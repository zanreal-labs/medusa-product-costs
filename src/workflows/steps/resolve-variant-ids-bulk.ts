import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { Modules } from "@medusajs/framework/utils";
import type { IProductModuleService } from "@medusajs/framework/types";

export interface ResolveVariantIdsBulkInput {
  skus: string[];
}

/**
 * Batch variant lookup by SKU - a single query for however many SKUs are
 * passed in, used after a CSV import instead of resolving one SKU at a time
 * (which would be a query per row for potentially thousands of rows).
 * SKUs with no matching variant are simply absent from the result map.
 */
export const resolveVariantIdsBulkStep = createStep(
  "resolve-variant-ids-bulk",
  async (input: ResolveVariantIdsBulkInput, { container }) => {
    if (input.skus.length === 0) {
      return new StepResponse<Record<string, string>>({});
    }

    const productModuleService: IProductModuleService = container.resolve(Modules.PRODUCT);
    const variants = await productModuleService.listProductVariants(
      { sku: input.skus },
      { select: ["id", "sku"] },
    );

    const bySku: Record<string, string> = {};
    for (const variant of variants) {
      if (variant.sku) {
        bySku[variant.sku] = variant.id;
      }
    }

    return new StepResponse(bySku);
  },
);
