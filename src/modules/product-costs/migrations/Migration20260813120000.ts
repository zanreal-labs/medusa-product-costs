import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Creates `product_costs_settings`, the one-row store of the persisted,
 * operator-editable VAT rate and default currency. Both value columns are
 * nullable - `null` means "not overridden here", resolved against the
 * plugin's `moduleOptions` default at read time in the service - so this
 * migration only shapes the table; the row itself is created lazily by the
 * service under a fixed primary key on first read.
 */
export class Migration20260813120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table if not exists "product_costs_settings" ("id" text not null, "default_currency" text null, "vat_rate" numeric null, "raw_vat_rate" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "product_costs_settings_pkey" primary key ("id"));`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_product_costs_settings_deleted_at" ON "product_costs_settings" ("deleted_at") WHERE deleted_at IS NULL;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "product_costs_settings" cascade;`);
  }
}
