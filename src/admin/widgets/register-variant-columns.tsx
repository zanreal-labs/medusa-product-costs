import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { Text } from "@medusajs/ui";
import { readVariantSrp, registerVariantColumn } from "@zanreal/medusa-admin-kit";
import type { CatalogProduct } from "@zanreal/medusa-admin-kit";
import { getI18n } from "react-i18next";
import { createBatcher } from "../lib/batch";
import { formatMarginLabel, formatMoney } from "../lib/format";
import { sdk } from "../lib/sdk";
import { resolveSrpMargin } from "../lib/srp-margin";
import type { SrpMargin } from "../lib/srp-margin";
import { resolveVariantCost } from "../lib/variant-cost";
import type { CostPriceLike, VariantCost } from "../lib/variant-cost";

/**
 * `registerVariantColumn` runs at module-evaluation time (see the note
 * below), outside any component render, so `cell` and `header` cannot call
 * the `useTranslation` hook. `getI18n()` reads the same i18next instance the
 * hook itself falls back to (`i18nFromContext || getI18n()`), so this stays
 * in step with whatever the host dashboard has configured - and falls back
 * to the given English text, unchanged, when no instance exists yet.
 */
const t = (key: string, defaultValue: string): string => {
  const i18n = getI18n();
  return i18n ? i18n.t(key, defaultValue) : defaultValue;
};

/** The admin's current language, for locale-aware money and percentages. */
const locale = (): string | undefined => getI18n()?.language;

/**
 * Registers this plugin's per-variant columns in the shared, extensible
 * catalogue list (`@zanreal/medusa-admin-kit`'s Catalog route).
 *
 * These calls must live at the top level of this file - not in the component
 * body, not in an effect - because the admin build statically imports every
 * widget into `virtual:medusa/widgets`, which the dashboard evaluates once at
 * boot. `registerVariantColumn` runs then, strictly before anyone can
 * navigate to Catalog, so the columns are always present by the time that
 * route's table reads the registry. See the admin-kit README's "contributor
 * contract" for the full explanation of why this is not optional.
 *
 * ## Two columns, one lookup
 *
 * The owner reads this list to decide what to buy and what to reprice, so it
 * carries both the purchase cost and what that cost leaves at the SRP. The two
 * are separate columns because they are separate decisions - a cost is a fact
 * about a supplier, a margin is a fact about a price - and because a single
 * cell holding both would be the "za dużo zbędnych informacji" this list is
 * being trimmed of.
 *
 * They share one `loadData` result and one batch, so a page of rows costs two
 * requests in total rather than one per row per column. That is also a
 * straight improvement on the cost column's previous behaviour, which fetched
 * `/admin/product-costs?limit=1&sku=...` once per row.
 *
 * ## Missing data is shown, not hidden
 *
 * Every unresolvable figure names what is missing, in amber. A quiet dash in a
 * cost column reads as "nothing to see", and the whole reason this store looks
 * at the column is to find the variants nobody has costed yet.
 *
 * ## What is NOT here
 *
 * There is no Allegro margin column in this plugin, and no dependency on
 * `@zanreal/medusa-allegro`. The commission-inclusive margin against the live
 * marketplace price needs the commission table and the offer's current price,
 * both of which only that plugin holds - and it already resolves this plugin's
 * module at runtime as a soft dependency, so the reverse edge would be a cycle
 * and would make this plugin uninstallable without Allegro. That column is
 * registered by the Allegro plugin, into this same registry, and lands beside
 * these two.
 */

interface ConfigResponse {
  /** `null` when no VAT rate is configured - this plugin ships no default one. */
  vatRate: number | null;
  /** `null` when no default currency is configured - this plugin ships no default one. */
  defaultCurrency: string | null;
}

/**
 * The VAT rate and default currency rarely change and are identical for every
 * row, so they are fetched once per table mount (not once per row) and shared.
 * A failed fetch clears the cache so the next batch retries rather than every
 * row being stuck on one transient failure forever.
 */
let configPromise: Promise<ConfigResponse> | undefined;

function loadConfig(): Promise<ConfigResponse> {
  if (!configPromise) {
    configPromise = sdk.client.fetch<ConfigResponse>("/admin/product-costs/config").catch(
      (error: unknown) => {
        configPromise = undefined;
        throw error;
      },
    );
  }
  return configPromise;
}

/** Everything both columns need for one variant, resolved together. */
export interface CatalogEconomics {
  /** The curated purchase cost, or `null` when this SKU has none on file. */
  cost: VariantCost | null;
  /** What that cost leaves at the variant's SRP, or why it could not be worked out. */
  srpMargin: SrpMargin;
  /** The currency the margin label is rendered in. */
  currency: string;
}

/** The slice of a variant row the SRP is read from. */
interface VariantSrpRow {
  sku?: string | null;
  metadata?: Record<string, unknown> | null;
  product?: { metadata?: Record<string, unknown> | null } | null;
}

