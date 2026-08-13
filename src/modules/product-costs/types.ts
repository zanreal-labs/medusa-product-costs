export type CostSource = "manual" | "csv" | "api";

/**
 * Plugin-wide options, forwarded by Medusa to every module the plugin
 * declares (see `plugins: [{ resolve: "@zanreal/medusa-product-costs",
 * options: {...} }]` in the consuming app's medusa-config.ts).
 */
export interface ProductCostsModuleOptions {
  /**
   * VAT rate applied when grossing up a net cost, as a fraction (0.23 =
   * 23%). Defaults to 0.23 (the PLN market rate this plugin was built
   * against) - override it for other markets.
   */
  vatRate?: number;
  /** Currency used for a cost when the caller does not specify one. */
  defaultCurrency?: string;
}

export interface ResolvedProductCostsModuleOptions {
  vatRate: number;
  defaultCurrency: string;
}

export const DEFAULT_VAT_RATE = 0.23;
export const DEFAULT_CURRENCY = "PLN";

export function resolveModuleOptions(
  options?: ProductCostsModuleOptions,
): ResolvedProductCostsModuleOptions {
  return {
    defaultCurrency: options?.defaultCurrency ?? DEFAULT_CURRENCY,
    vatRate: options?.vatRate ?? DEFAULT_VAT_RATE,
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
