import type { AdminProductVariant } from "@medusajs/framework/types";
import { Badge, Button, Container, Drawer, Heading, Input, Table, Text, toast } from "@medusajs/ui";
import { readVariantSrp } from "@zanreal/medusa-admin-kit";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatAmount, formatMarginLabel, parseInputCost } from "../lib/format";
import { sdk } from "../lib/sdk";
import { resolveSrpMargin } from "../lib/srp-margin";
import type { SrpMargin } from "../lib/srp-margin";

/**
 * The cost card, rendered on both the product page and the variant page.
 *
 * It lives here rather than in a widget because it is now mounted twice. The
 * owner's complaint was that costing a variant meant going back out to the
 * product ("jak wejdę w wariant to już nie widzę tych informacji, są tylko w
 * produkcie"), so the same card renders on `product.details.after` with every
 * variant of the product, and on `product_variant.details.after` with just the
 * one. Two widgets, one component: the save path, the history drawer and the
 * margin maths cannot drift apart between the two pages because there is only
 * one of each.
 *
 * ## Why it fetches its own variants
 *
 * A product detail page never hands a widget its variants. The dashboard loads
 * the product for `product.details.*` with
 * `PRODUCT_DETAIL_FIELDS = getLinkedFields("product", "*categories,*shipping_profile,-variants")`
 * (see `@medusajs/dashboard/src/routes/products/product-detail/constants.ts`).
 * The `-variants` there is an explicit exclusion: it fetches the variant table
 * separately with `useProductVariants`. So `data.variants` is `undefined` on
 * that page, and a widget that gated its render on `data.variants.length` -
 * as this one did - returned `null` and never appeared at all. That was read at
 * the time as a stale admin bundle; it was not, and no rebuild would ever have
 * fixed it.
 *
 * The variant page has the mirror-image problem: it hands over one variant but
 * no product, and the SRP falls back to the product's metadata, so the product
 * is fetched when the caller cannot supply it.
 */
const VARIANT_FETCH_LIMIT = 200;

/**
 * Variant fields this card needs. `metadata` is what carries the SRP the margin
 * is measured against, so it is not optional here even though the cost itself
 * does not need it.
 */
const VARIANT_FIELDS = "id,title,sku,metadata,*prices";

interface ConfigResponse {
  /** `null` when no VAT rate is configured - this plugin ships no default one. */
  vatRate: number | null;
  /** `null` when no default currency is configured - this plugin ships no default one. */
  defaultCurrency: string | null;
}

interface CostPriceDTO {
  sku: string;
  unit_cost_net: number;
  currency: string;
}

interface CostHistoryDTO {
  id: string;
  sku: string;
  unit_cost_net: number;
  currency: string;
  source: string;
  changed_by: string | null;
  changed_at: string;
}

interface CostRow {
  variantId: string;
  variantTitle: string;
  sku: string;
  /** String-bound to the input; parsed on save. */
  unitCostNet: string;
  currency: string;
  /** The variant's SRP, when it or its product carries one. */
  srp?: number;
  saving: boolean;
}

// i18next interpolation only fires once a translation resource is actually
// loaded; without one (this plugin's own component tests, which render with
// no i18next instance configured) `t(key, defaultValue)` returns
// `defaultValue` verbatim, `{{tokens}}` included. Substituting by hand here
// keeps both paths - translated and untranslated - correct the same way.
const interpolate = (template: string, values: Record<string, string | number>): string =>
  Object.entries(values).reduce(
    (result, [key, value]) => result.split(`{{${key}}}`).join(String(value)),
    template,
  );

export interface ProductCostCardProps {
  /** The product whose variants are costed. */
  productId: string;
  /** When set, the card shows only this variant - the variant detail page. */
  variantId?: string;
  /**
   * The product's own metadata, when the caller already has it. The SRP falls
   * back to it, so the card fetches the product itself when this is omitted.
   */
  productMetadata?: Record<string, unknown> | null;
  /** Variants the host page already loaded, if it ever does. */
  embeddedVariants?: AdminProductVariant[] | null;
}

