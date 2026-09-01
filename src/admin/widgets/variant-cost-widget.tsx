import { defineWidgetConfig } from "@medusajs/admin-sdk";
import type { AdminProductVariant, DetailWidgetProps } from "@medusajs/framework/types";
import { ProductCostCard } from "../components/product-cost-card";

/**
 * The same cost card on the variant page, scoped to that one variant.
 *
 * This exists because the owner could see a cost and its margin on the product
 * page and then lose both the moment he opened the variant he actually wanted
 * to price ("jak wejdę w wariant to już nie widzę tych informacji, są tylko w
 * produkcie").
 *
 * `product_variant.details.*` hands over the variant but not its product, and
 * the SRP falls back to the product's metadata, so `productMetadata` is left
 * undefined here on purpose: that is the card's signal to fetch the product
 * itself rather than silently treat "not passed" as "no metadata" and lose a
 * product-level SRP.
 */
const VariantCostWidget = ({ data }: DetailWidgetProps<AdminProductVariant>) => {
  // A variant always belongs to a product, but the field is optional in the
  // admin types and the card cannot do anything useful without it.
  if (!data.product_id) {
    return null;
  }
  return <ProductCostCard productId={data.product_id} variantId={data.id} />;
};

export const config = defineWidgetConfig({
  zone: "product_variant.details.after",
});

export default VariantCostWidget;
