import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { PRODUCT_COSTS_MODULE } from "../../modules/product-costs";
import type ProductCostsModuleService from "../../modules/product-costs/service";
import type { ProductCostsSettingsPatch } from "../../modules/product-costs/types";

/**
 * Thin step wrapper around the module service's `updateSettings`. No
 * compensation function: this workflow has exactly one step, so there is no
 * later step whose failure would need this write reverted.
 */
export const updateProductCostsSettingsStep = createStep(
  "update-product-costs-settings",
  async (input: ProductCostsSettingsPatch, { container }) => {
    const service: ProductCostsModuleService = container.resolve(PRODUCT_COSTS_MODULE);
    const settings = await service.updateSettings(input);
    return new StepResponse(settings);
  },
);
