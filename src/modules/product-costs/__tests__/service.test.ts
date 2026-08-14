import { beforeEach, describe, expect, it, vi } from "vitest";
import ProductCostsModuleService from "../service";

/**
 * Pure-unit tests for the service's own business logic (upsert/history
 * semantics, CSV import orchestration, variant-link diffing). The
 * auto-generated CRUD methods (`listCostPrices`, `createCostPrices`, etc.)
 * that `MedusaService(...)` attaches to the prototype need a fully wired
 * Medusa container (`__container__`, `baseRepository_`) to actually run
 * against a database - that's what `@medusajs/test-utils`' module test
 * runner is for, and it needs a live Postgres instance. Here we construct
 * the real service (its constructor only stores the container/options, so a
 * bare `{}` container is safe) and replace those specific auto-generated
 * methods with mocks, so the hand-written methods below run for real
 * against a controlled fake persistence layer.
 *
 * `baseRepository_` is stubbed with `transaction` and `getFreshManager` too:
 * the public `upsertCost` is decorated with `@InjectManager` (which calls
 * `getFreshManager`), and delegates to the protected `upsertCost_`, decorated
 * with `@InjectTransactionManager` (which calls `transaction(...)` to open
 * the real DB transaction in production). The stubs here just invoke the
 * work function with a fake manager object (`fakeTransactionManager`) so
 * the decorators' plumbing runs for real, without an actual database - tests
 * can then assert that every write inside `upsertCost` received the *same*
 * manager via its `sharedContext`, which is what guarantees they'd all be
 * part of one database transaction for real.
 */
const fakeTransactionManager = { __fake: "transaction-manager" };

/**
 * Build a service under test.
 *
 * Defaults to a CONFIGURED install - a VAT rate and a currency explicitly
 * chosen - because that is the only state in which most of this module does
 * anything. The plugin ships neither as a default (see
 * `ProductCostsModuleOptions`), so a test that wants ordinary behaviour has to
 * choose them, exactly like an operator does. Pass `null` to build the
 * unconfigured install instead and exercise the refusals.
 */
function createService(
  options: ConstructorParameters<typeof ProductCostsModuleService>[1] | null = {
    defaultCurrency: "PLN",
    vatRate: 0.23,
  },
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new (ProductCostsModuleService as any)(
    {},
    options ?? undefined,
  ) as ProductCostsModuleService & {
    listCostPrices: ReturnType<typeof vi.fn>;
    createCostPrices: ReturnType<typeof vi.fn>;
    updateCostPrices: ReturnType<typeof vi.fn>;
    createCostPriceHistories: ReturnType<typeof vi.fn>;
    listAndCountCostPrices: ReturnType<typeof vi.fn>;
    listAndCountCostPriceHistories: ReturnType<typeof vi.fn>;
    listProductCostsSettings: ReturnType<typeof vi.fn>;
    createProductCostsSettings: ReturnType<typeof vi.fn>;
    updateProductCostsSettings: ReturnType<typeof vi.fn>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    baseRepository_: any;
  };

  service.listCostPrices = vi.fn().mockResolvedValue([]);
  service.createCostPrices = vi.fn();
  service.updateCostPrices = vi.fn();
  service.createCostPriceHistories = vi.fn().mockResolvedValue({});
  service.listAndCountCostPrices = vi.fn().mockResolvedValue([[], 0]);
  service.listAndCountCostPriceHistories = vi.fn().mockResolvedValue([[], 0]);
  // No settings row persisted yet by default - `getSettings` creates the
  // fresh-install singleton (both columns null) the first time it is read,
  // matching production behavior for a store that has never opened
  // Settings > Product costs.
  service.listProductCostsSettings = vi.fn().mockResolvedValue([]);
  service.createProductCostsSettings = vi
    .fn()
    .mockImplementation(async (rows: unknown) => [(rows as Record<string, unknown>[])[0]]);
  service.updateProductCostsSettings = vi.fn().mockResolvedValue([]);
  service.baseRepository_ = {
    getFreshManager: vi.fn(() => ({ __fake: "fresh-manager" })),
    transaction: vi.fn(
      async (work: (manager: unknown) => Promise<unknown>) => await work(fakeTransactionManager),
    ),
  };

  return service;
}

