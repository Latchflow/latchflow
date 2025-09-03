import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: [
      // Ensure @latchflow/db resolves to the Core test Prisma mock when running package tests
      {
        find: /^@latchflow\/db$/,
        replacement: path.join(
          fileURLToPath(new URL("./", import.meta.url)),
          "src/test/prisma-mock.ts",
        ),
      },
    ],
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: [path.join(fileURLToPath(new URL("./", import.meta.url)), "src/test/setup.ts")],
  },
});
