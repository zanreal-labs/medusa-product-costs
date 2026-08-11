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
 * `deleteCascade: true` on the product-variant side means the link row
 * itself is removed when the underlying variant is deleted, so it never
 * points at a variant that no longer exists. It does not repair the
 * `CostPrice.variant_id` cache (a plain text column on this module's own
 * table, outside the link) - that column, and the link itself for a SKU
 * that gets re-assigned to a different/recreated variant, is repaired by
 * re-running `syncCostPriceVariantLinksWorkflow` (see the "Resync links"
 * admin action and `POST /admin/product-costs/resync-links`).
 */
export default defineLink(
  { deleteCascade: true, linkable: ProductModule.linkable.productVariant },
  ProductCostsModule.linkable.costPrice,
);