describe("ProductCostsModuleService.moduleOptions", () => {
  it("defaults neither the VAT rate nor the currency", () => {
    // The regression this guards: shipping 0.23/"PLN" told every installer
    // this plugin trades in Poland, and quietly moved gross cost, margin and
    // break-even for anyone who does not.
    const service = createService(null);
    expect(service.moduleOptions).toEqual({ defaultCurrency: null, vatRate: null });
  });

  it("honors options passed by the consuming app", () => {
    const service = createService({ defaultCurrency: "EUR", vatRate: 0.19 });
    expect(service.moduleOptions).toEqual({ defaultCurrency: "EUR", vatRate: 0.19 });
  });

  it("keeps an explicit zero VAT rate, which is a real answer and not an absent one", () => {
    const service = createService({ defaultCurrency: "GBP", vatRate: 0 });
    expect(service.moduleOptions).toEqual({ defaultCurrency: "GBP", vatRate: 0 });
  });

  it("normalizes a configured currency to upper case", () => {
    const service = createService({ defaultCurrency: "eur", vatRate: 0.19 });
    expect(service.moduleOptions.defaultCurrency).toBe("EUR");
  });
});

describe("ProductCostsModuleService without a configured VAT rate or currency", () => {
  it("refuses to compute economics, naming the setting and where to set it", async () => {
    const service = createService(null);
    await expect(service.computeEconomics({ netCost: 100, sellingPrice: 200 })).rejects.toThrow(
      /No VAT rate is configured.*Settings > Product costs/su,
    );
  });

  it("refuses to store a cost that carries no explicit currency", async () => {
    const service = createService(null);
    await expect(
      service.upsertCost("SKU-1", 10, { source: "manual" }),
    ).rejects.toThrow(/No default currency is configured.*Settings > Product costs/su);
  });

  it("still stores a cost when the caller names the currency itself", async () => {
    const service = createService(null);
    service.listCostPrices.mockResolvedValue([]);
    service.createCostPrices.mockResolvedValue({
      created_at: new Date(),
      currency: "GBP",
      id: "cprc_1",
      note: null,
      sku: "SKU-1",
      source: "manual",
      unit_cost_net: 10,
      updated_at: new Date(),
      variant_id: null,
    });
    await expect(
      service.upsertCost("SKU-1", 10, { currency: "GBP", source: "manual" }),
    ).resolves.toBeDefined();
  });
});

