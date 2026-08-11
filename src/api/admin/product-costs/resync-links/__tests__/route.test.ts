import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockResponse } from "../../__tests__/mock-response";

// `vi.hoisted` and `vi.mock` are both hoisted above the static import of
// "../route" below - see the equivalent note in the import route's tests.
const { runMock, syncCostPriceVariantLinksWorkflowMock } = vi.hoisted(() => {
  const hoistedRunMock = vi.fn();
  return {
    runMock: hoistedRunMock,
    syncCostPriceVariantLinksWorkflowMock: vi.fn(() => ({ run: hoistedRunMock })),
  };
});

vi.mock("../../../../../workflows/sync-cost-price-variant-links", () => ({
  syncCostPriceVariantLinksWorkflow: syncCostPriceVariantLinksWorkflowMock,
}));

import { POST } from "../route";

function createReq(overrides: Record<string, unknown> = {}) {
  return {
    scope: { resolve: vi.fn() },
    ...overrides,
  };
}

beforeEach(() => {
  runMock.mockReset();
  runMock.mockResolvedValue({ result: { changes: [], duplicateSkus: {} } });
  syncCostPriceVariantLinksWorkflowMock.mockClear();
});

describe("POST /admin/product-costs/resync-links", () => {
  it("returns a zeroed summary without running the sync workflow when there are no costs", async () => {
    const service = { listCosts: vi.fn().mockResolvedValue({ costs: [], count: 0 }) };
    const req = createReq({ scope: { resolve: () => service } }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(syncCostPriceVariantLinksWorkflowMock).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ changed: 0, duplicateSkus: {}, skusChecked: 0 });
  });

  it("collects every SKU on a single page and runs the sync workflow once", async () => {
    const service = {
      listCosts: vi.fn().mockResolvedValue({
        costs: [{ sku: "SKU-1" }, { sku: "SKU-2" }],
        count: 2,
      }),
    };
    const req = createReq({ scope: { resolve: () => service } }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(service.listCosts).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledWith({ input: { skus: ["SKU-1", "SKU-2"] } });
  });

  it("walks every page until the running offset reaches the total count", async () => {
    const page1 = {
      costs: Array.from({ length: 500 }, (_, i) => ({ sku: `SKU-${i}` })),
      count: 501,
    };
    const page2 = { costs: [{ sku: "SKU-500" }], count: 501 };
    const listCosts = vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
    const service = { listCosts };
    const req = createReq({ scope: { resolve: () => service } }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(listCosts).toHaveBeenCalledTimes(2);
    expect(listCosts).toHaveBeenNthCalledWith(1, {}, { limit: 500, offset: 0 });
    expect(listCosts).toHaveBeenNthCalledWith(2, {}, { limit: 500, offset: 500 });
    const [[{ input }]] = runMock.mock.calls;
    expect(input.skus).toHaveLength(501);
  });

  it("returns the change count and duplicateSkus from the sync workflow's result", async () => {
    const service = {
      listCosts: vi.fn().mockResolvedValue({ costs: [{ sku: "SKU-1" }], count: 1 }),
    };
    runMock.mockResolvedValue({
      result: {
        changes: [
          { costPriceId: "cprc_1", nextVariantId: "v2", previousVariantId: "v1", sku: "SKU-1" },
        ],
        duplicateSkus: { "SKU-1": 1 },
      },
    });
    const req = createReq({ scope: { resolve: () => service } }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(res.json).toHaveBeenCalledWith({
      changed: 1,
      duplicateSkus: { "SKU-1": 1 },
      skusChecked: 1,
    });
  });
});
