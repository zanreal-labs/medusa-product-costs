import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { PRODUCT_COSTS_MODULE } from "../../../../modules/product-costs";
import type ProductCostsModuleService from "../../../../modules/product-costs/service";
import { syncCostPriceVariantLinksWorkflow } from "../../../../workflows/sync-cost-price-variant-links";

interface ImportCsvBody {
  csv?: unknown;
}

/**
 * POST /admin/product-costs/import
 *
 * Body: `{ csv: "sku,cost\n..." }`. Unlike the single-row upsert endpoint,
 * this does not resolve product variant links per row - it persists costs
 * first, then does one batched variant lookup for every SKU touched. For a
 * very large file this second pass is the part worth moving to a
 * background job in a later wave; see the README roadmap.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<ImportCsvBody>,
  res: MedusaResponse,
): Promise<void> {
  const body = req.body ?? {};
  const csv = typeof body.csv === "string" ? body.csv : undefined;

  if (!csv || !csv.trim()) {
    res.status(400).json({ message: "csv (a non-empty string) is required" });
    return;
  }

  const service: ProductCostsModuleService = req.scope.resolve(PRODUCT_COSTS_MODULE);
  const result = await service.importCsv(csv, {
    changedBy: req.auth_context?.actor_id ?? null,
    source: "csv",
  });

  if (result.skus.length > 0) {
    await syncCostPriceVariantLinksWorkflow(req.scope).run({
      input: { skus: result.skus },
    });
  }

  res.json({
    created: result.created,
    errors: result.errors,
    skipped: result.skipped,
    updated: result.updated,
  });
}
