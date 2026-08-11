/**
 * Tolerant `sku,cost` CSV parser for the bulk cost import. Handles quoted
 * fields, either `,` or `;` as the delimiter, and localized decimal commas
 * ("64,35" as well as "64.35"). Ported from the supply-price CSV importer
 * used in production for the same shape of operator-supplied file.
 */

export interface ParsedCostRow {
  /** 1-based line number in the source text, for error reporting and audits. */
  lineNumber: number;
  sku: string;
  unitCostNet: number;
}

export interface CsvParseError {
  lineNumber: number;
  raw: string;
  reason: string;
}

export interface CsvParseResult {
  rows: ParsedCostRow[];
  errors: CsvParseError[];
}

/**
 * Parse a localized money string to a positive number, or undefined.
 * Handles plain ("10", "64.35"), decimal comma ("64,35"), thousands
 * grouping ("1 234,56", "1.234,56"), and currency suffixes ("64,35 zl").
 */
export function parseMoney(raw: string | undefined): number | undefined {
  if (!raw) {
    return;
  }
  let s = raw.replaceAll(/[^\d.,-]/gu, "");
  if (!s) {
    return;
  }
  if (s.includes(",") && s.includes(".")) {
    // The right-most separator is the decimal point; the other groups thousands.
    s =
      s.lastIndexOf(",") > s.lastIndexOf(".")
        ? s.replaceAll(".", "").replace(",", ".")
        : s.replaceAll(",", "");
  } else if (s.includes(",")) {
    const parts = s.split(",");
    const dec = parts.pop() ?? "";
    s = `${parts.join("")}.${dec}`;
  }
  const value = Number.parseFloat(s);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Pick the delimiter from a line by counting unquoted separators. */
function detectDelimiter(line: string): string {
  let semi = 0;
  let comma = 0;
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && ch === ";") {
      semi += 1;
    } else if (!inQuotes && ch === ",") {
      comma += 1;
    }
  }
  return semi > comma ? ";" : ",";
}

/** Split one CSV line into fields, honoring "quoted" fields with embedded delimiters. */
function splitCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Parse a 2-column `sku,cost` CSV (header optional). Blank lines are
 * ignored silently; every other unparsable line is reported in `errors`
 * with its original line number so an operator can find and fix it in
 * their source file. A row whose SKU is literally "sku" (any case) is
 * treated as a header and skipped without an error.
 */
export function parseCostCsv(text: string): CsvParseResult {
  const rawLines = text.split(/\r?\n/u);
  const rows: ParsedCostRow[] = [];
  const errors: CsvParseError[] = [];

  const firstNonBlank = rawLines.find((line) => line.trim());
  if (firstNonBlank === undefined) {
    return { errors, rows };
  }
  const delimiter = detectDelimiter(firstNonBlank);

  for (let i = 0; i < rawLines.length; i += 1) {
    const raw = rawLines[i];
    const lineNumber = i + 1;
    if (!raw.trim()) {
      continue;
    }

    const fields = splitCsvLine(raw, delimiter);
    const sku = (fields[0] ?? "").trim();

    if (sku.toLowerCase() === "sku") {
      continue;
    }
    if (!sku) {
      errors.push({ lineNumber, raw, reason: "Missing SKU" });
      continue;
    }

    const unitCostNet = parseMoney((fields[1] ?? "").trim());
    if (unitCostNet === undefined) {
      errors.push({ lineNumber, raw, reason: "Missing or invalid cost" });
      continue;
    }

    rows.push({ lineNumber, sku, unitCostNet });
  }

  return { errors, rows };
}
