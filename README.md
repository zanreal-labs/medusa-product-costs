# @zanreal/medusa-product-costs

A [Medusa v2](https://medusajs.com) plugin that tracks purchase cost (COGS) per SKU and computes
margin, break-even price, and net income against a selling price.

There is no cost/margin plugin in the Medusa ecosystem today. Medusa's Pricing module knows what
you _sell_ something for; nothing in core or the plugin registry tracks what it _cost_ you, or
turns that into a margin number. This plugin fills that gap: a small, standalone module for
curating a net purchase cost per SKU and deriving the numbers a pricing decision needs from it.

## What it does

- Stores a **net purchase cost per SKU**, entered by an operator or imported in bulk from a CSV.
- Grosses that cost up by a configurable VAT rate and computes **net income**, **break-even
  price**, and **margin %** against a given selling price and (optional) marketplace commission
  rate.
- Keeps an **append-only history** of every cost change, so "what did this used to cost, and when
  did it change" is always answerable.
- Links a cost to the Medusa **product variant** that currently carries its SKU, so the cost shows
  up next to the product in the admin - without making the variant the source of truth. The SKU
  is the durable key; if a variant is deleted and recreated, the cost is not orphaned.

It ships an admin widget on the product detail page (editable cost per variant, with a live gross
cost preview) and a "Product costs" page for bulk CSV import, search, and per-SKU history.

## The null-propagation philosophy

Nothing here is defaulted silently. If a figure depends on a value you have not provided, that
figure comes back `undefined` (`null` over the wire) - never `0`, never a guess.

- No purchase cost on file for a SKU? `grossCost`, `netIncome`, `breakEvenPrice`, and `marginPct`
  are all `undefined`. They are **not** computed as if the cost were `0`, which would silently
  make every margin look artificially good.
- No selling price given? `netIncome` and `marginPct` are `undefined`; `grossCost` and
  `breakEvenPrice` (which do not depend on a selling price) still compute.
- A marketplace commission rate at or above 100% (`commissionRate >= 1`)? `breakEvenPrice` is
  `undefined` - there is no finite gross price at which a 100%+ commission still leaves anything
  behind. `netIncome` still computes (it just comes out very negative), because it is well-defined
  even at absurd commission rates.
- `commissionRate` is the one input with a real default: omit it and it is treated as `0`, because
  "no commission" is a legitimate, common case (a lot of the SKUs this plugin was built for are
  sold direct with no marketplace cut) - not a missing input.
- `vatRate` is not a "missing input" either: it is a plugin option, configured once for the store
  it runs in, with a documented default of `0.23`. A rate the plugin is explicitly configured to
  default is not the same thing as a business fact (a cost, a price) that nobody entered.

Every money amount is a decimal rounded half-up to 2 places (see `round2` in
`src/modules/product-costs/lib/money.ts`). `marginPct` is the one exception - it is left as an
unrounded ratio (e.g. `0.4213`, not `42.13`), because rounding a ratio to 2 decimal places throws
away exactly the precision a caller might want when formatting it as a percentage. Format it at
the point you display it.

## Install

```bash
npm install @zanreal/medusa-product-costs
# or
pnpm add @zanreal/medusa-product-costs
# or
yarn add @zanreal/medusa-product-costs
```

Register it as a plugin in your Medusa app's `medusa-config.ts`:

```ts
import { defineConfig } from "@medusajs/framework/utils";

export default defineConfig({
  // ...
  plugins: [
    {
      resolve: "@zanreal/medusa-product-costs",
      options: {
        vatRate: 0.23,
        defaultCurrency: "PLN",
      },
    },
  ],
});
```

Then sync the module's migrations and the product-variant link into your app's database:

```bash
npx medusa db:migrate
```

## Options

| Option            | Type     | Default | Description                                                       |
| ----------------- | -------- | ------- | ----------------------------------------------------------------- |
| `vatRate`         | `number` | `0.23`  | VAT rate as a fraction, used to gross up a net cost.              |
| `defaultCurrency` | `string` | `"PLN"` | Currency recorded on a cost when the caller does not specify one. |

Both are per-store, not per-cost: every `CostPrice` row does still carry its own `currency`
column, but the VAT rate used in a margin calculation is always the store-wide option (or an
explicit override passed to that one calculation) - it is not stored per row.

## The margin math

Ported from a production pricing pipeline, unchanged:

```
grossCost      = netCost * (1 + vatRate)
netIncome      = sellingPrice - sellingPrice * commissionRate - grossCost
breakEvenPrice = grossCost / (1 - commissionRate)      // undefined when commissionRate >= 1
marginPct      = netIncome / sellingPrice
```

See `src/modules/product-costs/lib/economics.ts` for the implementation and
`src/modules/product-costs/lib/economics.test.ts`-equivalent (`__tests__/economics.test.ts`) for
the edge cases codified as tests.

## Admin API

All routes are under `/admin/product-costs` and use Medusa's standard admin authentication (no
extra setup needed - anything under `/admin` is authenticated by the framework by default).

### `GET /admin/product-costs`

List/search curated costs.

| Query param | Description                                                   |
| ----------- | ------------------------------------------------------------- |
| `q`         | Case-insensitive substring search on SKU.                     |
| `sku`       | Repeatable (`?sku=A&sku=B`) - filter to an exact set of SKUs. |
| `limit`     | Page size. Default `20`.                                      |
| `offset`    | Page offset. Default `0`.                                     |

```json
{
  "cost_prices": [
    {
      "id": "cprc_...",
      "sku": "ABC-123",
      "unit_cost_net": 10.5,
      "currency": "PLN",
      "source": "manual",
      "variant_id": "variant_...",
      "note": null
    }
  ],
  "count": 1,
  "limit": 20,
  "offset": 0
}
```

