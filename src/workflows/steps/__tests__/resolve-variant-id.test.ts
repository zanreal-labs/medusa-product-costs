import type { StepExecutionContext } from "@medusajs/framework/workflows-sdk";
import { Modules } from "@medusajs/framework/utils";
import { describe, expect, it, vi } from "vitest";
import { PRODUCT_COSTS_MODULE } from "../../../modules/product-costs";
import { resolveVariantIdBySku } from "../resolve-variant-id";

/**
 * Tests `resolveVariantIdBySku`, the step's business logic exported
 * separately from `resolveVariantIdBySkuStep` (see the comment on that
 * export) precisely so it can be exercised here with a mocked container,
 * without needing a `createWorkflow` composer context or a real Product
 * module. The cast to `Pick<StepExecutionContext, "container">` stands in
 * for the real `MedusaContainer` - the function under test only ever calls
 * `.resolve` on it.
 *
 * The fake resolves per registration key rather than returning one object for
 * every key: the function under test reads `skipVariantLinking` off the
 * product-costs module and the SKU off the product module, so a container that
 * answers both lookups with the same stub cannot tell the two paths apart.
 * `productCosts: undefined` stands for a container where the module is not
 * registered at all - the `allowUnregistered` case.
 */
function containerWith(
  listProductVariants: ReturnType<typeof vi.fn>,
  productCosts: { moduleOptions?: { skipVariantLinking?: boolean } } | undefined = {
    moduleOptions: { skipVariantLinking: false },
  },
): Pick<StepExecutionContext, "container"> {
  return {
    container: {
      resolve: (key: string) => (key === PRODUCT_COSTS_MODULE ? productCosts : { listProductVariants }),
    },
  } as unknown as Pick<StepExecutionContext, "container">;
}

// Guards the fake above: if either registration key ever changes, the fake
// would silently answer the wrong lookup and every test here would pass for
// the wrong reason.
describe("the container fake", () => {
  it("answers the product module and the product-costs module separately", () => {
    expect(PRODUCT_COSTS_MODULE).not.toBe(Modules.PRODUCT);
  });
});

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

  it("returns null without querying the Product module when skipVariantLinking is set", async () => {
    const listProductVariants = vi.fn();

    const result = await resolveVariantIdBySku(
      { sku: "FLIGHT-LH1234" },
      containerWith(listProductVariants, { moduleOptions: { skipVariantLinking: true } }),
    );

    expect(result).toEqual({ duplicateMatches: 0, variantId: null });
    // The point of the flag: a store whose "products" are custom entities has
    // no ProductVariant rows to match, so the query must not run at all.
    expect(listProductVariants).not.toHaveBeenCalled();
  });

  it("falls back to variant resolution when the product-costs module is not registered", async () => {
    const listProductVariants = vi.fn().mockResolvedValue([{ id: "variant_1" }]);

    const result = await resolveVariantIdBySku(
      { sku: "SKU-1" },
      containerWith(listProductVariants, undefined),
    );

    expect(result).toEqual({ duplicateMatches: 0, variantId: "variant_1" });
  });
});
