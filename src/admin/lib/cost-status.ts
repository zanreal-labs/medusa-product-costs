import { grossFromNet, round2 } from "../../modules/product-costs/lib/money";

/**
 * Product-level roll-up of a set of curated cost rows (one product's variants
 * can each carry their own cost, keyed by SKU). Kept framework-free, same as
 * the rest of `src/admin/lib`, so it is unit-testable without a React
 * renderer - see `__tests__/cost-status.test.ts`.
 *
 * Deliberately does not compute margin: margin needs each variant's selling
 * price, which the admin-kit Catalog route's product query does not fetch (it
 * requests only `id,title,handle,status,thumbnail,variants.id/title/sku` -
 * see that kit's `PRODUCT_LIST_FIELDS`). Adding a second per-row product fetch
 * just for this column's sake would turn one network call per row into two for
 * every installed catalogue, for a figure the product detail widget already
 * shows accurately (it has the real selling price). This column stays a cost
 * summary; margin remains on the product detail page.
 */
export interface CostPriceLike {
  sku: string;
  unit_cost_net: number;
  currency: string;
}

export interface CostStatusSummary {
  /** How many of the product's variants have a curated cost on file. */
  costedCount: number;
  /** The product's total variant count, costed or not. */
  variantCount: number;
  /**
   * Average net cost across the costed variants, only when they all share one
   * currency - averaging mismatched currencies would be meaningless.
   */
  avgNetCost?: number;
  /** `avgNetCost` grossed up by `vatRate`. Set exactly when `avgNetCost` is. */
  avgGrossCost?: number;
  /** Set only when every costed variant shares one currency. */
  currency?: string;
}

/**
 * Aggregate a product's cost rows (looked up by its variants' SKUs) into one
 * {@link CostStatusSummary} for the admin-kit Catalog column.
 */
export function summarizeCostStatus(
  costPrices: CostPriceLike[],
  variantCount: number,
  vatRate: number,
): CostStatusSummary {
  if (costPrices.length === 0) {
    return { costedCount: 0, variantCount };
  }

  const currencies = new Set(costPrices.map((cost) => cost.currency));
  if (currencies.size > 1) {
    // Coverage is still meaningful with mixed currencies; an averaged amount is not.
    return { costedCount: costPrices.length, variantCount };
  }
  const [currency] = currencies;

  const avgNetCost = round2(
    costPrices.reduce((sum, cost) => sum + cost.unit_cost_net, 0) / costPrices.length,
  );

  return {
    avgGrossCost: grossFromNet(avgNetCost, vatRate),
    avgNetCost,
    costedCount: costPrices.length,
    currency,
    variantCount,
  };
}

/**
 * Render a summary as the column's label, e.g. "2/3 costed - 12.50 PLN net"
 * or, with mixed currencies or none costed, just the coverage fraction.
 */
export function formatCostStatus(summary: CostStatusSummary): string {
  const coverage = `${summary.costedCount}/${summary.variantCount} costed`;
  if (summary.avgNetCost === undefined || summary.currency === undefined) {
    return coverage;
  }
  return `${coverage} - ${summary.avgNetCost.toFixed(2)} ${summary.currency} net`;
}
