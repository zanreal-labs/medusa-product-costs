import { model } from "@medusajs/framework/utils";

/**
 * The curated purchase cost for a single SKU, in a single currency. `sku` is
 * the durable key - a bulk CSV import matches by SKU, and `variant_id` is only
 * a denormalized cache of the Medusa product variant that currently carries
 * that SKU. If a variant is deleted and recreated (or the SKU moves to a
 * different variant), `variant_id` is re-resolved from `sku`; the cost itself
 * is never orphaned because the SKU, not the variant, owns the row.
 *
 * ## Why the key is (sku, currency) and not sku
 *
 * It used to be `sku` alone, one row per SKU. A store that buys the same
 * article from two suppliers invoicing in different currencies had nowhere to
 * put the second figure, and a store selling in several currencies could only
 * see a margin in the one currency its costs happened to be recorded in.
 *
 * The two rows are independent facts, not conversions of one another: this
 * module stores what a purchase actually cost, and deliberately does no
 * exchange-rate arithmetic. Nothing here says the EUR and the USD row for one
 * SKU have to agree at today's rate, because a real invoice does not care
 * what today's rate is.
 *
 * Single-currency stores are unaffected: one row per SKU is still exactly what
 * they get, and every read that does not name a currency resolves to the
 * store's configured default one.
 */
const CostPrice = model
  .define("cost_price", {
    currency: model.text().default("PLN"),
    id: model.id({ prefix: "cprc" }).primaryKey(),
    note: model.text().nullable(),
    sku: model.text(),
    source: model.enum(["manual", "csv", "api"]),
    unit_cost_net: model.bigNumber(),
    variant_id: model.text().nullable(),
  })
  .indexes([
    {
      on: ["sku", "currency"],
      unique: true,
    },
  ]);

export default CostPrice;
