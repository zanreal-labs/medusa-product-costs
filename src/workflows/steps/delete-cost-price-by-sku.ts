import type { StepExecutionContext } from "@medusajs/framework/workflows-sdk";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { PRODUCT_COSTS_MODULE } from "../../modules/product-costs";
import type ProductCostsModuleService from "../../modules/product-costs/service";
import type { CostPriceDTO } from "../../modules/product-costs/types";

export interface DeleteCostPriceBySkuInput {
  sku: string;
}

type StepContext = Pick<StepExecutionContext, "container">;

/**
 * Lists the `CostPrice` rows for a SKU. `CostPrice` is unique on
 * `(sku, currency)`, so a SKU can carry one row per currency.
 */
async function listBySku(service: ProductCostsModuleService, sku: string): Promise<CostPriceDTO[]> {
  return (await service.listCostPrices({ sku: [sku.trim()] }, {})) as unknown as CostPriceDTO[];
}

/** Business logic of {@link listCostPriceIdsBySkuStep}, exported for tests. */
export async function listCostPriceIdsBySku(
  input: DeleteCostPriceBySkuInput,
  { container }: StepContext,
): Promise<string[]> {
  const service: ProductCostsModuleService = container.resolve(PRODUCT_COSTS_MODULE);
  return (await listBySku(service, input.sku)).map((row) => row.id);
}

/** Business logic of {@link deleteCostPriceBySkuStep}, exported for tests. */
export async function deleteCostPricesBySku(
  input: DeleteCostPriceBySkuInput,
  { container }: StepContext,
): Promise<CostPriceDTO[]> {
  const service: ProductCostsModuleService = container.resolve(PRODUCT_COSTS_MODULE);
  const existing = await listBySku(service, input.sku);
  if (!existing.length) return [];
  await service.deleteCostPrices(existing.map((row) => row.id));
  return existing;
}

/**
 * Compensation of {@link deleteCostPriceBySkuStep}. Also accepts the single
 * record (or `null`) that earlier versions of the step persisted, so a
 * transaction that was in flight across an upgrade is still restored.
 */
export async function restoreCostPrices(
  deleted: CostPriceDTO[] | CostPriceDTO | null | undefined,
  { container }: StepContext,
): Promise<void> {
  const records = Array.isArray(deleted) ? deleted : deleted ? [deleted] : [];
  if (!records.length) return;

  const service: ProductCostsModuleService = container.resolve(PRODUCT_COSTS_MODULE);

  // Restored under their original ids. Without them the rows come back as
  // new records, and anything that referenced the old ids - the
  // CostPrice <-> ProductVariant module link above all - is left pointing
  // at rows that will never exist again.
  await service.createCostPrices(
    records.map((record) => ({
      id: record.id,
      sku: record.sku,
      unit_cost_net: Number(record.unit_cost_net),
      currency: record.currency,
      source: record.source,
      note: record.note,
      variant_id: record.variant_id,
    })),
  );
}

/**
 * Resolves the ids of every `CostPrice` row for the SKU without changing
 * anything. Lets a workflow dismiss links by owning id before the rows go.
 */
export const listCostPriceIdsBySkuStep = createStep(
  "list-cost-price-ids-by-sku",
  async (input: DeleteCostPriceBySkuInput, context) =>
    new StepResponse(await listCostPriceIdsBySku(input, context)),
);

/**
 * Deletes every `CostPrice` record for the given SKU (one per currency).
 * Returns an empty array when none exist (not an error - the SKU may never
 * have had a cost, or it was already removed).
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
 * Compensation restores the deleted records, under their original ids, if a
 * later step in the workflow fails and triggers a rollback. The
 * `CostPriceHistory` trail was never touched (it is append-only), so there is
 * nothing to restore there.
 *
 * Meant for stores running with `skipVariantLinking: true`. This step does not
 * dismiss the `CostPrice <-> ProductVariant` module link. On a store that
 * links variants, use `deleteCostPriceWorkflow` instead, or compose
 * `listCostPriceIdsBySkuStep`, then `removeRemoteLinkStep` keyed on
 * `{ [PRODUCT_COSTS_MODULE]: { cost_price_id: ids } }`, then this step. Links
 * must be removed before the rows are deleted.
 */
export const deleteCostPriceBySkuStep = createStep(
  "delete-cost-price-by-sku",
  async (input: DeleteCostPriceBySkuInput, context) => {
    const deleted = await deleteCostPricesBySku(input, context);
    return new StepResponse<CostPriceDTO[], CostPriceDTO[]>(deleted, deleted);
  },
  async (deleted: CostPriceDTO[] | undefined, context) => restoreCostPrices(deleted, context),
);
