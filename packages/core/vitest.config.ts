import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: [
      // Local alias for tests-only helpers (supports @tests and @tests/*)
      { find: /^@tests$/, replacement: path.join(__dirname, "tests") },
      { find: /^@tests\//, replacement: path.join(__dirname, "tests") + "/" },
      // Ensure @latchflow/db resolves to the Core test Prisma mock when running package tests
      {
        find: /^@latchflow\/db$/,
        replacement: path.join(__dirname, "tests/helpers/prisma-mock.ts"),
      },
    ],
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: [path.join(__dirname, "tests/setup/global.ts")],
  },
});
