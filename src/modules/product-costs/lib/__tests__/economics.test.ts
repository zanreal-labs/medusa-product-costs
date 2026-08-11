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
});
