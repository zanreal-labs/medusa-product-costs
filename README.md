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

The `grossCost = netCost * (1 + vatRate)` gross-up above is computed once, unrounded, and that
_unrounded_ value is what feeds `netIncome` and `breakEvenPrice` - not the rounded `grossCost`
field the result exposes. Each of the three outputs rounds itself once, independently, from that
same unrounded gross-up. Rounding the gross-up to 2 places first and then dividing/subtracting with
the rounded value would double-round and can land a cent off from the true figure -
`breakEvenPrice` in particular is meant to be a price floor, so rounding it down by a cent (the
direction double-rounding happened to produce) is the unsafe direction to be wrong in.

`computeEconomics` is service-level only in this wave - there is no `/admin/product-costs/economics`
(or similar) HTTP route. Call `ProductCostsModuleService.computeEconomics` directly from
server-side code in the same Medusa app (another module, a workflow, a script) if you need it;
don't mistake its absence from the admin API section below for a missing feature in the shipped UI.

## Admin API

All routes are under `/admin/product-costs` and use Medusa's standard admin authentication (no
extra setup needed - anything under `/admin` is authenticated by the framework by default).

### `GET /admin/product-costs`

List/search curated costs.

| Query param | Description                                                   |
| ----------- | ------------------------------------------------------------- |
| `q`         | Case-insensitive substring search on SKU.                     |
| `sku`       | Repeatable (`?sku=A&sku=B`) - filter to an exact set of SKUs. |
| `limit`     | Page size. Default `20`, capped at `500`.                     |
| `offset`    | Page offset. Default `0`.                                     |

A negative `limit` or `offset` (or a non-numeric one) is rejected with `400`, not silently
clamped to `0` - a malformed value here is almost always a client-side bug worth surfacing, not
something to paper over. `limit` above `500` is not rejected, just capped.

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
{
  "cost_price": { "id": "cprc_...", "sku": "ABC-123", "unit_cost_net": 10.5, "..." : "..." },
  "duplicate_variant_matches": 0
}
```

`source` is not normally sent by the admin UI - it defaults to `"manual"`. The CSV importer sets
it to `"csv"`; a future API-key integration would set it to `"api"`.

Validation: `sku` is required (whitespace-only is rejected the same as empty). `unit_cost_net`
must be a positive number no greater than `1,000,000` - a sane ceiling against a fat-fingered or
malformed value, not a real business limit. `currency`, if given, is uppercased and must match a
3-letter ISO-4217 shape (`^[A-Z]{3}$`, e.g. `"PLN"`) - a value that doesn't fit that shape is
rejected with `400` rather than stored as-is.

`duplicate_variant_matches` is `0` in the normal case. It is greater than `0` when this SKU
currently matches more than one product variant - which SKUs are supposed to prevent, but nothing
in Medusa enforces uniqueness at the database level. The variant with the lowest `id` wins
deterministically either way; this field just tells you an anomaly was resolved instead of hiding
it. Investigate and de-duplicate the variants sharing that SKU if you see this be non-zero.

### `POST /admin/product-costs/import`

Bulk-import a `sku,cost` CSV (see format below).

```json
// Request
{ "csv": "sku,cost\nABC-123,10.50\nDEF-456,20,00\n" }

// Response
{ "created": 1, "updated": 1, "skipped": 0, "errors": [], "duplicateSkus": {} }
```

`duplicateSkus` maps a SKU to how many _extra_ product variants it matched, for every SKU in this
import where that happened (empty in the normal case) - see the `duplicate_variant_matches` note
above; the same determinism and the same "investigate it" advice apply here per-SKU.

### `GET /admin/product-costs/:sku/history`

The append-only change history for one SKU, newest first. `limit`/`offset` follow the same rules
as the list route above (default `50`/`0`, capped at `500`, negative values rejected).

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

### `POST /admin/product-costs/resync-links`

Re-resolves the `CostPrice.variant_id` cache (and the module link) for **every** curated cost, not
just the SKUs touched by a recent save or import. Also available as the "Resync links" button on
the "Product costs" admin page. See "How the variant link stays in sync" below for when you need
this and what it does not fix.

```json
// Response
{ "changed": 3, "skusChecked": 128, "duplicateSkus": { "ABC-123": 1 } }
```

## CSV format

Two columns, `sku,cost`. A header row is optional - a row whose first column is literally `sku`
(any case) is skipped without being treated as data or as an error.

- **Delimiter**: `,` or `;`, auto-detected from the first non-blank line - whichever separator is
  strictly more frequent there wins outright. On a tie where that line contains _both_ delimiters,
  the tie is broken by which reading actually looks like a valid `sku,cost` row: exactly 2 fields,
  with the second being a clean money value (no stray semicolon left over from splitting in the
  wrong place). If _neither_ reading is a clean-enough win over the other, the import is rejected
  with a single error naming the ambiguous line, rather than guessing - add an explicit header row
  (e.g. `sku;cost`) to disambiguate, since a header line by itself never ties against a second
  reading. A tie on a line with **no** delimiter at all (nothing to disambiguate) still falls back
  to comma.
- **Quoting**: a field can be wrapped in `"..."` to contain the delimiter; `""` inside a quoted
  field is an escaped literal `"`.
