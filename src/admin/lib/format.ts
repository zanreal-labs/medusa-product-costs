/**
 * Pure display helpers shared by the product-cost admin surfaces.
 *
 * Deliberately dependency-free - no Medusa server imports, no React - so the
 * admin bundle stays small and every branch here is unit-testable in isolation
 * (see `__tests__/format.test.ts`). The money math itself lives in the module's
 * `lib/economics.ts`, which this file formats the output of.
 */

/** The subset of an admin variant price this UI reads. */
export interface VariantPriceLike {
  amount?: number | null;
  currency_code?: string | null;
  min_quantity?: number | null;
}

/**
 * Parse a net-cost text field into a positive number, tolerating a decimal
 * comma (`"12,50"` -> `12.5`). Returns `undefined` for blank / zero / negative
 * / NaN so a caller can treat "no usable value" uniformly rather than saving a
 * nonsense cost.
 */
export function parseInputCost(raw: string): number | undefined {
  const value = Number.parseFloat(raw.replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Pick the variant price that matches the plugin's default currency, so the
 * widget can show a margin against the price the store actually sells at.
 *
 * Currency codes are compared case-insensitively (Medusa stores lowercase ISO
 * codes; the plugin option is uppercase). A base price - one with no quantity
 * threshold - is preferred over any tiered price so the margin reflects a
 * single-unit sale rather than a bulk break.
 */
export function resolveVariantPrice(
  prices: VariantPriceLike[] | null | undefined,
  currency: string,
): number | undefined {
  if (!prices || prices.length === 0) {
    return undefined;
  }
  const wanted = currency.toLowerCase();
  const matches = prices.filter((price) => (price.currency_code ?? "").toLowerCase() === wanted);
  if (matches.length === 0) {
    return undefined;
  }
  const base = matches.find((price) => price.min_quantity == null) ?? matches[0];
  const { amount } = base;
  return typeof amount === "number" && Number.isFinite(amount) ? amount : undefined;
}

/** Format a ratio (`0.421`) as a percentage string (`"42.1%"`), or `"-"`. */
export function formatPercent(fraction?: number): string {
  if (fraction === undefined || !Number.isFinite(fraction)) {
    return "-";
  }
  return `${(fraction * 100).toFixed(1)}%`;
}

/** Format a money amount to 2 decimal places, or `"-"` when undefined. */
export function formatAmount(value?: number): string {
  return value === undefined || !Number.isFinite(value) ? "-" : value.toFixed(2);
}
