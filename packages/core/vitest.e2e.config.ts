import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@tests$/,
        replacement: path.join(fileURLToPath(new URL("./", import.meta.url)), "tests"),
      },
      {
        find: /^@tests\//,
        replacement: path.join(fileURLToPath(new URL("./", import.meta.url)), "tests") + "/",
      },
    ],
  },
  test: {
    include: ["tests/e2e/**/*.e2e.test.ts"],
    setupFiles: [path.join(fileURLToPath(new URL("./", import.meta.url)), "tests/setup/e2e.ts")],
  },
});
