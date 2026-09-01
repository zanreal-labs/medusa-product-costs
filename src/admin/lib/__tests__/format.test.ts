import { describe, expect, it } from "vitest";
import {
  formatAmount,
  formatMarginLabel,
  formatMoney,
  formatPercent,
  parseInputCost,
  resolveVariantPrice,
} from "../format";

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

/**
 * `Intl` separates an amount from its currency with a non-breaking space
 * (U+00A0), which is the right character in a table cell - it stops a cell
 * wrapping between "42,10" and "zl" - but makes an assertion written with a
 * plain space silently fail on a diff nobody can see. Normalising here keeps
 * the expectations readable while still asserting the real output.
 */
const plain = (value: string): string => value.replace(/[\u00a0\u202f]/g, " ");

describe("formatMarginLabel", () => {
  it("renders KWOTA (PROCENT) and nothing else", () => {
    // The shape the owner asked for verbatim. Notably absent: the anchor price
    // the card used to append as "at 199.00".
    expect(plain(formatMarginLabel(42.1, 0.271, "PLN", "pl-PL"))).toBe("42,10 zł (27%)");
  });

  it("localises the money and the percentage together", () => {
    expect(plain(formatMarginLabel(42.1, 0.271, "PLN", "en-GB"))).toBe("PLN 42.10 (27%)");
  });

  it("keeps the sign on a loss", () => {
    expect(plain(formatMarginLabel(-8, -0.04, "PLN", "en-GB"))).toBe("-PLN 8.00 (-4%)");
  });

  it("falls back to a plain amount for a currency Intl will not take", () => {
    // An unconfigured plugin legitimately has no currency, and a hand-typed one
    // can be anything.
    expect(plain(formatMarginLabel(42.1, 0.271, "", "en-GB"))).toBe("42.10 (27%)");
    expect(plain(formatMarginLabel(42.1, 0.271, "ZZZZ", "en-GB"))).toBe("42.10 ZZZZ (27%)");
  });

  it("never renders half a label", () => {
    expect(formatMarginLabel(undefined, 0.271, "PLN", "en-GB")).toBe("-");
    expect(formatMarginLabel(42.1, undefined, "PLN", "en-GB")).toBe("-");
    expect(formatMarginLabel(Number.NaN, 0.271, "PLN", "en-GB")).toBe("-");
  });
});

describe("formatMoney", () => {
  it("uses the admin's locale", () => {
    expect(plain(formatMoney(1234.5, "PLN", "pl-PL"))).toBe("1234,50 zł");
    expect(plain(formatMoney(1234.5, "EUR", "en-GB"))).toBe("€1,234.50");
  });

  it("renders an unknown currency as a plain suffixed amount", () => {
    expect(plain(formatMoney(12.3, "zz", "en-GB"))).toBe("12.30 ZZ");
    expect(plain(formatMoney(12.3, "  ", "en-GB"))).toBe("12.30");
  });
});
