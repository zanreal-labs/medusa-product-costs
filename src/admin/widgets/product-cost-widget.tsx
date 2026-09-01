import { defineWidgetConfig } from "@medusajs/admin-sdk";
import type {
  AdminProduct,
  AdminProductVariant,
  DetailWidgetProps,
} from "@medusajs/framework/types";
import { ProductCostCard } from "../components/product-cost-card";

/**
 * The cost card on the product page: every variant of the product.
 *
 * All of the behaviour lives in {@link ProductCostCard}, which the variant page
 * mounts too. This widget only supplies what this page knows - the product id,
 * its metadata (which the SRP falls back to, and which is already in hand here
 * so the card does not have to re-fetch it) and, if a future dashboard version
 * ever passes them, the embedded variants.
 */
const ProductCostWidget = ({ data }: DetailWidgetProps<AdminProduct>) => (
  <ProductCostCard
    embeddedVariants={(data.variants as AdminProductVariant[] | undefined) ?? null}
    productId={data.id}
    productMetadata={data.metadata ?? null}
  />
);

export const config = defineWidgetConfig({
  zone: "product.details.after",
});

export default ProductCostWidget;
