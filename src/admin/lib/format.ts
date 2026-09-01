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

/**
 * A margin as one compact label: `KWOTA (PROCENT)`, e.g. `"42,10 zł (27%)"`.
 *
 * This is the shape the owner asked for verbatim, and the reason it is one
 * helper rather than two call sites gluing strings: the amount and the
 * percentage are two readings of the same fact, so they have to round and
 * localise together everywhere they appear (the Catalog column, the product
 * card, the variant card).
 *
 * What it deliberately does NOT include is the anchor price. The card used to
 * append "at 199.00", and that sub-line is exactly what was asked to go: with
 * two margins side by side the anchor is implied by the column it sits under,
 * and repeating it doubled the width of the busiest part of the table.
 *
 * `Intl` does the formatting so the money follows the admin's own locale - a
 * Polish admin gets `42,10 zł`, an English one `PLN 42.10` - rather than this
 * plugin inventing a symbol table. The percentage is rounded to a whole number
 * on purpose: a margin is a decision aid here, and a trailing decimal is the
 * kind of precision that reads as noise in a dense column.
 *
 * Falls back to `"12.34 PLN"` when the currency is not a code `Intl` accepts,
 * which is what an unconfigured or hand-typed currency looks like. Returns
 * `"-"` when either half is unusable, so a caller can never render half a
 * label.
 */
export function formatMarginLabel(
  amount: number | undefined,
  fraction: number | undefined,
  currency: string,
  /** BCP 47 tag; defaults to the runtime's locale. */
  locale?: string,
): string {
  if (
    amount === undefined ||
    !Number.isFinite(amount) ||
    fraction === undefined ||
    !Number.isFinite(fraction)
  ) {
    return "-";
  }
  return `${formatMoney(amount, currency, locale)} (${formatPercentCompact(fraction, locale)})`;
}

/** Money in the admin's locale, falling back to `"12.34 XYZ"` for a currency `Intl` rejects. */
export function formatMoney(amount: number, currency: string, locale?: string): string {
  const code = currency.trim().toUpperCase();
  // `Intl` throws a RangeError on anything that is not a well-formed ISO 4217
  // code, and an unconfigured plugin legitimately has an empty currency, so the
  // throw is a normal path rather than an exceptional one.
  if (/^[A-Z]{3}$/.test(code)) {
    try {
      return new Intl.NumberFormat(locale, { currency: code, style: "currency" }).format(amount);
    } catch {
      // Fall through to the plain rendering below.
    }
  }
  const plain = amount.toFixed(2);
  return code ? `${plain} ${code}` : plain;
}

/** A ratio as a whole-number percentage (`0.271` -> `"27%"`), in the admin's locale. */
export function formatPercentCompact(fraction: number, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: 0,
      style: "percent",
    }).format(fraction);
  } catch {
    return `${Math.round(fraction * 100)}%`;
  }
}
