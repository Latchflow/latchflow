import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: [
      // Allow legacy test imports like "../../src/..." to resolve to the workspace src folder
      {
        find: /^\.\.\/\.\.\/src\//,
        replacement: path.join(fileURLToPath(new URL("./", import.meta.url)), "src/"),
      },
      // Redirect Prisma client to a local mock for tests to avoid resolving the real package
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
    include: [
      // Colocated unit tests alongside source files
      "src/**/*.test.ts",
      "src/**/*.spec.ts",
    ],
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
    },
  },
});
