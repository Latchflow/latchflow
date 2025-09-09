import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: [
      // Local alias for tests-only helpers (supports @tests and @tests/*)
      {
        find: /^@tests$/,
        replacement: path.join(fileURLToPath(new URL("./", import.meta.url)), "tests"),
      },
      {
        find: /^@tests\//,
        replacement: path.join(fileURLToPath(new URL("./", import.meta.url)), "tests") + "/",
      },
      // Ensure @latchflow/db resolves to the Core test Prisma mock when running package tests
      {
        find: /^@latchflow\/db$/,
        replacement: path.join(
          fileURLToPath(new URL("./", import.meta.url)),
          "tests/helpers/prisma-mock.ts",
        ),
      },
    ],
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: [path.join(fileURLToPath(new URL("./", import.meta.url)), "tests/setup/global.ts")],
  },
});
