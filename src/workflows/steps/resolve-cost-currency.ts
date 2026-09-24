import type { StepExecutionContext } from "@medusajs/framework/workflows-sdk";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { resolveEffectiveCurrency } from "../../lib/store-currency";

export interface ResolveCostCurrencyInput {
  /** The currency the caller asked for, if any. Always wins when present. */
  requested?: string;
}

export interface ResolveCostCurrencyOutput {
  /**
   * The currency to store the cost in, or `undefined` when none resolves
   * anywhere. `undefined` is deliberately not turned into an error here: the
   * module service is the one place that refuses, with the one message
   * (`CURRENCY_NOT_CONFIGURED_MESSAGE`), so this step stays a resolver.
   */
  currency: string | undefined;
}

/**
 * The step's business logic, exported separately from
 * `resolveCostCurrencyStep` so it can be unit-tested with a mocked container
 * (see the same note on `resolveVariantIdBySku`).
 *
 * Answers "what currency does this cost get stored in" for a caller that did
 * not name one: the Settings override, then the plugin option, then the
 * store's own default currency. Only the last of those is new - before it,
 * the module service resolved the first two on its own, and a store that had
 * configured neither simply could not save a cost.
 */
export async function resolveCostCurrency(
  input: ResolveCostCurrencyInput,
  { container }: Pick<StepExecutionContext, "container">,
): Promise<ResolveCostCurrencyOutput> {
  const requested = input.requested?.trim().toUpperCase();
  if (requested) {
    return { currency: requested };
  }
  const { currency } = await resolveEffectiveCurrency(container);
  return { currency: currency ?? undefined };
}

export const resolveCostCurrencyStep = createStep(
  "resolve-cost-currency",
  async (input: ResolveCostCurrencyInput, context) =>
    new StepResponse<ResolveCostCurrencyOutput>(await resolveCostCurrency(input, context)),
);
