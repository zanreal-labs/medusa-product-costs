import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { Modules } from "@medusajs/framework/utils";
import type { IProductModuleService } from "@medusajs/framework/types";

export interface ResolveVariantIdBySkuInput {
  sku: string;
}

/**
 * Looks up the Medusa product variant currently carrying a SKU. Read-only,
 * so there is nothing to compensate. Returns `null` (not an error) when no
 * variant matches - an unmatched SKU is a normal state for this plugin,
 * since a cost can be curated before the product it belongs to exists.
 */
export const resolveVariantIdBySkuStep = createStep(
  "resolve-variant-id-by-sku",
  async (input: ResolveVariantIdBySkuInput, { container }) => {
    const productModuleService: IProductModuleService = container.resolve(Modules.PRODUCT);
    const [variant] = await productModuleService.listProductVariants(
      { sku: input.sku },
      { select: ["id"], take: 1 },
    );
    return new StepResponse(variant?.id ?? null);
  },
);
