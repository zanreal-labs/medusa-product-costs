import type {
  AuthenticatedMedusaRequest,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { PRODUCT_COSTS_MODULE } from "../../../modules/product-costs";
import type ProductCostsModuleService from "../../../modules/product-costs/service";
import type { CostSource } from "../../../modules/product-costs/types";
import { upsertCostPriceWorkflow } from "../../../workflows/upsert-cost-price";

/**
 * GET /admin/product-costs?q=&sku=&limit=&offset=
 *
 * Lists curated costs. `q` does a case-insensitive substring search on the
 * SKU; `sku` (repeatable, e.g. `?sku=A&sku=B`) filters to an exact set.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const service: ProductCostsModuleService = req.scope.resolve(PRODUCT_COSTS_MODULE);

  const query = req.query as Record<string, string | string[] | undefined>;
  const limit = query.limit ? Number.parseInt(String(query.limit), 10) : 20;
  const offset = query.offset ? Number.parseInt(String(query.offset), 10) : 0;
  const q = typeof query.q === "string" ? query.q : undefined;
  const sku = query.sku
    ? (Array.isArray(query.sku)
      ? query.sku.map(String)
      : [String(query.sku)])
    : undefined;

  const { costs, count } = await service.listCosts(
    { q, sku },
    { limit: Number.isFinite(limit) ? limit : 20, offset: Number.isFinite(offset) ? offset : 0 },
  );

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

  const source: CostSource =
    body.source === "manual" || body.source === "csv" || body.source === "api"
      ? body.source
      : "manual";

  const { result: costPrice } = await upsertCostPriceWorkflow(req.scope).run({
    input: {
      changedBy: req.auth_context?.actor_id ?? null,
      currency: typeof body.currency === "string" ? body.currency : undefined,
      note: typeof body.note === "string" ? body.note : null,
      sku,
      source,
      unitCostNet,
    },
  });

  res.json({ cost_price: costPrice });
}
