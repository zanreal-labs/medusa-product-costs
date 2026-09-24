import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "entity-cost-card": "src/admin/components/entity-cost-card.tsx",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: false,
  outDir: "dist",
  // The admin tsconfig, not the root one, and not by accident. The root
  // tsconfig turns on `emitDecoratorMetadata` for the module service's
  // `@InjectManager()` decorators, and tsup reacts to that flag by routing
  // every file through swc before esbuild sees it. swc compiles JSX with the
  // classic runtime, so `jsx: "react-jsx"` never takes effect and the bundle
  // comes out full of bare `React.createElement` calls with no React binding -
  // which is what the injected `import React from "react"` banner was there to
  // paper over. The admin tsconfig carries no decorator metadata (and is the
  // tsconfig this file belongs to anyway: the root one excludes `src/admin`),
  // so esbuild does the JSX transform itself and emits `react/jsx-runtime`
  // imports instead.
  tsconfig: "src/admin/tsconfig.json",
  // `react/jsx-runtime` is listed separately on purpose: esbuild matches
  // `external` entries exactly, so marking `react` external does not cover its
  // subpaths, and the jsx-runtime shim would otherwise be bundled in.
  external: ["react", "react/jsx-runtime", "react-dom", "@medusajs/ui", "react-i18next", "i18next"],
  sourcemap: false,
  treeshake: true,
});
