import type { MedusaRequest } from "@medusajs/framework/http";
import { describe, expect, it, vi } from "vitest";
import { createMockResponse } from "../../__tests__/mock-response";
import { GET } from "../route";

describe("GET /admin/product-costs/config", () => {
  it("returns the service's resolved moduleOptions verbatim", async () => {
    const service = { moduleOptions: { defaultCurrency: "PLN", vatRate: 0.23 } };
    const req = { scope: { resolve: () => service } } as unknown as MedusaRequest;
    const res = createMockResponse();

    await GET(req, res as never);

    expect(res.json).toHaveBeenCalledWith({ defaultCurrency: "PLN", vatRate: 0.23 });
  });

  it("resolves the service from the productCosts module", async () => {
    const resolve = vi
      .fn()
      .mockReturnValue({ moduleOptions: { defaultCurrency: "EUR", vatRate: 0.19 } });
    const req = { scope: { resolve } } as unknown as MedusaRequest;
    const res = createMockResponse();

    await GET(req, res as never);

    expect(resolve).toHaveBeenCalledWith("productCosts");
  });
});
