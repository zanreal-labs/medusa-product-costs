# Changelog

All notable changes to `@zanreal/medusa-product-costs` are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). A version
reaches npm only through a GitHub Release, so the dates below are publish dates on the
registry, not merge dates on `main` - see [Releasing](./README.md#releasing).

## [Unreleased]

### Changed

- **Built and tested against Medusa 2.21.1** (was 2.18.0), with the admin toolchain Medusa 2.19
  requires: Vite 7 and, where used, React Router 7. `react-i18next` and `i18next` deliberately stay
  on the majors the Medusa dashboard itself ships (13 and 23): admin extensions share the host's
  i18n instance, and a second major would give them one of their own. Install alongside Medusa
  2.21.1; Node ^20.19 or ^22.12 is required from Medusa 2.19 on.

### Added

- **A cost per currency.** `CostPrice` is keyed by `(sku, currency)` instead of by `sku` alone, so a
  store buying the same article from suppliers who invoice in different currencies can record both
  figures, and a store selling in several currencies can see a margin in each. The rows are
  independent facts: this plugin still does no exchange-rate arithmetic. Pick the extra currencies
  under Settings > Product costs; `GET /admin/product-costs` gains an optional `?currency=`, and
  `GET /admin/product-costs/config` reports `enabledCurrencies`.

### Changed

- `getCostsBySkus`/`getCostBySku` take an optional currency and default to the store's, so a caller
  that wants one number still gets a deterministic one rather than whichever row the database
  returned first. `getAllCostsBySku` is the new multi-currency read. `computeEconomics` takes an
  optional `currency`.
- The Catalog cost column shows the default currency's cost and appends `+N` when the SKU is costed
  in others, rather than silently rendering one of several.
- Variant-link resync now re-points every currency's row for a SKU, not just the default one's.

### Migration

- `Migration20260924061401` widens the unique index from `sku` to `(sku, currency)` and adds
  `product_costs_settings.enabled_currencies`. Additive: existing rows already carry a currency, so
  nothing needs backfilling. `down()` will fail once a SKU has costs in two currencies, deliberately -
  choosing which of them to destroy is not a migration's call.

## [0.2.0] - 2026-09-08

### Added

- **Purchase cost and SRP margin on the catalog, the product page and the variant page.**
  The cost stops being something you open a separate screen to see.

### Changed

- Depends on `@zanreal/medusa-admin-kit` `^0.2.0`, the release that carries the stock base
  column.
- `pnpm test` runs the same typechecks CI runs, so a green local run means the same thing
  as a green pipeline.

### Fixed

- README states the package is on npm and how to install it from the registry. The
  previous text still told readers it was unpublished, which was the first thing a visitor
  to the npm page read.

## [0.1.0] - 2026-08-26

First public release. MIT, published from CI with npm provenance.

### Added

- **`productCosts` module** tracking purchase cost (COGS) per SKU, with atomic cost and
  history writes, append-only history and numeric DTOs.
- **Margin, break-even price and net income** computed against a selling price, with
  double rounding eliminated from the arithmetic and the admin preview rounding the same
  way the server does.
- **CSV import** whose delimiter tie-break is hardened, so an ambiguous row is reported
  rather than guessed.
- **Variant links** that cascade-delete when stale, plus a resync action.
- **Settings**: VAT rate and default currency persisted and editable.
- **Catalog surface** through `@zanreal/medusa-admin-kit`: one row per variant, with a
  per-product cost-coverage column, and the product page as the primary costing surface.
- Admin UI in English and Polish.

[Unreleased]: https://github.com/zanreal-labs/medusa-product-costs/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/zanreal-labs/medusa-product-costs/releases/tag/v0.2.0
[0.1.0]: https://github.com/zanreal-labs/medusa-product-costs/releases/tag/v0.1.0
