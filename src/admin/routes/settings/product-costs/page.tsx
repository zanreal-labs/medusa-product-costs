import { defineRouteConfig } from "@medusajs/admin-sdk";
import {
  Alert,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Select,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { sdk } from "../../../lib/sdk";

// i18next interpolation only fires once a translation resource is actually
// loaded; without one (this plugin's own component tests, which render with
// no i18next instance configured) `t(key, defaultValue)` returns
// `defaultValue` verbatim, `{{tokens}}` included. Substituting by hand here
// keeps both paths - translated and untranslated - correct the same way.
const interpolate = (template: string, values: Record<string, string | number>): string =>
  Object.entries(values).reduce(
    (result, [key, value]) => result.split(`{{${key}}}`).join(String(value)),
    template,
  );

interface ConfigResponse {
  /** `null` when no VAT rate is configured anywhere - the plugin ships no default one. */
  vatRate: number | null;
  /** `null` when no currency is configured anywhere - the plugin ships no default one. */
  defaultCurrency: string | null;
  /** Whether `vatRate` above came from a value saved here rather than from the plugin's own options. */
  vatRateOverridden: boolean;
  /** Whether `defaultCurrency` above came from a value saved here rather than from the plugin's own options. */
  defaultCurrencyOverridden: boolean;
}

/**
 * Currencies offered in the dropdown. Not exhaustive, and not a
 * recommendation - just enough common codes that the Select always has
 * something to show. Whatever currency the store is actually configured
 * with is added to this list at render time if it is not already in it (see
 * `currencyOptions` below), so the Select never has to fall back to an
 * empty/placeholder selection for a valid, already-saved value.
 */
const COMMON_CURRENCIES = [
  "EUR",
  "USD",
  "GBP",
  "PLN",
  "CZK",
  "SEK",
  "NOK",
  "DKK",
  "CHF",
  "HUF",
  "RON",
  "BGN",
  "UAH",
];

/**
 * Parse a VAT-rate percentage field ("23" or "23,5") into a fraction
 * (0.23), tolerating a decimal comma the same way the net-cost input does
 * (see `parseInputCost`). Returns `undefined` for anything outside 0..100
 * or unparsable text, so the caller can reject the save instead of
 * persisting a nonsense rate.
 */
function parseVatPercent(raw: string): number | undefined {
  const value = Number.parseFloat(raw.replace(",", "."));
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return undefined;
  }
  // Round to 4 decimal places of the fraction (0.01% precision) so a value
  // like 19% round-trips to exactly 0.19, not a binary-float remainder.
  return Math.round((value / 100) * 10_000) / 10_000;
}

/** The inverse of `parseVatPercent`, for pre-filling the input from a resolved fraction. */
function formatVatPercent(fraction: number): string {
  return String(Math.round(fraction * 10_000) / 100);
}

interface ImportCsvErrorDTO {
  lineNumber: number;
  raw: string;
  reason: string;
}

interface ImportCsvResponse {
  created: number;
  updated: number;
  skipped: number;
  errors: ImportCsvErrorDTO[];
  duplicateSkus: Record<string, number>;
}

interface ResyncLinksResponse {
  changed: number;
  skusChecked: number;
  duplicateSkus: Record<string, number>;
}

const csvPlaceholder = (t: (key: string, defaultValue: string) => string): string =>
  `SKU-1,10.50\nSKU-2,20.00\n# ${t(
    "productCosts.settings.csvPlaceholderNote",
    "also accepts ; as the delimiter and a comma as the decimal separator",
  )}`;

/**
 * Configuration and bulk operations for the product-costs plugin.
 *
 * Per-product costing happens on the product detail page (the "Product costs"
 * widget); this Settings page owns the two things that are genuinely
 * store-wide: the resolved plugin config, and the bulk `sku,cost` CSV import.
 * The variant-link resync is a maintenance action that belongs with them.
 */