describe("ProductCostsModuleService.upsertCost", () => {
  it("creates a new CostPrice and writes a history row when none exists", async () => {
    const service = createService();
    service.listCostPrices.mockResolvedValue([]);
    service.createCostPrices.mockResolvedValue({
      currency: "PLN",
      id: "cprc_1",
      note: null,
      sku: "SKU-1",
      source: "manual",
      unit_cost_net: 10,
      variant_id: null,
    });

    const result = await service.upsertCost("SKU-1", 10, { source: "manual" });

    expect(service.createCostPrices).toHaveBeenCalledWith(
      {
        currency: "PLN",
        note: null,
        sku: "SKU-1",
        source: "manual",
        unit_cost_net: 10,
        variant_id: null,
      },
      expect.objectContaining({ transactionManager: fakeTransactionManager }),
    );
    expect(service.updateCostPrices).not.toHaveBeenCalled();
    expect(service.createCostPriceHistories).toHaveBeenCalledTimes(1);
    expect(service.createCostPriceHistories).toHaveBeenCalledWith(
      expect.objectContaining({
        changed_by: null,
        currency: "PLN",
        sku: "SKU-1",
        source: "manual",
        unit_cost_net: 10,
      }),
      expect.objectContaining({ transactionManager: fakeTransactionManager }),
    );
    expect(result.created).toBe(true);
    expect(result.previousVariantId).toBeNull();
  });

  it("updates an existing CostPrice and still writes history, even when the value is unchanged", async () => {
    const service = createService();
    service.listCostPrices.mockResolvedValue([
      {
        currency: "PLN",
        id: "cprc_1",
        note: null,
        sku: "SKU-1",
        source: "manual",
        unit_cost_net: 10,
        variant_id: "variant_1",
      },
    ]);
    service.updateCostPrices.mockResolvedValue({
      currency: "PLN",
      id: "cprc_1",
      note: null,
      sku: "SKU-1",
      source: "manual",
      unit_cost_net: 10,
      variant_id: "variant_1",
    });

    const result = await service.upsertCost("SKU-1", 10, { source: "manual" });

    expect(service.createCostPrices).not.toHaveBeenCalled();
    expect(service.updateCostPrices).toHaveBeenCalledTimes(1);
    // Every create/update writes history - there is no "no-op, value unchanged" fast path.
    expect(service.createCostPriceHistories).toHaveBeenCalledTimes(1);
    expect(result.created).toBe(false);
    expect(result.previousVariantId).toBe("variant_1");
  });

  it("leaves variant_id untouched when the variantId key is omitted from the input", async () => {
    const service = createService();
    service.listCostPrices.mockResolvedValue([
      {
        currency: "PLN",
        id: "cprc_1",
        note: null,
        sku: "SKU-1",
        source: "manual",
        unit_cost_net: 10,
        variant_id: "variant_1",
      },
    ]);
    service.updateCostPrices.mockResolvedValue({});

    await service.upsertCost("SKU-1", 12, { source: "manual" });

    const [patch] = service.updateCostPrices.mock.calls[0] as [Record<string, unknown>];
    expect(patch).not.toHaveProperty("variant_id");
  });

  it("clears variant_id when variantId is explicitly passed as null", async () => {
    const service = createService();
    service.listCostPrices.mockResolvedValue([
      {
        currency: "PLN",
        id: "cprc_1",
        note: null,
        sku: "SKU-1",
        source: "manual",
        unit_cost_net: 10,
        variant_id: "variant_1",
      },
    ]);
    service.updateCostPrices.mockResolvedValue({});

    await service.upsertCost("SKU-1", 12, { source: "manual", variantId: null });

    const [patch] = service.updateCostPrices.mock.calls[0] as [Record<string, unknown>];
    expect(patch).toMatchObject({ variant_id: null });
  });

  it("rejects an empty sku", async () => {
    const service = createService();
    await expect(service.upsertCost("   ", 10, { source: "manual" })).rejects.toThrow(/sku/i);
  });

  it("rejects a non-positive unitCostNet", async () => {
    const service = createService();
    await expect(service.upsertCost("SKU-1", 0, { source: "manual" })).rejects.toThrow(
      /unitCostNet/i,
    );
    await expect(service.upsertCost("SKU-1", -5, { source: "manual" })).rejects.toThrow(
      /unitCostNet/i,
    );
  });

  it("canonicalizes unitCostNet to 2 decimal places at the write boundary", async () => {
    const service = createService();
    service.listCostPrices.mockResolvedValue([]);
    service.createCostPrices.mockResolvedValue({});

    await service.upsertCost("SKU-1", 10.999, { source: "manual" });

    expect(service.createCostPrices).toHaveBeenCalledWith(
      expect.objectContaining({ unit_cost_net: 11 }),
      expect.anything(),
    );
    expect(service.createCostPriceHistories).toHaveBeenCalledWith(
      expect.objectContaining({ unit_cost_net: 11 }),
      expect.anything(),
    );
  });

  it("runs the CostPrice write and the CostPriceHistory write inside the same database transaction", async () => {
    const service = createService();
    service.listCostPrices.mockResolvedValue([]);
    service.createCostPrices.mockResolvedValue({});

    await service.upsertCost("SKU-1", 10, { source: "manual" });

    expect(service.baseRepository_.transaction).toHaveBeenCalledTimes(1);
    const [, createContext] = service.createCostPrices.mock.calls[0] as [unknown, unknown];
    const [, historyContext] = service.createCostPriceHistories.mock.calls[0] as [unknown, unknown];
    expect(createContext).toMatchObject({ transactionManager: fakeTransactionManager });
    expect(historyContext).toMatchObject({ transactionManager: fakeTransactionManager });
  });

  it("rolls back the CostPrice write when the CostPriceHistory write fails", async () => {
    const service = createService();
    service.listCostPrices.mockResolvedValue([]);
    service.createCostPrices.mockResolvedValue({ id: "cprc_1", sku: "SKU-1" });
    service.createCostPriceHistories.mockRejectedValue(new Error("history write failed"));

    await expect(service.upsertCost("SKU-1", 10, { source: "manual" })).rejects.toThrow(
      "history write failed",
    );

    // The failure propagates out of `baseRepository_.transaction`'s work
    // function - in production that is exactly what makes Postgres roll
    // back the whole transaction, so the CostPrice row created above is
    // never actually committed. This stub cannot observe a real rollback
    // (there is no database here), but it does prove the error is not
    // swallowed - it reaches the caller, which is the precondition for the
    // transaction wrapper to roll back.
    expect(service.baseRepository_.transaction).toHaveBeenCalledTimes(1);
  });
});

