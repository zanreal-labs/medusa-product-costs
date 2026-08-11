import type { MedusaRequest } from "@medusajs/framework/http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockResponse } from "./mock-response";

// `vi.hoisted` and `vi.mock` are both hoisted above the static import of
// "../route" below, per vitest's mocking contract - `route.ts` imports
// `upsertCostPriceWorkflow` from this same specifier, so it resolves to the
// mock by the time `GET`/`POST` run.
const { runMock, upsertCostPriceWorkflowMock } = vi.hoisted(() => {
  const hoistedRunMock = vi.fn();
  return {
    runMock: hoistedRunMock,
    upsertCostPriceWorkflowMock: vi.fn(() => ({ run: hoistedRunMock })),
  };
});

vi.mock("../../../../workflows/upsert-cost-price", () => ({
  upsertCostPriceWorkflow: upsertCostPriceWorkflowMock,
}));

import { GET, POST } from "../route";

function createService(overrides: Record<string, unknown> = {}) {
  return {
    listCosts: vi.fn().mockResolvedValue({ costs: [], count: 0 }),
    ...overrides,
  };
}

function createReq(overrides: Record<string, unknown> = {}) {
  return {
    auth_context: { actor_id: "user_1" },
    body: {},
    params: {},
    query: {},
    scope: { resolve: vi.fn() },
    ...overrides,
  };
}

beforeEach(() => {
  runMock.mockReset();
  upsertCostPriceWorkflowMock.mockClear();
});

describe("GET /admin/product-costs", () => {
  it("defaults limit to 20 and offset to 0", async () => {
    const service = createService();
    const req = createReq({ scope: { resolve: () => service } }) as unknown as MedusaRequest;
    const res = createMockResponse();

    await GET(req, res as never);

    expect(service.listCosts).toHaveBeenCalledWith(
      { q: undefined, sku: undefined },
      {
        limit: 20,
        offset: 0,
      },
    );
    expect(res.json).toHaveBeenCalledWith({ cost_prices: [], count: 0, limit: 20, offset: 0 });
  });

  it("passes q and a repeated sku filter through", async () => {
    const service = createService();
    const req = createReq({
      query: { q: "abc", sku: ["A", "B"] },
      scope: { resolve: () => service },
    }) as unknown as MedusaRequest;
    const res = createMockResponse();

    await GET(req, res as never);

    expect(service.listCosts).toHaveBeenCalledWith(
      { q: "abc", sku: ["A", "B"] },
      expect.anything(),
    );
  });

  it("wraps a single sku query param in an array", async () => {
    const service = createService();
    const req = createReq({
      query: { sku: "A" },
      scope: { resolve: () => service },
    }) as unknown as MedusaRequest;
    const res = createMockResponse();

    await GET(req, res as never);

    expect(service.listCosts).toHaveBeenCalledWith({ q: undefined, sku: ["A"] }, expect.anything());
  });

  it("caps limit at 500", async () => {
    const service = createService();
    const req = createReq({
      query: { limit: "10000" },
      scope: { resolve: () => service },
    }) as unknown as MedusaRequest;
    const res = createMockResponse();

    await GET(req, res as never);

    expect(service.listCosts).toHaveBeenCalledWith(expect.anything(), {
      limit: 500,
      offset: 0,
    });
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
    expect(service.listCosts).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric limit with 400", async () => {
    const service = createService();
    const req = createReq({
      query: { limit: "abc" },
      scope: { resolve: () => service },
    }) as unknown as MedusaRequest;
    const res = createMockResponse();

    await GET(req, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects a negative offset with 400", async () => {
    const service = createService();
    const req = createReq({
      query: { offset: "-5" },
      scope: { resolve: () => service },
    }) as unknown as MedusaRequest;
    const res = createMockResponse();

    await GET(req, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "offset must be a non-negative number" });
  });
});