const ProductCostsSettingsPage = () => {
  const { t } = useTranslation();
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [vatRateInput, setVatRateInput] = useState("");
  const [currencyInput, setCurrencyInput] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [resettingConfig, setResettingConfig] = useState(false);

  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportCsvResponse | null>(null);

  const [resyncing, setResyncing] = useState(false);

  const applyConfig = (res: ConfigResponse) => {
    setConfig(res);
    // A null here means "not configured anywhere", which is a blank field, not
    // a number or a code to render. Filling something in would be this page
    // inventing the very setting it is asking the operator to choose.
    setVatRateInput(res.vatRate === null ? "" : formatVatPercent(res.vatRate));
    setCurrencyInput(res.defaultCurrency ?? "");
  };

  // Runs once on mount - `applyConfig` is stable across renders (it only
  // reads its argument), so it does not need to be in the dependency list.
  useEffect(() => {
    sdk.client
      .fetch<ConfigResponse>("/admin/product-costs/config")
      .then(applyConfig)
      .catch(() => setConfig(null));
  }, []);

  const currencyOptions = useMemo(() => {
    if (!currencyInput || COMMON_CURRENCIES.includes(currencyInput)) {
      return COMMON_CURRENCIES;
    }
    // The store's already-saved currency isn't in the curated list - add it
    // so the Select shows the real value instead of falling back to a
    // placeholder for a perfectly valid, already-persisted setting.
    return [currencyInput, ...COMMON_CURRENCIES];
  }, [currencyInput]);

  const saveConfig = async () => {
    const vatRate = parseVatPercent(vatRateInput);
    if (vatRate === undefined) {
      toast.error(t("productCosts.settings.vatRateInvalid", "Enter a VAT rate between 0 and 100."));
      return;
    }
    const currency = currencyInput.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      toast.error(t("productCosts.settings.currencyInvalid", "Pick a 3-letter currency code."));
      return;
    }
    setSavingConfig(true);
    try {
      const res = await sdk.client.fetch<ConfigResponse>("/admin/product-costs/config", {
        body: { default_currency: currency, vat_rate: vatRate },
        method: "POST",
      });
      applyConfig(res);
      toast.success(
        t(
          "productCosts.settings.configSaved",
          "Saved. Every gross-cost and margin calculation uses this now - no restart needed.",
        ),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("productCosts.settings.configSaveError", "Could not save the configuration."),
      );
    } finally {
      setSavingConfig(false);
    }
  };

  const resetConfig = async () => {
    setResettingConfig(true);
    try {
      const res = await sdk.client.fetch<ConfigResponse>("/admin/product-costs/config", {
        body: { default_currency: null, vat_rate: null },
        method: "POST",
      });
      applyConfig(res);
      toast.success(
        t(
          "productCosts.settings.configCleared",
          "Cleared. Both settings fall back to whatever this plugin was installed with, and are unset if it was installed with neither.",
        ),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("productCosts.settings.configClearError", "Could not reset the configuration."),
      );
    } finally {
      setResettingConfig(false);
    }
  };

  const hasOverride = Boolean(config?.vatRateOverridden || config?.defaultCurrencyOverridden);

  const onCsvFile = async (file: File) => {
    setCsvText(await file.text());
  };

  const runResyncLinks = async () => {
    setResyncing(true);
    try {
      const res = await sdk.client.fetch<ResyncLinksResponse>("/admin/product-costs/resync-links", {
        method: "POST",
      });
      const duplicateCount = Object.keys(res.duplicateSkus).length;
      toast.success(
        duplicateCount > 0
          ? interpolate(
              t(
                "productCosts.settings.resyncResultWithDuplicates",
                "Resynced {{checked}} SKUs, {{changed}} link(s) updated - {{duplicates}} SKU(s) matched more than one variant",
              ),
              { changed: res.changed, checked: res.skusChecked, duplicates: duplicateCount },
            )
          : interpolate(
              t(
                "productCosts.settings.resyncResult",
                "Resynced {{checked}} SKUs, {{changed}} link(s) updated",
              ),
              { changed: res.changed, checked: res.skusChecked },
            ),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("productCosts.settings.resyncError", "Resync failed"));
    } finally {
      setResyncing(false);
    }
  };

  const runImport = async () => {
    if (!csvText.trim()) {
      toast.error(t("productCosts.settings.csvRequired", "Paste or upload a CSV file first."));
      return;
    }
    setImporting(true);
    setImportResult(null);
    try {
      const res = await sdk.client.fetch<ImportCsvResponse>("/admin/product-costs/import", {
        body: { csv: csvText },
        method: "POST",
      });
      setImportResult(res);
      const duplicateCount = Object.keys(res.duplicateSkus).length;
      toast.success(
        duplicateCount > 0
          ? interpolate(
              t(
                "productCosts.settings.importResultWithDuplicates",
                "Imported: {{created}} created, {{updated}} updated, {{skipped}} skipped, {{errors}} errors - {{duplicates}} SKU(s) matched more than one variant",
              ),
              {
                created: res.created,
                duplicates: duplicateCount,
                errors: res.errors.length,
                skipped: res.skipped,
                updated: res.updated,
              },
            )
          : interpolate(
              t(
                "productCosts.settings.importResult",
                "Imported: {{created}} created, {{updated}} updated, {{skipped}} skipped, {{errors}} errors",
              ),
              {
                created: res.created,
                errors: res.errors.length,
                skipped: res.skipped,
                updated: res.updated,
              },
            ),
      );
      setCsvText("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("productCosts.settings.importError", "Import failed"));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h1">{t("productCosts.settings.heading", "Product costs")}</Heading>
        <Text className="text-ui-fg-subtle" size="small">
          {t(
            "productCosts.settings.subtitle",
            "Plugin configuration and bulk import. Set a single product's cost from its own detail page.",
          )}
        </Text>
      </div>

      <div className="px-6 py-4">
        <div className="mb-2 flex items-center justify-between">
          <Heading level="h2">{t("productCosts.settings.configHeading", "Configuration")}</Heading>
          {hasOverride ? (
            <Button
              disabled={!config}
              isLoading={resettingConfig}
              onClick={resetConfig}
              size="small"
              variant="secondary"
            >
              {t("productCosts.settings.clearSavedValues", "Clear saved values")}
            </Button>
          ) : null}
        </div>
        <Text className="text-ui-fg-subtle mb-3" size="small">
          {t(
            "productCosts.settings.configExplain1",
            "The VAT rate and default currency every gross-cost, margin and break-even figure in this plugin is worked out from. Saving here takes effect immediately, with no backend restart, and wins over whatever the plugin was installed with until you clear it.",
          )}
        </Text>
        <Text className="text-ui-fg-subtle mb-3" size="small">
          {t(
            "productCosts.settings.configExplain2",
            "Neither has a built-in default: this plugin does not know which market you trade in, and a guessed VAT rate or currency would move every figure it shows you without saying so. While either is blank, the calculations that need it refuse instead of returning a number nobody chose. Enter",
          )}{" "}
          <code>0</code>{" "}
          {t("productCosts.settings.configExplain2Suffix", "as the VAT rate if your costs genuinely carry none.")}
        </Text>
        {config && (config.vatRate === null || config.defaultCurrency === null) ? (
          <Alert className="mb-3" variant="warning">
            {config.vatRate === null && config.defaultCurrency === null
              ? t(
                  "productCosts.settings.alertBothMissing",
                  "No VAT rate and no default currency are set yet. Gross cost, margin and break-even cannot be worked out, and a cost saved without an explicit currency is refused, until both are filled in below.",
                )
              : config.vatRate === null
                ? t(
                    "productCosts.settings.alertVatMissing",
                    "No VAT rate is set yet, so gross cost, margin and break-even cannot be worked out. Fill it in below - enter 0 if your costs carry no VAT.",
                  )
                : t(
                    "productCosts.settings.alertCurrencyMissing",
                    "No default currency is set yet, so a cost saved without an explicit currency is refused. Fill it in below.",
                  )}
          </Alert>
        ) : null}
        {config ? (
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
            <div className="flex flex-col gap-y-1">
              <Label htmlFor="product-costs-vat-rate" size="small">
                {t("productCosts.settings.vatRateLabel", "VAT rate (%)")}
              </Label>
              <Input
                autoComplete="off"
                id="product-costs-vat-rate"
                onChange={(event) => setVatRateInput(event.target.value)}
                placeholder={t("productCosts.settings.vatRatePlaceholder", "e.g. 20")}
                value={vatRateInput}
              />
            </div>
            <div className="flex flex-col gap-y-1">
              <Label htmlFor="product-costs-currency" size="small">
                {t("productCosts.settings.currencyLabel", "Default currency")}
              </Label>
              <Select onValueChange={setCurrencyInput} value={currencyInput}>
                <Select.Trigger
                  aria-label={t("productCosts.settings.currencyLabel", "Default currency")}
                  id="product-costs-currency"
                >
                  <Select.Value
                    placeholder={t("productCosts.settings.selectCurrencyPlaceholder", "Select currency")}
                  />
                </Select.Trigger>
                <Select.Content>
                  {currencyOptions.map((code) => (
                    <Select.Item key={code} value={code}>
                      {code}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>
          </div>
        ) : (
          <Text className="text-ui-fg-subtle" size="small">
            {t("productCosts.common.loading", "Loading...")}
          </Text>
        )}
        <div className="mt-4">
          <Button disabled={!config} isLoading={savingConfig} onClick={saveConfig}>
            {t("productCosts.settings.save", "Save")}
          </Button>
        </div>
      </div>

      <div className="px-6 py-4">
        <div className="mb-2 flex items-center justify-between">
          <Heading level="h2">{t("productCosts.settings.csvHeading", "Bulk import (CSV)")}</Heading>
          <Button isLoading={resyncing} onClick={runResyncLinks} size="small" variant="secondary">
            {t("productCosts.settings.resyncButton", "Resync variant links")}
          </Button>
        </div>
        <Text className="text-ui-fg-subtle mb-2" size="small">
          {t(
            "productCosts.settings.csvHelp",
            'Two columns: sku and net cost. A comma or a semicolon both work as the delimiter, and both a period and a comma work as the decimal separator.',
          )}
        </Text>
        <Textarea
          onChange={(event) => setCsvText(event.target.value)}
          placeholder={csvPlaceholder(t)}
          rows={6}
          value={csvText}
        />
        <div className="mt-2 flex items-center gap-2">
          <Button isLoading={importing} onClick={runImport}>
            {t("productCosts.settings.import", "Import")}
          </Button>
          <label className="text-ui-fg-interactive cursor-pointer text-sm">
            {t("productCosts.settings.uploadInstead", "Upload a file instead")}
            <input
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  onCsvFile(file);
                }
              }}
              type="file"
            />
          </label>
        </div>

        {importResult && importResult.errors.length > 0 ? (
          <div className="mt-4">
            <Text className="font-medium" size="small">
              {interpolate(
                t("productCosts.settings.importErrorsHeading", "{{count}} row(s) could not be imported:"),
                { count: importResult.errors.length },
              )}
            </Text>
            <ul className="mt-1 list-disc pl-5">
              {importResult.errors.map((err) => (
                <li key={`${err.lineNumber}-${err.raw}`}>
                  <Text className="text-ui-fg-subtle" size="small">
                    {t("productCosts.settings.importErrorLinePrefix", "Line")} {err.lineNumber}:{" "}
                    {err.reason} ({err.raw})
                  </Text>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Container>
  );
};

export const config = defineRouteConfig({
  label: "Product costs",
});

export default ProductCostsSettingsPage;
