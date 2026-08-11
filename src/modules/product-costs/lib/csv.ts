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

/**
 * A field is never a legitimate money value if it still contains a
 * semicolon - no supported locale uses one in a number. Its presence in a
 * would-be cost field is the tell that a delimiter guess split the line in
 * the wrong place (the real delimiter leaked into what should have been a
 * clean value).
 */
function looksLikeMoneyField(field: string | undefined): boolean {
  if (field === undefined) {
    return false;
  }
  const trimmed = field.trim();
  if (trimmed.includes(";")) {
    return false;
  }
  return parseMoney(trimmed) !== undefined;
}

/**
 * Pick the delimiter from a line by counting unquoted separators. A strict
 * majority (more of one than the other) wins outright. On a tie where the
 * line contains both delimiters, the tie is broken by which reading
 * actually produces a plausible `sku,cost` split: exactly 2 fields, with
 * the second looking like a real money value (see `looksLikeMoneyField`).
 * If neither reading is unambiguously better - or the tie is on a line with
 * no delimiter at all - falls back to comma, matching the historical/ported
 * behavior. If *both* readings look equally plausible, there is no safe way
 * to guess, so `undefined` is returned and the caller reports the line
 * instead of picking one silently.
 */
function detectDelimiter(line: string): "," | ";" | undefined {
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
  if (semi > comma) {
    return ";";
  }
  if (comma > semi) {
    return ",";
  }
  if (semi === 0) {
    // No delimiter present at all - nothing to disambiguate.
    return ",";
  }

  const commaLooksRight = (() => {
    const fields = splitCsvLine(line, ",");
    return fields.length === 2 && looksLikeMoneyField(fields[1]);
  })();
  const semiLooksRight = (() => {
    const fields = splitCsvLine(line, ";");
    return fields.length === 2 && looksLikeMoneyField(fields[1]);
  })();

  if (commaLooksRight && !semiLooksRight) {
    return ",";
  }
  if (semiLooksRight && !commaLooksRight) {
    return ";";
  }
  return undefined;
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
  if (delimiter === undefined) {
    // Genuinely ambiguous: the sniffed line has both a comma and a
    // semicolon, and both readings look like a plausible `sku,cost` split -
    // there is no safe delimiter to apply to the rest of the file, so this
    // is reported instead of guessed. Adding an explicit header row (whose
    // delimiter is unambiguous on its own) resolves this for the whole file.
    errors.push({
      lineNumber: rawLines.indexOf(firstNonBlank) + 1,
      raw: firstNonBlank,
      reason:
        "Cannot determine the delimiter - the line contains both ',' and ';' and both readings " +
        'look like a valid sku,cost row. Add a header row (e.g. "sku;cost") to disambiguate.',
    });
    return { errors, rows };
  }

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