export const ProductCostCard = ({
  embeddedVariants,
  productId,
  productMetadata,
  variantId,
}: ProductCostCardProps) => {
  const { i18n, t } = useTranslation();
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [rows, setRows] = useState<CostRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [historySku, setHistorySku] = useState<string | null>(null);
  const [history, setHistory] = useState<CostHistoryDTO[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      const [configRes, allVariants, resolvedProductMetadata] = await Promise.all([
        sdk.client.fetch<ConfigResponse>("/admin/product-costs/config"),
        embeddedVariants
          ? Promise.resolve(embeddedVariants)
          : sdk.admin.product
              .listVariants(productId, {
                fields: VARIANT_FIELDS,
                limit: VARIANT_FETCH_LIMIT,
              })
              .then((response) => response.variants ?? []),
        productMetadata === undefined
          ? sdk.admin.product
              .retrieve(productId, { fields: "id,metadata" })
              .then((response) => response.product?.metadata ?? null)
              .catch(() => null)
          : Promise.resolve(productMetadata),
      ]);

      if (cancelled) {
        return;
      }

      // The variant page shows one row. Filtering the product's variants keeps
      // one fetch path for both pages rather than a second retrieve-by-id.
      const variants = variantId
        ? allVariants.filter((variant) => variant.id === variantId)
        : allVariants;

      const skus = [
        ...new Set(
          variants.map((variant) => variant.sku).filter((sku): sku is string => Boolean(sku)),
        ),
      ];
      const costsRes =
        skus.length > 0
          ? await sdk.client.fetch<{ cost_prices: CostPriceDTO[] }>("/admin/product-costs", {
              query: { limit: skus.length, sku: skus },
            })
          : { cost_prices: [] as CostPriceDTO[] };

      if (cancelled) {
        return;
      }

      const bySku = new Map(costsRes.cost_prices.map((costPrice) => [costPrice.sku, costPrice]));

      setConfig(configRes);
      setRows(
        variants.map((variant) => {
          const existing = variant.sku ? bySku.get(variant.sku) : undefined;
          // admin-kit's own reader, so this card and the Catalog's SRP column
          // can never disagree about what a variant's SRP is.
          const srp = readVariantSrp({
            metadata: variant.metadata,
            product: { metadata: resolvedProductMetadata },
          });
          return {
            currency: existing?.currency ?? configRes.defaultCurrency ?? "",
            saving: false,
            sku: variant.sku ?? "",
            srp: srp === null ? undefined : srp,
            unitCostNet: existing ? String(existing.unit_cost_net) : "",
            variantId: variant.id,
            variantTitle: variant.title ?? variant.sku ?? variant.id,
          };
        }),
      );
      setLoading(false);
    }

    load().catch((error: unknown) => {
      if (!cancelled) {
        setLoading(false);
        toast.error(
          error instanceof Error
            ? error.message
            : t("productCosts.widget.loadError", "Failed to load product costs"),
        );
      }
    });

    return () => {
      cancelled = true;
    };
    // Re-run only when the product (or the single variant) changes.
  }, [productId, variantId, embeddedVariants, productMetadata]);

  const updateRow = (rowVariantId: string, value: string) => {
    setRows((prev) =>
      prev.map((row) => (row.variantId === rowVariantId ? { ...row, unitCostNet: value } : row)),
    );
  };

  const save = async (row: CostRow) => {
    if (!row.sku) {
      toast.error(
        t("productCosts.widget.noSkuError", "This variant has no SKU - add one before setting a cost."),
      );
      return;
    }
    const unitCostNet = parseInputCost(row.unitCostNet);
    if (unitCostNet === undefined) {
      toast.error(t("productCosts.widget.invalidCostError", "Enter a positive net cost."));
      return;
    }

    setRows((prev) => prev.map((r) => (r.variantId === row.variantId ? { ...r, saving: true } : r)));

    try {
      const res = await sdk.client.fetch<{ cost_price: CostPriceDTO }>("/admin/product-costs", {
        body: { sku: row.sku, unit_cost_net: unitCostNet },
        method: "POST",
      });
      setRows((prev) =>
        prev.map((r) =>
          r.variantId === row.variantId
            ? {
                ...r,
                currency: res.cost_price.currency,
                saving: false,
                unitCostNet: String(res.cost_price.unit_cost_net),
              }
            : r,
        ),
      );
      toast.success(
        interpolate(t("productCosts.widget.savedCost", "Saved cost for {{sku}}"), { sku: row.sku }),
      );
    } catch (error) {
      setRows((prev) =>
        prev.map((r) => (r.variantId === row.variantId ? { ...r, saving: false } : r)),
      );
      toast.error(
        error instanceof Error ? error.message : t("productCosts.widget.saveError", "Failed to save cost"),
      );
    }
  };

  const openHistory = async (sku: string) => {
    setHistorySku(sku);
    setHistoryLoading(true);
    try {
      const res = await sdk.client.fetch<{ history: CostHistoryDTO[] }>(
        `/admin/product-costs/${encodeURIComponent(sku)}/history`,
      );
      setHistory(res.history);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("productCosts.widget.historyLoadError", "Failed to load history"),
      );
    } finally {
      setHistoryLoading(false);
    }
  };

  /** The SRP margin cell: `KWOTA (PROCENT)`, or an amber marker naming what is missing. */
  const marginCell = (row: CostRow) => {
    const margin: SrpMargin = resolveSrpMargin({
      netCost: parseInputCost(row.unitCostNet),
      srp: row.srp,
      vatRate: config?.vatRate ?? null,
    });
    if (margin.state !== "resolved") {
      const label =
        margin.state === "no-vat-rate"
          ? t("productCosts.widget.noVatRate", "no VAT rate")
          : (margin.state === "no-cost"
            ? t("productCosts.widget.noCost", "no purchase cost")
            : t("productCosts.widget.noSrp", "no SRP"));
      return (
        <Text className="text-ui-tag-orange-text" size="xsmall">
          {label}
        </Text>
      );
    }
    return (
      <Badge color={margin.netIncome >= 0 ? "green" : "red"} size="2xsmall">
        {formatMarginLabel(margin.netIncome, margin.marginPct, row.currency, i18n.language)}
      </Badge>
    );
  };

  // Only hide once the fetch has actually settled and there really is nothing
  // to show. Bailing out before that is what kept this card off the page.
  if (!loading && rows.length === 0) {
    return null;
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">{t("productCosts.widget.heading", "Product costs")}</Heading>
        {config ? (
          <Text className="text-ui-fg-subtle" size="small">
            {config.vatRate === null
              ? t("productCosts.widget.vatNotSet", "VAT not set")
              : interpolate(t("productCosts.widget.vatPercent", "VAT {{percent}}%"), {
                  percent: Math.round(config.vatRate * 100),
                })}{" "}
            · {config.defaultCurrency ?? t("productCosts.widget.currencyNotSet", "currency not set")}
          </Text>
        ) : null}
      </div>
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>{t("productCosts.widget.columns.variant", "Variant")}</Table.HeaderCell>
            <Table.HeaderCell>{t("productCosts.widget.columns.sku", "SKU")}</Table.HeaderCell>
            <Table.HeaderCell>
              {t("productCosts.widget.columns.netCost", "Purchase cost")}
            </Table.HeaderCell>
            <Table.HeaderCell>
              {t("productCosts.widget.columns.grossCost", "Gross (incl. VAT)")}
            </Table.HeaderCell>
            <Table.HeaderCell>
              {t("productCosts.widget.columns.srpMargin", "SRP margin")}
            </Table.HeaderCell>
            <Table.HeaderCell />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {loading ? (
            <Table.Row>
              <Table.Cell>
                <Text size="small">{t("productCosts.common.loading", "Loading...")}</Text>
              </Table.Cell>
              <Table.Cell />
              <Table.Cell />
              <Table.Cell />
              <Table.Cell />
              <Table.Cell />
            </Table.Row>
          ) : (
            rows.map((row) => {
              const netCost = parseInputCost(row.unitCostNet);
              // No VAT rate configured means no honest gross cost to show. It
              // stays blank rather than being computed off a rate this plugin
              // would have had to invent.
              const grossCost =
                config && config.vatRate !== null && netCost !== undefined
                  ? netCost * (1 + config.vatRate)
                  : undefined;
              return (
                <Table.Row key={row.variantId}>
                  <Table.Cell>{row.variantTitle}</Table.Cell>
                  <Table.Cell>
                    {row.sku || (
                      <Text className="text-ui-fg-muted">
                        {t("productCosts.widget.noSku", "no sku")}
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex items-center gap-2">
                      <Input
                        className="w-28"
                        onChange={(event) => updateRow(row.variantId, event.target.value)}
                        placeholder="0.00"
                        size="small"
                        value={row.unitCostNet}
                      />
                      <Text className="text-ui-fg-muted" size="small">
                        {row.currency}
                      </Text>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small">
                      {formatAmount(grossCost)} {row.currency}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>{marginCell(row)}</Table.Cell>
                  <Table.Cell>
                    <div className="flex justify-end gap-x-2">
                      <Button
                        isLoading={row.saving}
                        onClick={() => save(row)}
                        size="small"
                        variant="secondary"
                      >
                        {t("productCosts.widget.save", "Save")}
                      </Button>
                      <Button
                        disabled={!row.sku}
                        onClick={() => openHistory(row.sku)}
                        size="small"
                        variant="transparent"
                      >
                        {t("productCosts.widget.history", "History")}
                      </Button>
                    </div>
                  </Table.Cell>
                </Table.Row>
              );
            })
          )}
        </Table.Body>
      </Table>

      <Drawer onOpenChange={(open) => !open && setHistorySku(null)} open={historySku !== null}>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>
              {interpolate(t("productCosts.widget.historyTitle", "Cost history for {{sku}}"), {
                sku: historySku ?? "",
              })}
            </Drawer.Title>
          </Drawer.Header>
          <Drawer.Body>
            {historyLoading ? (
              <Text size="small">{t("productCosts.common.loading", "Loading...")}</Text>
            ) : (history.length === 0 ? (
              <Text size="small">{t("productCosts.widget.noHistory", "No history recorded yet.")}</Text>
            ) : (
              <Table>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>
                      {t("productCosts.widget.historyColumns.cost", "Cost")}
                    </Table.HeaderCell>
                    <Table.HeaderCell>
                      {t("productCosts.widget.historyColumns.source", "Source")}
                    </Table.HeaderCell>
                    <Table.HeaderCell>
                      {t("productCosts.widget.historyColumns.changedBy", "Changed by")}
                    </Table.HeaderCell>
                    <Table.HeaderCell>
                      {t("productCosts.widget.historyColumns.changedAt", "Changed at")}
                    </Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {history.map((entry) => (
                    <Table.Row key={entry.id}>
                      <Table.Cell>
                        {entry.unit_cost_net} {entry.currency}
                      </Table.Cell>
                      <Table.Cell>{entry.source}</Table.Cell>
                      <Table.Cell>{entry.changed_by ?? "-"}</Table.Cell>
                      <Table.Cell>{new Date(entry.changed_at).toLocaleString()}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            ))}
          </Drawer.Body>
        </Drawer.Content>
      </Drawer>
    </Container>
  );
};
