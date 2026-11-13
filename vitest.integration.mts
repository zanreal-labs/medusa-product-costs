import { defineConfig } from "vitest/config";

// Integration tests boot a real Medusa app against Postgres (see
// integration-tests/app). They need DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD
// and run against the built plugin, so use `pnpm test:integration`.
export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    // Threads, not forks: the Medusa test runner reports its HTTP port with
    // `process.send`, which collides with the vitest fork channel.
    pool: "threads",
    // `medusaIntegrationTestRunner` registers its hooks through the global
    // describe/beforeAll/afterAll, as it does under jest.
    globals: true,
    hookTimeout: 300_000,
    include: ["integration-tests/**/*.spec.ts"],
    testTimeout: 120_000,
  },
});
