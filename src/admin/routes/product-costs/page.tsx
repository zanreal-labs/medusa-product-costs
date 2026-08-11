import { defineRouteConfig } from "@medusajs/admin-sdk";
import { CurrencyDollar } from "@medusajs/icons";
import {
  Button,
  Container,
  Drawer,
  Heading,
  Input,
  Table,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { sdk } from "../../lib/sdk";

interface CostPriceDTO {
  id: string;
  sku: string;
  variant_id: string | null;
  unit_cost_net: number;
  currency: string;
  source: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

interface CostPriceHistoryDTO {
  id: string;
  sku: string;
  unit_cost_net: number;
  currency: string;
  source: string;
  changed_by: string | null;
  changed_at: string;
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
 * Full cost list: search by SKU, bulk CSV import, and a per-row history
 * drawer. Editing a single row's cost is done from the product detail
 * widget - this page is for bulk operations and audit, not row editing.
 */
const ProductCostsPage = () => {
  const [q, setQ] = useState("");
  const [costs, setCosts] = useState<CostPriceDTO[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [historySku, setHistorySku] = useState<string | null>(null);
  const [history, setHistory] = useState<CostPriceHistoryDTO[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportCsvResponse | null>(null);

  const [resyncing, setResyncing] = useState(false);

  const loadCosts = async (search: string) => {
    setLoading(true);
    try {
      const res = await sdk.client.fetch<{ cost_prices: CostPriceDTO[]; count: number }>(
        "/admin/product-costs",
        { query: { limit: 200, q: search || undefined } },
      );
      setCosts(res.cost_prices);
      setCount(res.count);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial load only - subsequent loads are triggered explicitly by search/import,
    // so `loadCosts` is intentionally not in the dependency list.
    loadCosts("");
  }, []);

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    loadCosts(q);
  };

  const openHistory = async (sku: string) => {
    setHistorySku(sku);
    setHistoryLoading(true);
    try {
      const res = await sdk.client.fetch<{ history: CostPriceHistoryDTO[] }>(
        `/admin/product-costs/${encodeURIComponent(sku)}/history`,
      );
      setHistory(res.history);
    } finally {
      setHistoryLoading(false);
    }
  };

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
      await loadCosts(q);
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
          duplicateCount > 0 ? ` - ${duplicateCount} SKU(s) matched more than one variant` : ""}`,
      );
      setCsvText("");
      await loadCosts(q);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h1">Product costs</Heading>
        <div className="flex items-center gap-4">
          <Text className="text-ui-fg-subtle" size="small">
            {count} SKUs
          </Text>
          <Button isLoading={resyncing} onClick={runResyncLinks} size="small" variant="secondary">
            Resync links
          </Button>
        </div>
      </div>

      <div className="px-6 py-4">
        <form className="flex max-w-md gap-2" onSubmit={onSearch}>
          <Input
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search by SKU"
            value={q}
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
      </div>

      <div className="px-6 py-4">
        <Heading className="mb-2" level="h2">
          Bulk import (CSV)
        </Heading>
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

        {importResult && importResult.errors.length > 0 && (
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
        )}
      </div>

      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>SKU</Table.HeaderCell>
            <Table.HeaderCell>Net cost</Table.HeaderCell>
            <Table.HeaderCell>Currency</Table.HeaderCell>
            <Table.HeaderCell>Source</Table.HeaderCell>
            <Table.HeaderCell>Variant linked</Table.HeaderCell>
            <Table.HeaderCell>Updated</Table.HeaderCell>
            <Table.HeaderCell />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {loading ? (
            <Table.Row>
              <Table.Cell>
                <Text size="small">Loading...</Text>
              </Table.Cell>
              <Table.Cell />
              <Table.Cell />
              <Table.Cell />
              <Table.Cell />
              <Table.Cell />
              <Table.Cell />
            </Table.Row>
          ) : (costs.length === 0 ? (
            <Table.Row>
              <Table.Cell>
                <Text size="small">
                  No costs yet - import a CSV or set one from a product page.
                </Text>
              </Table.Cell>
              <Table.Cell />
              <Table.Cell />
              <Table.Cell />
              <Table.Cell />
              <Table.Cell />
              <Table.Cell />
            </Table.Row>
          ) : (
            costs.map((cost) => (
              <Table.Row key={cost.id}>
                <Table.Cell>{cost.sku}</Table.Cell>
                <Table.Cell>{cost.unit_cost_net}</Table.Cell>
                <Table.Cell>{cost.currency}</Table.Cell>
                <Table.Cell>{cost.source}</Table.Cell>
                <Table.Cell>{cost.variant_id ? "Yes" : "No"}</Table.Cell>
                <Table.Cell>{new Date(cost.updated_at).toLocaleString()}</Table.Cell>
                <Table.Cell>
                  <Button onClick={() => openHistory(cost.sku)} size="small" variant="transparent">
                    History
                  </Button>
                </Table.Cell>
              </Table.Row>
            ))
          ))}
        </Table.Body>
      </Table>

      <Drawer onOpenChange={(open) => !open && setHistorySku(null)} open={historySku !== null}>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>History for {historySku}</Drawer.Title>
          </Drawer.Header>
          <Drawer.Body>
            {historyLoading ? (
              <Text size="small">Loading...</Text>
            ) : (history.length === 0 ? (
              <Text size="small">No history recorded yet.</Text>
            ) : (
              <Table>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Cost</Table.HeaderCell>
                    <Table.HeaderCell>Source</Table.HeaderCell>
                    <Table.HeaderCell>Changed by</Table.HeaderCell>
                    <Table.HeaderCell>Changed at</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {history.map((entry) => (
                    <Table.Row key={entry.id}>
                      <Table.Cell>
                        {entry.unit_cost_net} {entry.currency}
                      </Table.Cell>
                      <Table.Cell>{entry.source}</Table.Cell>
                      <Table.Cell>{entry.changed_by ?? "-"}</Table.Cell>
                      <Table.Cell>{new Date(entry.changed_at).toLocaleString()}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            ))}
          </Drawer.Body>
        </Drawer.Content>
      </Drawer>
    </Container>
  );
};

export const config = defineRouteConfig({
  icon: CurrencyDollar,
  label: "Product costs",
});

export default ProductCostsPage;
