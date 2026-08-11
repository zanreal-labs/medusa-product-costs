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
 * Thin step wrapper around the module service's `upsertCost`, which writes
 * the `CostPrice` and its `CostPriceHistory` row atomically (same DB
 * transaction - see the service). This step itself has no compensation
 * function, though: if a *later* step in this workflow fails (e.g. the
 * module-link write), that already-committed cost/history pair is not
 * rolled back - reverting it on a downstream workflow failure isn't
 * attempted in this wave; see the README roadmap.
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
