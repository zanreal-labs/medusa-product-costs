import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { removeRemoteLinkStep } from "@medusajs/medusa/core-flows";
import { PRODUCT_COSTS_MODULE } from "../modules/product-costs";
import {
  deleteCostPriceBySkuStep,
  listCostPriceIdsBySkuStep,
} from "./steps/delete-cost-price-by-sku";

export interface DeleteCostPriceWorkflowInput {
  sku: string;
}

/**
 * Deletes every `CostPrice` record for the given SKU (one per currency) and
 * dismisses their `CostPrice ↔ ProductVariant` module links, keeping the link
 * table clean. Returns the deleted records, an empty array when there were
 * none (not an error).
 *
 * Links are removed by the cost price's own id, as Medusa core does for its
 * own entities, so they go whatever the `variant_id` cache column says. The
 * ids are resolved first, the links removed second and the rows deleted last.
 *
 * Use this workflow — not `deleteCostPriceBySkuStep` directly — on stores
 * that run with variant linking enabled. For custom entities with
 * `skipVariantLinking: true`, the bare step is enough.
 *
 * Compensation is fully handled: if a later step in a composed workflow fails,
 * both the deleted `CostPrice` rows and their links are restored.
 */
export const deleteCostPriceWorkflow = createWorkflow(
  "delete-cost-price",
  (input: DeleteCostPriceWorkflowInput) => {
    const ids = listCostPriceIdsBySkuStep({ sku: input.sku });

    // No rows means nothing to dismiss; an empty list makes the step a no-op.
    const linksToRemove = transform({ ids }, ({ ids }) =>
      ids.length ? [{ [PRODUCT_COSTS_MODULE]: { cost_price_id: ids } }] : [],
    );
    removeRemoteLinkStep(linksToRemove);

    const deleted = deleteCostPriceBySkuStep({ sku: input.sku });

    return new WorkflowResponse(deleted);
  },
);
