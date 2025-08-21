@latchflow/api-types
====================

TypeScript types generated from the Latchflow OpenAPI document.

Usage

- Generate types (requires dev dep `openapi-typescript`):
  - From repo root: `pnpm -F @latchflow/api-types generate`
  - Or within the package: `pnpm run generate`

- Import in apps/packages:
  `import type { paths, components } from '@latchflow/api-types'`

Notes

- Source: `packages/core/openapi/dist/openapi.json` (kept up-to-date via `pnpm oas:bundle`).
- The generator writes a declaration file `src/index.d.ts` with exported `paths` and `components` types.

