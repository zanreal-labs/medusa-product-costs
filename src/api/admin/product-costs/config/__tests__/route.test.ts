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
    resolved?: { defaultCurrency: string | null; enabledCurrencies?: string[]; vatRate: number | null };
    settings?: {
      default_currency: string | null;
      enabled_currencies?: string[] | null;
      vat_rate: number | null;
    };
    moduleOptions?: { defaultCurrency: string | null; enabledCurrencies?: string[]; vatRate: number | null };
  } = {},
) {
  const resolved = overrides.resolved ?? {
    defaultCurrency: "PLN",
    enabledCurrencies: ["PLN"],
    vatRate: 0.23,
  };
  const settings = overrides.settings ?? {
    default_currency: null,
    enabled_currencies: null,
    vat_rate: null,
  };
  return {
    getResolvedOptions: vi.fn().mockResolvedValue(resolved),
    getSettings: vi.fn().mockResolvedValue({ id: "pcset_singleton", ...settings }),
    moduleOptions: overrides.moduleOptions ?? { defaultCurrency: "PLN", vatRate: 0.23 },
  };
}

/**
 * A request scope that answers per registration key. The route resolves two
 * different things now - the product-costs service and Medusa's Query, the
 * latter only to read the store's default currency - and a scope that hands
 * the same object to both cannot tell those lookups apart.
 *
 * `storeCurrency: undefined` stands for a container with no Query registered
 * (this plugin's own route tests, and any caller outside a Medusa request):
 * the store fallback then resolves to nothing, exactly as it does when the
 * store has named no default currency.
 */
function createScope(service: unknown, storeCurrency?: string) {
  const query =
    storeCurrency === undefined
      ? undefined
      : {
          graph: vi.fn().mockResolvedValue({
            data: [
              {
                supported_currencies: [
                  { currency_code: "usd", is_default: false },
                  { currency_code: storeCurrency.toLowerCase(), is_default: true },
                ],
              },
            ],
          }),
        };
  return {
    resolve: (key: string) => (key === "query" ? query : service),
  };
}

beforeEach(() => {
  runMock.mockReset();
  runMock.mockResolvedValue({
    result: { default_currency: null, enabled_currencies: null, vat_rate: null },
  });
  updateProductCostsSettingsWorkflowMock.mockClear();
});

