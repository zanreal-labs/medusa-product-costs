import { defineLink } from "@medusajs/framework/utils";
import ProductModule from "@medusajs/medusa/product";
import ProductCostsModule from "../modules/product-costs";

/**
 * Links a `CostPrice` row to the Medusa product variant that currently
 * carries its SKU, so `query.graph` can fetch a variant's cost alongside
 * its other data. This link is a convenience for reads only - `sku` on
 * `CostPrice` remains the durable key that the CSV importer and the admin
 * UI match against. See `src/workflows/upsert-cost-price.ts` for how the
 * link is kept in sync as variants are created, recreated, or deleted.
 *
 * No side of this link carries `deleteCascade`, on purpose (issue #27).
 * In Medusa's `Link`, the side marked `deleteCascade` is the one deleted
 * when the link is removed through the other side, so the flag on the
 * product-variant side made `link.delete({ productCosts: { cost_price_id } })`
 * soft-delete the variant. With no flag on either side:
 *
 * - Removing or dismissing this link, or deleting a `CostPrice` (see
 *   `deleteCostPriceWorkflow`), never deletes a product variant.
 * - Deleting a product variant (core `deleteProductVariantsWorkflow`) or a
 *   whole product (`deleteProductsWorkflow`) still removes the link row:
 *   both call `removeRemoteLinkStep` with
 *   `{ product: { product_variant_id } }` (Medusa 2.22.1 and later), which
 *   reaches this link through the key the link registers on the product
 *   side, independently of `deleteCascade`. The `CostPrice` rows are kept,
 *   because the cost belongs to the SKU, not to the variant.
 *
 * The link row going away does not repair the `CostPrice.variant_id` cache
 * (a plain text column on this module's own table, outside the link). That
 * column, and the link itself for a SKU that gets re-assigned to a
 * different or recreated variant, is repaired by re-running
 * `syncCostPriceVariantLinksWorkflow` (see the "Resync links" admin action
 * and `POST /admin/product-costs/resync-links`).
 */
export default defineLink(
  ProductModule.linkable.productVariant,
  ProductCostsModule.linkable.costPrice,
);
