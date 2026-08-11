import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { Modules } from "@medusajs/framework/utils";
import type { LinkDefinition } from "@medusajs/framework/types";
import { PRODUCT_COSTS_MODULE } from "../../modules/product-costs";
import type { VariantLinkChange } from "../../modules/product-costs/service";
import type { LinkChange } from "./build-link-change-step";

function buildLinkDefinition(costPriceId: string, variantId: string): LinkDefinition {
  return {
    [Modules.PRODUCT]: { product_variant_id: variantId },
    [PRODUCT_COSTS_MODULE]: { cost_price_id: costPriceId },
  };
}

/**
 * Same idea as `buildLinkChangeStep`, but for the many rows a CSV import (or
 * a manual re-sync) can touch in one pass.
 */
export const buildBulkLinkChangeStep = createStep(
  "build-bulk-link-change",
  (changes: VariantLinkChange[]) => {
    const toDismiss: LinkDefinition[] = [];
    const toCreate: LinkDefinition[] = [];

    for (const change of changes) {
      if (change.previousVariantId) {
        toDismiss.push(buildLinkDefinition(change.costPriceId, change.previousVariantId));
      }
      if (change.nextVariantId) {
        toCreate.push(buildLinkDefinition(change.costPriceId, change.nextVariantId));
      }
    }

    return new StepResponse<LinkChange>({ toCreate, toDismiss });
  },
);
