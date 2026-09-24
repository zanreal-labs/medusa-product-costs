import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import type { ReturnWorkflow } from "@medusajs/framework/workflows-sdk";
import type { VariantLinkChange } from "../modules/product-costs/service";
import { createRemoteLinkStep, dismissRemoteLinkStep } from "@medusajs/medusa/core-flows";
import { applyVariantLinksStep } from "./steps/apply-variant-links-step";
import { buildBulkLinkChangeStep } from "./steps/build-bulk-link-change-step";
import { resolveVariantIdsBulkStep } from "./steps/resolve-variant-ids-bulk";

export interface SyncCostPriceVariantLinksWorkflowInput {
  skus: string[];
}

export interface SyncCostPriceVariantLinksWorkflowOutput {
  changes: VariantLinkChange[];
  duplicateSkus: Record<string, number>;
}

/**
 * Batch variant-link reconciliation for a set of SKUs: one query against
 * the Product module for however many SKUs are given, then a single write
 * pass over the affected `CostPrice` rows and their module links. Run this
 * after a CSV import (which does not resolve links per-row - see
 * `import-cost-prices-csv.ts`) or at any time to repair links after
 * variants were deleted and recreated.
 */
// Annotated rather than inferred. The inferred type reaches into
// @medusajs/orchestration, and when this plugin is built inside a pnpm
// workspace (the Medusa app vendors it as a submodule) the declaration emit
// cannot name that module portably and fails with TS2742. Stating the public
// shape here also documents it for the two callers.
export const syncCostPriceVariantLinksWorkflow: ReturnWorkflow<
  SyncCostPriceVariantLinksWorkflowInput,
  SyncCostPriceVariantLinksWorkflowOutput,
  []
> = createWorkflow(
  "sync-cost-price-variant-links",
  (input: SyncCostPriceVariantLinksWorkflowInput) => {
    const resolved = resolveVariantIdsBulkStep({ skus: input.skus });

    const changes = applyVariantLinksStep({
      skus: input.skus,
      variantIdBySku: resolved.bySku,
    });

    const linkChange = buildBulkLinkChangeStep(changes);

    dismissRemoteLinkStep(linkChange.toDismiss);
    createRemoteLinkStep(linkChange.toCreate);

    return new WorkflowResponse({
      changes,
      // Surfaces the resolve-step's determinism note (see
      // `resolveVariantIdsBulkStep`) to every caller of this workflow - the
      // CSV import route and the admin "Resync links" action - so a SKU
      // that unexpectedly matched more than one variant is visible instead
      // of silently absorbed.
      duplicateSkus: resolved.duplicates,
    });
  },
);
