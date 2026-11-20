import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL("../../..", import.meta.url)),
  test: {
    include: ["assessment/phase4/probes/**/*.spec.ts"],
    environment: "node",
    pool: "forks",
    testTimeout: 30_000,
  },
});