describe("ProductCostsModuleService.importCsv", () => {
  let service: ReturnType<typeof createService>;

  beforeEach(() => {
    service = createService();
    service.createCostPrices.mockImplementation(async (data: Record<string, unknown>) => ({
      ...data,
      id: `cprc_${data.sku}`,
    }));
    service.updateCostPrices.mockImplementation(async (data: Record<string, unknown>) => data);
  });

  it("creates rows for new SKUs and reports them in the result", async () => {
    const result = await service.importCsv("SKU-1,10.50\nSKU-2,20.00");

    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);
    expect(new Set(result.skus)).toEqual(new Set(["SKU-1", "SKU-2"]));
    expect(service.createCostPriceHistories).toHaveBeenCalledTimes(2);
  });

  it("deduplicates a SKU repeated in the same file, keeping the last occurrence and counting earlier ones as skipped", async () => {
    const result = await service.importCsv("SKU-1,10.00\nSKU-1,20.00");

    expect(result.skipped).toBe(1);
    expect(result.created).toBe(1);
    expect(service.createCostPrices).toHaveBeenCalledTimes(1);
    expect(service.createCostPrices).toHaveBeenCalledWith(
      expect.objectContaining({ sku: "SKU-1", unit_cost_net: 20 }),
      expect.anything(),
    );
  });

  it("carries parser errors through untouched", async () => {
    const result = await service.importCsv("SKU-1,10\nnot a valid row\nSKU-2,20");

    expect(result.errors).toEqual([
      { lineNumber: 2, raw: "not a valid row", reason: "Missing or invalid cost" },
    ]);
    expect(result.created).toBe(2);
  });

  it("reports a persistence failure as an error without incrementing created/updated", async () => {
    service.createCostPrices.mockImplementation(async (data: Record<string, unknown>) => {
      if (data.sku === "SKU-BAD") {
        throw new Error("db exploded");
      }
      return { ...data, id: `cprc_${data.sku}` };
    });

    const result = await service.importCsv("SKU-1,10\nSKU-BAD,20");

    expect(result.created).toBe(1);
    expect(result.errors).toEqual([{ lineNumber: 2, raw: "SKU-BAD,20", reason: "db exploded" }]);
  });

  it("canonicalizes a row's cost to 2 decimal places, since importCsv writes through upsertCost", async () => {
    const result = await service.importCsv("SKU-1,10.999");

    expect(result.created).toBe(1);
    expect(service.createCostPrices).toHaveBeenCalledWith(
      expect.objectContaining({ unit_cost_net: 11 }),
      expect.anything(),
    );
  });
});

describe("ProductCostsModuleService.setVariantLinks", () => {
  it("only updates rows whose variant_id actually changes, and reports the before/after", async () => {
    const service = createService();
    service.listCostPrices.mockResolvedValue([
      { id: "cprc_1", sku: "SKU-1", variant_id: "v1" },
      { id: "cprc_2", sku: "SKU-2", variant_id: "v_old" },
      { id: "cprc_3", sku: "SKU-3", variant_id: "v3" },
    ]);
    service.updateCostPrices.mockResolvedValue([]);

    const changes = await service.setVariantLinks({
      "SKU-1": "v1",
      "SKU-2": "v2",
      "SKU-3": null,
    });

    expect(changes).toEqual([
      { costPriceId: "cprc_2", nextVariantId: "v2", previousVariantId: "v_old", sku: "SKU-2" },
      { costPriceId: "cprc_3", nextVariantId: null, previousVariantId: "v3", sku: "SKU-3" },
    ]);
    expect(service.updateCostPrices).toHaveBeenCalledWith([
      { id: "cprc_2", variant_id: "v2" },
      { id: "cprc_3", variant_id: null },
    ]);
  });

  it("does nothing when every variant_id is already up to date", async () => {
    const service = createService();
    service.listCostPrices.mockResolvedValue([{ id: "cprc_1", sku: "SKU-1", variant_id: "v1" }]);

    const changes = await service.setVariantLinks({ "SKU-1": "v1" });

    expect(changes).toEqual([]);
    expect(service.updateCostPrices).not.toHaveBeenCalled();
  });
});

