import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { registerProductColumn } from "@zanreal/medusa-admin-kit";
import type { ProductColumnProduct } from "@zanreal/medusa-admin-kit";
import { StatusBadge, Text } from "@medusajs/ui";
import { formatCostStatus, summarizeCostStatus } from "../lib/cost-status";
import type { CostPriceLike, CostStatusSummary } from "../lib/cost-status";
import { sdk } from "../lib/sdk";

/**
 * Registers the per-product cost-coverage column in the shared, extensible
 * products list (`@zanreal/medusa-admin-kit`'s Catalog route).
 *
 * This call must live at the top level of this file - not in the component
 * body, not in an effect - because the admin build statically imports every
 * widget into `virtual:medusa/widgets`, which the dashboard evaluates once at
 * boot. `registerProductColumn` runs then, strictly before anyone can
 * navigate to Catalog, so the column is always present by the time that
 * route's table reads the registry. See the admin-kit README's "contributor
 * contract" for the full explanation of why this is not optional.
 *
 * The lookup is a network call keyed by the row's SKUs, so it goes through
 * `loadData` rather than `cell`: the Catalog table renders immediately with
 * this column showing its loading state, then re-renders once the cost rows
 * for that row's SKUs resolve. A product with no SKUs never hits the network.
 */

interface ConfigResponse {
  vatRate: number;
  defaultCurrency: string;
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

registerProductColumn<ProductColumnProduct, CostStatusSummary>({
  cell: (_ctx, async) => {
    if (!async || async.isLoading) {
      return (
        <Text className="text-ui-fg-muted" size="small">
          ...
        </Text>
      );
    }
    if (async.error) {
      return <StatusBadge color="red">error</StatusBadge>;
    }
    const summary = async.data;
    if (!summary || summary.costedCount === 0) {
      return (
        <Text className="text-ui-fg-muted" size="small">
          not costed
        </Text>
      );
    }
    const fullyCosted = summary.costedCount === summary.variantCount;
    return (
      <StatusBadge color={fullyCosted ? "green" : "orange"}>
        {formatCostStatus(summary)}
      </StatusBadge>
    );
  },
  header: "Cost",
  id: "product-costs.margin",
  loadData: async (ctx) => {
    if (ctx.skus.length === 0) {
      return { costedCount: 0, variantCount: ctx.variantCount };
    }
    const [config, costsResponse] = await Promise.all([
      loadConfig(),
      sdk.client.fetch<{ cost_prices: CostPriceLike[] }>("/admin/product-costs", {
        query: { limit: ctx.skus.length, sku: ctx.skus },
      }),
    ]);
    return summarizeCostStatus(costsResponse.cost_prices, ctx.variantCount, config.vatRate);
  },
  priority: 20,
});

const RegisterProductCostsColumnsWidget = () => null;

export const config = defineWidgetConfig({
  zone: "product.list.before",
});

export default RegisterProductCostsColumnsWidget;
