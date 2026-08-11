import { grossFromNet, round2 } from "./money";

/**
 * Inputs to the margin/break-even calculation. `vatRate` is always resolved
 * by the caller (it falls back to the plugin's configured default, itself
 * defaulting to 0.23), so it is a required, always-defined fraction here -
 * the "no silent defaults" rule applies to the business inputs below it,
 * not to a rate the plugin is explicitly configured to default.
 */
export interface EconomicsInput {
  /** Net purchase cost per unit. Undefined/null when no cost is on file. */
  netCost?: number | null;
  /** The price the item is being sold for. */
  sellingPrice?: number | null;
  /** Marketplace/channel commission, as a fraction (0.1 = 10%). Defaults to 0. */
  commissionRate?: number | null;
  /** VAT rate as a fraction (0.23 = 23%). */
  vatRate: number;
}

export interface EconomicsResult {
  /** netCost grossed up by VAT, rounded to 2 places. Undefined without a netCost. */
  grossCost?: number;
  /**
   * sellingPrice - sellingPrice * commissionRate - grossCost, rounded to 2
   * places. Undefined without both a sellingPrice and a resolvable grossCost.
   */
  netIncome?: number;
  /**
   * grossCost / (1 - commissionRate), rounded to 2 places. The smallest gross
   * selling price at which netIncome reaches zero. Undefined without a
   * resolvable grossCost, and undefined when commissionRate >= 1 (the
   * commission would consume the entire price, so no finite break-even
   * exists).
   */
  breakEvenPrice?: number;
  /**
   * netIncome / sellingPrice, expressed as a fraction (0.42 = 42%), left
   * unrounded - it is a ratio, not a money amount, and rounding it to 2
   * decimal places would destroy precision that a caller may want to format
   * differently (e.g. "42.1%"). Undefined without a resolvable netIncome, or
   * when sellingPrice is missing or zero.
   */
  marginPct?: number;
}

/**
 * Pure margin/break-even calculator. No I/O, no defaults beyond the
 * documented `commissionRate` fallback to 0. A missing business input always
 * leaves the dependent figure `undefined` - it is never coerced to 0, which
 * would silently understate cost or overstate margin.
 */
export function computeEconomics(input: EconomicsInput): EconomicsResult {
  const { netCost, sellingPrice, vatRate } = input;
  const commissionRate = input.commissionRate ?? 0;

  const hasNetCost = netCost !== undefined && netCost !== null;
  const hasSellingPrice = sellingPrice !== undefined && sellingPrice !== null;

  const grossCost = hasNetCost ? grossFromNet(netCost as number, vatRate) : undefined;

  const netIncome =
    hasSellingPrice && grossCost !== undefined
      ? round2((sellingPrice as number) - (sellingPrice as number) * commissionRate - grossCost)
      : undefined;

  const breakEvenPrice =
    grossCost !== undefined && commissionRate < 1
      ? round2(grossCost / (1 - commissionRate))
      : undefined;

  const marginPct =
    netIncome !== undefined && hasSellingPrice && sellingPrice !== 0
      ? netIncome / (sellingPrice as number)
      : undefined;

  return { breakEvenPrice, grossCost, marginPct, netIncome };
}
