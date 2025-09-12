import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  pool: "threads",
  resolve: {
    alias: [
      { find: /^@tests$/, replacement: path.join(__dirname, "tests") },
      { find: /^@tests\//, replacement: path.join(__dirname, "tests") + "/" },
      // In E2E we want to use the real DB package without requiring a build step.
      // Alias @latchflow/db to its source entry; globalSetup ensures `prisma generate` runs.
      { find: /^@latchflow\/db$/, replacement: path.join(__dirname, "../db/src/index.ts") },
    ],
  },
  test: {
    include: ["tests/e2e/**/*.e2e.test.ts"],
    // Start containers once per run via globalSetup
    globalSetup: [path.join(__dirname, "tests/setup/e2e.global.ts")],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    isolate: false,
    // Run E2E in a single worker to avoid starting multiple container sets
    poolOptions: {
      threads: {
        singleThread: true,
        maxThreads: 1,
        minThreads: 1,
      },
    },
  },
});
