import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: [
      // Ensure @latchflow/db resolves to a test mock during Vitest runs across the monorepo
      {
        find: /^@latchflow\/db$/,
        replacement: path.join(
          fileURLToPath(new URL("./", import.meta.url)),
          "packages/core/src/test/prisma-mock.ts",
        ),
      },
    ],
  },
  test: {
    // Let package-level configs handle include patterns when running in subpackages.
    // This root config primarily supplies the alias so Vite can transform modules.
  },
});
