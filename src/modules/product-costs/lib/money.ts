/**
 * Money helpers for the product costs module. Centralized so the rounding
 * strategy never drifts between the service, the CSV importer, and the
 * economics calculator.
 */

/**
 * Round to 2 decimal places, half-up. Uses `Number.EPSILON` to bias the
 * binary floating-point representation away from the tie-to-even direction,
 * so values like `1.005` round to `1.01` instead of `1.00`.
 */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Convert a net amount to gross at the given VAT rate, rounded to 2 decimal
 * places. `rate` is a fraction (0.23, not 23).
 */
export function grossFromNet(net: number, rate: number): number {
  return round2(net * (1 + rate));
}
