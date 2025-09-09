# AGENTS.md — Latchflow

## Overview
Trigger-gated, plugin-extensible file release system.  
Stores encrypted bundles and releases them via **Trigger → Action** pipelines.  
Two main apps (admin-ui + portal) share a core backend; CLI mirrors admin/portal functionality.

**Primary stack:** pnpm workspaces, Node 20+, Postgres 16, Next.js (admin/portal), Prisma in packages/db.

## Project Structure
```
apps/
  cli/           - CLI
  admin-ui/      - Next.js admin interface
  portal/        - Recipient portal
packages/
  core/          - Service runtime, plugin loader, API
  db/            - Prisma schema & client (@latchflow/db)
  plugins/core/  - Built-in plugins (cron, webhook, email, publish)
```

### Dev Environment
```
- Install deps
pnpm install

- Start dev dependencies (Postgres, MinIO, MailHog)
docker compose up -d

- Set DATABASE_URL in .env
export DATABASE_URL="postgresql://latchflow:latchflow@localhost:5432/latchflow?schema=public"

- Migrate DB
pnpm -F db migrate
pnpm -F db generate

- Start core service
pnpm -F core dev

- Start admin app
pnpm -F admin-ui dev

### Linting & Tests
pnpm -r lint
pnpm -r test
```

## Architectural Rules

- Plugin registry handles all triggers/actions; never hardcode types.
- packages/db is the only Prisma client; other code imports it from @latchflow/db.
- Admin and portal apps must not access the DB directly.
- Every trigger firing must create a TriggerEvent; every action must create an ActionInvocation; every download must create a DownloadEvent.
- Verify bundle recipients before release (OTP/passphrase).
- Enforce per-recipient download limits and rate throttles.

---

## Coding Standards

- Language: TypeScript (strict mode)
- Formatting: Prettier + ESLint (see repo configs)
- Branch naming: feature/, fix/, chore/ + short description
- Commits: Conventional Commits

---

## Security & Safety Rails

- Never run destructive DB commands outside local/test DBs.
- Never embed secrets; always use environment variables.
- No network calls in tests unless explicitly marked and mocked.
- Public link publishing only via the release_bundle action.

---

## Testing Guidance

- Unit tests live alongside the source files they cover using `*.test.ts` only.
- Use a single test file per source file, with the same basename. Example: `src/foo/bar.ts` → `src/foo/bar.test.ts`. Do not split tests for a single module across multiple files.
- A single global setup file for Core lives at `packages/core/src/test/setup.ts`.
- Do not add tests under `src/test` beyond the setup file; colocate tests with their source instead.
- Integration tests live under a top‑level `tests/` directory within each package (repo‑wide convention). Keep end‑to‑end or multi‑module flows here so unit tests stay tightly scoped.
- Each package that has integration tests should add a package‑level `vitest.config.ts` to include both `src/**/*.test.ts` and `tests/**/*.test.ts`, and set up any aliases/mocks it needs (e.g., Core maps `@latchflow/db` to its Prisma mock).
- E2E tests spin up local services (Postgres, MinIO, MailHog).
- All tests must be runnable with pnpm -r test from repo root.
- Mock S3/email in tests — no external dependencies.

---

## Pitfalls & Gotchas

- We're using the ESLint recommended rules which includes `no-explicit-any`. Please exercise robust typing practices to avoid rework.
- Prisma migrations fail if DB container is not ready — check docker compose ps.
- MailHog runs on port 8025 for local email viewing.
- MinIO access keys must match .env for upload/download tests.
- When adding integration tests to another package, mirror Core’s approach:
  - Create `packages/<pkg>/tests/` for integration tests.
  - Add `packages/<pkg>/vitest.config.ts` with include patterns for both unit and integration tests and any necessary module aliases.
  - Optionally add package scripts: `test:unit` (runs `vitest run src`) and `test:integration` (runs `vitest run tests`).

---

## Useful Paths

- Prisma schema — packages/db/prisma/schema.prisma
- Built-in plugins — packages/plugins/core
- Plugin capability examples — packages/plugins/core/*

## Storage Driver Notes

- S3 driver supports presigned uploads and server-side copy. It feature-detects capabilities via optional methods on `StorageDriver`.
- For MinIO/dev-container setups use separate endpoints:
  - `endpoint` (server ops): `http://minio:9000`
  - `presignEndpoint` (client URLs): `http://localhost:9000`
- Commit flow verifies uploads via `HEAD` only:
  - Prefer `ChecksumSHA256` (S3); fallback to `metadata.sha256` (MinIO). Presigned PUT includes `x-amz-meta-sha256` to support the fallback.
- ETag policy: persist the storage-native ETag on `File.etag` and prefer it for HTTP response headers; also store `contentHash` (sha256).

---

## See Also

- README.md — human-oriented overview.
- docs/plugin-sdk.md — plugin authoring guide.
- docs/architecture.md — high-level system design.
