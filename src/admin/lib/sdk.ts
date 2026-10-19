import Medusa from "@medusajs/js-sdk";

/**
 * Shared JS SDK client for the admin widget and UI route. `sdk.client.fetch`
 * carries the admin session cookie automatically, so our custom
 * `/admin/product-costs/*` routes authenticate the same way any built-in
 * `sdk.admin.*` call does.
 */
// `import.meta` is guarded because tsup also bundles this module into the
// standalone EntityCostCard, and esbuild rewrites `import.meta` to `undefined`
// in its CJS output; an unguarded read would throw when the package is
// `require`d. Vite (the admin build) still sees `import.meta.env` here.
const env = typeof import.meta !== "undefined" ? import.meta.env : undefined;

export const sdk = new Medusa({
  auth: { type: "session" },
  baseUrl: env?.VITE_BACKEND_URL || "/",
  debug: env?.DEV ?? false,
});
