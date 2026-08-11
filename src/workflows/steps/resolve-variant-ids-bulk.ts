import type { StepExecutionContext } from "@medusajs/framework/workflows-sdk";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { Modules } from "@medusajs/framework/utils";
import type { IProductModuleService } from "@medusajs/framework/types";

export interface ResolveVariantIdsBulkInput {
  skus: string[];
}

export interface ResolveVariantIdsBulkOutput {
  /** sku -> resolved variant id. SKUs with no matching variant are absent. */
  bySku: Record<string, string>;
  /**
   * SKUs that matched more than one variant, mapped to how many *extra*
   * variants were ignored for each. Empty in the normal case - SKUs are
   * meant to be unique, but nothing in Medusa enforces that at the database
   * level. For every entry here, the lowest `id` (ascending) won
   * deterministically, never an unordered "last one iterated" pick.
   */
  duplicates: Record<string, number>;
}

/**
 * The step's business logic, exported separately from
 * `resolveVariantIdsBulkStep` so it can be unit-tested with a mocked
 * container - see the equivalent note on `resolveVariantIdBySku`.
 *
 * Batch variant lookup by SKU - a single query for however many SKUs are
 * passed in, used after a CSV import instead of resolving one SKU at a time
 * (which would be a query per row for potentially thousands of rows). SKUs
 * with no matching variant are simply absent from `bySku`. Results are
 * ordered by variant id ascending, and the first (lowest-id) variant seen
 * for a SKU wins, so that when more than one variant shares a SKU, the same
 * one wins on every run.
 */
export async function resolveVariantIdsBulk(
  input: ResolveVariantIdsBulkInput,
  { container }: Pick<StepExecutionContext, "container">,
): Promise<ResolveVariantIdsBulkOutput> {
  if (input.skus.length === 0) {
    return { bySku: {}, duplicates: {} };
  }

  const productModuleService: IProductModuleService = container.resolve(Modules.PRODUCT);
  const variants = await productModuleService.listProductVariants(
    { sku: input.skus },
    { order: { id: "ASC" }, select: ["id", "sku"] },
  );

  const bySku: Record<string, string> = {};
  const duplicates: Record<string, number> = {};
  for (const variant of variants) {
    if (!variant.sku) {
      continue;
    }
    if (variant.sku in bySku) {
      duplicates[variant.sku] = (duplicates[variant.sku] ?? 0) + 1;
      continue;
    }
    bySku[variant.sku] = variant.id;
  }

  return { bySku, duplicates };
}

export const resolveVariantIdsBulkStep = createStep(
  "resolve-variant-ids-bulk",
  async (input: ResolveVariantIdsBulkInput, context) =>
    new StepResponse<ResolveVariantIdsBulkOutput>(await resolveVariantIdsBulk(input, context)),
);
