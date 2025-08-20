# Latchflow Core OpenAPI

This folder contains the multi-file OpenAPI 3.1 spec for the Core HTTP API.

- Root spec: `openapi.yaml`
- Split files under `paths/` and `components/`
- Bundled output written to `dist/openapi.json` and `dist/openapi.yaml`

Commands (from repo root):

- Bundle JSON: `pnpm oas:bundle`
- Bundle YAML: `pnpm oas:bundle:yaml`
- Lint: `pnpm oas:lint`
- Validate: `pnpm oas:validate`
- Preview docs: `pnpm oas:preview`

Serve from the Core service at runtime via `GET /openapi.json` (reads from `packages/core/openapi/dist/openapi.json`).