- **Decimal commas**: `10,50` and `10.50` are both read as `10.5`. Thousands grouping is
  tolerated too (`1 234,56`, `1.234,56`, `1,234.56`).
  - **A lone comma is always read as a decimal point (PL/EU convention), never as a US-style
    thousands separator**: `"1,234"` parses as `1.234`, not `1234`. A file with US-formatted
    numbers like `"1,234.56"` (comma _and_ dot present) is still read correctly as `1234.56`, since
    the dot disambiguates which separator is the decimal point - it is a file using **only**
    commas as thousands separators, with no field ever showing a decimal point, that will
    misparse. There is no way to distinguish that shape from PL/EU decimal-comma input from the
    number alone, so don't feed this importer a US-locale export that only ever uses whole-number,
    comma-grouped costs.
- **Currency suffixes** are stripped (`64,35 zl` -> `64.35`).
- **Zero and negative costs are rejected** as invalid - a cost is always a positive number.
- **Costs are canonicalized to 2 decimal places** on write (half-up, e.g. `10.999` is stored as
  `11.00`), matching every other money value in this plugin.
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
- The module link (`src/links/cost-price-product-variant.ts`) is declared with
  `deleteCascade: true` on the product-variant side, so the link row itself is removed when the
  underlying variant is deleted - it never points at a variant that no longer exists.
- Re-run the sync at any time (e.g. after deleting and recreating a variant) by importing the
  `syncCostPriceVariantLinksWorkflow` workflow and running it with the affected SKUs, or by calling
  `POST /admin/product-costs/resync-links` (also exposed as the "Resync links" button on the
  "Product costs" admin page), which does this for every curated cost in the store.

**What resyncing does not fix**: `CostPrice.sku` is the durable key this plugin matches on. If a
variant's SKU is _renamed_ in the Product module (as opposed to the variant being deleted and
recreated), `CostPrice.variant_id` still points at that same variant - the row is not stale, it is
just indexed by the SKU's old value. Nothing observes a SKU rename automatically; the row catches
up the next time that SKU is saved, imported, or included in a resync. If you rename SKUs in bulk
outside this plugin, run a resync (or a fresh CSV import covering the renamed SKUs) afterward.

Whenever more than one product variant carries the same SKU - which shouldn't happen, but nothing
in Medusa enforces it at the database level - every resolution point (the single-row API, the CSV
import's batched lookup, and the resync endpoint) picks the variant with the lowest `id`, the same
one every time, and reports the anomaly back (`duplicate_variant_matches` / `duplicateSkus`; see
the Admin API section above) instead of silently picking one.

## Development

Requires Node.js >= 22.13 (pnpm 11, pinned via `packageManager` in `package.json`, needs it).

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

**Known gap: no live-Postgres round-trip test for `unit_cost_net`.** Both `CostPrice` and
`CostPriceHistory` declare `unit_cost_net` as `model.bigNumber()`, which does not necessarily
round-trip through MikroORM as a plain JS `number`. Every service method that returns a DTO
(`upsertCost`, `getCostsBySkus`, `listCosts`, `getHistory`) normalizes it with `Number(...)`
before it reaches an API response, and the unit tests pin that normalization against a
BigNumber-shaped stand-in (a numeric string, the easiest fake to construct without a database).
What those tests cannot prove is what MikroORM's real bigNumber column actually hands back for a
value like `10.10` after a genuine write-then-read against Postgres. A real integration test for
that (`@medusajs/test-utils`'s `moduleIntegrationTestRunner`, pointed at a throwaway Postgres -
Docker locally makes that easy to spin up, same pattern as `plugin:db:generate` above) was
assessed and intentionally not added in this pass: that runner is built around Jest's test
globals, this project's test runner is Vitest, and CI has no database service configured, so a
DB-backed test would not run there and would make the local `pnpm test` gate depend on Docker
being available. If this module ever moves to Jest, or CI grows a Postgres service, this is the
test to add.

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
