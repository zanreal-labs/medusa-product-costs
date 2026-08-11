import type { StepExecutionContext } from "@medusajs/framework/workflows-sdk";
import { describe, expect, it, vi } from "vitest";
import { resolveVariantIdsBulk } from "../resolve-variant-ids-bulk";

/**
 * Tests `resolveVariantIdsBulk`, the step's business logic exported
 * separately from `resolveVariantIdsBulkStep` (see the comment on that
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

describe("resolveVariantIdsBulk", () => {
  it("returns empty results without querying the Product module when skus is empty", async () => {
    const listProductVariants = vi.fn();

    const result = await resolveVariantIdsBulk({ skus: [] }, containerWith(listProductVariants));

    expect(result).toEqual({ bySku: {}, duplicates: {} });
    expect(listProductVariants).not.toHaveBeenCalled();
  });

  it("maps each SKU to its variant id, omitting SKUs with no match", async () => {
    const listProductVariants = vi.fn().mockResolvedValue([
      { id: "variant_1", sku: "SKU-1" },
      { id: "variant_2", sku: "SKU-2" },
    ]);

    const result = await resolveVariantIdsBulk(
      { skus: ["SKU-1", "SKU-2", "SKU-3"] },
      containerWith(listProductVariants),
    );

    expect(result).toEqual({
      bySku: { "SKU-1": "variant_1", "SKU-2": "variant_2" },
      duplicates: {},
    });
    expect(listProductVariants).toHaveBeenCalledWith(
      { sku: ["SKU-1", "SKU-2", "SKU-3"] },
      expect.objectContaining({ order: { id: "ASC" } }),
    );
  });

  it("resolves deterministically to the lowest id and records the rest as duplicates when a SKU matches more than one variant", async () => {
    // Ordered ascending by id, as the query requests - the step must not
    // re-sort or let a later-iterated row overwrite an earlier one.
    const listProductVariants = vi.fn().mockResolvedValue([
      { id: "variant_1", sku: "SKU-DUP" },
      { id: "variant_2", sku: "SKU-DUP" },
      { id: "variant_3", sku: "SKU-DUP" },
      { id: "variant_9", sku: "SKU-UNIQUE" },
    ]);

    const result = await resolveVariantIdsBulk(
      { skus: ["SKU-DUP", "SKU-UNIQUE"] },
      containerWith(listProductVariants),
    );

    expect(result).toEqual({
      bySku: { "SKU-DUP": "variant_1", "SKU-UNIQUE": "variant_9" },
      duplicates: { "SKU-DUP": 2 },
    });
  });

  it("skips a variant with no sku instead of writing an 'undefined' key", async () => {
    const listProductVariants = vi.fn().mockResolvedValue([
      { id: "variant_1", sku: null },
      { id: "variant_2", sku: "SKU-1" },
    ]);

    const result = await resolveVariantIdsBulk(
      { skus: ["SKU-1"] },
      containerWith(listProductVariants),
    );

    expect(result).toEqual({ bySku: { "SKU-1": "variant_2" }, duplicates: {} });
  });
});
