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

function createService(options?: ConstructorParameters<typeof ProductCostsModuleService>[1]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new (ProductCostsModuleService as any)(
    {},
    options,
  ) as ProductCostsModuleService & {
    listCostPrices: ReturnType<typeof vi.fn>;
    createCostPrices: ReturnType<typeof vi.fn>;
    updateCostPrices: ReturnType<typeof vi.fn>;
    createCostPriceHistories: ReturnType<typeof vi.fn>;
    listAndCountCostPrices: ReturnType<typeof vi.fn>;
    listAndCountCostPriceHistories: ReturnType<typeof vi.fn>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    baseRepository_: any;
  };

  service.listCostPrices = vi.fn().mockResolvedValue([]);
  service.createCostPrices = vi.fn();
  service.updateCostPrices = vi.fn();
  service.createCostPriceHistories = vi.fn().mockResolvedValue({});
  service.listAndCountCostPrices = vi.fn().mockResolvedValue([[], 0]);
  service.listAndCountCostPriceHistories = vi.fn().mockResolvedValue([[], 0]);
  service.baseRepository_ = {
    getFreshManager: vi.fn(() => ({ __fake: "fresh-manager" })),
    transaction: vi.fn(
      async (work: (manager: unknown) => Promise<unknown>) => await work(fakeTransactionManager),
    ),
  };

  return service;
}

describe("ProductCostsModuleService.moduleOptions", () => {
  it("defaults vatRate to 0.23 and currency to PLN", () => {
    const service = createService();
    expect(service.moduleOptions).toEqual({ defaultCurrency: "PLN", vatRate: 0.23 });
  });

  it("honors options passed by the consuming app", () => {
    const service = createService({ defaultCurrency: "EUR", vatRate: 0.19 });
    expect(service.moduleOptions).toEqual({ defaultCurrency: "EUR", vatRate: 0.19 });
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
