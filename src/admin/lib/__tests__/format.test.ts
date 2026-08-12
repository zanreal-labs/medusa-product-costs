import { describe, expect, it } from "vitest";
import { formatAmount, formatPercent, parseInputCost, resolveVariantPrice } from "../format";

describe("parseInputCost", () => {
  it("parses a plain decimal", () => {
    expect(parseInputCost("12.50")).toBe(12.5);
  });

  it("tolerates a decimal comma", () => {
    expect(parseInputCost("12,50")).toBe(12.5);
  });

  it("rejects blank, zero and negative values", () => {
    expect(parseInputCost("")).toBeUndefined();
    expect(parseInputCost("0")).toBeUndefined();
    expect(parseInputCost("-3")).toBeUndefined();
    expect(parseInputCost("abc")).toBeUndefined();
  });
});

describe("resolveVariantPrice", () => {
  it("returns undefined when there are no prices", () => {
    expect(resolveVariantPrice(null, "PLN")).toBeUndefined();
    expect(resolveVariantPrice([], "PLN")).toBeUndefined();
  });

  it("matches the currency case-insensitively", () => {
    expect(resolveVariantPrice([{ amount: 29.99, currency_code: "pln" }], "PLN")).toBe(29.99);
  });

  it("prefers the base price over a tiered one", () => {
    const price = resolveVariantPrice(
      [
        { amount: 20, currency_code: "pln", min_quantity: 10 },
        { amount: 29.99, currency_code: "pln", min_quantity: null },
      ],
      "PLN",
    );
    expect(price).toBe(29.99);
  });

  it("ignores prices in other currencies", () => {
    expect(resolveVariantPrice([{ amount: 10, currency_code: "eur" }], "PLN")).toBeUndefined();
  });

  it("returns undefined when the matched amount is not a finite number", () => {
    expect(resolveVariantPrice([{ amount: null, currency_code: "pln" }], "PLN")).toBeUndefined();
  });
});

describe("formatPercent", () => {
  it("formats a ratio as a one-decimal percentage", () => {
    expect(formatPercent(0.421)).toBe("42.1%");
  });

  it("returns a dash for undefined or non-finite input", () => {
    expect(formatPercent()).toBe("-");
    expect(formatPercent(Number.NaN)).toBe("-");
  });
});

describe("formatAmount", () => {
  it("formats to two decimal places", () => {
    expect(formatAmount(12.3)).toBe("12.30");
  });

  it("returns a dash for undefined", () => {
    expect(formatAmount()).toBe("-");
  });
});
