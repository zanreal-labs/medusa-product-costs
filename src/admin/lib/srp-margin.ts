import { computeEconomics } from "../../modules/product-costs/lib/economics";

/**
 * The SRP margin, resolved once for every surface that shows it.
 *
 * This is the single definition behind three places: the Catalog list column,
 * the product-detail cost card and the variant-detail cost card. They used to
 * be able to disagree - only the product card computed a margin at all, and it
 * anchored on whatever price happened to be in the configured currency. One
 * helper means the number an operator sees in the list is the same number they
 * see after clicking into the variant.
 *
 * ## The anchor is the SRP, and only the SRP
 *
 * `srp` here is the variant's own `metadata.srp`, falling back to its product's
 * - the same value the Catalog's SRP column shows, read with admin-kit's
 * `readVariantSrp` so the two cannot drift.
 *
 * When there is no SRP the result is `no-srp`, and the cell says so. It does
 * **not** quietly fall back to the variant's shop price. The two are different
 * facts about a product: an SRP is what the market is told the thing is worth,
 * a shop price is what this store currently charges. A margin labelled "SRP"
 * that was actually measured against a discounted shop price is a number an
 * operator would price against and be wrong.
 *
 * ## No commission
 *
 * `computeEconomics` is called with no `commissionRate`, which it documents as
 * defaulting to 0. That is correct here and is the entire difference between
 * this margin and the Allegro one: the SRP is this store's own retail price, so
 * nobody takes a cut of it. The commission-inclusive margin against the live
 * marketplace price is owned by `@zanreal/medusa-allegro`, which holds both the
 * commission table and the live price - this plugin never learns about either.
 *
 * Pure, so every branch is unit-tested without a renderer.
 */

/** Why an SRP margin could not be worked out, or the figures when it could. */
export type SrpMargin =
  | { state: "resolved"; netIncome: number; marginPct: number; srp: number }
  /** No curated purchase cost for this SKU. */
  | { state: "no-cost" }
  /** No `metadata.srp` on the variant or its product. */
  | { state: "no-srp" }
  /** The plugin has no VAT rate configured, so there is no honest gross cost. */
  | { state: "no-vat-rate" };

export interface SrpMarginInput {
  /** Net purchase cost per unit, or undefined when none is on file. */
  netCost: number | undefined;
  /** The variant's SRP, or undefined when neither it nor its product carries one. */
  srp: number | undefined;
  /** VAT rate as a fraction, or null when the plugin has none configured. */
  vatRate: number | null;
}

/**
 * Resolve the SRP margin, or the specific reason it cannot be resolved.
 *
 * The reasons are ordered most-fundamental-first so the cell names the thing an
 * operator has to fix: a store with no VAT rate configured has nothing to fix
 * per variant, a variant with no cost needs a cost, and only then does a
 * missing SRP become the blocker.
 */
export function resolveSrpMargin(input: SrpMarginInput): SrpMargin {
  if (input.vatRate === null) {
    return { state: "no-vat-rate" };
  }
  if (input.netCost === undefined) {
    return { state: "no-cost" };
  }
  if (input.srp === undefined) {
    return { state: "no-srp" };
  }

  const { marginPct, netIncome } = computeEconomics({
    netCost: input.netCost,
    sellingPrice: input.srp,
    vatRate: input.vatRate,
  });

  // Both fall out together, but an SRP of exactly 0 leaves `marginPct`
  // undefined (a ratio over zero), and a margin label needs both halves. A
  // zero SRP is not a price anyone sells at, so it reads as no SRP at all.
  if (netIncome === undefined || marginPct === undefined) {
    return { state: "no-srp" };
  }

  return { marginPct, netIncome, srp: input.srp, state: "resolved" };
}
