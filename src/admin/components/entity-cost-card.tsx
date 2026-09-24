
import {
  Badge,
  Button,
  Container,
  Drawer,
  Heading,
  Input,
  Table,
  Text,
  toast,
} from "@medusajs/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { computeEconomics } from "../../modules/product-costs/lib/economics";
import { grossFromNet } from "../../modules/product-costs/lib/money";

const interpolate = (template: string, values: Record<string, string | number>): string =>
  Object.entries(values).reduce(
    (result, [key, value]) => result.split(`{{${key}}}`).join(String(value)),
    template,
  );

function parseInputCost(raw: string): number | undefined {
  const value = Number.parseFloat(raw.replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function authHeaders(): Record<string, string> {
  try {
    const token = localStorage.getItem("medusa_auth_token");
    if (token) return { Authorization: `Bearer ${token}` };
  } catch {}
  return {};
}

async function apiFetch<T>(
  path: string,
  init: RequestInit & { query?: Record<string, string> } = {},
): Promise<T> {
  const { query, ...rest } = init;
  const url = query ? `${path}?${new URLSearchParams(query)}` : path;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...((rest.headers as Record<string, string>) ?? {}),
    ...authHeaders(),
  };
  const body =
    rest.body != null
      ? typeof rest.body === "string"
        ? rest.body
        : JSON.stringify(rest.body)
      : undefined;
  if (body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { ...rest, headers, credentials: "include", body });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.json() as Promise<T>;
}

interface CostPriceRow {
  id: string;
  sku: string;
  unit_cost_net: number;
  currency: string;
  updated_at: string;
}

interface HistoryRow {
  id: string;
  unit_cost_net: number;
  currency: string;
  source: string;
  changed_by: string | null;
  changed_at: string;
}

interface CostsResponse {
  cost_prices: CostPriceRow[];
}

interface ConfigResponse {
  vatRate: number | null;
  defaultCurrency: string | null;
}

interface HistoryResponse {
  history: HistoryRow[];
  count: number;
}

interface PriceEntry {
  currency_code: string;
  amount: number;
  rules?: Record<string, string>;
}

interface EntityCostCardProps {
  entityId: string;
  prices?: PriceEntry[] | null;
}

/**
 * Self-contained cost card for custom entity detail pages.
 * Pass the entity ID as `entityId` — it is used directly as the cost SKU.
 * Pass the entity's `price_set.prices` as `prices` to enable margin calculation.
 * Use it for custom product entities, with the plugin to be configured with `skipVariantLinking: true`.
 */
const EntityCostCard = ({ entityId, prices }: EntityCostCardProps) => {
  const { t } = useTranslation();
  const [cost, setCost] = useState<CostPriceRow | null | undefined>(undefined);
  const [currency, setCurrency] = useState<string>("—");
  const [vatRate, setVatRate] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [saving, setSaving] = useState(false);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const load = async () => {
    try {
      const [costRes, configRes] = await Promise.all([
        apiFetch<CostsResponse>("/admin/product-costs", {
          method: "GET",
          query: { sku: entityId },
        }),
        apiFetch<ConfigResponse>("/admin/product-costs/config", {
          method: "GET",
        }),
      ]);
      const existing = costRes.cost_prices?.[0] ?? null;
      setCost(existing);
      if (configRes.vatRate !== null) setVatRate(configRes.vatRate);
      if (configRes.defaultCurrency) setCurrency(configRes.defaultCurrency);
      if (existing) setCurrency(existing.currency);
    } catch {
      setCost(null);
    }
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await apiFetch<HistoryResponse>(
        `/admin/product-costs/${encodeURIComponent(entityId)}/history`,
        { method: "GET" },
      );
      setHistory(res.history ?? []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [entityId]);

  // Base price (no region rule) matching the cost currency
  const srp = prices?.find(
    (p) => p.currency_code.toUpperCase() === currency.toUpperCase() && !p.rules?.region_id,
  )?.amount;

  const netCost = cost?.unit_cost_net;
  const economics =
    vatRate !== null
      ? computeEconomics({ netCost, sellingPrice: srp, vatRate })
      : ({} as ReturnType<typeof computeEconomics>);
  const { grossCost, netIncome } = economics;
  const marginPct = economics.marginPct !== undefined ? economics.marginPct * 100 : undefined;

  const handleOpenHistory = () => {
    setHistoryOpen(true);
    loadHistory();
  };

  const handleEdit = () => {
    setInputValue(cost ? String(cost.unit_cost_net) : "");
    setEditing(true);
  };

  const handleCancel = () => {
    setEditing(false);
    setInputValue("");
  };

  const handleSave = async () => {
    const parsed = parseInputCost(inputValue);
    if (!parsed) {
      toast.error(t("productCosts.entityCard.invalidCostError", "Enter a valid positive cost"));
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/admin/product-costs", {
        method: "POST",
        body: JSON.stringify({ sku: entityId, unit_cost_net: parsed, source: "manual" }),
      });
      toast.success(t("productCosts.entityCard.savedCost", "Cost saved"));
      setEditing(false);
      setInputValue("");
      await load();
    } catch (err: unknown) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("productCosts.entityCard.saveError", "Failed to save cost"),
      );
    } finally {
      setSaving(false);
    }
  };

  const isLoading = cost === undefined;

  // Live gross preview while editing
  const previewGross = (() => {
    if (!editing || vatRate === null) return undefined;
    const v = parseInputCost(inputValue);
    return v !== undefined ? grossFromNet(v, vatRate) : undefined;
  })();

  const vatLabel =
    vatRate !== null
      ? interpolate(t("productCosts.entityCard.vatPercent", "VAT {{percent}}%"), {
          percent: Math.round(vatRate * 100),
        })
      : t("productCosts.entityCard.vatNotSet", "VAT not set");

  const marginColor =
    marginPct === undefined ? "grey" : marginPct >= 0 ? "green" : "red";

  return (
    <>
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex flex-col gap-y-0.5">
            <Heading level="h2" className="text-ui-fg-base">
              {t("productCosts.entityCard.heading", "Cost")}
            </Heading>
            {vatRate !== null && (
              <Text className="text-ui-fg-subtle text-xs">{vatLabel} · {currency}</Text>
            )}
          </div>
          {!isLoading && !editing && (
            <div className="flex items-center gap-x-2">
              <Button variant="transparent" size="small" onClick={handleOpenHistory}>
                {t("productCosts.entityCard.historyButton", "History")}
              </Button>
              <Button variant="secondary" size="small" onClick={handleEdit}>
                {cost
                  ? t("productCosts.entityCard.editButton", "Edit")
                  : t("productCosts.entityCard.setCostButton", "Set cost")}
              </Button>
            </div>
          )}
        </div>

        {isLoading && (
          <div className="px-6 py-4">
            <Text className="text-ui-fg-subtle text-sm">{t("productCosts.common.loading", "Loading...")}</Text>
          </div>
        )}

        {!isLoading && !editing && !cost && (
          <div className="px-6 py-4">
            <Text className="text-ui-fg-subtle text-sm">{t("productCosts.entityCard.noCostSet", "No cost set")}</Text>
          </div>
        )}

        {!isLoading && !editing && cost && (
          <>
            <div className="flex items-center justify-between px-6 py-3">
              <Text className="text-ui-fg-subtle text-sm">{t("productCosts.entityCard.netCost", "Net cost")}</Text>
              <div className="flex items-center gap-x-2">
                <Text className="text-ui-fg-base text-sm font-medium">
                  {cost.unit_cost_net.toFixed(2)}
                </Text>
                <Badge size="2xsmall" color="grey">
                  {cost.currency}
                </Badge>
              </div>
            </div>

            {grossCost !== undefined && (
              <div className="flex items-center justify-between px-6 py-3">
                <Text className="text-ui-fg-subtle text-sm">{t("productCosts.entityCard.grossCost", "Gross (break-even)")}</Text>
                <div className="flex items-center gap-x-2">
                  <Text className="text-ui-fg-base text-sm font-medium">
                    {grossCost.toFixed(2)}
                  </Text>
                  <Badge size="2xsmall" color="grey">
                    {cost.currency}
                  </Badge>
                </div>
              </div>
            )}

            {srp !== undefined && (
              <div className="flex items-center justify-between px-6 py-3">
                <Text className="text-ui-fg-subtle text-sm">{t("productCosts.entityCard.sellPrice", "Sell price")}</Text>
                <div className="flex items-center gap-x-2">
                  <Text className="text-ui-fg-base text-sm font-medium">
                    {srp.toFixed(2)}
                  </Text>
                  <Badge size="2xsmall" color="grey">
                    {currency}
                  </Badge>
                </div>
              </div>
            )}

            {marginPct !== undefined && netIncome !== undefined && (
              <div className="flex items-center justify-between px-6 py-3">
                <Text className="text-ui-fg-subtle text-sm">{t("productCosts.entityCard.margin", "Margin")}</Text>
                <Badge size="2xsmall" color={marginColor}>
                  {marginPct.toFixed(1)}% ({netIncome.toFixed(2)} {currency})
                </Badge>
              </div>
            )}

            {grossCost === undefined && vatRate === null && (
              <div className="px-6 py-3">
                <Text className="text-ui-fg-muted text-xs">
                  {t("productCosts.entityCard.noVatHint", "Configure a VAT rate in product costs settings to see gross cost and margin.")}
                </Text>
              </div>
            )}

            {srp === undefined && grossCost !== undefined && (
              <div className="px-6 py-3">
                <Text className="text-ui-fg-muted text-xs">
                  {interpolate(t("productCosts.entityCard.noSellPriceHint", "Set a sell price in {{currency}} to see margin."), { currency })}
                </Text>
              </div>
            )}

            <div className="flex items-center justify-between px-6 py-3">
              <Text className="text-ui-fg-subtle text-sm">{t("productCosts.entityCard.lastUpdated", "Last updated")}</Text>
              <Text className="text-ui-fg-base text-sm">
                {new Date(cost.updated_at).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </Text>
            </div>
          </>
        )}

        {editing && (
          <div className="flex flex-col gap-y-3 px-6 py-4">
            <div className="flex items-center gap-x-2">
              <div className="relative flex-1">
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder={`0.00 ${currency}`}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  autoFocus
                />
              </div>
              <Button size="small" onClick={handleSave} isLoading={saving}>
                {t("productCosts.entityCard.save", "Save")}
              </Button>
              <Button
                variant="secondary"
                size="small"
                onClick={handleCancel}
                disabled={saving}
              >
                {t("productCosts.entityCard.cancel", "Cancel")}
              </Button>
            </div>
            {previewGross !== undefined && (
              <Text className="text-ui-fg-subtle text-xs">
                {interpolate(t("productCosts.entityCard.grossPreview", "Gross (break-even): {{amount}} {{currency}}"), {
                  amount: previewGross.toFixed(2),
                  currency,
                })}
              </Text>
            )}
          </div>
        )}
      </Container>

      <Drawer open={historyOpen} onOpenChange={setHistoryOpen}>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>
              {interpolate(t("productCosts.entityCard.historyTitle", "Cost history for {{entityId}}"), { entityId })}
            </Drawer.Title>
          </Drawer.Header>
          <Drawer.Body className="overflow-y-auto p-0">
            {historyLoading && (
              <div className="px-6 py-4">
                <Text className="text-ui-fg-subtle text-sm">{t("productCosts.common.loading", "Loading...")}</Text>
              </div>
            )}
            {!historyLoading && history.length === 0 && (
              <div className="px-6 py-4">
                <Text className="text-ui-fg-subtle text-sm">{t("productCosts.entityCard.noHistory", "No history yet")}</Text>
              </div>
            )}
            {!historyLoading && history.length > 0 && (
              <Table>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>{t("productCosts.entityCard.historyColumns.cost", "Cost")}</Table.HeaderCell>
                    <Table.HeaderCell>{t("productCosts.entityCard.historyColumns.source", "Source")}</Table.HeaderCell>
                    <Table.HeaderCell>{t("productCosts.entityCard.historyColumns.changedBy", "Changed by")}</Table.HeaderCell>
                    <Table.HeaderCell>{t("productCosts.entityCard.historyColumns.changedAt", "Changed at")}</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {history.map((row) => (
                    <Table.Row key={row.id}>
                      <Table.Cell>
                        <div className="flex items-center gap-x-2">
                          <Text className="text-ui-fg-base text-sm font-medium">
                            {row.unit_cost_net.toFixed(2)}
                          </Text>
                          <Badge size="2xsmall" color="grey">
                            {row.currency}
                          </Badge>
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <Text className="text-ui-fg-subtle text-sm">{row.source}</Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Text className="text-ui-fg-subtle text-sm">
                          {row.changed_by ?? "—"}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Text className="text-ui-fg-subtle text-sm">
                          {new Date(row.changed_at).toLocaleString(undefined, {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </Text>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            )}
          </Drawer.Body>
        </Drawer.Content>
      </Drawer>
    </>
  );
};

export default EntityCostCard;
