import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { PRODUCT_COSTS_MODULE } from "../../modules/product-costs";
import type ProductCostsModuleService from "../../modules/product-costs/service";
import type { CostSource } from "../../modules/product-costs/types";

export interface UpsertCostPriceStepInput {
  sku: string;
  unitCostNet: number;
  currency?: string;
  source: CostSource;
  note?: string | null;
  changedBy?: string | null;
  variantId: string | null;
}

/**
 * Thin step wrapper around the module service's `upsertCost`. No
 * compensation function - reverting a cost change (and its already-written
 * history row) on a later workflow failure isn't attempted in this wave;
 * see the README roadmap.
 */
export const upsertCostPriceStep = createStep(
  "upsert-cost-price",
  async (input: UpsertCostPriceStepInput, { container }) => {
    const service: ProductCostsModuleService = container.resolve(PRODUCT_COSTS_MODULE);
    const result = await service.upsertCost(input.sku, input.unitCostNet, {
      changedBy: input.changedBy,
      currency: input.currency,
      note: input.note,
      source: input.source,
      variantId: input.variantId,
    });
    return new StepResponse(result);
  },
);
