import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Button, Container, Heading, Text, Textarea, toast } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { sdk } from "../../../lib/sdk";

interface ConfigResponse {
  vatRate: number;
  defaultCurrency: string;
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

  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportCsvResponse | null>(null);

  const [resyncing, setResyncing] = useState(false);

  useEffect(() => {
    sdk.client
      .fetch<ConfigResponse>("/admin/product-costs/config")
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

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
        <Heading className="mb-2" level="h2">
          Configuration
        </Heading>
        <Text className="text-ui-fg-subtle mb-3" size="small">
          Resolved from the plugin options in <code>medusa-config.ts</code>. Change them there and
          restart the backend.
        </Text>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
          <div>
            <dt className="text-ui-fg-muted txt-compact-small">VAT rate</dt>
            <dd className="txt-compact-small">
              {config ? `${Math.round(config.vatRate * 100)}%` : "loading..."}
            </dd>
          </div>
          <div>
            <dt className="text-ui-fg-muted txt-compact-small">Default currency</dt>
            <dd className="txt-compact-small">{config ? config.defaultCurrency : "loading..."}</dd>
          </div>
        </dl>
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
