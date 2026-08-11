import type {
  AuthenticatedMedusaRequest,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { PRODUCT_COSTS_MODULE } from "../../../modules/product-costs";
import type ProductCostsModuleService from "../../../modules/product-costs/service";
import type { CostSource } from "../../../modules/product-costs/types";
import { upsertCostPriceWorkflow } from "../../../workflows/upsert-cost-price";

/** Hard ceiling for `limit` on any paginated list in this plugin. */
const MAX_LIMIT = 500;
/** Hard ceiling for `unit_cost_net` - a sane guard against a fat-fingered or malformed value. */
const MAX_UNIT_COST_NET = 1_000_000;
/** ISO-4217 currency codes are always 3 letters; normalize case before checking. */
const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

/**
 * Parses a `limit`/`offset` query param. Returns `{ error }` when the raw
 * value is present but not a non-negative number - never silently falls
 * back to the default, which would mask a client-side bug (e.g. `limit=-1`
 * or `limit=abc`).
 */
type PaginationParamResult = { ok: true; value: number } | { ok: false; error: string };

function parsePaginationParam(raw: string | undefined, fallback: number): PaginationParamResult {
  if (raw === undefined) {
    return { ok: true, value: fallback };
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { error: "must be a non-negative number", ok: false };
  }
  return { ok: true, value: parsed };
}

/**
 * GET /admin/product-costs?q=&sku=&limit=&offset=
 *
 * Lists curated costs. `q` does a case-insensitive substring search on the
 * SKU; `sku` (repeatable, e.g. `?sku=A&sku=B`) filters to an exact set.
 * `limit` is capped at `MAX_LIMIT`; a negative `limit` or `offset` is
 * rejected rather than silently clamped to 0.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const service: ProductCostsModuleService = req.scope.resolve(PRODUCT_COSTS_MODULE);

  const query = req.query as Record<string, string | string[] | undefined>;
  const limitResult = parsePaginationParam(query.limit ? String(query.limit) : undefined, 20);
  if (!limitResult.ok) {
    res.status(400).json({ message: `limit ${limitResult.error}` });
    return;
  }
  const offsetResult = parsePaginationParam(query.offset ? String(query.offset) : undefined, 0);
  if (!offsetResult.ok) {
    res.status(400).json({ message: `offset ${offsetResult.error}` });
    return;
  }

  const limit = Math.min(limitResult.value, MAX_LIMIT);
  const offset = offsetResult.value;
  const q = typeof query.q === "string" ? query.q : undefined;
  const sku = query.sku
    ? (Array.isArray(query.sku)
      ? query.sku.map(String)
      : [String(query.sku)])
    : undefined;

  const { costs, count } = await service.listCosts({ q, sku }, { limit, offset });

  res.json({ cost_prices: costs, count, limit, offset });
}

interface UpsertCostBody {
  sku?: unknown;
  unit_cost_net?: unknown;
  currency?: unknown;
  note?: unknown;
  source?: unknown;
}

/**
 * POST /admin/product-costs
 *
 * Body: `{ sku, unit_cost_net, currency?, note? }`. `source` defaults to
 * "manual" (the operator UI is the only caller that omits it; the CSV
 * importer and any future API-key integration set it explicitly).
 */
export async function POST(
  req: AuthenticatedMedusaRequest<UpsertCostBody>,
  res: MedusaResponse,
): Promise<void> {
  const body = req.body ?? {};

  const sku = typeof body.sku === "string" ? body.sku.trim() : "";
  const unitCostNet = typeof body.unit_cost_net === "number" ? body.unit_cost_net : Number.NaN;

  if (!sku) {
    res.status(400).json({ message: "sku is required" });
    return;
  }
  if (!Number.isFinite(unitCostNet) || unitCostNet <= 0) {
    res.status(400).json({ message: "unit_cost_net must be a positive number" });
    return;
  }
  if (unitCostNet > MAX_UNIT_COST_NET) {
    res.status(400).json({ message: `unit_cost_net must not exceed ${MAX_UNIT_COST_NET}` });
    return;
  }

  let currency: string | undefined;
  if (typeof body.currency === "string" && body.currency.trim()) {
    currency = body.currency.trim().toUpperCase();
    if (!CURRENCY_CODE_RE.test(currency)) {
      res.status(400).json({ message: 'currency must be a 3-letter ISO-4217 code, e.g. "PLN"' });
      return;
    }
  }

  const source: CostSource =
    body.source === "manual" || body.source === "csv" || body.source === "api"
      ? body.source
      : "manual";

  const { result } = await upsertCostPriceWorkflow(req.scope).run({
    input: {
      changedBy: req.auth_context?.actor_id ?? null,
      currency,
      note: typeof body.note === "string" ? body.note : null,
      sku,
      source,
      unitCostNet,
    },
  });

  res.json({
    cost_price: result.costPrice,
    // > 0 means this SKU currently matches more than one product variant -
    // the lowest variant id won deterministically, but the duplicate is
    // worth an operator's attention (see resolveVariantIdBySkuStep).
    duplicate_variant_matches: result.duplicateVariantMatches,
  });
}
