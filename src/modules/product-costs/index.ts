import { Module } from "@medusajs/framework/utils";
import ProductCostsModuleService from "./service";

export const PRODUCT_COSTS_MODULE = "productCosts";

export default Module(PRODUCT_COSTS_MODULE, {
  service: ProductCostsModuleService,
});

export { default as ProductCostsModuleService } from "./service";
export * from "./types";
export * from "./lib/economics";
export * from "./lib/money";
export * from "./lib/csv";
