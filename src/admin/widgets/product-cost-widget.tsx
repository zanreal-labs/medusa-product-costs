import { defineWidgetConfig } from "@medusajs/admin-sdk";
import type { AdminProduct, DetailWidgetProps } from "@medusajs/framework/types";
import { Button, Container, Heading, Input, Table, Text, toast } from "@medusajs/ui";
import { useEffect, useMemo, useState } from "react";
import { sdk } from "../lib/sdk";

interface ConfigResponse {
  vatRate: number;
  defaultCurrency: string;
}

interface CostPriceDTO {
  sku: string;
  unit_cost_net: number;
  currency: string;
}

interface CostRow {
  variantId: string;
  variantTitle: string;
  sku: string;
  /** String-bound to the input; parsed on save. */
  unitCostNet: string;
  currency: string;
  saving: boolean;
}

function parseInputCost(raw: string): number | undefined {
  const value = Number.parseFloat(raw.replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Shows every variant of the current product with an editable net cost and
 * a live gross-cost preview (net cost grossed up by the plugin's configured
 * VAT rate). Saving a row calls the same admin API the CSV importer and the
 * "Product costs" page use, so all three stay consistent.
 */
const ProductCostWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const variants = data.variants ?? [];
  const skus = useMemo(
    () => [
      ...new Set(
        variants.map((variant) => variant.sku).filter((sku): sku is string => Boolean(sku)),
      ),
    ],
    [variants],
  );

  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [rows, setRows] = useState<CostRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const [configRes, costsRes] = await Promise.all([
        sdk.client.fetch<ConfigResponse>("/admin/product-costs/config"),
        skus.length > 0
          ? sdk.client.fetch<{ cost_prices: CostPriceDTO[] }>("/admin/product-costs", {
              query: { limit: skus.length, sku: skus },
            })
          : Promise.resolve({ cost_prices: [] as CostPriceDTO[] }),
      ]);

      if (cancelled) {
        return;
      }

      const bySku = new Map(costsRes.cost_prices.map((costPrice) => [costPrice.sku, costPrice]));

      setConfig(configRes);
      setRows(
        variants.map((variant) => {
          const existing = variant.sku ? bySku.get(variant.sku) : undefined;
          return {
            currency: existing?.currency ?? configRes.defaultCurrency,
            saving: false,
            sku: variant.sku ?? "",
            unitCostNet: existing ? String(existing.unit_cost_net) : "",
            variantId: variant.id,
            variantTitle: variant.title ?? variant.sku ?? variant.id,
          };
        }),
      );
      setLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
    // Re-run only when the product (and therefore its variant set) changes -
    // `variants` and `skus` are derived from `data` on every render.
  }, [data.id]);

  const updateRow = (variantId: string, value: string) => {
    setRows((prev) =>
      prev.map((row) => (row.variantId === variantId ? { ...row, unitCostNet: value } : row)),
    );
  };

  const save = async (row: CostRow) => {
    if (!row.sku) {
      toast.error("This variant has no SKU - add one before setting a cost.");
      return;
    }
    const unitCostNet = parseInputCost(row.unitCostNet);
    if (unitCostNet === undefined) {
      toast.error("Enter a positive net cost.");
      return;
    }

    setRows((prev) =>
      prev.map((r) => (r.variantId === row.variantId ? { ...r, saving: true } : r)),
    );

    try {
      const res = await sdk.client.fetch<{ cost_price: CostPriceDTO }>("/admin/product-costs", {
        body: { sku: row.sku, unit_cost_net: unitCostNet },
        method: "POST",
      });
      setRows((prev) =>
        prev.map((r) =>
          r.variantId === row.variantId
            ? {
                ...r,
                currency: res.cost_price.currency,
                saving: false,
                unitCostNet: String(res.cost_price.unit_cost_net),
              }
            : r,
        ),
      );
      toast.success(`Saved cost for ${row.sku}`);
    } catch (error) {
      setRows((prev) =>
        prev.map((r) => (r.variantId === row.variantId ? { ...r, saving: false } : r)),
      );
      toast.error(error instanceof Error ? error.message : "Failed to save cost");
    }
  };

  const grossCostPreview = (row: CostRow): string | null => {
    const unitCostNet = parseInputCost(row.unitCostNet);
    if (!config || unitCostNet === undefined) {
      return null;
    }
    return (unitCostNet * (1 + config.vatRate)).toFixed(2);
  };

  if (variants.length === 0) {
    return null;
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Product costs</Heading>
        {config && (
          <Text className="text-ui-fg-subtle" size="small">
            VAT {Math.round(config.vatRate * 100)}%
          </Text>
        )}
      </div>
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Variant</Table.HeaderCell>
            <Table.HeaderCell>SKU</Table.HeaderCell>
            <Table.HeaderCell>Net cost</Table.HeaderCell>
            <Table.HeaderCell>Gross cost</Table.HeaderCell>
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
            </Table.Row>
          ) : (
            rows.map((row) => (
              <Table.Row key={row.variantId}>
                <Table.Cell>{row.variantTitle}</Table.Cell>
                <Table.Cell>
                  {row.sku || <Text className="text-ui-fg-muted">no sku</Text>}
                </Table.Cell>
                <Table.Cell>
                  <Input
                    onChange={(event) => updateRow(row.variantId, event.target.value)}
                    placeholder="0.00"
                    size="small"
                    value={row.unitCostNet}
                  />
                </Table.Cell>
                <Table.Cell>
                  <Text size="small">
                    {grossCostPreview(row) ?? "-"} {row.currency}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Button
                    isLoading={row.saving}
                    onClick={() => save(row)}
                    size="small"
                    variant="secondary"
                  >
                    Save
                  </Button>
                </Table.Cell>
              </Table.Row>
            ))
          )}
        </Table.Body>
      </Table>
    </Container>
  );
};

export const config = defineWidgetConfig({
  zone: "product.details.after",
});

export default ProductCostWidget;
