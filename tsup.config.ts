import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "entity-cost-card": "src/admin/components/entity-cost-card.tsx",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: false,
  outDir: "dist",
  external: ["react", "react-dom", "@medusajs/ui", "react-i18next", "i18next"],
  sourcemap: false,
  treeshake: true,
});
