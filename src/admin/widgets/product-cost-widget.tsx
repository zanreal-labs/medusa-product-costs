import { defineWidgetConfig } from "@medusajs/admin-sdk";
import type {
  AdminProduct,
  AdminProductVariant,
  DetailWidgetProps,
} from "@medusajs/framework/types";
import { Badge, Button, Container, Drawer, Heading, Input, Table, Text, toast } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { computeEconomics } from "../../modules/product-costs/lib/economics";
import { formatAmount, formatPercent, parseInputCost, resolveVariantPrice } from "../lib/format";
import { sdk } from "../lib/sdk";

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
  /** The variant's own sell price in the configured currency, when known. */
  sellingPrice?: number;
  saving: boolean;
}

/**
 * A product detail page never hands a widget its variants.
 *
 * The dashboard loads the product for `product.details.*` with
 * `PRODUCT_DETAIL_FIELDS = getLinkedFields("product", "*categories,*shipping_profile,-variants")`
 * (see `@medusajs/dashboard/src/routes/products/product-detail/constants.ts`).
 * The `-variants` there is an explicit exclusion: it fetches the variant table
 * separately with `useProductVariants`. So `data.variants` is `undefined` on
 * this page, and a widget that gated its render on `data.variants.length` -
 * as this one did - returned `null` and never appeared at all. That was read at
 * the time as a stale admin bundle; it was not, and no rebuild would ever have
 * fixed it.
 *
 * So the widget fetches its own variants, the same way the dashboard's own
 * variant section does. `data.variants` is still preferred when a future
 * dashboard version does pass it.
 */
const VARIANT_FETCH_LIMIT = 200;

/**
 * The primary place a cost is set. For every variant of the product it shows an
 * editable net cost, the live gross cost (grossed up by the plugin's configured
 * VAT rate), and - when the variant carries a sell price in the configured
 * currency - the margin at that price. All computed with the module's own
 * `computeEconomics`, so the widget never disagrees with the server.
 *
 * Saving a row calls the same admin API the CSV importer and the standalone
 * cost list use, so all three stay consistent, and each SKU's change history is
 * one click away in a drawer. Bulk CSV import and the plugin config now live in
 * Settings > Product costs; this widget is where per-product costing happens.
 */
const ProductCostWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
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

      const embedded = data.variants ?? null;
      const [configRes, variants] = await Promise.all([
        sdk.client.fetch<ConfigResponse>("/admin/product-costs/config"),
        embedded
          ? Promise.resolve(embedded as AdminProductVariant[])
          : sdk.admin.product
              .listVariants(data.id, {
                fields: "id,title,sku,*prices",
                limit: VARIANT_FETCH_LIMIT,
              })
              .then((response) => response.variants ?? []),
      ]);

      if (cancelled) {
        return;
      }

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
          return {
            currency: existing?.currency ?? configRes.defaultCurrency ?? "",
            saving: false,
            sellingPrice: configRes.defaultCurrency
              ? resolveVariantPrice(variant.prices, configRes.defaultCurrency)
              : undefined,
            sku: variant.sku ?? "",
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
        toast.error(error instanceof Error ? error.message : "Failed to load product costs");
      }
    });

    return () => {
      cancelled = true;
    };
    // Re-run only when the product (and therefore its variant set) changes.
  }, [data.id, data.variants]);

  const updateRow = (variantId: string, value: string) => {
    setRows((prev) =>
      prev.map((row) => (row.variantId === variantId ? { ...row, unitCostNet: value } : row)),
    );
  };

  const save = async (row: CostRow) => {
    if (!row.sku) {
      toast.error("This variant has no SKU - add one before setting a cost.");
      return;
    }
    const unitCostNet = parseInputCost(row.unitCostNet);
    if (unitCostNet === undefined) {
      toast.error("Enter a positive net cost.");
      return;
    }

    setRows((prev) =>
      prev.map((r) => (r.variantId === row.variantId ? { ...r, saving: true } : r)),
    );

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
      toast.success(`Saved cost for ${row.sku}`);
    } catch (error) {
      setRows((prev) =>
        prev.map((r) => (r.variantId === row.variantId ? { ...r, saving: false } : r)),
      );
      toast.error(error instanceof Error ? error.message : "Failed to save cost");
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
      toast.error(error instanceof Error ? error.message : "Failed to load history");
    } finally {
      setHistoryLoading(false);
    }
  };

  // Only hide once the fetch has actually settled and the product really has no
  // variants. Bailing out before that is what kept this widget off the page.
  if (!loading && rows.length === 0) {
    return null;
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Product costs</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Net purchase cost per variant. Gross is grossed up by VAT and is also the break-even
            sell price - this plugin applies no channel commission.
          </Text>
        </div>
        {config ? (
          <Text className="text-ui-fg-subtle" size="small">
            {config.vatRate === null ? "VAT not set" : `VAT ${Math.round(config.vatRate * 100)}%`} ·{" "}
            {config.defaultCurrency ?? "currency not set"}
          </Text>
        ) : null}
      </div>
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Variant</Table.HeaderCell>
            <Table.HeaderCell>SKU</Table.HeaderCell>
            <Table.HeaderCell>Net cost</Table.HeaderCell>
            <Table.HeaderCell>Gross (incl. VAT)</Table.HeaderCell>
            <Table.HeaderCell>Margin</Table.HeaderCell>
            <Table.HeaderCell />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {loading ? (
            <Table.Row>
              <Table.Cell>
                <Text size="small">Loading...</Text>
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
              // No VAT rate configured means no honest gross or margin to show.
              // Every dependent figure stays blank rather than being computed
              // off a rate this plugin would have had to invent.
              const econ =
                config && config.vatRate !== null
                  ? computeEconomics({
                      netCost,
                      sellingPrice: row.sellingPrice,
                      vatRate: config.vatRate,
                    })
                  : {};
              const marginKnown = econ.marginPct !== undefined;
              return (
                <Table.Row key={row.variantId}>
                  <Table.Cell>{row.variantTitle}</Table.Cell>
                  <Table.Cell>
                    {row.sku || <Text className="text-ui-fg-muted">no sku</Text>}
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
                      {formatAmount(econ.grossCost)} {row.currency}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    {marginKnown ? (
                      <div className="flex flex-col gap-y-1">
                        <Badge color={(econ.netIncome ?? 0) >= 0 ? "green" : "red"} size="2xsmall">
                          {formatPercent(econ.marginPct)}
                        </Badge>
                        <Text className="text-ui-fg-muted" size="xsmall">
                          {formatAmount(econ.netIncome)} {row.currency} at{" "}
                          {formatAmount(row.sellingPrice)}
                        </Text>
                      </div>
                    ) : (
                      <Text className="text-ui-fg-muted" size="xsmall">
                        {netCost === undefined ? "-" : `set a ${row.currency} price to see margin`}
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex justify-end gap-x-2">
                      <Button
                        isLoading={row.saving}
                        onClick={() => save(row)}
                        size="small"
                        variant="secondary"
                      >
                        Save
                      </Button>
                      <Button
                        disabled={!row.sku}
                        onClick={() => openHistory(row.sku)}
                        size="small"
                        variant="transparent"
                      >
                        History
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
            <Drawer.Title>Cost history for {historySku}</Drawer.Title>
          </Drawer.Header>
          <Drawer.Body>
            {historyLoading ? (
              <Text size="small">Loading...</Text>
            ) : (history.length === 0 ? (
              <Text size="small">No history recorded yet.</Text>
            ) : (
              <Table>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Cost</Table.HeaderCell>
                    <Table.HeaderCell>Source</Table.HeaderCell>
                    <Table.HeaderCell>Changed by</Table.HeaderCell>
                    <Table.HeaderCell>Changed at</Table.HeaderCell>
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

export const config = defineWidgetConfig({
  zone: "product.details.after",
});

export default ProductCostWidget;
