import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { dismissRemoteLinkStep } from "@medusajs/medusa/core-flows";
import { buildLinkChangeStep } from "./steps/build-link-change-step";
import { deleteCostPriceBySkuStep } from "./steps/delete-cost-price-by-sku";

export interface DeleteCostPriceWorkflowInput {
  sku: string;
}

/**
 * Deletes the `CostPrice` record for the given SKU and dismisses the
 * `CostPrice ↔ ProductVariant` module link if one was set, keeping the
 * link table clean. Returns `null` when no record was found (not an error).
 *
 * Use this workflow — not `deleteCostPriceBySkuStep` directly — on stores
 * that run with variant linking enabled. For custom entities with
 * `skipVariantLinking: true`, the bare step is enough.
 *
 * Compensation is fully handled: if a later step in a composed workflow fails,
 * both the deleted `CostPrice` and its link are restored to their original state.
 */
export const deleteCostPriceWorkflow = createWorkflow(
  "delete-cost-price",
  (input: DeleteCostPriceWorkflowInput) => {
    const deleted = deleteCostPriceBySkuStep({ sku: input.sku });

    // Build the set of links to dismiss. When deleted is null (no CostPrice
    // found) or the record had no variant_id, both arrays are empty and
    // dismissRemoteLinkStep is a no-op.
    const linkChange = buildLinkChangeStep({
      costPriceId: deleted.id,
      previousVariantId: deleted.variant_id,
      nextVariantId: null,
    });

    dismissRemoteLinkStep(linkChange.toDismiss);

    return new WorkflowResponse(deleted);
  },
);
