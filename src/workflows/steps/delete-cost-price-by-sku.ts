import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { PRODUCT_COSTS_MODULE } from "../../modules/product-costs";
import type ProductCostsModuleService from "../../modules/product-costs/service";
import type { CostPriceDTO } from "../../modules/product-costs/types";

export interface DeleteCostPriceBySkuInput {
  sku: string;
}

/**
 * Deletes the `CostPrice` record for the given SKU, if one exists. Returns
 * `null` when no record is found (not an error - the SKU may never have had a
 * cost, or it was already removed).
 *
 * Exported so that consuming applications can compose it into their own delete
 * workflows for custom product entities that are not Medusa `ProductVariant`s.
 * The typical pattern:
 *
 * ```ts
 * import { deleteCostPriceBySkuStep } from "@zanreal/medusa-product-costs/workflows"
 * import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
 *
 * export const deleteFlightWorkflow = createWorkflow(
 *   "delete-flight",
 *   (input: { id: string }) => {
 *     deleteCostPriceBySkuStep({ sku: input.id })
 *     deleteFlightStep(input)
 *     return new WorkflowResponse(void 0)
 *   }
 * )
 * ```
 *
 * Compensation restores the deleted record, under its original id, if a later
 * step in the workflow fails and triggers a rollback. The `CostPriceHistory`
 * trail was never touched (it is append-only), so there is nothing to restore
 * there.
 *
 * Meant for stores running with `skipVariantLinking: true`. This step does not
 * dismiss the `CostPrice <-> ProductVariant` module link, so on a store that
 * does link variants, deleting a linked cost leaves that link behind; compose
 * `dismissRemoteLinkStep` before it in that case.
 */
export const deleteCostPriceBySkuStep = createStep(
  "delete-cost-price-by-sku",
  async (input: DeleteCostPriceBySkuInput, { container }) => {
    const service: ProductCostsModuleService = container.resolve(PRODUCT_COSTS_MODULE);

    const [existing] = await service.listCostPrices(
      { sku: [input.sku.trim()] },
      {},
    ) as unknown as CostPriceDTO[];

    if (!existing) {
      return new StepResponse<CostPriceDTO | null>(null);
    }

    await service.deleteCostPrices([existing.id]);

    return new StepResponse<CostPriceDTO | null>(existing);
  },
  async (deleted: CostPriceDTO | null, { container }) => {
    if (!deleted) return;

    const service: ProductCostsModuleService = container.resolve(PRODUCT_COSTS_MODULE);

    // Restored under its original id. Without it the row comes back as a
    // new record, and anything that referenced the old id - the
    // CostPrice <-> ProductVariant module link above all - is left pointing
    // at a row that will never exist again.
    await service.createCostPrices([{
      id: deleted.id,
      sku: deleted.sku,
      unit_cost_net: Number(deleted.unit_cost_net),
      currency: deleted.currency,
      source: deleted.source,
      note: deleted.note,
      variant_id: deleted.variant_id,
    }]);
  },
);