/**
 * One batch: the costs for a set of SKUs and the SRP metadata for the same
 * SKUs, in two parallel requests, indexed by SKU.
 *
 * The SRP has to be fetched rather than read off the row because the Catalog's
 * contributed-column context carries a normalized variant (`id`, `sku`,
 * `title`, `thumbnail`) and the parent product - not the variant's own
 * `metadata`, which is where an SRP usually lives. Asking the variants route
 * for the exact SKU set costs one request per page, and `readVariantSrp` is
 * admin-kit's own reader, so this column and the kit's SRP column can never
 * disagree about what a variant's SRP is.
 */
const fetchEconomics = async (skus: string[]): Promise<Map<string, CatalogEconomics>> => {
  const [config, costsResponse, variantsResponse] = await Promise.all([
    loadConfig(),
    sdk.client.fetch<{ cost_prices: CostPriceLike[] }>("/admin/product-costs", {
      query: { limit: skus.length, sku: skus },
    }),
    sdk.client.fetch<{ variants: VariantSrpRow[] }>("/admin/product-variants", {
      query: {
        fields: "id,sku,metadata,product.metadata",
        limit: skus.length,
        sku: skus,
      },
    }),
  ]);

  const srpBySku = new Map<string, number>();
  for (const variant of variantsResponse.variants ?? []) {
    const srp = readVariantSrp(variant);
    if (variant.sku && srp !== null) {
      srpBySku.set(variant.sku, srp);
    }
  }

  const bySku = new Map<string, CatalogEconomics>();
  for (const sku of skus) {
    const cost = resolveVariantCost(costsResponse.cost_prices, sku, config.vatRate);
    bySku.set(sku, {
      cost,
      currency: cost?.currency ?? config.defaultCurrency ?? "",
      srpMargin: resolveSrpMargin({
        netCost: cost?.netCost,
        srp: srpBySku.get(sku),
        vatRate: config.vatRate,
      }),
    });
  }
  return bySku;
};

/** The one batcher both columns share, so they never race for the same page. */
const economicsBatcher = createBatcher(fetchEconomics);

/** A SKU-less variant can be matched to nothing; skip the network entirely. */
const loadEconomics = async (sku: string | null): Promise<CatalogEconomics | null> =>
  sku ? economicsBatcher.load(sku) : null;

/** An amber "this is missing and you should fix it" marker. */
const Missing = ({ label }: { label: string }) => (
  <Text className="text-ui-tag-orange-text" size="xsmall">
    {label}
  </Text>
);

const Loading = () => (
  <Text className="text-ui-fg-muted" size="small">
    {t("productCosts.catalogColumn.loading", "...")}
  </Text>
);

const Failed = () => (
  <Text className="text-ui-fg-error" size="small">
    {t("productCosts.catalogColumn.error", "error")}
  </Text>
);

registerVariantColumn<CatalogProduct, CatalogEconomics | null>({
  cell: (_ctx, async) => {
    if (!async || async.isLoading) {
      return <Loading />;
    }
    if (async.error) {
      return <Failed />;
    }
    const cost = async.data?.cost;
    if (!cost) {
      // Amber, not a muted dash: an uncosted variant is the thing this column
      // exists to find, and it silently read as "nothing here" before.
      return <Missing label={t("productCosts.catalogColumn.noCost", "no purchase cost")} />;
    }
    return (
      <span className="flex w-full justify-end tabular-nums">
        <Text size="small">{formatMoney(cost.netCost, cost.currency, locale())}</Text>
      </span>
    );
  },
  header: t("productCosts.catalogColumn.header", "Purchase cost"),
  id: "product-costs.cost",
  loadData: async (ctx) => loadEconomics(ctx.sku),
  priority: 20,
});

registerVariantColumn<CatalogProduct, CatalogEconomics | null>({
  cell: (_ctx, async) => {
    if (!async || async.isLoading) {
      return <Loading />;
    }
    if (async.error) {
      return <Failed />;
    }
    const data = async.data;
    if (!data) {
      return <Missing label={t("productCosts.catalogColumn.noSku", "no sku")} />;
    }
    const margin = data.srpMargin;
    switch (margin.state) {
      case "no-vat-rate": {
        return <Missing label={t("productCosts.catalogColumn.noVatRate", "no VAT rate")} />;
      }
      case "no-cost": {
        return <Missing label={t("productCosts.catalogColumn.noCost", "no purchase cost")} />;
      }
      case "no-srp": {
        // Never substituted with the shop price: an SRP margin measured against
        // a discounted shop price is a number an operator would price against
        // and be wrong.
        return <Missing label={t("productCosts.catalogColumn.noSrp", "no SRP")} />;
      }
      default: {
        return (
          <span className="flex w-full justify-end tabular-nums">
            <Text className={margin.netIncome < 0 ? "text-ui-fg-error" : undefined} size="small">
              {formatMarginLabel(margin.netIncome, margin.marginPct, data.currency, locale())}
            </Text>
          </span>
        );
      }
    }
  },
  header: t("productCosts.catalogColumn.srpMarginHeader", "SRP margin"),
  id: "product-costs.srp_margin",
  loadData: async (ctx) => loadEconomics(ctx.sku),
  priority: 21,
});

const RegisterProductCostsColumnsWidget = () => null;

export const config = defineWidgetConfig({
  zone: "product.list.before",
});

export default RegisterProductCostsColumnsWidget;
