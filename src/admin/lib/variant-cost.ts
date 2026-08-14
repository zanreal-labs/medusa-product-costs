import { grossFromNet, round2 } from "../../modules/product-costs/lib/money";

/**
 * One variant's curated cost, as the Catalog column renders it.
 *
 * There is nothing to aggregate here any more. The admin-kit Catalog lists one
 * variant per row, so this resolves the single cost row that belongs to that
 * variant's SKU. The predecessor rolled a product's variants up into a coverage
 * ratio ("12/13 costed") plus an average, which answered a question nobody
 * asked: what an operator wants from a cost column is the cost.
 *
 * Kept framework-free, same as the rest of `src/admin/lib`, so it is
 * unit-testable without a React renderer - see `__tests__/variant-cost.test.ts`.
 *
 * Deliberately does not compute margin: margin needs the variant's selling
 * price, which the Catalog route's query does not fetch (see that kit's
 * `VARIANT_LIST_FIELDS`). Adding a second per-row fetch just for this column
 * would double the request count of every installed catalogue for a figure the
 * product detail widget already shows accurately, against the real price. This
 * column stays a cost; margin stays on the product detail page.
 */
export interface CostPriceLike {
  sku: string;
  unit_cost_net: number;
  currency: string;
}

export interface VariantCost {
  /** The variant's curated net purchase cost. */
  netCost: number;
  /** `netCost` grossed up by the plugin's configured VAT rate. */
  grossCost: number;
  /** The currency the cost is recorded in. */
  currency: string;
}

/**
 * Pick the cost row belonging to `sku` out of a `/admin/product-costs`
 * response and shape it for the column.
 *
 * Returns `null` when the variant has no SKU, or has one with no curated cost -
 * both render as "not costed", which is a fact about that one variant rather
 * than a fraction of a product.
 */
export function resolveVariantCost(
  costPrices: CostPriceLike[],
  sku: string | null,
  vatRate: number,
): VariantCost | null {
  if (!sku) {
    return null;
  }
  const match = costPrices.find((cost) => cost.sku === sku);
  if (!match) {
    return null;
  }

  const netCost = round2(match.unit_cost_net);
  return {
    currency: match.currency,
    grossCost: grossFromNet(netCost, vatRate),
    netCost,
  };
}

/**
 * Render a resolved cost as the column's label, e.g. `"12.50 PLN"`. Plain, and
 * exactly one number: the net purchase cost of this variant.
 */
export function formatVariantCost(cost: VariantCost): string {
  return `${cost.netCost.toFixed(2)} ${cost.currency}`;
}
