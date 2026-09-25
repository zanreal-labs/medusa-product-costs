import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { PRODUCT_COSTS_MODULE } from "../modules/product-costs";
import type ProductCostsModuleService from "../modules/product-costs/service";

/**
 * Where the currency a cost gets stored in actually came from. Carried all
 * the way to the admin on purpose: a currency the operator never typed must
 * never look like one they did.
 *
 * - `settings` - saved under Settings > Product costs.
 * - `plugin` - the `defaultCurrency` option in `medusa-config.ts`.
 * - `store` - the currency marked `is_default` in Medusa's own Store settings.
 * - `null` - configured nowhere; the operations that need a currency refuse.
 */
export type CurrencySource = "settings" | "plugin" | "store" | null;

export interface EffectiveCurrency {
  currency: string | null;
  source: CurrencySource;
}

/** The shape of the container this module needs. Keeps the helper testable with a plain object. */
interface ResolvingContainer {
  resolve: <T = unknown>(key: string, options?: { allowUnregistered?: boolean }) => T;
}

interface SupportedCurrencyRow {
  currency_code?: string | null;
  is_default?: boolean | null;
}

interface StoreRow {
  supported_currencies?: SupportedCurrencyRow[] | null;
}

interface StoreQuery {
  graph: (config: { entity: string; fields: string[] }) => Promise<{ data?: StoreRow[] | null }>;
}

/** Every currency Medusa's Store settings list, and which one of them is marked default. */
export interface StoreCurrencies {
  /** The currency marked `is_default`, uppercased, or `null` when none is. */
  defaultCurrency: string | null;
  /** Every supported currency, uppercased and deduplicated, in the store's own order. */
  supported: string[];
}

const NO_STORE_CURRENCIES: StoreCurrencies = { defaultCurrency: null, supported: [] };

/**
 * The currencies Medusa's Store settings list, uppercased, or an empty answer
 * when there is no store or no Query registered in this container at all.
 *
 * Never throws. This is consulted on read paths that must keep working (the
 * settings screen, a cost upsert); a store lookup that fails is the same
 * situation as a store that lists no currencies, and both end in the plugin
 * falling back to its own settings rather than in a 500.
 */
export async function resolveStoreCurrencies(
  container: ResolvingContainer,
): Promise<StoreCurrencies> {
  try {
    const query = container.resolve<StoreQuery | undefined>(ContainerRegistrationKeys.QUERY, {
      allowUnregistered: true,
    });
    if (!query?.graph) {
      return NO_STORE_CURRENCIES;
    }
    const { data } = await query.graph({
      entity: "store",
      fields: ["supported_currencies.currency_code", "supported_currencies.is_default"],
    });
    // One store is the norm; when several exist, the first one wins, matching
    // how Medusa's own admin treats the store singleton.
    const rows = data?.[0]?.supported_currencies ?? [];
    const supported: string[] = [];
    let defaultCurrency: string | null = null;
    for (const row of rows) {
      const code = row?.currency_code?.trim().toUpperCase();
      if (!code) {
        continue;
      }
      if (!supported.includes(code)) {
        supported.push(code);
      }
      if (row?.is_default === true && defaultCurrency === null) {
        defaultCurrency = code;
      }
    }
    return { defaultCurrency, supported };
  } catch {
    return NO_STORE_CURRENCIES;
  }
}

/**
 * The currency marked `is_default` in Medusa's Store settings, uppercased,
 * or `null` when there is no store, no default among its supported
 * currencies, or no Query registered in this container at all. Never throws;
 * see `resolveStoreCurrencies`.
 */
export async function resolveStoreDefaultCurrency(
  container: ResolvingContainer,
): Promise<string | null> {
  return (await resolveStoreCurrencies(container)).defaultCurrency;
}

/**
 * The currency a cost is recorded in when the caller does not name one, and
 * where that currency came from.
 *
 * Precedence, strongest first:
 *
 * 1. the override saved under Settings > Product costs,
 * 2. the `defaultCurrency` plugin option in `medusa-config.ts`,
 * 3. the store's own default currency.
 *
 * The store sits last, and that ordering is the whole point. The first two
 * are statements about *costs* - somebody chose them knowing what this plugin
 * stores. The store's default currency answers a different question, what the
 * shop sells in, and for any store that buys abroad and sells at home the two
 * differ. Using it is much better than refusing to save anything, but it is
 * still an inference, which is why `source` travels with it and the settings
 * screen says out loud when a currency came from there. A silent fallback
 * here would relabel every purchase invoice in the store's selling currency
 * and leave nothing on screen to reveal it.
 */
export async function resolveEffectiveCurrency(
  container: ResolvingContainer,
): Promise<EffectiveCurrency> {
  const service = container.resolve<ProductCostsModuleService>(PRODUCT_COSTS_MODULE);
  const settings = await service.getSettings();
  if (settings.default_currency) {
    return { currency: settings.default_currency, source: "settings" };
  }
  const fromPlugin = service.moduleOptions.defaultCurrency;
  if (fromPlugin) {
    return { currency: fromPlugin, source: "plugin" };
  }
  const fromStore = await resolveStoreDefaultCurrency(container);
  return fromStore ? { currency: fromStore, source: "store" } : { currency: null, source: null };
}
