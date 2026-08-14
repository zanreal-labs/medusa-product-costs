import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { PRODUCT_COSTS_MODULE } from "../../../../modules/product-costs";
import type ProductCostsModuleService from "../../../../modules/product-costs/service";
import type { ProductCostsSettingsPatch } from "../../../../modules/product-costs/types";
import { updateProductCostsSettingsWorkflow } from "../../../../workflows/update-product-costs-settings";

/** ISO-4217 currency codes are always 3 letters; normalize case before checking. */
const CURRENCY_CODE_RE = /^[A-Z]{3}$/;
/** VAT rate is a fraction (0.23 = 23%). A sane ceiling against a fat-fingered value, not a real business limit. */
const MAX_VAT_RATE = 1;

/** The columns an admin write may set, mapped for a fast membership test against typos. */
const WRITABLE_KEYS = new Set(["vat_rate", "default_currency"]);

/**
 * GET /admin/product-costs/config
 *
 * The RESOLVED configuration (`vatRate`, `defaultCurrency`) the rest of the
 * plugin actually computes with: a value saved from this same Settings page
 * when one exists, falling back to the plugin's own options otherwise. The
 * admin UI (this page and the product detail widget) uses this to compute a
 * gross-cost preview that always matches what the server itself would compute.
 *
 * Either field can be `null`, meaning "configured nowhere". This plugin ships
 * no default VAT rate and no default currency, so `null` must reach the UI
 * intact: it is what tells the Settings page to render a blank field and a
 * warning instead of a number nobody chose.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const service: ProductCostsModuleService = req.scope.resolve(PRODUCT_COSTS_MODULE);
  const resolved = await service.getResolvedOptions();
  const settings = await service.getSettings();
  res.json({
    defaultCurrency: resolved.defaultCurrency,
    defaultCurrencyOverridden: settings.default_currency !== null,
    vatRate: resolved.vatRate,
    vatRateOverridden: settings.vat_rate !== null,
  });
}

interface ConfigPatchBody {
  vat_rate?: unknown;
  default_currency?: unknown;
}

/**
 * POST /admin/product-costs/config
 *
 * Persists an override for one or both settings: `{ vat_rate?, default_currency? }`.
 * Only the keys present in the body are written, so saving the VAT rate
 * never disturbs a previously-saved currency (and vice versa). Passing a key
 * as `null` explicitly clears that override back to the plugin's own option -
 * a real, intended action, not the same thing as omitting the key. When the
 * plugin was installed without that option either, clearing it leaves the
 * setting genuinely unset, and the operations needing it refuse.
 *
 * Once saved, every runtime computation that reads VAT rate or currency
 * (`computeEconomics`, the default currency on a new `CostPrice`) picks up
 * the change on its very next call - no backend restart needed.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const service: ProductCostsModuleService = req.scope.resolve(PRODUCT_COSTS_MODULE);
  const body = (req.body ?? {}) as ConfigPatchBody & Record<string, unknown>;

  for (const key of Object.keys(body)) {
    if (!WRITABLE_KEYS.has(key)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Unknown setting \`${key}\`. Writable settings: ${[...WRITABLE_KEYS].join(", ")}.`,
      );
    }
  }

  if (Object.keys(body).length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Provide at least one setting to update: ${[...WRITABLE_KEYS].join(", ")}.`,
    );
  }

  const patch: ProductCostsSettingsPatch = {};

  if ("vat_rate" in body) {
    if (body.vat_rate === null) {
      patch.vat_rate = null;
    } else if (
      typeof body.vat_rate !== "number" ||
      !Number.isFinite(body.vat_rate) ||
      body.vat_rate < 0 ||
      body.vat_rate > MAX_VAT_RATE
    ) {
      res.status(400).json({
        message: `vat_rate must be a number between 0 and ${MAX_VAT_RATE} (a fraction, e.g. 0.23 for 23%), or null to clear the override`,
      });
      return;
    } else {
      patch.vat_rate = body.vat_rate;
    }
  }

  if ("default_currency" in body) {
    if (body.default_currency === null) {
      patch.default_currency = null;
    } else if (typeof body.default_currency !== "string" || !body.default_currency.trim()) {
      res.status(400).json({
        message: "default_currency must be a non-empty string, or null to clear the override",
      });
      return;
    } else {
      const normalized = body.default_currency.trim().toUpperCase();
      if (!CURRENCY_CODE_RE.test(normalized)) {
        res.status(400).json({
          message: "default_currency must be a 3-letter ISO-4217 code",
        });
        return;
      }
      patch.default_currency = normalized;
    }
  }

  const { result: settings } = await updateProductCostsSettingsWorkflow(req.scope).run({
    input: patch,
  });
  res.json({
    defaultCurrency: settings.default_currency ?? service.moduleOptions.defaultCurrency,
    defaultCurrencyOverridden: settings.default_currency !== null,
    vatRate: settings.vat_rate ?? service.moduleOptions.vatRate,
    vatRateOverridden: settings.vat_rate !== null,
  });
}
