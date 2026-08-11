import { describe, expect, it } from "vitest";
import { parseCostCsv, parseMoney } from "../csv";

describe("parseMoney", () => {
  it("parses plain numbers", () => {
    expect(parseMoney("10")).toBe(10);
    expect(parseMoney("64.35")).toBe(64.35);
  });

  it("parses decimal commas", () => {
    expect(parseMoney("64,35")).toBe(64.35);
  });

  it("parses thousands grouping with a decimal comma", () => {
    expect(parseMoney("1 234,56")).toBe(1234.56);
    expect(parseMoney("1.234,56")).toBe(1234.56);
  });

  it("parses thousands grouping with a decimal point", () => {
    expect(parseMoney("1,234.56")).toBe(1234.56);
  });

  it("strips a currency suffix", () => {
    expect(parseMoney("64,35 zl")).toBe(64.35);
  });

  it("returns undefined for empty, zero, negative, or non-numeric input", () => {
    expect(parseMoney("")).toBeUndefined();
    expect(parseMoney("0")).toBeUndefined();
    expect(parseMoney("-5")).toBeUndefined();
    expect(parseMoney("not a number")).toBeUndefined();
  });
});

describe("parseCostCsv", () => {
  it("parses a simple comma-separated file", () => {
    const { rows, errors } = parseCostCsv("SKU-1,10.50\nSKU-2,20.00");
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { lineNumber: 1, sku: "SKU-1", unitCostNet: 10.5 },
      { lineNumber: 2, sku: "SKU-2", unitCostNet: 20 },
    ]);
  });

  it("skips a header row named sku (case-insensitive) without an error", () => {
    const { rows, errors } = parseCostCsv("sku,price\nSKU-1,10.50\nSKU,99\nSKU-2,20");
    expect(errors).toEqual([]);
    expect(rows.map((r) => r.sku)).toEqual(["SKU-1", "SKU-2"]);
  });

  it("detects a semicolon delimiter from an unambiguous header row", () => {
    // The delimiter is sniffed from the first line only. A bare data row
    // like "SKU-1;10,50" has one semicolon AND one decimal comma, which
    // ties and is genuinely ambiguous on its own (see the dedicated
    // ambiguous-tie test below) - an explicit header line disambiguates it,
    // since "sku;price" ties too but has no second reading to compete with.
    const { rows } = parseCostCsv("sku;price\nSKU-1;10,50\nSKU-2;20,00");
    expect(rows).toEqual([
      { lineNumber: 2, sku: "SKU-1", unitCostNet: 10.5 },
      { lineNumber: 3, sku: "SKU-2", unitCostNet: 20 },
    ]);
  });

  it("resolves a comma/semicolon tie in favor of whichever delimiter yields a clean money field", () => {
    // Exactly one comma and one semicolon - a tie by count. Splitting on
    // comma leaves "A;10.50" as the cost field, which still contains the
    // other delimiter (a dead giveaway the split landed in the wrong
    // place); splitting on semicolon leaves the clean "10.50". Before this
    // was hardened, a tie fell back to comma unconditionally, which would
    // have silently produced sku="SKU" (dropping ",A") with a
    // coincidentally-valid-looking cost of 10.50.
    const { rows, errors } = parseCostCsv("SKU,A;10.50");
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ lineNumber: 1, sku: "SKU,A", unitCostNet: 10.5 }]);
  });

  it("reports an unresolvable comma/semicolon tie instead of silently guessing", () => {
    // Exactly one comma (the decimal point) and one semicolon (the intended
    // field delimiter) - both readings produce an equally plausible-looking
    // cost ("50" via comma-split, "10,50" via semicolon-split), so there is
    // no safe way to pick one. This must be reported, not silently resolved
    // - previously this fell back to comma unconditionally, silently
    // producing sku="SKU-1;10" and cost=50, both wrong.
    const { rows, errors } = parseCostCsv("SKU-1;10,50");
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.lineNumber).toBe(1);
    expect(errors[0]?.reason).toMatch(/cannot determine the delimiter/i);
  });

  it("honors quoted fields containing the delimiter", () => {
    const { rows } = parseCostCsv('"SKU,WITH,COMMAS",10.50');
    expect(rows).toEqual([{ lineNumber: 1, sku: "SKU,WITH,COMMAS", unitCostNet: 10.5 }]);
  });

  it("unescapes doubled quotes inside a quoted field", () => {
    const { rows } = parseCostCsv('"SKU-""QUOTED""",5');
    expect(rows[0]?.sku).toBe('SKU-"QUOTED"');
  });

  it("parses decimal commas within a semicolon-delimited row", () => {
    const { rows } = parseCostCsv("sku;price\nSKU-1;1 234,56");
    expect(rows[0]?.unitCostNet).toBe(1234.56);
  });

  it("ignores blank lines without reporting an error", () => {
    const { rows, errors } = parseCostCsv("SKU-1,10\n\n\nSKU-2,20\n");
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
  });

  it("reports a garbage line (no parseable cost) as an error, keeping its line number", () => {
    const { rows, errors } = parseCostCsv("SKU-1,10\nthis is not a csv row at all\nSKU-2,20");
    expect(rows.map((r) => r.sku)).toEqual(["SKU-1", "SKU-2"]);
    expect(errors).toEqual([
      { lineNumber: 2, raw: "this is not a csv row at all", reason: "Missing or invalid cost" },
    ]);
  });

  it("reports a row with a missing SKU as an error", () => {
    const { errors } = parseCostCsv(",10.50");
    expect(errors).toEqual([{ lineNumber: 1, raw: ",10.50", reason: "Missing SKU" }]);
  });

  it("reports a row with a zero or negative cost as invalid", () => {
    const { errors } = parseCostCsv("SKU-1,0\nSKU-2,-5");
    expect(errors).toHaveLength(2);
    expect(errors.every((e) => e.reason === "Missing or invalid cost")).toBe(true);
  });

  it("returns no rows and no errors for an empty file", () => {
    expect(parseCostCsv("")).toEqual({ errors: [], rows: [] });
    expect(parseCostCsv("\n\n")).toEqual({ errors: [], rows: [] });
  });

  it("handles Windows line endings", () => {
    const { rows } = parseCostCsv("SKU-1,10\r\nSKU-2,20\r\n");
    expect(rows).toHaveLength(2);
  });
});
