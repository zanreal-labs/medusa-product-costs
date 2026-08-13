import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { updateProductCostsSettingsStep } from "./steps/update-product-costs-settings-step";
import type { ProductCostsSettingsPatch } from "../modules/product-costs/types";

/**
 * Persists an operator-saved override of the VAT rate and/or default
 * currency from Settings > Product costs. A one-step workflow - the write
 * itself is the whole operation - kept as a workflow rather than a direct
 * service call from the API route, matching this plugin's own convention
 * (see `upsertCostPriceWorkflow`) of routing every admin-reachable mutation
 * through one, so it stays consistent and auditable the same way.
 */
export const updateProductCostsSettingsWorkflow = createWorkflow(
  "update-product-costs-settings",
  (input: ProductCostsSettingsPatch) => {
    const settings = updateProductCostsSettingsStep(input);
    return new WorkflowResponse(settings);
  },
);
