import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { PRODUCT_COSTS_MODULE } from "../../modules/product-costs";
import type ProductCostsModuleService from "../../modules/product-costs/service";
import type { VariantLinkChange } from "../../modules/product-costs/service";

export interface ApplyVariantLinksStepInput {
  /** sku -> resolved variant id (absent SKUs are treated as unresolved/null). */
  variantIdBySku: Record<string, string>;
  /** The full set of SKUs that were looked up, including unmatched ones. */
  skus: string[];
}

/**
 * Writes the resolved `variant_id` cache on `CostPrice` for a batch of SKUs
 * and reports what changed, so the workflow can reconcile module links
 * afterward. A SKU present in `skus` but absent from `variantIdBySku` is an
 * explicit "no variant found" - its cached variant_id is cleared to null
 * rather than left stale.
 */
export const applyVariantLinksStep = createStep(
  "apply-variant-links",
  async (input: ApplyVariantLinksStepInput, { container }) => {
    const service: ProductCostsModuleService = container.resolve(PRODUCT_COSTS_MODULE);

    const bySku: Record<string, string | null> = {};
    for (const sku of input.skus) {
      bySku[sku] = input.variantIdBySku[sku] ?? null;
    }

    const changes = await service.setVariantLinks(bySku);
    return new StepResponse<VariantLinkChange[]>(changes);
  },
);
