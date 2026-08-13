import { describe, expect, it } from "vitest";
import { formatCostStatus, summarizeCostStatus } from "../cost-status";
import type { CostPriceLike } from "../cost-status";

const cost = (overrides: Partial<CostPriceLike> = {}): CostPriceLike => ({
  currency: "PLN",
  sku: "SKU-1",
  unit_cost_net: 10,
  ...overrides,
});

describe("summarizeCostStatus", () => {
  it("returns zero coverage for no cost rows", () => {
    expect(summarizeCostStatus([], 3, 0.23)).toEqual({ costedCount: 0, variantCount: 3 });
  });

  it("averages net cost and grosses it up when every row shares one currency", () => {
    const summary = summarizeCostStatus(
      [cost({ unit_cost_net: 10 }), cost({ unit_cost_net: 20 })],
      2,
      0.23,
    );
    expect(summary).toEqual({
      avgGrossCost: 18.45,
      avgNetCost: 15,
      costedCount: 2,
      currency: "PLN",
      variantCount: 2,
    });
  });

  it("reports coverage only, no averaged amount, when currencies are mixed", () => {
    const summary = summarizeCostStatus(
      [cost({ currency: "PLN", unit_cost_net: 10 }), cost({ currency: "EUR", unit_cost_net: 5 })],
      2,
      0.23,
    );
    expect(summary).toEqual({ costedCount: 2, variantCount: 2 });
  });

  it("reports partial coverage when not every variant is costed", () => {
    const summary = summarizeCostStatus([cost({ unit_cost_net: 12.5 })], 3, 0.23);
    expect(summary).toEqual({
      avgGrossCost: 15.38,
      avgNetCost: 12.5,
      costedCount: 1,
      currency: "PLN",
      variantCount: 3,
    });
  });
});

describe("formatCostStatus", () => {
  it("formats full coverage with the averaged amount", () => {
    expect(
      formatCostStatus({ avgGrossCost: 18.45, avgNetCost: 15, costedCount: 2, currency: "PLN", variantCount: 2 }),
    ).toBe("2/2 costed - 15.00 PLN net");
  });

  it("formats partial coverage the same way", () => {
    expect(
      formatCostStatus({
        avgGrossCost: 15.38,
        avgNetCost: 12.5,
        costedCount: 1,
        currency: "PLN",
        variantCount: 3,
      }),
    ).toBe("1/3 costed - 12.50 PLN net");
  });

  it("falls back to the coverage fraction alone when nothing is costed", () => {
    expect(formatCostStatus({ costedCount: 0, variantCount: 3 })).toBe("0/3 costed");
  });

  it("falls back to the coverage fraction alone when currencies are mixed", () => {
    expect(formatCostStatus({ costedCount: 2, variantCount: 2 })).toBe("2/2 costed");
  });
});
