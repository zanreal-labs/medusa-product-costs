import { describe, expect, it } from "vitest";
import { resolveSrpMargin } from "../srp-margin";

const VAT = 0.23;

describe("resolveSrpMargin", () => {
  it("measures the margin against the SRP with no commission taken", () => {
    // gross cost = 100 * 1.23 = 123; net income at an SRP of 200 = 77.
    // No commission is subtracted: the SRP is this store's own retail price.
    const result = resolveSrpMargin({ netCost: 100, srp: 200, vatRate: VAT });
    expect(result).toEqual({
      marginPct: 77 / 200,
      netIncome: 77,
      srp: 200,
      state: "resolved",
    });
  });

  it("reports a loss rather than clamping it", () => {
    const result = resolveSrpMargin({ netCost: 100, srp: 100, vatRate: VAT });
    expect(result.state).toBe("resolved");
    if (result.state === "resolved") {
      expect(result.netIncome).toBeLessThan(0);
      expect(result.marginPct).toBeLessThan(0);
    }
  });

  it("never substitutes another price when the variant has no SRP", () => {
    // The whole point of the `no-srp` state: a margin labelled "SRP" that was
    // actually measured against a shop price is a number an operator would
    // price against and be wrong.
    expect(resolveSrpMargin({ netCost: 100, srp: undefined, vatRate: VAT })).toEqual({
      state: "no-srp",
    });
  });

  it("treats a zero SRP as no SRP, because a ratio over zero is not a margin", () => {
    expect(resolveSrpMargin({ netCost: 100, srp: 0, vatRate: VAT })).toEqual({ state: "no-srp" });
  });

  it("names a missing purchase cost rather than assuming zero", () => {
    expect(resolveSrpMargin({ netCost: undefined, srp: 200, vatRate: VAT })).toEqual({
      state: "no-cost",
    });
  });

  it("reports the store-wide blocker first when no VAT rate is configured", () => {
    // Ordered most-fundamental-first: with no VAT rate there is nothing to fix
    // on this variant, so saying "no purchase cost" would send the operator to
    // the wrong screen.
    expect(resolveSrpMargin({ netCost: undefined, srp: undefined, vatRate: null })).toEqual({
      state: "no-vat-rate",
    });
    expect(resolveSrpMargin({ netCost: 100, srp: 200, vatRate: null })).toEqual({
      state: "no-vat-rate",
    });
  });

  it("works with a zero VAT rate, which is a rate and not an absent one", () => {
    const result = resolveSrpMargin({ netCost: 100, srp: 200, vatRate: 0 });
    expect(result).toMatchObject({ netIncome: 100, state: "resolved" });
  });
});
