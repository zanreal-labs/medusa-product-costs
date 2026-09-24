import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { createRemoteLinkStep, dismissRemoteLinkStep } from "@medusajs/medusa/core-flows";
import { buildLinkChangeStep } from "./steps/build-link-change-step";
import { resolveCostCurrencyStep } from "./steps/resolve-cost-currency";
import { resolveVariantIdBySkuStep } from "./steps/resolve-variant-id";
import { upsertCostPriceStep } from "./steps/upsert-cost-price-step";
import type { CostSource } from "../modules/product-costs/types";

export interface UpsertCostPriceWorkflowInput {
  sku: string;
  unitCostNet: number;
  currency?: string;
  source: CostSource;
  note?: string | null;
  changedBy?: string | null;
}

/**
 * Single-SKU cost upsert used by the admin API and the admin widget: resolve
 * the SKU's current product variant, persist the cost (writing history),
 * then keep the CostPrice <-> ProductVariant module link in sync with
 * whatever the variant resolution found. Real-time and per-request, unlike
 * the CSV import path (see `import-cost-prices-csv.ts`), which defers link
 * resolution to a bulk follow-up step.
 */
export const upsertCostPriceWorkflow = createWorkflow(
  "upsert-cost-price",
  (input: UpsertCostPriceWorkflowInput) => {
    const resolvedVariant = resolveVariantIdBySkuStep({ sku: input.sku });

    // Resolved here rather than left to the module service, because the last
    // fallback - the store's own default currency - lives in another module
    // and the service is deliberately blind to those. An explicit
    // `input.currency` still wins; see `resolveCostCurrency`.
    const resolvedCurrency = resolveCostCurrencyStep({ requested: input.currency });

    const upsertResult = upsertCostPriceStep({
      changedBy: input.changedBy,
      currency: resolvedCurrency.currency,
      note: input.note,
      sku: input.sku,
      source: input.source,
      unitCostNet: input.unitCostNet,
      variantId: resolvedVariant.variantId,
    });

    const linkChange = buildLinkChangeStep({
      costPriceId: upsertResult.costPrice.id,
      nextVariantId: resolvedVariant.variantId,
      previousVariantId: upsertResult.previousVariantId,
    });

    dismissRemoteLinkStep(linkChange.toDismiss);
    createRemoteLinkStep(linkChange.toCreate);

    return new WorkflowResponse({
      costPrice: upsertResult.costPrice,
      // Surfaces the resolve-step's determinism note (see
      // `resolveVariantIdBySkuStep`) all the way to the API response, so an
      // operator can see that a SKU unexpectedly matched more than one
      // variant, instead of that anomaly being silently absorbed.
      duplicateVariantMatches: resolvedVariant.duplicateMatches,
    });
  },
);
