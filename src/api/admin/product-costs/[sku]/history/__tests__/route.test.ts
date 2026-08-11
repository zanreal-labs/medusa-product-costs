import type { MedusaRequest } from "@medusajs/framework/http";
import { describe, expect, it, vi } from "vitest";
import { createMockResponse } from "../../../__tests__/mock-response";
import { GET } from "../route";

function createService(overrides: Record<string, unknown> = {}) {
  return {
    getHistory: vi.fn().mockResolvedValue({ count: 0, history: [] }),
    ...overrides,
  };
}

function createReq(overrides: Record<string, unknown> = {}) {
  return {
    params: { sku: "SKU-1" },
    query: {},
    scope: { resolve: vi.fn() },
    ...overrides,
  };
}

describe("GET /admin/product-costs/:sku/history", () => {
  it("defaults limit to 50 and offset to 0", async () => {
    const service = createService();
    const req = createReq({ scope: { resolve: () => service } }) as unknown as MedusaRequest;
    const res = createMockResponse();

    await GET(req, res as never);

    expect(service.getHistory).toHaveBeenCalledWith("SKU-1", { limit: 50, offset: 0 });
    expect(res.json).toHaveBeenCalledWith({ count: 0, history: [], limit: 50, offset: 0 });
  });

  it("passes the sku param through untouched", async () => {
    const service = createService();
    const req = createReq({
      params: { sku: "SKU-WITH-DASHES-99" },
      scope: { resolve: () => service },
    }) as unknown as MedusaRequest;
    const res = createMockResponse();

    await GET(req, res as never);

    expect(service.getHistory).toHaveBeenCalledWith("SKU-WITH-DASHES-99", expect.anything());
  });

  it("caps limit at 500", async () => {
    const service = createService();
    const req = createReq({
      query: { limit: "10000" },
      scope: { resolve: () => service },
    }) as unknown as MedusaRequest;
    const res = createMockResponse();

    await GET(req, res as never);

    expect(service.getHistory).toHaveBeenCalledWith("SKU-1", { limit: 500, offset: 0 });
  });

  it("rejects a negative limit with 400, without calling the service", async () => {
    const service = createService();
    const req = createReq({
      query: { limit: "-1" },
      scope: { resolve: () => service },
    }) as unknown as MedusaRequest;
    const res = createMockResponse();

    await GET(req, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "limit must be a non-negative number" });
    expect(service.getHistory).not.toHaveBeenCalled();
  });

  it("rejects a negative offset with 400", async () => {
    const service = createService();
    const req = createReq({
      query: { offset: "-1" },
      scope: { resolve: () => service },
    }) as unknown as MedusaRequest;
    const res = createMockResponse();

    await GET(req, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "offset must be a non-negative number" });
  });

  it("returns the service's count and history verbatim", async () => {
    const historyRow = {
      changed_at: new Date("2026-01-01"),
      changed_by: "user_1",
      currency: "PLN",
      id: "cprch_1",
      sku: "SKU-1",
      source: "manual",
      unit_cost_net: 10.5,
    };
    const service = createService({
      getHistory: vi.fn().mockResolvedValue({ count: 1, history: [historyRow] }),
    });
    const req = createReq({ scope: { resolve: () => service } }) as unknown as MedusaRequest;
    const res = createMockResponse();

    await GET(req, res as never);

    expect(res.json).toHaveBeenCalledWith({
      count: 1,
      history: [historyRow],
      limit: 50,
      offset: 0,
    });
  });
});
