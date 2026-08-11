import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { Modules } from "@medusajs/framework/utils";
import type { LinkDefinition } from "@medusajs/framework/types";
import { PRODUCT_COSTS_MODULE } from "../../modules/product-costs";

export interface BuildLinkChangeStepInput {
  costPriceId: string;
  previousVariantId: string | null;
  nextVariantId: string | null;
}

export interface LinkChange {
  toDismiss: LinkDefinition[];
  toCreate: LinkDefinition[];
}

function buildLinkDefinition(costPriceId: string, variantId: string): LinkDefinition {
  return {
    [Modules.PRODUCT]: { product_variant_id: variantId },
    [PRODUCT_COSTS_MODULE]: { cost_price_id: costPriceId },
  };
}

/**
 * Pure logic step (no I/O) that decides which module links, if any, need to
 * change after an upsert. Kept separate from `resolveRemoteLinkStep` so
 * `createRemoteLinkStep`/`dismissRemoteLinkStep` can be composed directly in
 * the workflow - both accept an empty array as a no-op, so this step never
 * needs a runtime `when()` branch to skip them.
 */
export const buildLinkChangeStep = createStep(
  "build-link-change",
  (input: BuildLinkChangeStepInput) => {
    const { costPriceId, previousVariantId, nextVariantId } = input;

    if (previousVariantId === nextVariantId) {
      return new StepResponse<LinkChange>({ toCreate: [], toDismiss: [] });
    }

    return new StepResponse<LinkChange>({
      toCreate: nextVariantId ? [buildLinkDefinition(costPriceId, nextVariantId)] : [],
      toDismiss: previousVariantId ? [buildLinkDefinition(costPriceId, previousVariantId)] : [],
    });
  },
);