describe("ProductCostsModuleService.computeEconomics", () => {
  it("resolves netCost by sku when not given directly", async () => {
    const service = createService();
    service.listCostPrices.mockResolvedValue([
      { currency: "PLN", id: "cprc_1", sku: "SKU-1", unit_cost_net: 100 },
    ]);

    const result = await service.computeEconomics({ sellingPrice: 200, sku: "SKU-1" });

    expect(result.grossCost).toBe(123);
    expect(result.netIncome).toBe(77);
  });

  it("prefers an explicit netCost over a sku lookup", async () => {
    const service = createService();

    const result = await service.computeEconomics({ netCost: 50, sellingPrice: 100, sku: "SKU-1" });

    expect(service.listCostPrices).not.toHaveBeenCalled();
    expect(result.grossCost).toBe(61.5);
  });

  it("returns every figure undefined when neither netCost nor a matching sku is given", async () => {
    const service = createService();
    service.listCostPrices.mockResolvedValue([]);

    const result = await service.computeEconomics({ sellingPrice: 200, sku: "UNKNOWN-SKU" });

    expect(result.grossCost).toBeUndefined();
    expect(result.netIncome).toBeUndefined();
  });
});

/**
 * A stateful stand-in for the settings-singleton persistence, shared by the
 * tests below that need a save to actually be visible to a later read - the
 * fixed-mock-return-value style used everywhere else in this file cannot
 * express "read back what was just written."
 */
function withPersistedSettingsStore(service: ReturnType<typeof createService>): {
  getStoredRow: () => Record<string, unknown> | undefined;
} {
  let storedRow: Record<string, unknown> | undefined;

  service.listProductCostsSettings = vi
    .fn()
    .mockImplementation(async () => (storedRow ? [storedRow] : []));
  service.createProductCostsSettings = vi.fn().mockImplementation(async (rows: unknown) => {
    storedRow = (rows as Record<string, unknown>[])[0];
    return [storedRow];
  });
  service.updateProductCostsSettings = vi.fn().mockImplementation(async (rows: unknown) => {
    const [patch] = rows as Record<string, unknown>[];
    storedRow = { ...storedRow, ...patch };
    return [storedRow];
  });

  return { getStoredRow: () => storedRow };
}

