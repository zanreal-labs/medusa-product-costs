import type { StepExecutionContext } from "@medusajs/framework/workflows-sdk";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import type { LinkDefinition } from "@medusajs/framework/types";
import costPriceVariantLink from "../../links/cost-price-product-variant";
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

export interface CostPriceIdsInput {
  ids: string[];
}

/**
 * Resolves the real `CostPrice <-> ProductVariant` link pairs for the given
 * cost price ids, whatever the `variant_id` cache column says. The result is
 * meant for `dismissRemoteLinkStep`, not `removeRemoteLinkStep`: the link
 * carries `deleteCascade` on the variant side, so deleting it through the cost
 * price would soft-delete the variants too.
 */
export async function listCostPriceVariantLinks(
  input: CostPriceIdsInput,
  { container }: StepContext,
): Promise<LinkDefinition[]> {
  if (!input.ids.length) return [];
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: costPriceVariantLink.entryPoint,
    filters: { cost_price_id: input.ids },
    fields: ["product_variant_id", "cost_price_id"],
  });
  return (data as { product_variant_id: string; cost_price_id: string }[]).map((row) => ({
    [Modules.PRODUCT]: { product_variant_id: row.product_variant_id },
    [PRODUCT_COSTS_MODULE]: { cost_price_id: row.cost_price_id },
  }));
}

/** Business logic of {@link deleteCostPricesByIdsStep}, exported for tests. */
export async function deleteCostPricesByIds(
  input: CostPriceIdsInput,
  { container }: StepContext,
): Promise<CostPriceDTO[]> {
  if (!input.ids.length) return [];
  const service: ProductCostsModuleService = container.resolve(PRODUCT_COSTS_MODULE);
  const existing = (await service.listCostPrices({ id: input.ids }, {})) as unknown as CostPriceDTO[];
  if (!existing.length) return [];
  await service.deleteCostPrices(existing.map((row) => row.id));
  return existing;
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

/** Lists the link pairs of the given cost prices, to be dismissed (never deleted). */
export const listCostPriceVariantLinksStep = createStep(
  "list-cost-price-variant-links",
  async (input: CostPriceIdsInput, context) =>
    new StepResponse(await listCostPriceVariantLinks(input, context)),
);

/**
 * Deletes the `CostPrice` records with the given ids, so a workflow removes
 * exactly the rows whose links it dismissed. Compensation restores them.
 */
export const deleteCostPricesByIdsStep = createStep(
  "delete-cost-prices-by-ids",
  async (input: CostPriceIdsInput, context) => {
    const deleted = await deleteCostPricesByIds(input, context);
    return new StepResponse<CostPriceDTO[], CostPriceDTO[]>(deleted, deleted);
  },
  async (deleted: CostPriceDTO[] | undefined, context) => restoreCostPrices(deleted, context),
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
 * `listCostPriceIdsBySkuStep`, `listCostPriceVariantLinksStep`,
 * `dismissRemoteLinkStep` and `deleteCostPricesByIdsStep`. Do not use
 * `removeRemoteLinkStep` here: the link has `deleteCascade` on the variant
 * side, so it would soft-delete the product variants.
 */
export const deleteCostPriceBySkuStep = createStep(
  "delete-cost-price-by-sku",
  async (input: DeleteCostPriceBySkuInput, context) => {
    const deleted = await deleteCostPricesBySku(input, context);
    return new StepResponse<CostPriceDTO[], CostPriceDTO[]>(deleted, deleted);
  },
  async (deleted: CostPriceDTO[] | undefined, context) => restoreCostPrices(deleted, context),
);
