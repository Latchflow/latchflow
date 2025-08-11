import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  dts: true,
  format: ["esm"],
  sourcemap: true,
  splitting: false,
  treeshake: false,
  external: [
    // Leave the generated client + engines as-is
    "../generated/prisma",
    "@prisma/client",
    ".prisma/client",
    "@prisma/engines",
  ],
});
