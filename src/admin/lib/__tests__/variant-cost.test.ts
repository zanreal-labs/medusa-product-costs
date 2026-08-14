import { describe, expect, it } from "vitest";
import { formatVariantCost, resolveVariantCost } from "../variant-cost";
import type { CostPriceLike } from "../variant-cost";

const cost = (overrides: Partial<CostPriceLike> = {}): CostPriceLike => ({
  currency: "PLN",
  sku: "SKU-1",
  unit_cost_net: 10,
  ...overrides,
});

describe("resolveVariantCost", () => {
  it("returns the cost row belonging to this variant's SKU", () => {
    const resolved = resolveVariantCost(
      [cost({ sku: "SKU-1", unit_cost_net: 12.5 }), cost({ sku: "SKU-2", unit_cost_net: 99 })],
      "SKU-1",
      0.23,
    );
    expect(resolved).toEqual({ currency: "PLN", grossCost: 15.38, netCost: 12.5 });
  });

  it("grosses the net cost up by the configured VAT rate", () => {
    expect(resolveVariantCost([cost({ unit_cost_net: 100 })], "SKU-1", 0.23)?.grossCost).toBe(123);
    expect(resolveVariantCost([cost({ unit_cost_net: 100 })], "SKU-1", 0)?.grossCost).toBe(100);
  });

  it("keeps the cost row's own currency, not a store default", () => {
    expect(resolveVariantCost([cost({ currency: "EUR" })], "SKU-1", 0.23)?.currency).toBe("EUR");
  });

  it("returns null when the variant has no SKU", () => {
    expect(resolveVariantCost([cost()], null, 0.23)).toBeNull();
    expect(resolveVariantCost([cost()], "", 0.23)).toBeNull();
  });

  it("returns null when the SKU has no curated cost", () => {
    expect(resolveVariantCost([], "SKU-1", 0.23)).toBeNull();
    expect(resolveVariantCost([cost({ sku: "OTHER" })], "SKU-1", 0.23)).toBeNull();
  });

  it("never reports a coverage ratio - a row is one variant with one cost", () => {
    const resolved = resolveVariantCost([cost({ unit_cost_net: 12.5 })], "SKU-1", 0.23);
    expect(resolved).not.toHaveProperty("costedCount");
    expect(resolved).not.toHaveProperty("variantCount");
  });
});

describe("formatVariantCost", () => {
  it("formats the plain net cost with its currency", () => {
    expect(formatVariantCost({ currency: "PLN", grossCost: 15.38, netCost: 12.5 })).toBe(
      "12.50 PLN",
    );
  });

  it("always shows two decimals", () => {
    expect(formatVariantCost({ currency: "EUR", grossCost: 12.3, netCost: 10 })).toBe("10.00 EUR");
  });
});

describe("resolveVariantCost without a configured VAT rate", () => {
  it("still reports the net cost but leaves the gross one unknown", () => {
    // The net cost is a stored fact. The gross one is derived from a VAT rate
    // this plugin ships no default for, so with none configured there is
    // nothing honest to show - `undefined`, never a silently un-grossed number.
    const cost = resolveVariantCost(
      [{ currency: "GBP", sku: "SKU-1", unit_cost_net: 10 }],
      "SKU-1",
      null,
    );
    expect(cost).toEqual({ currency: "GBP", grossCost: undefined, netCost: 10 });
  });
});
