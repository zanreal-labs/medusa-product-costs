import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { dismissRemoteLinkStep } from "@medusajs/medusa/core-flows";
import {
  deleteCostPricesByIdsStep,
  listCostPriceIdsBySkuStep,
  listCostPriceVariantLinksStep,
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
 * Links are found by the cost price's own id, so they go whatever the
 * `variant_id` cache column says, and are dismissed rather than deleted
 * (deleting would cascade to the product variants). The ids are resolved
 * first, the links dismissed second and those same rows deleted last.
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

    // Dismiss, never delete: the link cascades to the variant side, so
    // `link.delete` would soft-delete the product variants. An empty list
    // makes the step a no-op.
    const links = listCostPriceVariantLinksStep({ ids });
    dismissRemoteLinkStep(links);

    // Delete the very rows whose links were dismissed, not a fresh SKU lookup.
    const deleted = deleteCostPricesByIdsStep({ ids });

    return new WorkflowResponse(deleted);
  },
);
