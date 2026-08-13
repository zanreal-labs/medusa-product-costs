import { defineRouteConfig } from "@medusajs/admin-sdk";
import {
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
import { sdk } from "../../../lib/sdk";

interface ConfigResponse {
  vatRate: number;
  defaultCurrency: string;
  /** Whether `vatRate` above came from a persisted override, not the `medusa-config.ts` default. */
  vatRateOverridden: boolean;
  /** Whether `defaultCurrency` above came from a persisted override, not the `medusa-config.ts` default. */
  defaultCurrencyOverridden: boolean;
}

/**
 * Currencies offered in the dropdown. Not exhaustive - just the common ones
 * around the market this plugin was built for - so the Select always has
 * something to show. Whatever currency the store is actually configured
 * with is added to this list at render time if it is not already in it (see
 * `currencyOptions` below), so the Select never has to fall back to an
 * empty/placeholder selection for a valid, already-saved value.
 */
const COMMON_CURRENCIES = [
  "PLN",
  "EUR",
  "USD",
  "GBP",
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

const CSV_PLACEHOLDER =
  "SKU-1,10.50\nSKU-2,20.00\n# also accepts ; as a delimiter and 20,00 as a decimal comma";

/**
 * Configuration and bulk operations for the product-costs plugin.
 *
 * Per-product costing happens on the product detail page (the "Product costs"
 * widget); this Settings page owns the two things that are genuinely
 * store-wide: the resolved plugin config, and the bulk `sku,cost` CSV import.
 * The variant-link resync is a maintenance action that belongs with them.
 */
const ProductCostsSettingsPage = () => {
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
    setVatRateInput(formatVatPercent(res.vatRate));
    setCurrencyInput(res.defaultCurrency);
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
      toast.error("Enter a VAT rate between 0 and 100.");
      return;
    }
    const currency = currencyInput.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      toast.error('Enter a 3-letter currency code, e.g. "PLN".');
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
        "Saved. Every gross-cost and margin calculation uses this now - no restart needed.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the configuration.");
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
      toast.success("Reset to the medusa-config.ts default.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reset the configuration.");
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
          ? `Resynced ${res.skusChecked} SKUs, ${res.changed} link(s) updated - ${duplicateCount} SKU(s) matched more than one variant`
          : `Resynced ${res.skusChecked} SKUs, ${res.changed} link(s) updated`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Resync failed");
    } finally {
      setResyncing(false);
    }
  };

  const runImport = async () => {
    if (!csvText.trim()) {
      toast.error("Paste or upload a CSV file first.");
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
        `Imported: ${res.created} created, ${res.updated} updated, ${res.skipped} skipped, ${res.errors.length} errors${
          duplicateCount > 0 ? ` - ${duplicateCount} SKU(s) matched more than one variant` : ""
        }`,
      );
      setCsvText("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h1">Product costs</Heading>
        <Text className="text-ui-fg-subtle" size="small">
          Plugin configuration and bulk import. Set a single product's cost from its own detail
          page.
        </Text>
      </div>

      <div className="px-6 py-4">
        <div className="mb-2 flex items-center justify-between">
          <Heading level="h2">Configuration</Heading>
          {hasOverride ? (
            <Button
              disabled={!config}
              isLoading={resettingConfig}
              onClick={resetConfig}
              size="small"
              variant="secondary"
            >
              Reset to plugin default
            </Button>
          ) : null}
        </div>
        <Text className="text-ui-fg-subtle mb-3" size="small">
          The VAT rate and default currency every gross-cost and margin calculation in this plugin
          uses. Saving here takes effect immediately, with no backend restart - it overrides the
          <code> vatRate</code>/<code>defaultCurrency</code> options in{" "}
          <code>medusa-config.ts</code> until you reset it.
        </Text>
        {config ? (
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
            <div className="flex flex-col gap-y-1">
              <Label htmlFor="product-costs-vat-rate" size="small">
                VAT rate (%)
              </Label>
              <Input
                autoComplete="off"
                id="product-costs-vat-rate"
                onChange={(event) => setVatRateInput(event.target.value)}
                placeholder="23"
                value={vatRateInput}
              />
            </div>
            <div className="flex flex-col gap-y-1">
              <Label htmlFor="product-costs-currency" size="small">
                Default currency
              </Label>
              <Select onValueChange={setCurrencyInput} value={currencyInput}>
                <Select.Trigger aria-label="Default currency" id="product-costs-currency">
                  <Select.Value placeholder="Select currency" />
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
            Loading...
          </Text>
        )}
        <div className="mt-4">
          <Button disabled={!config} isLoading={savingConfig} onClick={saveConfig}>
            Save
          </Button>
        </div>
      </div>

      <div className="px-6 py-4">
        <div className="mb-2 flex items-center justify-between">
          <Heading level="h2">Bulk import (CSV)</Heading>
          <Button isLoading={resyncing} onClick={runResyncLinks} size="small" variant="secondary">
            Resync variant links
          </Button>
        </div>
        <Text className="text-ui-fg-subtle mb-2" size="small">
          Two columns, sku and net cost. Quotes, a ";" delimiter, and decimal commas are all
          accepted - see the README for the exact format.
        </Text>
        <Textarea
          onChange={(event) => setCsvText(event.target.value)}
          placeholder={CSV_PLACEHOLDER}
          rows={6}
          value={csvText}
        />
        <div className="mt-2 flex items-center gap-2">
          <Button isLoading={importing} onClick={runImport}>
            Import
          </Button>
          <label className="text-ui-fg-interactive cursor-pointer text-sm">
            Upload a file instead
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
              {importResult.errors.length} row(s) could not be imported:
            </Text>
            <ul className="mt-1 list-disc pl-5">
              {importResult.errors.map((err) => (
                <li key={`${err.lineNumber}-${err.raw}`}>
                  <Text className="text-ui-fg-subtle" size="small">
                    Line {err.lineNumber}: {err.reason} ({err.raw})
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
