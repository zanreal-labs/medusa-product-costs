import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { PRODUCT_COSTS_MODULE } from "../../../../modules/product-costs";
import type ProductCostsModuleService from "../../../../modules/product-costs/service";
import { syncCostPriceVariantLinksWorkflow } from "../../../../workflows/sync-cost-price-variant-links";

/** Page size for walking every `CostPrice` row - kept well under any DB row limit. */
const PAGE_SIZE = 500;

/**
 * POST /admin/product-costs/resync-links
 *
 * Repairs the `CostPrice.variant_id` cache (and the module link) for
 * *every* curated cost, not just the SKUs touched by a recent save or
 * import. Run this after deleting and recreating variants, after a bulk
 * operation outside this plugin that could have moved a SKU to a
 * different variant, or any time the "Variant linked" column on the
 * "Product costs" page looks wrong.
 *
 * This does not repair a SKU rename by itself - `CostPrice.sku` is the
 * durable key this plugin matches against, so renaming a variant's SKU in
 * the Product module still needs a follow-up save, import, or resync (this
 * endpoint) to re-point `CostPrice` at the variant under its new SKU. See
 * the README's "How the variant link stays in sync" section.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const service: ProductCostsModuleService = req.scope.resolve(PRODUCT_COSTS_MODULE);

  const skus: string[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (offset < total) {
    const { costs, count } = await service.listCosts({}, { limit: PAGE_SIZE, offset });
    skus.push(...costs.map((cost) => cost.sku));
    total = count;
    offset += PAGE_SIZE;
  }

  if (skus.length === 0) {
    res.json({ changed: 0, duplicateSkus: {}, skusChecked: 0 });
    return;
  }

  const { result } = await syncCostPriceVariantLinksWorkflow(req.scope).run({
    input: { skus },
  });

  res.json({
    changed: result.changes.length,
    duplicateSkus: result.duplicateSkus,
    skusChecked: skus.length,
  });
}
