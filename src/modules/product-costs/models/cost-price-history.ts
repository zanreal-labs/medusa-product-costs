import { model } from "@medusajs/framework/utils";

/**
 * Append-only audit trail for `CostPrice`. The service writes one row here
 * on every create or update of a `CostPrice` - there is no DB trigger,
 * because Medusa's DML layer does not support them. Rows are never updated
 * or deleted.
 *
 * That contract is not implicit: `MedusaService(...)` auto-generates
 * update/delete/soft-delete/restore mutators for every model it is given,
 * including this one, so nothing here would stop a caller from rewriting or
 * erasing history without an explicit guard. `ProductCostsModuleService`
 * overrides those four generated mutators to throw - see the
 * "append-only guard" section in `../service.ts`.
 */
const CostPriceHistory = model.define("cost_price_history", {
  changed_at: model.dateTime(),
  changed_by: model.text().nullable(),
  currency: model.text(),
  id: model.id({ prefix: "cprch" }).primaryKey(),
  sku: model.text().index(),
  source: model.enum(["manual", "csv", "api"]),
  unit_cost_net: model.bigNumber(),
});

export default CostPriceHistory;