describe("ProductCostsModuleService settings singleton", () => {
  it("getSettings creates the fresh-install row (both columns null) on first read", async () => {
    const service = createService();

    const settings = await service.getSettings();

    expect(settings).toEqual({
      default_currency: null,
      id: "pcset_singleton",
      vat_rate: null,
    });
    expect(service.createProductCostsSettings).toHaveBeenCalledTimes(1);
  });

  it("getSettings returns the existing row without creating a second one", async () => {
    const service = createService();
    service.listProductCostsSettings.mockResolvedValue([
      { default_currency: "EUR", id: "pcset_singleton", vat_rate: "0.19" },
    ]);

    const settings = await service.getSettings();

    expect(settings).toEqual({ default_currency: "EUR", id: "pcset_singleton", vat_rate: 0.19 });
    expect(service.createProductCostsSettings).not.toHaveBeenCalled();
  });

  it("normalizes a bigNumber-shaped vat_rate to a real number, same as unit_cost_net", async () => {
    const service = createService();
    service.listProductCostsSettings.mockResolvedValue([
      { default_currency: null, id: "pcset_singleton", vat_rate: "0.19" },
    ]);

    const settings = await service.getSettings();

    expect(settings.vat_rate).toBe(0.19);
    expect(typeof settings.vat_rate).toBe("number");
  });

  it("re-reads the winning row when a concurrent first-read wins the insert race", async () => {
    const service = createService();
    service.listProductCostsSettings
      .mockResolvedValueOnce([]) // this call's own read: nothing yet
      .mockResolvedValueOnce([{ default_currency: null, id: "pcset_singleton", vat_rate: null }]); // re-read after the insert conflict
    service.createProductCostsSettings.mockRejectedValue(new Error("duplicate key"));

    const settings = await service.getSettings();

    expect(settings).toEqual({
      default_currency: null,
      id: "pcset_singleton",
      vat_rate: null,
    });
  });

  it("getResolvedOptions falls back to moduleOptions when nothing is persisted", async () => {
    const service = createService({ defaultCurrency: "EUR", vatRate: 0.19 });

    const resolved = await service.getResolvedOptions();

    expect(resolved).toEqual({ defaultCurrency: "EUR", vatRate: 0.19 });
  });

  it("getResolvedOptions prefers a persisted override over moduleOptions", async () => {
    const service = createService({ defaultCurrency: "PLN", vatRate: 0.23 });
    service.listProductCostsSettings.mockResolvedValue([
      { default_currency: "USD", id: "pcset_singleton", vat_rate: "0.08" },
    ]);

    const resolved = await service.getResolvedOptions();

    expect(resolved).toEqual({ defaultCurrency: "USD", vatRate: 0.08 });
  });

  it("getResolvedOptions falls back per-field, not all-or-nothing", async () => {
    const service = createService({ defaultCurrency: "PLN", vatRate: 0.23 });
    // Only the VAT rate is overridden - currency is still unset (null).
    service.listProductCostsSettings.mockResolvedValue([
      { default_currency: null, id: "pcset_singleton", vat_rate: "0.05" },
    ]);

    const resolved = await service.getResolvedOptions();

    expect(resolved).toEqual({ defaultCurrency: "PLN", vatRate: 0.05 });
  });

  it("updateSettings writes only the given keys and returns the refreshed row", async () => {
    const service = createService();
    const store = withPersistedSettingsStore(service);

    const result = await service.updateSettings({ vat_rate: 0.19 });

    expect(service.updateProductCostsSettings).toHaveBeenCalledWith([
      { id: "pcset_singleton", vat_rate: 0.19 },
    ]);
    expect(result.vat_rate).toBe(0.19);
    expect(store.getStoredRow()).toMatchObject({ vat_rate: 0.19 });
  });

  it("updateSettings(null) clears a previously-saved override back to moduleOptions", async () => {
    const service = createService({ defaultCurrency: "PLN", vatRate: 0.23 });
    withPersistedSettingsStore(service);

    await service.updateSettings({ vat_rate: 0.19 });
    let resolved = await service.getResolvedOptions();
    expect(resolved.vatRate).toBe(0.19);

    await service.updateSettings({ vat_rate: null });
    resolved = await service.getResolvedOptions();
    expect(resolved.vatRate).toBe(0.23);
  });

  it("saving a VAT rate override immediately changes computeEconomics's math - no restart needed", async () => {
    const service = createService({ defaultCurrency: "PLN", vatRate: 0.23 });
    withPersistedSettingsStore(service);

    // Before any save: computeEconomics falls back to the moduleOptions VAT
    // rate configured in the plugin options (0.23 = 23%).
    const before = await service.computeEconomics({ netCost: 100 });
    expect(before.grossCost).toBe(123);

    // The operator saves a new VAT rate from Settings > Product costs.
    await service.updateSettings({ vat_rate: 0.19 });

    // The very next computeEconomics call - with no service restart and no
    // change to moduleOptions - picks up the persisted override.
    const after = await service.computeEconomics({ netCost: 100 });
    expect(after.grossCost).toBe(119);
  });

  it("saving a default_currency override is honored by upsertCost when the caller omits currency", async () => {
    const service = createService({ defaultCurrency: "PLN", vatRate: 0.23 });
    withPersistedSettingsStore(service);
    service.listCostPrices.mockResolvedValue([]);
    service.createCostPrices.mockImplementation(async (data: Record<string, unknown>) => data);

    await service.updateSettings({ default_currency: "EUR" });
    await service.upsertCost("SKU-1", 10, { source: "manual" });

    expect(service.createCostPrices).toHaveBeenCalledWith(
      expect.objectContaining({ currency: "EUR" }),
      expect.anything(),
    );
  });

  it("an explicit vatRate passed to computeEconomics still wins over a persisted override", async () => {
    const service = createService({ defaultCurrency: "PLN", vatRate: 0.23 });
    withPersistedSettingsStore(service);

    await service.updateSettings({ vat_rate: 0.19 });
    const result = await service.computeEconomics({ netCost: 100, vatRate: 0.05 });

    expect(result.grossCost).toBe(105);
  });
});