describe("GET /admin/product-costs/config", () => {
  it("returns the resolved (persisted-or-default) configuration when nothing is overridden", async () => {
    const service = createService();
    const req = { scope: createScope(service) } as unknown as MedusaRequest;
    const res = createMockResponse();

    await GET(req, res as never);

    expect(res.json).toHaveBeenCalledWith({
      defaultCurrency: "PLN",
      defaultCurrencyOverridden: false,
      defaultCurrencySource: "plugin",
      enabledCurrencies: ["PLN"],
      enabledCurrenciesOverridden: false,
      vatRate: 0.23,
      vatRateOverridden: false,
    });
  });

  it("reports the persisted override, resolved through the service", async () => {
    const service = createService({
      resolved: { defaultCurrency: "EUR", enabledCurrencies: ["EUR", "USD"], vatRate: 0.19 },
      settings: { default_currency: "EUR", enabled_currencies: ["USD"], vat_rate: 0.19 },
    });
    const req = { scope: createScope(service) } as unknown as MedusaRequest;
    const res = createMockResponse();

    await GET(req, res as never);

    expect(res.json).toHaveBeenCalledWith({
      defaultCurrency: "EUR",
      defaultCurrencyOverridden: true,
      defaultCurrencySource: "settings",
      enabledCurrencies: ["EUR", "USD"],
      enabledCurrenciesOverridden: true,
      vatRate: 0.19,
      vatRateOverridden: true,
    });
  });

  it("falls back to the store's default currency when neither the settings nor the plugin name one", async () => {
    const service = createService({
      moduleOptions: { defaultCurrency: null, vatRate: 0.23 },
      resolved: { defaultCurrency: null, vatRate: 0.23 },
    });
    const req = { scope: createScope(service, "GBP") } as unknown as MedusaRequest;
    const res = createMockResponse();

    await GET(req, res as never);

    expect(res.json).toHaveBeenCalledWith({
      defaultCurrency: "GBP",
      defaultCurrencyOverridden: false,
      // Named, not silently presented as a chosen setting: the store's selling
      // currency is not necessarily the currency purchase invoices arrive in.
      defaultCurrencySource: "store",
      // Headed by the effective currency even though it came from the store:
      // the list is what the cost card offers, and offering nothing would
      // leave the one currency this store can actually save in unreachable.
      enabledCurrencies: ["GBP"],
      enabledCurrenciesOverridden: false,
      vatRate: 0.23,
      vatRateOverridden: false,
    });
  });

  it("does not consult the store when the plugin already names a currency", async () => {
    const service = createService();
    const scope = createScope(service, "GBP");
    const query = scope.resolve("query") as { graph: ReturnType<typeof vi.fn> };
    const req = { scope } as unknown as MedusaRequest;
    const res = createMockResponse();

    await GET(req, res as never);

    expect(query.graph).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ defaultCurrency: "PLN", defaultCurrencySource: "plugin" }),
    );
  });

  it("reports the currency as configured nowhere when the store has no default either", async () => {
    const service = createService({
      moduleOptions: { defaultCurrency: null, vatRate: null },
      resolved: { defaultCurrency: null, vatRate: null },
    });
    const req = { scope: createScope(service) } as unknown as MedusaRequest;
    const res = createMockResponse();

    await GET(req, res as never);

    // `null` has to survive the trip: it is what tells the settings page to
    // render a blank field and a warning instead of a code nobody chose.
    expect(res.json).toHaveBeenCalledWith({
      defaultCurrency: null,
      defaultCurrencyOverridden: false,
      defaultCurrencySource: null,
      enabledCurrencies: [],
      enabledCurrenciesOverridden: false,
      vatRate: null,
      vatRateOverridden: false,
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
      result: { default_currency: null, enabled_currencies: null, vat_rate: 0.19 },
    });
    const service = createService();
    const req = {
      body: { vat_rate: 0.19 },
      scope: createScope(service),
    } as unknown as MedusaRequest;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(runMock).toHaveBeenCalledWith({ input: { vat_rate: 0.19 } });
    expect(res.json).toHaveBeenCalledWith({
      defaultCurrency: "PLN",
      defaultCurrencyOverridden: false,
      defaultCurrencySource: "plugin",
      enabledCurrencies: ["PLN"],
      enabledCurrenciesOverridden: false,
      vatRate: 0.19,
      vatRateOverridden: true,
    });
  });

  it("uppercases and validates default_currency before persisting", async () => {
    runMock.mockResolvedValue({
      result: { default_currency: "EUR", enabled_currencies: null, vat_rate: null },
    });
    const service = createService();
    const req = {
      body: { default_currency: "eur" },
      scope: createScope(service),
    } as unknown as MedusaRequest;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(runMock).toHaveBeenCalledWith({ input: { default_currency: "EUR" } });
  });

  it("rejects a currency that is not a 3-letter code, without running the workflow", async () => {
    const service = createService();
    const req = {
      body: { default_currency: "EURO" },
      scope: createScope(service),
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
      scope: createScope(service),
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
      scope: createScope(service),
    } as unknown as MedusaRequest;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("clears an override when a key is explicitly sent as null", async () => {
    runMock.mockResolvedValue({
      result: { default_currency: null, enabled_currencies: null, vat_rate: null },
    });
    const service = createService();
    const req = {
      body: { vat_rate: null },
      scope: createScope(service),
    } as unknown as MedusaRequest;
    const res = createMockResponse();

    await POST(req, res as never);

    expect(runMock).toHaveBeenCalledWith({ input: { vat_rate: null } });
  });

  it("rejects an unknown key rather than silently ignoring it", async () => {
    const service = createService();
    const req = {
      body: { vatRate: 0.2 },
      scope: createScope(service),
    } as unknown as MedusaRequest;
    const res = createMockResponse();

    await expect(POST(req, res as never)).rejects.toThrow(/Unknown setting/);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("rejects an empty body rather than silently no-op-ing", async () => {
    const service = createService();
    const req = {
      body: {},
      scope: createScope(service),
    } as unknown as MedusaRequest;
    const res = createMockResponse();

    await expect(POST(req, res as never)).rejects.toThrow(/Provide at least one setting/);
    expect(runMock).not.toHaveBeenCalled();
  });
});
