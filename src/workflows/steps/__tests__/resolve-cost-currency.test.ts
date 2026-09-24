import type { StepExecutionContext } from "@medusajs/framework/workflows-sdk";
import { describe, expect, it, vi } from "vitest";
import { resolveCostCurrency } from "../resolve-cost-currency";

/**
 * Tests `resolveCostCurrency`, the step's business logic exported separately
 * from `resolveCostCurrencyStep` so it can run with a mocked container (see
 * the same note on `resolveVariantIdBySku`). The fake answers per
 * registration key, since the resolution walks both the product-costs service
 * and Medusa's Query.
 */
function containerWith(options: {
  settingsCurrency?: string | null;
  pluginCurrency?: string | null;
  storeCurrency?: string;
}): Pick<StepExecutionContext, "container"> {
  const service = {
    getSettings: vi.fn().mockResolvedValue({ default_currency: options.settingsCurrency ?? null }),
    moduleOptions: { defaultCurrency: options.pluginCurrency ?? null, vatRate: null },
  };
  const query = options.storeCurrency
    ? {
        graph: vi.fn().mockResolvedValue({
          data: [{ supported_currencies: [{ currency_code: options.storeCurrency, is_default: true }] }],
        }),
      }
    : undefined;
  return {
    container: { resolve: (key: string) => (key === "query" ? query : service) },
  } as unknown as Pick<StepExecutionContext, "container">;
}

describe("resolveCostCurrency", () => {
  it("uses the requested currency, normalized, whatever is configured", async () => {
    const result = await resolveCostCurrency(
      { requested: " eur " },
      containerWith({ pluginCurrency: "PLN", storeCurrency: "gbp" }),
    );

    expect(result).toEqual({ currency: "EUR" });
  });

  it("falls back through settings, plugin option and the store, in that order", async () => {
    expect(
      await resolveCostCurrency({}, containerWith({ pluginCurrency: "PLN", settingsCurrency: "EUR" })),
    ).toEqual({ currency: "EUR" });

    expect(
      await resolveCostCurrency({}, containerWith({ pluginCurrency: "PLN", storeCurrency: "gbp" })),
    ).toEqual({ currency: "PLN" });

    expect(await resolveCostCurrency({}, containerWith({ storeCurrency: "gbp" }))).toEqual({
      currency: "GBP",
    });
  });

  it("returns undefined rather than throwing when no currency resolves anywhere", async () => {
    // The refusal belongs to the module service, which owns the single
    // CURRENCY_NOT_CONFIGURED_MESSAGE. This step only resolves.
    expect(await resolveCostCurrency({}, containerWith({}))).toEqual({ currency: undefined });
  });

  it("treats a blank requested currency as no currency at all", async () => {
    expect(await resolveCostCurrency({ requested: "   " }, containerWith({ storeCurrency: "gbp" }))).toEqual(
      { currency: "GBP" },
    );
  });
});