describe("POST /admin/product-costs", () => {
  beforeEach(() => {
    runMock.mockResolvedValue({
      result: { costPrice: { id: "cprc_1", sku: "SKU-1" }, duplicateVariantMatches: 0 },
    });
  });

  it("rejects a missing sku with 400, without calling the workflow", async () => {
    const req = createReq({
      body: { unit_cost_net: 10 },
    }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "sku is required" });
    expect(upsertCostPriceWorkflowMock).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only sku with 400", async () => {
    const req = createReq({
      body: { sku: "   ", unit_cost_net: 10 },
    }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "sku is required" });
  });

  it("trims a sku with surrounding whitespace before using it", async () => {
    const req = createReq({
      body: { sku: "  SKU-1  ", unit_cost_net: 10 },
    }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ sku: "SKU-1" }) }),
    );
  });

  it("rejects a non-number unit_cost_net with 400", async () => {
    const req = createReq({
      body: { sku: "SKU-1", unit_cost_net: "10" },
    }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "unit_cost_net must be a positive number" });
  });

  it("rejects a zero unit_cost_net with 400", async () => {
    const req = createReq({
      body: { sku: "SKU-1", unit_cost_net: 0 },
    }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects a negative unit_cost_net with 400", async () => {
    const req = createReq({
      body: { sku: "SKU-1", unit_cost_net: -5 },
    }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects a unit_cost_net above the ceiling with 400", async () => {
    const req = createReq({
      body: { sku: "SKU-1", unit_cost_net: 1_000_001 },
    }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: "unit_cost_net must not exceed 1000000",
    });
    expect(upsertCostPriceWorkflowMock).not.toHaveBeenCalled();
  });

  it("accepts a unit_cost_net exactly at the ceiling", async () => {
    const req = createReq({
      body: { sku: "SKU-1", unit_cost_net: 1_000_000 },
    }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(res.status).not.toHaveBeenCalled();
    expect(upsertCostPriceWorkflowMock).toHaveBeenCalled();
  });

  it("rejects a currency that is not a 3-letter code with 400", async () => {
    const req = createReq({
      body: { currency: "PLZ1", sku: "SKU-1", unit_cost_net: 10 },
    }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("ISO-4217") }),
    );
    expect(upsertCostPriceWorkflowMock).not.toHaveBeenCalled();
  });

  it("normalizes a lowercase currency to uppercase before validating and forwarding it", async () => {
    const req = createReq({
      body: { currency: "pln", sku: "SKU-1", unit_cost_net: 10 },
    }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(res.status).not.toHaveBeenCalled();
    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ currency: "PLN" }) }),
    );
  });

  it("leaves currency undefined when not provided, letting the workflow fall back to the module default", async () => {
    const req = createReq({
      body: { sku: "SKU-1", unit_cost_net: 10 },
    }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ currency: undefined }) }),
    );
  });

  it("defaults source to manual when not provided", async () => {
    const req = createReq({
      body: { sku: "SKU-1", unit_cost_net: 10 },
    }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ source: "manual" }) }),
    );
  });

  it("falls back to manual when source is not one of the known values", async () => {
    const req = createReq({
      body: { sku: "SKU-1", source: "not-a-real-source", unit_cost_net: 10 },
    }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ source: "manual" }) }),
    );
  });

  it("returns the workflow's cost_price and duplicate_variant_matches on success", async () => {
    runMock.mockResolvedValue({
      result: { costPrice: { id: "cprc_1", sku: "SKU-1" }, duplicateVariantMatches: 2 },
    });
    const req = createReq({
      body: { sku: "SKU-1", unit_cost_net: 10 },
    }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(res.json).toHaveBeenCalledWith({
      cost_price: { id: "cprc_1", sku: "SKU-1" },
      duplicate_variant_matches: 2,
    });
  });

  it("passes the authenticated actor id through as changedBy", async () => {
    const req = createReq({
      auth_context: { actor_id: "user_42" },
      body: { sku: "SKU-1", unit_cost_net: 10 },
    }) as never;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ changedBy: "user_42" }) }),
    );
  });
});
