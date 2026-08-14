import type { Context } from "@medusajs/framework/types";
import {
  InjectManager,
  InjectTransactionManager,
  MedusaContext,
  MedusaError,
  MedusaService,
} from "@medusajs/framework/utils";
import { parseCostCsv } from "./lib/csv";
import { computeEconomics as computeEconomicsPure } from "./lib/economics";
import type { EconomicsResult } from "./lib/economics";
import { round2 } from "./lib/money";
import CostPriceHistory from "./models/cost-price-history";
import CostPrice from "./models/cost-price";
import ProductCostsSettings from "./models/product-costs-settings";
import type {
  ComputeEconomicsInput,
  CostPriceDTO,
  CostPriceHistoryDTO,
  ImportCsvOptions,
  ImportCsvResult,
  ListCostsFilters,
  ListCostsPagination,
  ProductCostsModuleOptions,
  ProductCostsSettingsPatch,
  ProductCostsSettingsRow,
  ResolvedProductCostsModuleOptions,
  UpsertCostInput,
} from "./types";
import {
  CURRENCY_NOT_CONFIGURED_MESSAGE,
  VAT_RATE_NOT_CONFIGURED_MESSAGE,
  resolveModuleOptions,
} from "./types";

/**
 * Fixed primary key for the settings singleton - see `ProductCostsSettings`
 * for why a fixed id makes this a true singleton.
 */
export const PRODUCT_COSTS_SETTINGS_ID = "pcset_singleton";

type InjectedDependencies = Record<string, unknown>;

export interface UpsertCostResult {
  costPrice: CostPriceDTO;
  created: boolean;
  /** The variant id that was linked before this call, if any. Lets callers detect a variant-link change. */
  previousVariantId: string | null;
}

export interface VariantLinkChange {
  costPriceId: string;
  sku: string;
  previousVariantId: string | null;
  nextVariantId: string | null;
}

const APPEND_ONLY_MESSAGE =
  "CostPriceHistory rows are append-only - create a new row with createCostPriceHistories " +
  "instead of modifying or removing an existing one.";

/**
 * `CostPrice.unit_cost_net` and `CostPriceHistory.unit_cost_net` are declared
 * with `model.bigNumber()`, which does not round-trip through the ORM as a
 * plain JS `number` - normalize it at every service boundary that returns a
 * DTO, so every consumer (the admin UI, `res.json` in the API routes, other
 * modules reading through this service) gets a real number, not a BigNumber
 * wrapper or a string.
 */
function toCostPriceDTO(row: CostPriceDTO): CostPriceDTO {
  return { ...row, unit_cost_net: Number(row.unit_cost_net) };
}

function toCostPriceHistoryDTO(row: CostPriceHistoryDTO): CostPriceHistoryDTO {
  return { ...row, unit_cost_net: Number(row.unit_cost_net) };
}

/**
 * `ProductCostsSettings.vat_rate` is declared with `model.bigNumber()` for
 * the same reason `CostPrice.unit_cost_net` is - it does not round-trip
 * through the ORM as a plain JS `number`. Normalize it here, at the one
 * place every read of the settings row passes through. `null` (not
 * overridden) is passed through untouched - it is never coerced to `0`.
 */
function toSettingsDTO(row: ProductCostsSettingsRow): ProductCostsSettingsRow {
  return {
    ...row,
    vat_rate: row.vat_rate === null || row.vat_rate === undefined ? null : Number(row.vat_rate),
  };
}

/**
 * Module service for the product-costs module. Deliberately has no
 * knowledge of the Product module or any other Medusa module - resolving a
 * SKU to a variant id, and creating the module link, is orchestration work
 * done by the workflows in `src/workflows`, which is where cross-module
 * calls belong. This keeps the module portable and testable in isolation.
 */
