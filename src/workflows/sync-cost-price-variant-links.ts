import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { createRemoteLinkStep, dismissRemoteLinkStep } from "@medusajs/medusa/core-flows";
import { applyVariantLinksStep } from "./steps/apply-variant-links-step";
import { buildBulkLinkChangeStep } from "./steps/build-bulk-link-change-step";
import { resolveVariantIdsBulkStep } from "./steps/resolve-variant-ids-bulk";

export interface SyncCostPriceVariantLinksWorkflowInput {
  skus: string[];
}

/**
 * Batch variant-link reconciliation for a set of SKUs: one query against
 * the Product module for however many SKUs are given, then a single write
 * pass over the affected `CostPrice` rows and their module links. Run this
 * after a CSV import (which does not resolve links per-row - see
 * `import-cost-prices-csv.ts`) or at any time to repair links after
 * variants were deleted and recreated.
 */
export const syncCostPriceVariantLinksWorkflow = createWorkflow(
  "sync-cost-price-variant-links",
  (input: SyncCostPriceVariantLinksWorkflowInput) => {
    const variantIdBySku = resolveVariantIdsBulkStep({ skus: input.skus });

    const changes = applyVariantLinksStep({
      skus: input.skus,
      variantIdBySku,
    });

    const linkChange = buildBulkLinkChangeStep(changes);

    dismissRemoteLinkStep(linkChange.toDismiss);
    createRemoteLinkStep(linkChange.toCreate);

    return new WorkflowResponse(changes);
  },
);
