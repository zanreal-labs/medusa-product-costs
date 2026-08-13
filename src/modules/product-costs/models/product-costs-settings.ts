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
  id: model.id({ prefix: "pcset" }).primaryKey(),
  /** VAT rate override as a fraction (0.23 = 23%). `null` = use moduleOptions.vatRate. */
  vat_rate: model.bigNumber().nullable(),
});

export default ProductCostsSettings;
