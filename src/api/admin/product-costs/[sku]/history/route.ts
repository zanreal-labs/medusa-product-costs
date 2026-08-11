import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { PRODUCT_COSTS_MODULE } from "../../../../../modules/product-costs";
import type ProductCostsModuleService from "../../../../../modules/product-costs/service";

/** Hard ceiling for `limit` - matches the list route (`../../route.ts`). */
const MAX_LIMIT = 500;

type PaginationParamResult = { ok: true; value: number } | { ok: false; error: string };

/**
 * Parses a `limit`/`offset` query param. Returns `{ ok: false }` when the
 * raw value is present but not a non-negative number - never silently
 * falls back to the default, which would mask a client-side bug.
 */
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
 * GET /admin/product-costs/:sku/history?limit=&offset=
 *
 * `limit` is capped at `MAX_LIMIT`; a negative `limit` or `offset` is
 * rejected rather than silently clamped to 0.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const { sku } = req.params;
  const service: ProductCostsModuleService = req.scope.resolve(PRODUCT_COSTS_MODULE);

  const query = req.query as Record<string, string | undefined>;
  const limitResult = parsePaginationParam(query.limit, 50);
  if (!limitResult.ok) {
    res.status(400).json({ message: `limit ${limitResult.error}` });
    return;
  }
  const offsetResult = parsePaginationParam(query.offset, 0);
  if (!offsetResult.ok) {
    res.status(400).json({ message: `offset ${offsetResult.error}` });
    return;
  }

  const limit = Math.min(limitResult.value, MAX_LIMIT);
  const offset = offsetResult.value;

  const { count, history } = await service.getHistory(sku, { limit, offset });

  res.json({ count, history, limit, offset });
}
