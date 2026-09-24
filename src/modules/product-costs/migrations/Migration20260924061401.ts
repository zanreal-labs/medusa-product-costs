import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Widens the `cost_price` key from `sku` to `(sku, currency)`, and adds
 * `product_costs_settings.enabled_currencies`.
 *
 * Purely additive for existing data: every row already carries a currency, so
 * the old one-row-per-SKU shape satisfies the new composite unique index
 * unchanged, and nothing needs backfilling. Dropping the narrower constraint
 * only removes a restriction.
 *
 * `down()` is the direction that can fail, and deliberately so: once a SKU has
 * costs in two currencies, restoring a unique index on `sku` alone is not
 * possible without deciding which of those rows to destroy. That decision is
 * not a migration's to make, so the index creation simply errors out and
 * leaves the data intact.
 */
export class Migration20260924061401 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "cost_price" drop constraint if exists "cost_price_sku_currency_unique";`);
    this.addSql(`drop index if exists "IDX_cost_price_sku_unique";`);

    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cost_price_sku_currency_unique" ON "cost_price" ("sku", "currency") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "product_costs_settings" add column if not exists "enabled_currencies" text[] null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_cost_price_sku_currency_unique";`);

    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cost_price_sku_unique" ON "cost_price" ("sku") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "product_costs_settings" drop column if exists "enabled_currencies";`);
  }

}
