import { describe, expect, it, vi } from "vitest";
import { resolveEffectiveCurrency, resolveStoreDefaultCurrency } from "../store-currency";

/**
 * A container fake that answers per registration key, the way the real one
 * does. The helpers under test resolve two different things - the
 * product-costs service and Medusa's Query - so a fake that hands the same
 * object to both cannot tell the lookups apart.
 */
function containerWith(options: {
  service?: unknown;
  query?: unknown;
}): { resolve: <T>(key: string) => T } {
  return {
    resolve: (<T,>(key: string) => (key === "query" ? options.query : options.service) as T),
  };
}

function storeQuery(supported: Array<{ currency_code?: string | null; is_default?: boolean | null }>) {
  return { graph: vi.fn().mockResolvedValue({ data: [{ supported_currencies: supported }] }) };
}

function serviceWith(settingsCurrency: string | null, pluginCurrency: string | null) {
  return {
    getSettings: vi.fn().mockResolvedValue({ default_currency: settingsCurrency }),
    moduleOptions: { defaultCurrency: pluginCurrency, vatRate: null },
  };
}

describe("resolveStoreDefaultCurrency", () => {
  it("returns the currency marked is_default, uppercased", async () => {
    const query = storeQuery([
      { currency_code: "usd", is_default: false },
      { currency_code: "eur", is_default: true },
    ]);

    expect(await resolveStoreDefaultCurrency(containerWith({ query }))).toBe("EUR");
    expect(query.graph).toHaveBeenCalledWith({
      entity: "store",
      fields: ["supported_currencies.currency_code", "supported_currencies.is_default"],
    });
  });

  it("returns null when the store supports currencies but marks none of them default", async () => {
    const query = storeQuery([{ currency_code: "usd", is_default: false }]);

    // Not "pick the first one": a store that never marked a default has not
    // answered the question, and guessing here is the thing this plugin
    // refuses to do.
    expect(await resolveStoreDefaultCurrency(containerWith({ query }))).toBeNull();
  });

  it("returns null when no store exists", async () => {
    const query = { graph: vi.fn().mockResolvedValue({ data: [] }) };

    expect(await resolveStoreDefaultCurrency(containerWith({ query }))).toBeNull();
  });

  it("returns null when Query is not registered in the container", async () => {
    expect(await resolveStoreDefaultCurrency(containerWith({}))).toBeNull();
  });

  it("returns null instead of throwing when the store lookup fails", async () => {
    const query = { graph: vi.fn().mockRejectedValue(new Error("connection reset")) };

    // A fallback that can take down the settings screen is worse than no
    // fallback: this path is a read on a page that must keep rendering.
    expect(await resolveStoreDefaultCurrency(containerWith({ query }))).toBeNull();
  });
});

describe("resolveEffectiveCurrency", () => {
  it("prefers the saved settings override over everything else", async () => {
    const query = storeQuery([{ currency_code: "gbp", is_default: true }]);

    const result = await resolveEffectiveCurrency(
      containerWith({ query, service: serviceWith("EUR", "PLN") }),
    );

    expect(result).toEqual({ currency: "EUR", source: "settings" });
    expect(query.graph).not.toHaveBeenCalled();
  });

  it("falls back to the plugin option before the store", async () => {
    const query = storeQuery([{ currency_code: "gbp", is_default: true }]);

    const result = await resolveEffectiveCurrency(
      containerWith({ query, service: serviceWith(null, "PLN") }),
    );

    expect(result).toEqual({ currency: "PLN", source: "plugin" });
    expect(query.graph).not.toHaveBeenCalled();
  });

  it("falls back to the store's default currency when nothing else names one", async () => {
    const query = storeQuery([{ currency_code: "gbp", is_default: true }]);

    const result = await resolveEffectiveCurrency(
      containerWith({ query, service: serviceWith(null, null) }),
    );

    expect(result).toEqual({ currency: "GBP", source: "store" });
  });

  it("reports no currency and no source when it is configured nowhere", async () => {
    const result = await resolveEffectiveCurrency(
      containerWith({ service: serviceWith(null, null) }),
    );

    expect(result).toEqual({ currency: null, source: null });
  });
});
