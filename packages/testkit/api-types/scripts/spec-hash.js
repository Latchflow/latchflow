#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const openapiPath = resolve(process.cwd(), "../../../packages/core/openapi/dist/openapi.json");
try {
  const data = readFileSync(openapiPath);
  const hash = createHash("sha256").update(data).digest("hex");
  const out = {
    spec: "packages/core/openapi/dist/openapi.json",
    sha256: hash,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(resolve(process.cwd(), "VERSION.json"), JSON.stringify(out, null, 2));
  console.log(`[testkit-api-types] Wrote VERSION.json (sha256=${hash.slice(0, 8)}…)`);
} catch (err) {
  console.error("[testkit-api-types] Failed to compute spec hash:", err?.message || err);
  process.exit(1);
}
