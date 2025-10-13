import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@tests$/, replacement: path.join(__dirname, "tests") },
      { find: /^@tests\//, replacement: `${path.join(__dirname, "tests")}/` },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: [path.join(__dirname, "tests/setup/global.ts")],
  },
});
