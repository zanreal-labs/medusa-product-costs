import { describe, expect, it } from "vitest";
import { grossFromNet, round2 } from "../money";

describe("round2", () => {
  it("rounds to 2 decimal places", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(10)).toBe(10);
    expect(round2(10.1)).toBe(10.1);
  });

  it("rounds half-up rather than tie-to-even", () => {
    // Plain floating point math would give 1.0049999999999999 for 1.005,
    // which naive rounding sends to 1.00. The Number.EPSILON bias fixes it.
    expect(round2(1.005)).toBe(1.01);
    expect(round2(0.615)).toBe(0.62);
    expect(round2(2.675)).toBe(2.68);
  });

  it("handles negative values", () => {
    expect(round2(-1.005)).toBe(-1);
    expect(round2(-10.456)).toBe(-10.46);
  });

  it("handles zero", () => {
    expect(round2(0)).toBe(0);
  });
});

describe("grossFromNet", () => {
  it("grosses up a net amount at the given VAT rate", () => {
    expect(grossFromNet(100, 0.23)).toBe(123);
    expect(grossFromNet(10, 0.23)).toBe(12.3);
  });

  it("rounds the result to 2 decimal places", () => {
    expect(grossFromNet(33.33, 0.23)).toBe(41); // 40.9959 -> 41.00
  });

  it("returns the net amount unchanged at a zero VAT rate", () => {
    expect(grossFromNet(50, 0)).toBe(50);
  });

  it("diverges from a naive `(net * (1 + rate)).toFixed(2)` at an exact half-cent - this is why the admin widget's gross-cost preview must call grossFromNet directly, not reimplement the formula", () => {
    const net = 0.5;
    const rate = 0.23;
    const naive = (net * (1 + rate)).toFixed(2);
    expect(naive).toBe("0.61");
    expect(grossFromNet(net, rate).toFixed(2)).toBe("0.62");
  });
});
