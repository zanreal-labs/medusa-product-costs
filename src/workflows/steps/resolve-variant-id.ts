import type { StepExecutionContext } from "@medusajs/framework/workflows-sdk";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { Modules } from "@medusajs/framework/utils";
import type { IProductModuleService } from "@medusajs/framework/types";

export interface ResolveVariantIdBySkuInput {
  sku: string;
}

export interface ResolveVariantIdBySkuOutput {
  variantId: string | null;
  /**
   * Count of *other* product variants that also currently carry this SKU,
   * beyond the one `variantId` resolved to. Zero in the normal case - SKUs
   * are meant to be unique, but nothing in Medusa enforces that at the
   * database level, so more than one variant can end up sharing one. When
   * that happens, the lowest `id` (ascending) wins deterministically -
   * never an unordered "whichever the database returned first" - and this
   * count tells the caller an anomaly was silently resolved rather than
   * hiding it entirely.
   */
  duplicateMatches: number;
}

/**
 * The step's business logic, exported separately from
 * `resolveVariantIdBySkuStep` so it can be unit-tested with a mocked
 * container. `createStep(...)`'s returned step function only runs inside a
 * `createWorkflow` composer context (it throws "createStep must be used
 * inside a createWorkflow definition" otherwise), so the wrapped version
 * cannot be invoked directly from a test.
 *
 * Looks up the Medusa product variant currently carrying a SKU. Returns
 * `null` (not an error) when no variant matches - an unmatched SKU is a
 * normal state for this plugin, since a cost can be curated before the
 * product it belongs to exists.
 */
export async function resolveVariantIdBySku(
  input: ResolveVariantIdBySkuInput,
  { container }: Pick<StepExecutionContext, "container">,
): Promise<ResolveVariantIdBySkuOutput> {
  const productModuleService: IProductModuleService = container.resolve(Modules.PRODUCT);
  // Ordered by id ascending so that if more than one variant carries this
  // SKU, the same one wins on every run - not whatever order the database
  // happened to return.
  const variants = await productModuleService.listProductVariants(
    { sku: input.sku },
    { order: { id: "ASC" }, select: ["id"] },
  );
  return {
    duplicateMatches: Math.max(variants.length - 1, 0),
    variantId: variants[0]?.id ?? null,
  };
}

export const resolveVariantIdBySkuStep = createStep(
  "resolve-variant-id-by-sku",
  async (input: ResolveVariantIdBySkuInput, context) =>
    new StepResponse<ResolveVariantIdBySkuOutput>(await resolveVariantIdBySku(input, context)),
);