### `POST /admin/product-costs`

Create or update the cost for one SKU. Always writes a history row.

```json
// Request
{ "sku": "ABC-123", "unit_cost_net": 10.5, "currency": "PLN", "note": "spring restock" }

// Response
{ "cost_price": { "id": "cprc_...", "sku": "ABC-123", "unit_cost_net": 10.5, "..." : "..." } }
```

`source` is not normally sent by the admin UI - it defaults to `"manual"`. The CSV importer sets
it to `"csv"`; a future API-key integration would set it to `"api"`.

### `POST /admin/product-costs/import`

Bulk-import a `sku,cost` CSV (see format below).

```json
// Request
{ "csv": "sku,cost\nABC-123,10.50\nDEF-456,20,00\n" }

// Response
{ "created": 1, "updated": 1, "skipped": 0, "errors": [] }
```

### `GET /admin/product-costs/:sku/history`

The append-only change history for one SKU, newest first.

```json
{
  "history": [
    {
      "id": "cprch_...",
      "sku": "ABC-123",
      "unit_cost_net": 10.5,
      "currency": "PLN",
      "source": "manual",
      "changed_by": "user_...",
      "changed_at": "2026-08-11T10:00:00.000Z"
    }
  ],
  "count": 1,
  "limit": 50,
  "offset": 0
}
```

### `GET /admin/product-costs/config`

The resolved plugin options (`vatRate`, `defaultCurrency`), so the admin UI can compute a gross
cost preview that matches how this store is actually configured.

## CSV format

Two columns, `sku,cost`. A header row is optional - a row whose first column is literally `sku`
(any case) is skipped without being treated as data or as an error.

- **Delimiter**: `,` or `;`, auto-detected from the first non-blank line (whichever separator is
  strictly more frequent there; a tie falls back to comma).
- **Quoting**: a field can be wrapped in `"..."` to contain the delimiter; `""` inside a quoted
  field is an escaped literal `"`.
- **Decimal commas**: `10,50` and `10.50` are both read as `10.5`. Thousands grouping is
  tolerated too (`1 234,56`, `1.234,56`, `1,234.56`).
- **Currency suffixes** are stripped (`64,35 zl` -> `64.35`).
- **Zero and negative costs are rejected** as invalid - a cost is always a positive number.
- **Duplicate SKUs within one file**: the _last_ occurrence wins (as if you had re-saved a
  spreadsheet with a corrected row further down); every earlier occurrence of that SKU counts
  toward `skipped`, not `updated`.
- **Unparsable lines** (missing SKU, missing or invalid cost, or just garbage) are collected in
  `errors` with their 1-based line number, the raw line text, and a reason - they never abort the
  rest of the import.

```csv
sku,cost
ABC-123,10.50
DEF-456;20,00
"SKU, WITH, COMMAS",5.00
```

## How the variant link stays in sync

`CostPrice.sku` is the durable key. `CostPrice.variant_id` is a denormalized cache of whichever
product variant currently carries that SKU, kept in sync by two workflows
(`src/workflows/upsert-cost-price.ts`, `src/workflows/sync-cost-price-variant-links.ts`) rather
than by the module itself - a Medusa module is deliberately isolated from other modules, so
resolving "which variant has this SKU right now" and writing the `CostPrice <-> ProductVariant`
module link is orchestration work, not something the `productCosts` module does on its own.

- The single-row admin API call resolves the variant and reconciles the link in the same request.
- The CSV importer does not resolve links per row (that would be a query per line for a
  potentially large file) - it persists costs first, then runs one batched variant lookup and one
  batched link update for every SKU the import touched.
- Re-run the sync at any time (e.g. after deleting and recreating a variant) by importing the
  `syncCostPriceVariantLinksWorkflow` workflow and running it with the affected SKUs.

## Development

```bash
pnpm install
pnpm test            # vitest - formula, CSV parser, and service-logic unit tests
pnpm exec medusa lint src
pnpm exec tsc --noEmit -p tsconfig.json          # backend
pnpm exec tsc --noEmit -p src/admin/tsconfig.json # admin UI
pnpm build            # medusa plugin:build
```

Generating a fresh migration after changing a model requires a scratch Postgres database:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/scratch_db npx medusa plugin:db:generate
```

The module-service tests construct the real `ProductCostsModuleService` and replace its
auto-generated CRUD methods (`listCostPrices`, `createCostPrices`, etc. - the ones that need a
live database and a fully wired Medusa container) with mocks, so the hand-written business logic
(history-on-update, CSV dedup, variant-link diffing, margin resolution) runs for real against a
controlled fake persistence layer. There is no database in CI.

## Roadmap

**Wave 2 - price suggestion.** Given a target margin % and a SKU's cost, suggest a selling price
that would hit it (the inverse of `computeEconomics`). This is the natural next step once cost
data exists for a meaningful share of a catalog.

**Consumers.** A companion Allegro pricing-automation plugin is expected to read `breakEvenPrice`
from this plugin as the floor for automated price changes - never let an automated rule reprice a
SKU below the price at which it stops making money. That consumer does not exist yet; this plugin
is built so it can.

**Other deferred items:**

- Workflow compensation (rollback) for `upsertCostPriceWorkflow` - a failure partway through
  currently leaves the cost/history write in place; there is no automatic undo.
- A background job for the variant-link sync on very large CSV imports, instead of doing it
  synchronously in the same request as the import.
- Bulk CSV export (the inverse of import) from the "Product costs" page.
- Scoping the admin routes to a dedicated permission instead of the default admin-user check.

## License

MIT
