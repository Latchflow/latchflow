import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@tests$/, replacement: path.join(__dirname, "tests") },
      { find: /^@tests\//, replacement: path.join(__dirname, "tests") + "/" },
    ],
  },
  test: {
    include: ["tests/e2e/**/*.e2e.test.ts"],
    setupFiles: [path.join(__dirname, "tests/setup/e2e.ts")],
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
