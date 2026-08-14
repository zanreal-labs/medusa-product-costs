import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { Text } from "@medusajs/ui";
import { registerVariantColumn } from "@zanreal/medusa-admin-kit";
import type { CatalogProduct } from "@zanreal/medusa-admin-kit";
import { formatVariantCost, resolveVariantCost } from "../lib/variant-cost";
import type { CostPriceLike, VariantCost } from "../lib/variant-cost";
import { sdk } from "../lib/sdk";

/**
 * Registers the per-variant cost column in the shared, extensible catalogue
 * list (`@zanreal/medusa-admin-kit`'s Catalog route).
 *
 * This call must live at the top level of this file - not in the component
 * body, not in an effect - because the admin build statically imports every
 * widget into `virtual:medusa/widgets`, which the dashboard evaluates once at
 * boot. `registerVariantColumn` runs then, strictly before anyone can
 * navigate to Catalog, so the column is always present by the time that
 * route's table reads the registry. See the admin-kit README's "contributor
 * contract" for the full explanation of why this is not optional.
 *
 * The lookup is a network call keyed by the row's SKU, so it goes through
 * `loadData` rather than `cell`: the Catalog table renders immediately with
 * this column showing its loading state, then re-renders once that SKU's cost
 * resolves. A variant with no SKU never hits the network.
 *
 * The cell shows the variant's actual net cost. It used to show a coverage
 * ratio ("12/13 costed") because a row was a product and a product has many
 * costs; a row is now one variant, so it has one cost, and that is what a cost
 * column should say.
 */

interface ConfigResponse {
  /** `null` when no VAT rate is configured - this plugin ships no default one. */
  vatRate: number | null;
  /** `null` when no default currency is configured - this plugin ships no default one. */
  defaultCurrency: string | null;
}

/**
 * The VAT rate rarely changes and is identical for every row, so it is
 * fetched once per table mount (not once per row) and shared. A failed fetch
 * clears the cache so the next row's `loadData` retries rather than every row
 * being stuck on one transient failure forever.
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

registerVariantColumn<CatalogProduct, VariantCost | null>({
  cell: (_ctx, async) => {
    if (!async || async.isLoading) {
      return (
        <Text className="text-ui-fg-muted" size="small">
          ...
        </Text>
      );
    }
    if (async.error) {
      return (
        <Text className="text-ui-fg-error" size="small">
          error
        </Text>
      );
    }
    const cost = async.data;
    if (!cost) {
      return (
        <Text className="text-ui-fg-muted" size="small">
          not costed
        </Text>
      );
    }
    return (
      <div className="flex flex-col">
        <Text size="small">{formatVariantCost(cost)}</Text>
        <Text className="text-ui-fg-muted" size="xsmall">
          {cost.grossCost === undefined
            ? "no VAT rate set"
            : `${cost.grossCost.toFixed(2)} incl. VAT`}
        </Text>
      </div>
    );
  },
  header: "Cost",
  id: "product-costs.cost",
  loadData: async (ctx) => {
    if (!ctx.sku) {
      return null;
    }
    const [config, costsResponse] = await Promise.all([
      loadConfig(),
      sdk.client.fetch<{ cost_prices: CostPriceLike[] }>("/admin/product-costs", {
        query: { limit: 1, sku: ctx.sku },
      }),
    ]);
    return resolveVariantCost(costsResponse.cost_prices, ctx.sku, config.vatRate);
  },
  priority: 20,
});

const RegisterProductCostsColumnsWidget = () => null;

export const config = defineWidgetConfig({
  zone: "product.list.before",
});

export default RegisterProductCostsColumnsWidget;
