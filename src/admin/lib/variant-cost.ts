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
  /** `netCost` grossed up by the plugin's configured VAT rate, or `undefined` when no rate is configured. */
  grossCost: number | undefined;
  /** The currency the cost is recorded in. */
  currency: string;
  /**
   * How many *other* currencies this SKU is also costed in. Zero for the
   * single-currency store, which is most of them. The column appends it so a
   * figure that is one of several never passes for the whole story.
   */
  otherCurrencies: number;
}

/**
 * Pick the cost row belonging to `sku` out of a `/admin/product-costs`
 * response and shape it for the column.
 *
 * Returns `null` when the variant has no SKU, or has one with no curated cost -
 * both render as "not costed", which is a fact about that one variant rather
 * than a fraction of a product.
 *
 * A SKU can carry a cost in several currencies. `preferredCurrency` (the
 * store's default) decides which one this one-line column shows; the rest are
 * counted, not dropped silently. When the SKU has costs but none in the
 * preferred currency, the first row still wins over showing nothing - a cost
 * in the wrong currency is information, an empty cell is not - and the count
 * makes it visible that others exist.
 */
export function resolveVariantCost(
  costPrices: CostPriceLike[],
  sku: string | null,
  /** `null` when no VAT rate is configured: the net cost still reads true, the gross one cannot be worked out. */
  vatRate: number | null,
  /** `null`/omitted on a store that has configured no default currency. */
  preferredCurrency?: string | null,
): VariantCost | null {
  if (!sku) {
    return null;
  }
  const matches = costPrices.filter((cost) => cost.sku === sku);
  if (matches.length === 0) {
    return null;
  }
  const match = preferredCurrency
    ? (matches.find((cost) => cost.currency === preferredCurrency) ?? matches[0])
    : matches[0];
  if (!match) {
    return null;
  }

  const netCost = round2(match.unit_cost_net);
  return {
    currency: match.currency,
    grossCost: vatRate === null ? undefined : grossFromNet(netCost, vatRate),
    netCost,
    otherCurrencies: matches.length - 1,
  };
}

/**
 * Render a resolved cost as the column's label, e.g. `"12.50 PLN"`, or
 * `"12.50 PLN +1"` when the same SKU is also costed in another currency.
 */
export function formatVariantCost(cost: VariantCost): string {
  const label = `${cost.netCost.toFixed(2)} ${cost.currency}`;
  return cost.otherCurrencies > 0 ? `${label} +${cost.otherCurrencies}` : label;
}