class ProductCostsModuleService extends MedusaService({
  CostPrice,
  CostPriceHistory,
  ProductCostsSettings,
}) {
  protected readonly moduleOptions_: ResolvedProductCostsModuleOptions;

  constructor(container: InjectedDependencies, options?: ProductCostsModuleOptions) {
    super(...arguments);
    this.moduleOptions_ = resolveModuleOptions(options);
  }

  /**
   * The plugin options as configured in `medusa-config.ts`, unaffected by
   * anything saved through Settings > Product costs. Kept around because it
   * is the fallback `getResolvedOptions` resolves against - most callers
   * want `getResolvedOptions()` instead, which is what actually reflects an
   * admin-saved override.
   */
  get moduleOptions(): ResolvedProductCostsModuleOptions {
    return this.moduleOptions_;
  }

  // ─── Settings singleton: the persisted, operator-editable VAT rate and currency ───

  /**
   * The settings singleton, created with both columns `null` ("not
   * overridden") on first read. The fixed id makes it a true singleton: a
   * concurrent first-read that loses the insert re-reads the winner's row
   * rather than duplicating it, and a settings row written this rarely never
   * contends in practice.
   */
  async getSettings(): Promise<ProductCostsSettingsRow> {
    const existing = await this.readSettingsRow();
    if (existing) {
      return existing;
    }
    try {
      const [created] = await this.createProductCostsSettings([
        { default_currency: null, id: PRODUCT_COSTS_SETTINGS_ID, vat_rate: null },
      ]);
      return toSettingsDTO(created as unknown as ProductCostsSettingsRow);
    } catch (error) {
      // A concurrent first-read won the insert under the fixed id. The row exists now.
      const row = await this.readSettingsRow();
      if (row) {
        return row;
      }
      throw error;
    }
  }

  /** The stored singleton row, or undefined before its first read created it. */
  protected async readSettingsRow(): Promise<ProductCostsSettingsRow | undefined> {
    const [row] = await this.listProductCostsSettings(
      { id: PRODUCT_COSTS_SETTINGS_ID },
      { take: 1 },
    );
    return row ? toSettingsDTO(row as unknown as ProductCostsSettingsRow) : undefined;
  }

  /**
   * Save an override for one or both settings. Only the keys present in
   * `patch` are written, so saving the VAT rate never disturbs a
   * previously-saved currency (and vice versa). Passing a key with value
   * `null` explicitly clears that override back to "use moduleOptions" -
   * that is a real, intended action, not the same thing as omitting the key.
   */
  async updateSettings(patch: ProductCostsSettingsPatch): Promise<ProductCostsSettingsRow> {
    // Ensure the singleton exists before the conditional update, so a
    // first-ever save through the admin has a row to land on.
    await this.getSettings();
    await this.updateProductCostsSettings([{ id: PRODUCT_COSTS_SETTINGS_ID, ...patch }]);
    const row = await this.readSettingsRow();
    if (!row) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "medusa-product-costs: the settings singleton disappeared between write and read.",
      );
    }
    return row;
  }

  /**
   * The configuration every runtime read of VAT rate / currency should
   * actually use: a persisted override from Settings > Product costs when one
   * is saved, falling back to the plugin options when it is not. This is what
   * makes a VAT rate change in the admin take effect immediately, with no
   * restart - every caller below resolves against this, never against
   * `moduleOptions_` directly.
   *
   * Either field can come back `null`, meaning "configured nowhere". That is
   * not a value to compute or store with: this plugin ships no default VAT
   * rate and no default currency, because both are facts about the market a
   * store trades in and a guess at either is wrong silently. Callers that
   * need one refuse and name the setting instead.
   */
  async getResolvedOptions(): Promise<ResolvedProductCostsModuleOptions> {
    const settings = await this.getSettings();
    return {
      defaultCurrency: settings.default_currency ?? this.moduleOptions_.defaultCurrency,
      vatRate: settings.vat_rate ?? this.moduleOptions_.vatRate,
    };
  }

  /**
   * Create or update the cost for a SKU. Always writes a `CostPriceHistory`
   * row, on both branches - there is no "no-op" fast path, per the
   * requirement that every create/update is recorded.
   *
   * Public entry point, decorated with `@InjectManager()` per the standard
   * Medusa module-service pattern: it resolves a manager for the shared
   * context and delegates to `upsertCost_`, which does the actual work
   * inside a database transaction.
   */
  @InjectManager()
  async upsertCost(
    sku: string,
    unitCostNet: number,
    input: UpsertCostInput,
    @MedusaContext() sharedContext: Context = {},
  ): Promise<UpsertCostResult> {
    return await this.upsertCost_(sku, unitCostNet, input, sharedContext);
  }

  /**
   * The `CostPrice` write and the `CostPriceHistory` write happen inside one
   * database transaction (`@InjectTransactionManager` opens it, and every
   * write below shares it through `sharedContext`): if the process crashes
   * or the history write fails after the cost write succeeds, the whole
   * transaction rolls back, so a cost is never persisted without its
   * matching history row.
   */
  @InjectTransactionManager()
  protected async upsertCost_(
    sku: string,
    unitCostNet: number,
    input: UpsertCostInput,
    @MedusaContext() sharedContext: Context = {},
  ): Promise<UpsertCostResult> {
    const trimmedSku = sku.trim();
    if (!trimmedSku) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "upsertCost requires a non-empty sku");
    }
    if (!Number.isFinite(unitCostNet) || unitCostNet <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `upsertCost requires a positive unitCostNet, received "${unitCostNet}"`,
      );
    }
    // Canonicalize to 2 decimal places at the write boundary. This is the
    // one place every cost this module persists passes through - a direct
    // API/widget call and every row of a CSV import alike (`importCsv`
    // calls this method per row) - so rounding here is enough to guarantee
    // every stored `unit_cost_net` has exactly 2 decimal places, matching
    // the money convention used everywhere else in this module.
    const canonicalUnitCostNet = round2(unitCostNet);

    const currency = input.currency ?? (await this.getResolvedOptions()).defaultCurrency;
    if (!currency) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, CURRENCY_NOT_CONFIGURED_MESSAGE);
    }
    const [existing] = await this.listCostPrices({ sku: [trimmedSku] }, {}, sharedContext);
    const previousVariantId = (existing?.variant_id as string | null | undefined) ?? null;

    const variantIdPatch = "variantId" in input ? { variant_id: input.variantId ?? null } : {};

    let costPrice: CostPriceDTO;
    let created: boolean;

    if (existing) {
      costPrice = toCostPriceDTO(
        (await this.updateCostPrices(
          {
            currency,
            id: existing.id as string,
            note: input.note ?? null,
            source: input.source,
            unit_cost_net: canonicalUnitCostNet,
            ...variantIdPatch,
          },
          sharedContext,
        )) as unknown as CostPriceDTO,
      );
      created = false;
    } else {
      costPrice = toCostPriceDTO(
        (await this.createCostPrices(
          {
            currency,
            note: input.note ?? null,
            sku: trimmedSku,
            source: input.source,
            unit_cost_net: canonicalUnitCostNet,
            variant_id: "variantId" in input ? (input.variantId ?? null) : null,
          },
          sharedContext,
        )) as unknown as CostPriceDTO,
      );
      created = true;
    }

    await this.createCostPriceHistories(
      {
        changed_at: new Date(),
        changed_by: input.changedBy ?? null,
        currency,
        sku: trimmedSku,
        source: input.source,
        unit_cost_net: canonicalUnitCostNet,
      },
      sharedContext,
    );

    return { costPrice, created, previousVariantId };
  }

  async getCostsBySkus(skus: string[]): Promise<CostPriceDTO[]> {
    const trimmed = [...new Set(skus.map((s) => s.trim()).filter(Boolean))];
    if (trimmed.length === 0) {
      return [];
    }
    const rows = (await this.listCostPrices({ sku: trimmed })) as unknown as CostPriceDTO[];
    return rows.map(toCostPriceDTO);
  }

  async getCostBySku(sku: string): Promise<CostPriceDTO | undefined> {
    const [costPrice] = await this.getCostsBySkus([sku]);
    return costPrice;
  }

  async listCosts(
    filters: ListCostsFilters = {},
    pagination: ListCostsPagination = {},
  ): Promise<{ costs: CostPriceDTO[]; count: number }> {
    const { limit = 20, offset = 0 } = pagination;
    const where: Record<string, unknown> = {};

    if (filters.q) {
      where.sku = { $ilike: `%${filters.q}%` };
    } else if (filters.sku) {
      where.sku = filters.sku;
    }

    const [costs, count] = await this.listAndCountCostPrices(where, {
      order: { updated_at: "DESC" },
      skip: offset,
      take: limit,
    });

    return { costs: (costs as unknown as CostPriceDTO[]).map(toCostPriceDTO), count };
  }

  async getHistory(
    sku: string,
    pagination: ListCostsPagination = {},
  ): Promise<{ history: CostPriceHistoryDTO[]; count: number }> {
    const { limit = 50, offset = 0 } = pagination;
    const [history, count] = await this.listAndCountCostPriceHistories(
      { sku: sku.trim() },
      { order: { changed_at: "DESC" }, skip: offset, take: limit },
    );
    return {
      count,
      history: (history as unknown as CostPriceHistoryDTO[]).map(toCostPriceHistoryDTO),
    };
  }

  /**
   * Margin/break-even calculator. Accepts either a direct `netCost` or a
   * `sku` to look one up; if neither resolves to a cost, every dependent
   * figure comes back `undefined` (see `lib/economics.ts`) rather than
   * silently treating the missing cost as 0.
   *
   * `vatRate` resolves through `getResolvedOptions()` - a persisted override
   * saved from Settings > Product costs, falling back to the plugin options -
   * so a VAT rate change in the admin changes this calculation on the very
   * next call, with no restart. An explicit `input.vatRate` still wins over
   * both, for a caller computing a one-off "what if" figure.
   *
   * Refuses when no rate resolves from anywhere. Returning a figure computed
   * off a guessed rate would be worse than an error: a break-even number is
   * read as authoritative, and nothing on screen would reveal that the rate
   * behind it was invented.
   */
  async computeEconomics(input: ComputeEconomicsInput): Promise<EconomicsResult> {
    let { netCost } = input;
    if (netCost === undefined && input.sku) {
      const costPrice = await this.getCostBySku(input.sku);
      netCost = costPrice ? Number(costPrice.unit_cost_net) : undefined;
    }

    const vatRate = input.vatRate ?? (await this.getResolvedOptions()).vatRate;
    if (vatRate === null) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, VAT_RATE_NOT_CONFIGURED_MESSAGE);
    }

    return computeEconomicsPure({
      commissionRate: input.commissionRate,
      netCost,
      sellingPrice: input.sellingPrice,
      vatRate,
    });
  }

  /**
   * Bulk-import a `sku,cost` CSV. Duplicate SKUs within the same file are
   * deduplicated by keeping the last occurrence (matching how a spreadsheet
   * re-save would behave) - earlier occurrences count as `skipped`, not
   * applied. Unparsable lines are reported in `errors`, and a persistence
   * failure on an otherwise-valid row is appended there too so nothing
   * silently vanishes.
   */
  async importCsv(text: string, opts: ImportCsvOptions = {}): Promise<ImportCsvResult> {
    const { rows, errors: parseErrors } = parseCostCsv(text);
    const source = opts.source ?? "csv";

    const lastOccurrenceBySku = new Map<string, (typeof rows)[number]>();
    let skipped = 0;
    for (const row of rows) {
      if (lastOccurrenceBySku.has(row.sku)) {
        skipped += 1;
      }
      lastOccurrenceBySku.set(row.sku, row);
    }

    let created = 0;
    let updated = 0;
    const errors = [...parseErrors];
    const skus: string[] = [];

    for (const row of lastOccurrenceBySku.values()) {
      try {
        const result = await this.upsertCost(row.sku, row.unitCostNet, {
          changedBy: opts.changedBy ?? null,
          source,
        });
        if (result.created) {
          created += 1;
        } else {
          updated += 1;
        }
        skus.push(row.sku);
      } catch (error) {
        errors.push({
          lineNumber: row.lineNumber,
          raw: `${row.sku},${row.unitCostNet}`,
          reason: error instanceof Error ? error.message : "Failed to save row",
        });
      }
    }

    return { created, errors, skipped, skus, updated };
  }

  /**
   * Refresh the denormalized `variant_id` cache for a batch of SKUs in one
   * pass. Used by the variant-link sync workflow after a CSV import (which
   * intentionally does not resolve variant links per-row) and can also be
   * re-run at any time to repair links after variants are deleted and
   * recreated. Only rows whose `variant_id` actually changes are written;
   * the return value reports the before/after for each of those so the
   * caller can reconcile the module link (this service never touches the
   * link itself - see the module-isolation note on the class).
   */
  async setVariantLinks(bySku: Record<string, string | null>): Promise<VariantLinkChange[]> {
    const skus = Object.keys(bySku);
    if (skus.length === 0) {
      return [];
    }

    const existing = await this.getCostsBySkus(skus);
    const existingBySku = new Map(existing.map((costPrice) => [costPrice.sku, costPrice]));

    const changes = skus
      .map((sku) => {
        const row = existingBySku.get(sku);
        const nextVariantId = bySku[sku] ?? null;
        if (!row || row.variant_id === nextVariantId) {
          return;
        }
        return {
          costPriceId: row.id,
          nextVariantId,
          previousVariantId: row.variant_id,
          sku,
        };
      })
      .filter((change): change is VariantLinkChange => Boolean(change));

    if (changes.length === 0) {
      return [];
    }

    await this.updateCostPrices(
      changes.map((change) => ({ id: change.costPriceId, variant_id: change.nextVariantId })),
    );

    return changes;
  }

  /**
   * `CostPriceHistory` is documented (see the model) as an append-only audit
   * trail, but `MedusaService(...)` auto-generates update/delete/soft-delete/
   * restore mutators for every model it is given, including this one -
   * nothing about the model definition itself makes it read-only. These
   * overrides are what actually enforces the append-only contract: calling
   * any of them throws instead of silently letting the audit trail be
   * rewritten or thinned out. `createCostPriceHistories` and every read
   * method (`retrieveCostPriceHistory`, `listCostPriceHistories`,
   * `listAndCountCostPriceHistories`) are untouched and still work normally.
   */
  // Declared as arrow-function properties, not methods: `MedusaService(...)`
  // types these members as call-signature-only properties on the base
  // class, and TypeScript requires a subclass to override a property with a
  // property (TS2425) - a `methodName() {}` override here would be a
  // property/method mismatch even though it works fine at runtime.
  updateCostPriceHistories = async (..._args: unknown[]): Promise<never> => {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, APPEND_ONLY_MESSAGE);
  };

  deleteCostPriceHistories = async (..._args: unknown[]): Promise<never> => {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, APPEND_ONLY_MESSAGE);
  };

  softDeleteCostPriceHistories = async (..._args: unknown[]): Promise<never> => {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, APPEND_ONLY_MESSAGE);
  };

  restoreCostPriceHistories = async (..._args: unknown[]): Promise<never> => {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, APPEND_ONLY_MESSAGE);
  };
}

export default ProductCostsModuleService;
