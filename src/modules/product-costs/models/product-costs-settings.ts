import { model } from "@medusajs/framework/utils";

/**
 * The persisted, operator-editable override of the two store-wide settings
 * that used to live only in `medusa-config.ts`: the VAT rate and the default
 * currency.
 *
 * A SINGLETON: exactly one row exists, keyed by the fixed id
 * `PRODUCT_COSTS_SETTINGS_ID` (in the service). Both columns are nullable, and
 * `null` means "not overridden here" - `getResolvedOptions` in the service
 * falls back to the plugin's `moduleOptions` (itself defaulting to 0.23 /
 * "PLN") whenever a column is null. That distinction matters the same way it
 * does everywhere else in this module (see the README's "null-propagation
 * philosophy"): a persisted `0` VAT rate is a real, deliberate "no VAT"
 * setting, not the same thing as "unset", so a blank field is never coerced
 * to a number at write time - only resolved against the fallback at read
 * time. That keeps a later change to `moduleOptions` (a redeploy) still able
 * to shift the effective default for every store that has never overridden
 * it here.
 *
 * Fresh-install default: the row is created lazily on first read with both
 * columns `null`, so a store that has never opened Settings > Product costs
 * keeps behaving exactly as it did before this settings surface existed -
 * driven entirely by `medusa-config.ts` - until an operator explicitly saves
 * a value.
 */
const ProductCostsSettings = model.define("product_costs_settings", {
  /** ISO-4217 currency code override, e.g. "PLN". `null` = use moduleOptions.defaultCurrency. */
  default_currency: model.text().nullable(),
  /**
   * The currencies this store records costs in, beyond the default one, as
   * ISO-4217 codes. Drives which currency rows the cost cards offer to fill
   * in; it does not restrict what may be stored, because a CSV import or an
   * API caller naming a currency outside this list is recording a real
   * invoice, not making a mistake for this setting to veto.
   *
   * `null` (not `[]`) is the untouched state, and the two differ: `null`
   * means "never configured", and resolves to just the default currency,
   * while an empty array is an operator having deliberately cleared the list.
   */
  enabled_currencies: model.array().nullable(),
  id: model.id({ prefix: "pcset" }).primaryKey(),
  /** VAT rate override as a fraction (0.23 = 23%). `null` = use moduleOptions.vatRate. */
  vat_rate: model.bigNumber().nullable(),
});

export default ProductCostsSettings;
