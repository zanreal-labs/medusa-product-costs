import { describe, expect, it } from "vitest";
import { computeEconomics } from "../economics";

const VAT = 0.23;

describe("computeEconomics", () => {
  it("computes grossCost, netIncome, breakEvenPrice, and marginPct for a full input", () => {
    const result = computeEconomics({
      commissionRate: 0.1,
      netCost: 100,
      sellingPrice: 200,
      vatRate: VAT,
    });

    // grossCost = 100 * 1.23 = 123
    expect(result.grossCost).toBe(123);
    // netIncome = 200 - 200*0.1 - 123 = 200 - 20 - 123 = 57
    expect(result.netIncome).toBe(57);
    // breakEvenPrice = 123 / (1 - 0.1) = 136.666... -> 136.67
    expect(result.breakEvenPrice).toBe(136.67);
    // marginPct = 57 / 200 = 0.285
    expect(result.marginPct).toBe(0.285);
  });

  it("defaults commissionRate to 0 when omitted", () => {
    const withCommission = computeEconomics({ netCost: 100, sellingPrice: 200, vatRate: VAT });
    const explicitZero = computeEconomics({
      commissionRate: 0,
      netCost: 100,
      sellingPrice: 200,
      vatRate: VAT,
    });
    expect(withCommission).toEqual(explicitZero);
  });

  it("leaves everything except grossCost undefined when sellingPrice is missing", () => {
    const result = computeEconomics({ netCost: 100, vatRate: VAT });
    expect(result.grossCost).toBe(123);
    expect(result.netIncome).toBeUndefined();
    expect(result.marginPct).toBeUndefined();
    // breakEvenPrice only depends on grossCost + commissionRate, not sellingPrice.
    expect(result.breakEvenPrice).toBe(123);
  });

  it("leaves every dependent figure undefined when netCost is missing - never coerced to 0", () => {
    const result = computeEconomics({ sellingPrice: 200, vatRate: VAT });
    expect(result.grossCost).toBeUndefined();
    expect(result.netIncome).toBeUndefined();
    expect(result.breakEvenPrice).toBeUndefined();
    expect(result.marginPct).toBeUndefined();
  });

  it("treats null the same as undefined for netCost and sellingPrice", () => {
    const result = computeEconomics({ netCost: null, sellingPrice: null, vatRate: VAT });
    expect(result.grossCost).toBeUndefined();
    expect(result.netIncome).toBeUndefined();
    expect(result.breakEvenPrice).toBeUndefined();
    expect(result.marginPct).toBeUndefined();
  });

  it("leaves breakEvenPrice undefined when commissionRate is exactly 1 (division by zero)", () => {
    const result = computeEconomics({
      commissionRate: 1,
      netCost: 100,
      sellingPrice: 200,
      vatRate: VAT,
    });
    expect(result.grossCost).toBe(123);
    expect(result.breakEvenPrice).toBeUndefined();
    // netIncome is still a real (very negative) number - only breakEven is undefined.
    expect(result.netIncome).toBe(-123);
  });

  it("leaves breakEvenPrice undefined when commissionRate exceeds 1", () => {
    const result = computeEconomics({
      commissionRate: 1.5,
      netCost: 100,
      sellingPrice: 200,
      vatRate: VAT,
    });
    expect(result.breakEvenPrice).toBeUndefined();
  });

  it("leaves marginPct undefined when sellingPrice is exactly 0", () => {
    const result = computeEconomics({ netCost: 100, sellingPrice: 0, vatRate: VAT });
    // netIncome is still computable (0 - 0 - grossCost).
    expect(result.netIncome).toBe(-123);
    expect(result.marginPct).toBeUndefined();
  });

  it("rounds grossCost, netIncome, and breakEvenPrice half-up to 2 decimal places", () => {
    const result = computeEconomics({
      commissionRate: 0.099,
      netCost: 33.333,
      sellingPrice: 99.995,
      vatRate: VAT,
    });
    expect(Number.isInteger(result.grossCost! * 100)).toBe(true);
    expect(Number.isInteger(result.netIncome! * 100)).toBe(true);
    expect(Number.isInteger(result.breakEvenPrice! * 100)).toBe(true);
  });

  it("supports a zero VAT rate", () => {
    const result = computeEconomics({ netCost: 100, sellingPrice: 150, vatRate: 0 });
    expect(result.grossCost).toBe(100);
    expect(result.netIncome).toBe(50);
  });

  describe("does not double-round", () => {
    // Rounding grossCost to 2 places and then feeding that ROUNDED value into
    // netIncome/breakEvenPrice compounds rounding error. The correct formula
    // (matching the production reference this was ported from) computes the
    // gross-up unrounded, feeds it unrounded into every downstream formula,
    // and rounds each output once, independently, at the end.

    it("computes the exact correct breakEvenPrice for the triple that exposed the bug (netCost=33.62, vatRate=0.23, commissionRate=0.1)", () => {
      // Unrounded gross is 33.62 * 1.23 = 41.3526. Rounding that to 41.35
      // *before* dividing by (1 - 0.1) gives 45.94 - a cent below the true
      // break-even, which is the unsafe direction for a price floor.
      // Dividing the unrounded 41.3526 by 0.9 and rounding once gives the
      // correct 45.95.
      const result = computeEconomics({ commissionRate: 0.1, netCost: 33.62, vatRate: VAT });
      expect(result.grossCost).toBe(41.35);
      expect(result.breakEvenPrice).toBe(45.95);
    });

    it("computes the exact correct netIncome and breakEvenPrice for a second straddling case (netCost=7.50, commissionRate=0.05, sellingPrice=20)", () => {
      // Unrounded gross is 7.50 * 1.23 = 9.225 (rounds to 9.23 on its own).
      // Double-rounding (feeding 9.23 forward) gives netIncome=9.77 and
      // breakEvenPrice=9.72; feeding the unrounded 9.225 forward gives the
      // correct netIncome=9.78 and breakEvenPrice=9.71.
      const result = computeEconomics({
        commissionRate: 0.05,
        netCost: 7.5,
        sellingPrice: 20,
        vatRate: VAT,
      });
      expect(result.grossCost).toBe(9.23);
      expect(result.netIncome).toBe(9.78);
      expect(result.breakEvenPrice).toBe(9.71);
    });

    it("computes the exact correct netIncome and breakEvenPrice for a third straddling case (netCost=100.50, commissionRate=0.5, sellingPrice=300)", () => {
      // Unrounded gross is 100.50 * 1.23 = 123.615. Double-rounding gives
      // netIncome=26.38 and breakEvenPrice=247.24; the correct single-round
      // result is netIncome=26.39 and breakEvenPrice=247.23.
      const result = computeEconomics({
        commissionRate: 0.5,
        netCost: 100.5,
        sellingPrice: 300,
        vatRate: VAT,
      });
      expect(result.grossCost).toBe(123.62);
      expect(result.netIncome).toBe(26.39);
      expect(result.breakEvenPrice).toBe(247.23);
    });
  });

  it("pins current semantics for a negative sellingPrice: netIncome is still a real number, and marginPct comes out positive because a negative netIncome divided by a negative sellingPrice flips sign", () => {
    // A negative sellingPrice is not a real business input - nothing sells
    // for negative money - but the formula does not special-case it; it is
    // well-defined arithmetic, not "missing" in the null-propagation sense.
    // netIncome comes out very negative as expected. marginPct, being a
    // negative divided by a negative, comes out POSITIVE - which reads as a
    // healthy margin despite the underlying figures being nonsense. This is
    // pinned as documented current behavior, not a recommendation to build
    // on: callers should reject a negative sellingPrice before it reaches
    // this function.
    const result = computeEconomics({
      commissionRate: 0.1,
      netCost: 50,
      sellingPrice: -100,
      vatRate: VAT,
    });
    expect(result.grossCost).toBe(61.5);
    expect(result.netIncome).toBe(-151.5);
    expect(result.marginPct).toBeCloseTo(1.515);
  });
});
