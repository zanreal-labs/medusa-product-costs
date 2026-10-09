import type { StepExecutionContext } from "@medusajs/framework/workflows-sdk";
import { describe, expect, it, vi } from "vitest";
import { PRODUCT_COSTS_MODULE } from "../../../modules/product-costs";
import type { CostPriceDTO } from "../../../modules/product-costs/types";
import {
  deleteCostPricesBySku,
  listCostPriceIdsBySku,
  restoreCostPrices,
} from "../delete-cost-price-by-sku";

/**
 * Exercises the step handlers exported next to the steps, with a container
 * that only answers the product-costs module key (see resolve-variant-id.test).
 */
function containerWith(service: object): Pick<StepExecutionContext, "container"> {
  return {
    container: { resolve: (key: string) => (key === PRODUCT_COSTS_MODULE ? service : undefined) },
  } as unknown as Pick<StepExecutionContext, "container">;
}

const row = (id: string, currency: string, extra: Partial<CostPriceDTO> = {}): CostPriceDTO =>
  ({
    id,
    sku: "SKU-1",
    unit_cost_net: 10,
    currency,
    source: "manual",
    note: null,
    variant_id: "variant_1",
    ...extra,
  }) as unknown as CostPriceDTO;

describe("deleteCostPricesBySku", () => {
  it("deletes every currency row for the SKU and returns them", async () => {
    const rows = [row("cp_1", "EUR"), row("cp_2", "USD")];
    const service = {
      listCostPrices: vi.fn().mockResolvedValue(rows),
      deleteCostPrices: vi.fn().mockResolvedValue(undefined),
    };

    const result = await deleteCostPricesBySku({ sku: " SKU-1 " }, containerWith(service));

    expect(service.listCostPrices).toHaveBeenCalledWith({ sku: ["SKU-1"] }, {});
    expect(service.deleteCostPrices).toHaveBeenCalledWith(["cp_1", "cp_2"]);
    expect(result).toEqual(rows);
  });

  it("is a no-op when the SKU has no rows", async () => {
    const service = {
      listCostPrices: vi.fn().mockResolvedValue([]),
      deleteCostPrices: vi.fn(),
    };

    expect(await deleteCostPricesBySku({ sku: "SKU-1" }, containerWith(service))).toEqual([]);
    expect(service.deleteCostPrices).not.toHaveBeenCalled();
  });
});

describe("listCostPriceIdsBySku", () => {
  it("returns the ids without deleting anything", async () => {
    const service = {
      listCostPrices: vi.fn().mockResolvedValue([row("cp_1", "EUR"), row("cp_2", "USD")]),
      deleteCostPrices: vi.fn(),
    };

    expect(await listCostPriceIdsBySku({ sku: "SKU-1" }, containerWith(service))).toEqual([
      "cp_1",
      "cp_2",
    ]);
    expect(service.deleteCostPrices).not.toHaveBeenCalled();
  });
});

describe("restoreCostPrices", () => {
  it("recreates every deleted row under its original id", async () => {
    const service = { createCostPrices: vi.fn().mockResolvedValue([]) };

    await restoreCostPrices(
      [row("cp_1", "EUR", { unit_cost_net: "12.5" as unknown as number }), row("cp_2", "USD")],
      containerWith(service),
    );

    expect(service.createCostPrices).toHaveBeenCalledWith([
      expect.objectContaining({ id: "cp_1", currency: "EUR", unit_cost_net: 12.5, variant_id: "variant_1" }),
      expect.objectContaining({ id: "cp_2", currency: "USD", unit_cost_net: 10 }),
    ]);
  });

  it("does nothing when no row was deleted", async () => {
    const service = { createCostPrices: vi.fn() };

    await restoreCostPrices([], containerWith(service));
    await restoreCostPrices(undefined, containerWith(service));
    await restoreCostPrices(null, containerWith(service));

    expect(service.createCostPrices).not.toHaveBeenCalled();
  });

  it("still restores the single record persisted by the previous step shape", async () => {
    const service = { createCostPrices: vi.fn().mockResolvedValue([]) };

    await restoreCostPrices(row("cp_1", "EUR"), containerWith(service));

    expect(service.createCostPrices).toHaveBeenCalledWith([expect.objectContaining({ id: "cp_1" })]);
  });
});
