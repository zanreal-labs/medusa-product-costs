// Minimal Medusa app used only by the integration tests. It loads this
// repository as a plugin, i.e. its built output in `.medusa/server`, the
// same way a store does, so `pnpm test:integration` builds first.
const path = require("path");
const { defineConfig } = require("@medusajs/framework/utils");

module.exports = defineConfig({
  admin: { disable: true },
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      adminCors: "*",
      authCors: "*",
      cookieSecret: "test",
      jwtSecret: "test",
      storeCors: "*",
    },
  },
  plugins: [{ options: {}, resolve: path.resolve(__dirname, "../..") }],
});
