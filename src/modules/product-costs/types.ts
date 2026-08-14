export type CostSource = "manual" | "csv" | "api";

/**
 * Plugin-wide options, forwarded by Medusa to every module the plugin
 * declares (see `plugins: [{ resolve: "@zanreal/medusa-product-costs",
 * options: {...} }]` in the consuming app's plugin configuration).
 *
 * Both fields are optional here and BOTH ARE WITHOUT A DEFAULT. Neither one
 * is knowable from the outside: a VAT rate and a trading currency are facts
 * about the market a specific store sells in, and this plugin has no way to
 * infer either. An operator sets them once from Settings > Product costs, or
 * here; until then the operations that need them refuse rather than guess.
 */
export interface ProductCostsModuleOptions {
  /**
   * VAT rate applied when grossing up a net cost, as a fraction (0.23 = 23%,
   * 0 = none).
   *
   * No default: this number flows into gross cost, margin and break-even, so
   * a guessed one understates or overstates the price a store must not sell
   * below, quietly and in the store's own admin. Set the rate for the market
   * you actually trade in.
   */
  vatRate?: number;
  /**
   * ISO-4217 currency a cost is recorded in when the caller does not name one.
   *
   * No default: a guessed currency silently mislabels every stored cost, and
   * nothing downstream can tell a mislabelled row from a correct one.
   */
  defaultCurrency?: string;
}

export interface ResolvedProductCostsModuleOptions {
  /** `null` when no VAT rate is configured. Not a value to compute with - see `VAT_RATE_NOT_CONFIGURED_MESSAGE`. */
  vatRate: number | null;
  /** `null` when no currency is configured. Not a value to store - see `CURRENCY_NOT_CONFIGURED_MESSAGE`. */
  defaultCurrency: string | null;
}

/** The one message every "no VAT rate configured" refusal uses, so they cannot drift apart. */
export const VAT_RATE_NOT_CONFIGURED_MESSAGE =
  "No VAT rate is configured, so gross cost, margin and break-even cannot be worked out. Set one under Settings > Product costs (enter 0 if your costs carry no VAT). This plugin ships without a default rate on purpose - it does not know which market you trade in, and a guessed rate would quietly move every break-even figure it shows you.";

/** The one message every "no default currency configured" refusal uses. */
export const CURRENCY_NOT_CONFIGURED_MESSAGE =
  "No default currency is configured, so this cost cannot be stored without guessing what its number means. Set one under Settings > Product costs, or pass an explicit currency with the cost. This plugin ships without a default currency on purpose - a wrong one mislabels every stored cost, and nothing downstream can tell the difference afterwards.";

export function resolveModuleOptions(
  options?: ProductCostsModuleOptions,
): ResolvedProductCostsModuleOptions {
  const currency = options?.defaultCurrency?.trim().toUpperCase();
  return {
    defaultCurrency: currency ? currency : null,
    vatRate: typeof options?.vatRate === "number" ? options.vatRate : null,
  };
}

export interface UpsertCostInput {
  currency?: string;
  note?: string | null;
  source: CostSource;
  /**
   * The Medusa actor id (user/api key) responsible for the change, recorded
   * on the history row. `undefined`/`null` for unattended imports.
   */
  changedBy?: string | null;
  /**
   * The resolved product variant id for this SKU, if any. Omit the key
   * entirely to leave the previously stored value untouched; pass `null`
   * explicitly to clear it.
   */
  variantId?: string | null;
}

export interface ListCostsFilters {
  sku?: string | string[];
  q?: string;
}

export interface ListCostsPagination {
  limit?: number;
  offset?: number;
}

export interface CostPriceDTO {
  id: string;
  sku: string;
  variant_id: string | null;
  unit_cost_net: number;
  currency: string;
  source: CostSource;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CostPriceHistoryDTO {
  id: string;
  sku: string;
  unit_cost_net: number;
  currency: string;
  source: CostSource;
  changed_by: string | null;
  changed_at: Date;
}

export interface ImportCsvError {
  lineNumber: number;
  raw: string;
  reason: string;
}

export interface ImportCsvResult {
  created: number;
  updated: number;
  /** Duplicate SKUs within the same file - the last occurrence wins, earlier ones are skipped. */
  skipped: number;
  errors: ImportCsvError[];
  /** SKUs actually created or updated - callers use this to trigger a variant-link sync. */
  skus: string[];
}

export interface ImportCsvOptions {
  source?: CostSource;
  changedBy?: string | null;
}

export interface ComputeEconomicsInput {
  /** Looked up when `netCost` is not given directly. */
  sku?: string;
  netCost?: number;
  sellingPrice?: number;
  commissionRate?: number;
  /** Overrides the plugin's configured default for this one calculation. */
  vatRate?: number;
}

/**
 * The persisted settings singleton, as callers read it. `null` on either
 * field means "not overridden here" - the service resolves it against
 * `moduleOptions` (see `getResolvedOptions`), never against a literal 0 or
 * empty string.
 */
export interface ProductCostsSettingsRow {
  id: string;
  vat_rate: number | null;
  default_currency: string | null;
}

/**
 * The columns an admin write may set on the settings singleton. Passing a
 * key with value `null` explicitly clears that override back to "use
 * moduleOptions"; omitting the key entirely leaves it untouched.
 */
export interface ProductCostsSettingsPatch {
  vat_rate?: number | null;
  default_currency?: string | null;
}
