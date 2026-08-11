import { model } from "@medusajs/framework/utils";

/**
 * The curated purchase cost for a single SKU. `sku` is the durable key - a
 * bulk CSV import matches by SKU, and `variant_id` is only a denormalized
 * cache of the Medusa product variant that currently carries that SKU. If a
 * variant is deleted and recreated (or the SKU moves to a different
 * variant), `variant_id` is re-resolved from `sku`; the cost itself is never
 * orphaned because the SKU, not the variant, owns the row.
 */
const CostPrice = model.define("cost_price", {
  currency: model.text().default("PLN"),
  id: model.id({ prefix: "cprc" }).primaryKey(),
  note: model.text().nullable(),
  sku: model.text().unique(),
  source: model.enum(["manual", "csv", "api"]),
  unit_cost_net: model.bigNumber(),
  variant_id: model.text().nullable(),
});

export default CostPrice;
