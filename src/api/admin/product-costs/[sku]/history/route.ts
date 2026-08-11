import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { PRODUCT_COSTS_MODULE } from "../../../../../modules/product-costs";
import type ProductCostsModuleService from "../../../../../modules/product-costs/service";

/**
 * GET /admin/product-costs/:sku/history?limit=&offset=
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const { sku } = req.params;
  const service: ProductCostsModuleService = req.scope.resolve(PRODUCT_COSTS_MODULE);

  const query = req.query as Record<string, string | undefined>;
  const limit = query.limit ? Number.parseInt(query.limit, 10) : 50;
  const offset = query.offset ? Number.parseInt(query.offset, 10) : 0;

  const { count, history } = await service.getHistory(sku, {
    limit: Number.isFinite(limit) ? limit : 50,
    offset: Number.isFinite(offset) ? offset : 0,
  });

  res.json({ count, history, limit, offset });
}
