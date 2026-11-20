import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Run from anywhere: yarn vitest run -c assessment/harness/vitest.config.mts
export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  test: {
    include: ["assessment/harness/**/*.spec.ts"],
    environment: "node",
    pool: "forks", // one process per spec file: env changes in the end-to-end spec stay isolated
    testTimeout: 30_000,
  },
});
