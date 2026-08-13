import type { MedusaRequest } from "@medusajs/framework/http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockResponse } from "../../__tests__/mock-response";

// `vi.hoisted` and `vi.mock` are both hoisted above the static import of
// "../route" below, per vitest's mocking contract - `route.ts` imports
// `updateProductCostsSettingsWorkflow` from this same specifier, so it
// resolves to the mock by the time `POST` runs. See the import route's tests
// for the same pattern against a different workflow.
const { runMock, updateProductCostsSettingsWorkflowMock } = vi.hoisted(() => {
  const hoistedRunMock = vi.fn();
  return {
    runMock: hoistedRunMock,
    updateProductCostsSettingsWorkflowMock: vi.fn(() => ({ run: hoistedRunMock })),
  };
});

vi.mock("../../../../../workflows/update-product-costs-settings", () => ({
  updateProductCostsSettingsWorkflow: updateProductCostsSettingsWorkflowMock,
}));

import { GET, POST } from "../route";

function createService(
  overrides: {
    resolved?: { defaultCurrency: string; vatRate: number };
    settings?: { default_currency: string | null; vat_rate: number | null };
  } = {},
) {
  const resolved = overrides.resolved ?? { defaultCurrency: "PLN", vatRate: 0.23 };
  const settings = overrides.settings ?? { default_currency: null, vat_rate: null };
  return {
    getResolvedOptions: vi.fn().mockResolvedValue(resolved),
    getSettings: vi.fn().mockResolvedValue({ id: "pcset_singleton", ...settings }),
    moduleOptions: { defaultCurrency: "PLN", vatRate: 0.23 },
  };
}

beforeEach(() => {
  runMock.mockReset();
  runMock.mockResolvedValue({ result: { default_currency: null, vat_rate: null } });
  updateProductCostsSettingsWorkflowMock.mockClear();
});

describe("GET /admin/product-costs/config", () => {
  it("returns the resolved (persisted-or-default) configuration when nothing is overridden", async () => {
    const service = createService();
    const req = { scope: { resolve: () => service } } as unknown as MedusaRequest;
    const res = createMockResponse();

    await GET(req, res as never);

    expect(res.json).toHaveBeenCalledWith({
      defaultCurrency: "PLN",
      defaultCurrencyOverridden: false,
      vatRate: 0.23,
      vatRateOverridden: false,
    });
  });

  it("reports the persisted override, resolved through the service", async () => {
    const service = createService({
      resolved: { defaultCurrency: "EUR", vatRate: 0.19 },
      settings: { default_currency: "EUR", vat_rate: 0.19 },
    });
    const req = { scope: { resolve: () => service } } as unknown as MedusaRequest;
    const res = createMockResponse();

    await GET(req, res as never);

    expect(res.json).toHaveBeenCalledWith({
      defaultCurrency: "EUR",
      defaultCurrencyOverridden: true,
      vatRate: 0.19,
      vatRateOverridden: true,
    });
  });

  it("resolves the service from the productCosts module", async () => {
    const service = createService();
    const resolve = vi.fn().mockReturnValue(service);
    const req = { scope: { resolve } } as unknown as MedusaRequest;
    const res = createMockResponse();

    await GET(req, res as never);

    expect(resolve).toHaveBeenCalledWith("productCosts");
  });
});

describe("POST /admin/product-costs/config", () => {
  it("persists a vat_rate override through the workflow and returns the resolved config", async () => {
    runMock.mockResolvedValue({
      result: { default_currency: null, vat_rate: 0.19 },
    });
    const service = createService();
    const req = {
      body: { vat_rate: 0.19 },
      scope: { resolve: () => service },
    } as unknown as MedusaRequest;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(runMock).toHaveBeenCalledWith({ input: { vat_rate: 0.19 } });
    expect(res.json).toHaveBeenCalledWith({
      defaultCurrency: "PLN",
      defaultCurrencyOverridden: false,
      vatRate: 0.19,
      vatRateOverridden: true,
    });
  });

  it("uppercases and validates default_currency before persisting", async () => {
    runMock.mockResolvedValue({
      result: { default_currency: "EUR", vat_rate: null },
    });
    const service = createService();
    const req = {
      body: { default_currency: "eur" },
      scope: { resolve: () => service },
    } as unknown as MedusaRequest;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(runMock).toHaveBeenCalledWith({ input: { default_currency: "EUR" } });
  });

  it("rejects a currency that is not a 3-letter code, without running the workflow", async () => {
    const service = createService();
    const req = {
      body: { default_currency: "EURO" },
      scope: { resolve: () => service },
    } as unknown as MedusaRequest;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("rejects a vat_rate outside 0..1", async () => {
    const service = createService();
    const req = {
      body: { vat_rate: 1.5 },
      scope: { resolve: () => service },
    } as unknown as MedusaRequest;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("rejects a negative vat_rate", async () => {
    const service = createService();
    const req = {
      body: { vat_rate: -0.1 },
      scope: { resolve: () => service },
    } as unknown as MedusaRequest;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("clears an override when a key is explicitly sent as null", async () => {
    runMock.mockResolvedValue({
      result: { default_currency: null, vat_rate: null },
    });
    const service = createService();
    const req = {
      body: { vat_rate: null },
      scope: { resolve: () => service },
    } as unknown as MedusaRequest;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(runMock).toHaveBeenCalledWith({ input: { vat_rate: null } });
  });

  it("rejects an unknown key rather than silently ignoring it", async () => {
    const service = createService();
    const req = {
      body: { vatRate: 0.2 },
      scope: { resolve: () => service },
    } as unknown as MedusaRequest;
    const res = createMockResponse();

    await expect(POST(req, res as never)).rejects.toThrow(/Unknown setting/);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("rejects an empty body rather than silently no-op-ing", async () => {
    const service = createService();
    const req = {
      body: {},
      scope: { resolve: () => service },
    } as unknown as MedusaRequest;
    const res = createMockResponse();

    await expect(POST(req, res as never)).rejects.toThrow(/Provide at least one setting/);
    expect(runMock).not.toHaveBeenCalled();
  });
});
