import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260811100816 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "cost_price" drop constraint if exists "cost_price_sku_unique";`);
    this.addSql(`create table if not exists "cost_price" ("id" text not null, "currency" text not null default 'PLN', "note" text null, "sku" text not null, "source" text check ("source" in ('manual', 'csv', 'api')) not null, "unit_cost_net" numeric not null, "variant_id" text null, "raw_unit_cost_net" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "cost_price_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cost_price_sku_unique" ON "cost_price" ("sku") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cost_price_deleted_at" ON "cost_price" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "cost_price_history" ("id" text not null, "changed_at" timestamptz not null, "changed_by" text null, "currency" text not null, "sku" text not null, "source" text check ("source" in ('manual', 'csv', 'api')) not null, "unit_cost_net" numeric not null, "raw_unit_cost_net" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "cost_price_history_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cost_price_history_sku" ON "cost_price_history" ("sku") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cost_price_history_deleted_at" ON "cost_price_history" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "cost_price" cascade;`);

    this.addSql(`drop table if exists "cost_price_history" cascade;`);
  }

}
