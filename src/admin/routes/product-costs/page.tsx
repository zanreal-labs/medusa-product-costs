import { defineRouteConfig } from "@medusajs/admin-sdk";
import { CurrencyDollar } from "@medusajs/icons";
import { Button, Container, Drawer, Heading, Input, Table, Text } from "@medusajs/ui";
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

/**
 * A read-only cross-product cost overview: search every curated SKU and open
 * its change history. It is a browse-and-audit surface only - editing a single
 * cost happens on that product's detail page (the "Product costs" widget), and
 * bulk CSV import plus the plugin config live under Settings > Product costs.
 */
const ProductCostsPage = () => {
  const [q, setQ] = useState("");
  const [costs, setCosts] = useState<CostPriceDTO[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [historySku, setHistorySku] = useState<string | null>(null);
  const [history, setHistory] = useState<CostPriceHistoryDTO[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

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
    // Initial load only - subsequent loads are triggered explicitly by search,
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

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h1">Product costs</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Browse every curated cost. Edit a cost from its product page; import and settings live
            under Settings.
          </Text>
        </div>
        <Text className="text-ui-fg-subtle" size="small">
          {count} SKUs
        </Text>
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
                  No costs yet - import a CSV from Settings, or set one from a product page.
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
