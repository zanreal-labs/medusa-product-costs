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
 */
export default defineLink(
  ProductModule.linkable.productVariant,
  ProductCostsModule.linkable.costPrice,
);
