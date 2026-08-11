import type { StepExecutionContext } from "@medusajs/framework/workflows-sdk";
import { describe, expect, it, vi } from "vitest";
import { resolveVariantIdBySku } from "../resolve-variant-id";

/**
 * Tests `resolveVariantIdBySku`, the step's business logic exported
 * separately from `resolveVariantIdBySkuStep` (see the comment on that
 * export) precisely so it can be exercised here with a mocked container,
 * without needing a `createWorkflow` composer context or a real Product
 * module. The cast to `Pick<StepExecutionContext, "container">` stands in
 * for the real `MedusaContainer` - the function under test only ever calls
 * `.resolve` on it.
 */
function containerWith(
  listProductVariants: ReturnType<typeof vi.fn>,
): Pick<StepExecutionContext, "container"> {
  return {
    container: { resolve: () => ({ listProductVariants }) },
  } as unknown as Pick<StepExecutionContext, "container">;
}

describe("resolveVariantIdBySku", () => {
  it("returns null and zero duplicates when no variant matches", async () => {
    const listProductVariants = vi.fn().mockResolvedValue([]);

    const result = await resolveVariantIdBySku(
      { sku: "SKU-1" },
      containerWith(listProductVariants),
    );

    expect(result).toEqual({ duplicateMatches: 0, variantId: null });
  });

  it("returns the single matching variant id with zero duplicates", async () => {
    const listProductVariants = vi.fn().mockResolvedValue([{ id: "variant_1" }]);

    const result = await resolveVariantIdBySku(
      { sku: "SKU-1" },
      containerWith(listProductVariants),
    );

    expect(result).toEqual({ duplicateMatches: 0, variantId: "variant_1" });
    expect(listProductVariants).toHaveBeenCalledWith(
      { sku: "SKU-1" },
      expect.objectContaining({ order: { id: "ASC" } }),
    );
  });

  it("resolves deterministically to the lowest id and reports the rest as duplicates when a SKU matches more than one variant", async () => {
    // Ordered ascending by id, as the query requests - the step must not
    // re-sort or pick anything other than the first entry.
    const listProductVariants = vi
      .fn()
      .mockResolvedValue([{ id: "variant_1" }, { id: "variant_2" }, { id: "variant_3" }]);

    const result = await resolveVariantIdBySku(
      { sku: "SKU-DUP" },
      containerWith(listProductVariants),
    );

    expect(result).toEqual({ duplicateMatches: 2, variantId: "variant_1" });
  });
});
