import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockResponse } from "../../__tests__/mock-response";

// `vi.hoisted` and `vi.mock` are both hoisted above the static import of
// "../route" below, per vitest's mocking contract - `route.ts` imports
// `syncCostPriceVariantLinksWorkflow` from this same specifier, so it
// resolves to the mock by the time `POST` runs.
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

function createService(overrides: Record<string, unknown> = {}) {
  return {
    importCsv: vi.fn().mockResolvedValue({
      created: 0,
      errors: [],
      skipped: 0,
      skus: [],
      updated: 0,
    }),
    ...overrides,
  };
}

function createReq(overrides: Record<string, unknown> = {}) {
  return {
    auth_context: { actor_id: "user_1" },
    body: {},
    scope: { resolve: vi.fn() },
    ...overrides,
  };
}

beforeEach(() => {
  runMock.mockReset();
  runMock.mockResolvedValue({ result: { changes: [], duplicateSkus: {} } });
  syncCostPriceVariantLinksWorkflowMock.mockClear();
});

describe("POST /admin/product-costs/import", () => {
  it("rejects a missing csv body with 400, without touching the service", async () => {
    const service = createService();
    const req = createReq({ scope: { resolve: () => service } }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "csv (a non-empty string) is required" });
    expect(service.importCsv).not.toHaveBeenCalled();
  });

  it("rejects a blank/whitespace-only csv body with 400", async () => {
    const service = createService();
    const req = createReq({
      body: { csv: "   \n  " },
      scope: { resolve: () => service },
    }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects a non-string csv body with 400", async () => {
    const service = createService();
    const req = createReq({
      body: { csv: 12_345 },
      scope: { resolve: () => service },
    }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("passes the csv body and the authenticated actor id through to importCsv with source csv", async () => {
    const service = createService();
    const req = createReq({
      auth_context: { actor_id: "user_9" },
      body: { csv: "SKU-1,10.50" },
      scope: { resolve: () => service },
    }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(service.importCsv).toHaveBeenCalledWith("SKU-1,10.50", {
      changedBy: "user_9",
      source: "csv",
    });
  });

  it("does not run the variant-link sync workflow when no SKU was touched", async () => {
    const service = createService({
      importCsv: vi.fn().mockResolvedValue({
        created: 0,
        errors: [{ lineNumber: 1, raw: "garbage", reason: "Missing or invalid cost" }],
        skipped: 0,
        skus: [],
        updated: 0,
      }),
    });
    const req = createReq({
      body: { csv: "garbage" },
      scope: { resolve: () => service },
    }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(syncCostPriceVariantLinksWorkflowMock).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      created: 0,
      duplicateSkus: {},
      errors: [{ lineNumber: 1, raw: "garbage", reason: "Missing or invalid cost" }],
      skipped: 0,
      updated: 0,
    });
  });

  it("runs the variant-link sync workflow for every SKU touched and surfaces duplicateSkus", async () => {
    const service = createService({
      importCsv: vi.fn().mockResolvedValue({
        created: 2,
        errors: [],
        skipped: 0,
        skus: ["SKU-1", "SKU-2"],
        updated: 0,
      }),
    });
    runMock.mockResolvedValue({ result: { changes: [], duplicateSkus: { "SKU-1": 1 } } });
    const req = createReq({
      body: { csv: "SKU-1,10\nSKU-2,20" },
      scope: { resolve: () => service },
    }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(runMock).toHaveBeenCalledWith({ input: { skus: ["SKU-1", "SKU-2"] } });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ duplicateSkus: { "SKU-1": 1 } }),
    );
  });

  it("reports parse/persistence errors from importCsv untouched", async () => {
    const service = createService({
      importCsv: vi.fn().mockResolvedValue({
        created: 1,
        errors: [{ lineNumber: 3, raw: "bad,row", reason: "Missing or invalid cost" }],
        skipped: 0,
        skus: ["SKU-1"],
        updated: 0,
      }),
    });
    const req = createReq({
      body: { csv: "SKU-1,10\nbad,row" },
      scope: { resolve: () => service },
    }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        created: 1,
        errors: [{ lineNumber: 3, raw: "bad,row", reason: "Missing or invalid cost" }],
      }),
    );
  });
});
