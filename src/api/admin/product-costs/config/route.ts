import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { PRODUCT_COSTS_MODULE } from "../../../../modules/product-costs";
import type ProductCostsModuleService from "../../../../modules/product-costs/service";

/**
 * GET /admin/product-costs/config
 *
 * Exposes the plugin's resolved options (the configured VAT rate and
 * default currency) so the admin UI can compute a gross-cost preview
 * without hardcoding a value that might not match how the plugin was
 * configured for this store.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const service: ProductCostsModuleService = req.scope.resolve(PRODUCT_COSTS_MODULE);
  res.json(service.moduleOptions);
}
