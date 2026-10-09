import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { createMedusaContainer } from "@medusajs/framework/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRODUCT_COSTS_MODULE } from "../../modules/product-costs";

const calls = vi.hoisted(() => ({ dismiss: [] as unknown[], remove: [] as unknown[] }));

// Stand-ins for the core-flows steps that record what the workflow feeds them.
vi.mock("@medusajs/medusa/core-flows", () => ({
  dismissRemoteLinkStep: createStep("fake-dismiss-remote-link", async (input: unknown) => {
    calls.dismiss.push(input);
    return new StepResponse(input);
  }),
  removeRemoteLinkStep: createStep("fake-remove-remote-link", async (input: unknown) => {
    calls.remove.push(input);
    return new StepResponse(input);
  }),
}));

import { deleteCostPriceWorkflow } from "../delete-cost-price";

function buildContainer(rows: { id: string }[], links: object[]) {
  const service = {
    listCostPrices: vi.fn(async (filter: { sku?: string[]; id?: string[] }) =>
      filter.id ? rows.filter((r) => filter.id!.includes(r.id)) : rows,
    ),
    deleteCostPrices: vi.fn(async () => undefined),
  };
  const query = { graph: vi.fn(async () => ({ data: links })) };
  const container = createMedusaContainer();
  container.register(PRODUCT_COSTS_MODULE, { resolve: () => service });
  container.register("query", { resolve: () => query });
  return { container, service, query };
}

describe("deleteCostPriceWorkflow", () => {
  beforeEach(() => {
    calls.dismiss.length = 0;
    calls.remove.length = 0;
  });

  it("dismisses the links (never removes them, which would cascade to variants), then deletes the same rows", async () => {
    const { container, service, query } = buildContainer(
      [{ id: "cp_1" }, { id: "cp_2" }],
      [{ product_variant_id: "variant_1", cost_price_id: "cp_1" }],
    );

    await deleteCostPriceWorkflow(container).run({ input: { sku: "SKU-1" } });

    expect(query.graph).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { cost_price_id: ["cp_1", "cp_2"] },
        fields: ["product_variant_id", "cost_price_id"],
      }),
    );
    expect(calls.remove).toEqual([]);
    expect(calls.dismiss).toEqual([
      [
        {
          product: { product_variant_id: "variant_1" },
          [PRODUCT_COSTS_MODULE]: { cost_price_id: "cp_1" },
        },
      ],
    ]);
    expect(service.deleteCostPrices).toHaveBeenCalledWith(["cp_1", "cp_2"]);
  });

  it("dismisses nothing when the SKU has no rows", async () => {
    const { container, service } = buildContainer([], []);
    await deleteCostPriceWorkflow(container).run({ input: { sku: "NOPE" } });
    expect(calls.remove).toEqual([]);
    expect(calls.dismiss).toEqual([[]]);
    expect(service.deleteCostPrices).not.toHaveBeenCalled();
  });
});
