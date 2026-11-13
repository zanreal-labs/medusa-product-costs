import path from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  deleteProductsWorkflow,
  deleteProductVariantsWorkflow,
} from "@medusajs/medusa/core-flows";
import type { MedusaContainer } from "@medusajs/framework/types";

// Both directions of the CostPrice <-> ProductVariant link (issue #27),
// against a real Medusa app and Postgres:
// - removing a cost price's link, or the cost price itself, never deletes the
//   product variant;
// - deleting a product variant removes the link row but keeps the CostPrice
//   rows, so a variant recreated with the same SKU is relinked by the sync.

const PRODUCT_COSTS = "productCosts";
// `entryPoint` of src/links/cost-price-product-variant.ts.
const LINK_ENTRY_POINT = "product_variant_cost_price";

medusaIntegrationTestRunner({
  cwd: path.join(__dirname, "../app"),
  testSuite: ({ getContainer }) => {
    let container: MedusaContainer;
    let counter = 0;

    beforeEach(() => {
      container = getContainer();
    });

    // Plugin workflows are run by name through the engine the app loaded, so
    // the test exercises the registered definitions, not a second copy.
    async function runWorkflow<T = unknown>(name: string, input: unknown): Promise<T> {
      const engine = container.resolve(Modules.WORKFLOW_ENGINE) as {
        run: (name: string, opts: { input: unknown; throwOnError?: boolean }) => Promise<{ result: T }>;
      };
      const { result } = await engine.run(name, { input, throwOnError: true });
      return result;
    }

    async function createVariant(sku: string) {
      counter += 1;
      const productService = container.resolve(Modules.PRODUCT);
      const [product] = await productService.createProducts([
        {
          options: [{ title: "Size", values: ["S"] }],
          title: `Product ${counter}`,
          variants: [{ options: { Size: "S" }, sku, title: "S" }],
        },
      ]);
      return { productId: product.id, variantId: product.variants[0].id };
    }

    async function createCostPrice(sku: string) {
      const result = await runWorkflow<{ costPrice: { id: string } }>("upsert-cost-price", {
        currency: "PLN",
        sku,
        source: "manual",
        unitCostNet: 1234,
      });
      return result.costPrice.id;
    }

    // Live (not soft-deleted) rows of this plugin's link table.
    async function listLinks(filters: { product_variant_id?: string; cost_price_id?: string }) {
      const query = container.resolve(ContainerRegistrationKeys.QUERY);
      const { data } = await query.graph({
        entity: LINK_ENTRY_POINT,
        fields: ["product_variant_id", "cost_price_id"],
        filters,
      });
      return data as { product_variant_id: string; cost_price_id: string }[];
    }

    async function variantExists(variantId: string) {
      const productService = container.resolve(Modules.PRODUCT);
      const variants = await productService.listProductVariants({ id: [variantId] });
      return variants.length === 1;
    }

    async function costPricesForSku(sku: string) {
      const service = container.resolve(PRODUCT_COSTS) as {
        listCostPrices: (filter: { sku: string[] }) => Promise<{ id: string; variant_id: string | null }[]>;
      };
      return service.listCostPrices({ sku: [sku] });
    }

    describe("removing the link from the cost price side", () => {
      it("link.delete by cost price keeps the product variant", async () => {
        const sku = "LINK-DELETE-1";
        const { variantId } = await createVariant(sku);
        const costPriceId = await createCostPrice(sku);
        expect(await listLinks({ cost_price_id: costPriceId })).toHaveLength(1);

        const link = container.resolve(ContainerRegistrationKeys.LINK);
        await link.delete({ [PRODUCT_COSTS]: { cost_price_id: [costPriceId] } });

        expect(await listLinks({ cost_price_id: costPriceId })).toHaveLength(0);
        expect(await variantExists(variantId)).toBe(true);
      });

      it("link.dismiss keeps the product variant", async () => {
        const sku = "LINK-DISMISS-1";
        const { variantId } = await createVariant(sku);
        const costPriceId = await createCostPrice(sku);

        const link = container.resolve(ContainerRegistrationKeys.LINK);
        await link.dismiss({
          [Modules.PRODUCT]: { product_variant_id: variantId },
          [PRODUCT_COSTS]: { cost_price_id: costPriceId },
        });

        expect(await listLinks({ cost_price_id: costPriceId })).toHaveLength(0);
        expect(await variantExists(variantId)).toBe(true);
      });

      it("deleteCostPriceWorkflow removes cost rows and link, keeps the variant", async () => {
        const sku = "COST-DELETE-1";
        const { variantId } = await createVariant(sku);
        const costPriceId = await createCostPrice(sku);

        await runWorkflow("delete-cost-price", { sku });

        expect(await costPricesForSku(sku)).toHaveLength(0);
        expect(await listLinks({ cost_price_id: costPriceId })).toHaveLength(0);
        expect(await variantExists(variantId)).toBe(true);
      });
    });

    describe("deleting from the product variant side", () => {
      it("deleteProductVariantsWorkflow removes the link row and keeps the cost price", async () => {
        const sku = "VARIANT-DELETE-1";
        const { variantId } = await createVariant(sku);
        const costPriceId = await createCostPrice(sku);
        expect(await listLinks({ product_variant_id: variantId })).toHaveLength(1);

        await deleteProductVariantsWorkflow(container).run({ input: { ids: [variantId] } });

        expect(await variantExists(variantId)).toBe(false);
        expect(await listLinks({ product_variant_id: variantId })).toHaveLength(0);
        expect(await listLinks({ cost_price_id: costPriceId })).toHaveLength(0);
        const rows = await costPricesForSku(sku);
        expect(rows.map((r) => r.id)).toEqual([costPriceId]);
      });

      it("deleteProductsWorkflow removes the link row and keeps the cost price", async () => {
        const sku = "PRODUCT-DELETE-1";
        const { productId, variantId } = await createVariant(sku);
        const costPriceId = await createCostPrice(sku);

        await deleteProductsWorkflow(container).run({ input: { ids: [productId] } });

        expect(await variantExists(variantId)).toBe(false);
        expect(await listLinks({ cost_price_id: costPriceId })).toHaveLength(0);
        expect((await costPricesForSku(sku)).map((r) => r.id)).toEqual([costPriceId]);
      });

      it("a variant recreated with the same SKU is relinked by the sync workflow", async () => {
        const sku = "VARIANT-RECREATE-1";
        const { variantId } = await createVariant(sku);
        const costPriceId = await createCostPrice(sku);

        await deleteProductVariantsWorkflow(container).run({ input: { ids: [variantId] } });
        const { variantId: recreatedId } = await createVariant(sku);
        await runWorkflow("sync-cost-price-variant-links", { skus: [sku] });

        const links = await listLinks({ cost_price_id: costPriceId });
        expect(links).toHaveLength(1);
        expect(links[0]).toMatchObject({ product_variant_id: recreatedId });
        const [row] = await costPricesForSku(sku);
        expect(row).toMatchObject({ id: costPriceId, variant_id: recreatedId });
      });
    });
  },
});