describe("ProductCostsModuleService CostPriceHistory append-only guard", () => {
  // `CostPriceHistory` is documented as append-only, but `MedusaService(...)`
  // auto-generates update/delete/soft-delete/restore mutators for every
  // model it is given - including this one. These four overrides are what
  // actually enforces the contract; without them, any caller with a
  // reference to the service could rewrite or erase audit history.
  it("throws NOT_ALLOWED from updateCostPriceHistories", async () => {
    const service = createService();
    await expect(
      service.updateCostPriceHistories({ id: "cprch_1", unit_cost_net: 1 }),
    ).rejects.toThrow(/append-only/i);
  });

  it("throws NOT_ALLOWED from deleteCostPriceHistories", async () => {
    const service = createService();
    await expect(service.deleteCostPriceHistories("cprch_1")).rejects.toThrow(/append-only/i);
  });

  it("throws NOT_ALLOWED from softDeleteCostPriceHistories", async () => {
    const service = createService();
    await expect(service.softDeleteCostPriceHistories("cprch_1")).rejects.toThrow(/append-only/i);
  });

  it("throws NOT_ALLOWED from restoreCostPriceHistories", async () => {
    const service = createService();
    await expect(service.restoreCostPriceHistories("cprch_1")).rejects.toThrow(/append-only/i);
  });
});

describe("ProductCostsModuleService unit_cost_net normalization", () => {
  // `unit_cost_net` is a `model.bigNumber()` field, which does not
  // round-trip through the ORM as a plain JS `number` - the mocks below
  // stand in for whatever shape the ORM actually returns (a numeric string
  // is the easiest stand-in to assert against) at every boundary that flows
  // into `res.json` in the API routes.
  it("normalizes unit_cost_net to a number in getCostsBySkus", async () => {
    const service = createService();
    service.listCostPrices.mockResolvedValue([
      { currency: "PLN", id: "cprc_1", sku: "SKU-1", unit_cost_net: "10.10" },
    ]);

    const [costPrice] = await service.getCostsBySkus(["SKU-1"]);

    expect(costPrice?.unit_cost_net).toBe(10.1);
    expect(typeof costPrice?.unit_cost_net).toBe("number");
  });

  it("normalizes unit_cost_net to a number in listCosts", async () => {
    const service = createService();
    service.listAndCountCostPrices.mockResolvedValue([
      [{ currency: "PLN", id: "cprc_1", sku: "SKU-1", unit_cost_net: "10.10" }],
      1,
    ]);

    const { costs } = await service.listCosts();

    expect(costs[0]?.unit_cost_net).toBe(10.1);
    expect(typeof costs[0]?.unit_cost_net).toBe("number");
  });

  it("normalizes unit_cost_net to a number in getHistory", async () => {
    const service = createService();
    service.listAndCountCostPriceHistories.mockResolvedValue([
      [{ currency: "PLN", id: "cprch_1", sku: "SKU-1", unit_cost_net: "10.10" }],
      1,
    ]);

    const { history } = await service.getHistory("SKU-1");

    expect(history[0]?.unit_cost_net).toBe(10.1);
    expect(typeof history[0]?.unit_cost_net).toBe("number");
  });

  it("normalizes unit_cost_net to a number in the upsertCost result", async () => {
    const service = createService();
    service.listCostPrices.mockResolvedValue([]);
    service.createCostPrices.mockResolvedValue({
      currency: "PLN",
      id: "cprc_1",
      sku: "SKU-1",
      unit_cost_net: "10.10",
    });

    const result = await service.upsertCost("SKU-1", 10.1, { source: "manual" });

    expect(result.costPrice.unit_cost_net).toBe(10.1);
    expect(typeof result.costPrice.unit_cost_net).toBe("number");
  });
});
