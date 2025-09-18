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

### Admin Triggers
- API paths live under `/triggers` (route code in `packages/core/src/routes/admin/triggers.ts`).
- AuthZ is enforced via policy entries on resource `trigger_def`:
  - Read: `GET /triggers`, `GET /triggers/:id` (v1 allows executor reads), scopes: `triggers:read`.
  - Write: `POST /triggers`, `POST|PATCH /triggers/:id`, `DELETE /triggers/:id`, `POST /triggers/:id/test-fire`, scopes: `triggers:write`.
- Capability validation is DB-backed: check `PluginCapability` (`kind = TRIGGER`, `isEnabled = true`). Do not depend on the in-memory runtime registry inside routes.
- Delete semantics: return 409 when a trigger is referenced by pipelines or has events; prefer disabling (`isEnabled=false`).
- Auditing: on create/update, append ChangeLog entries for `TRIGGER_DEFINITION` (canonical serializer redacts secrets).

### Admin Actions
- API paths live under `/actions` (route code in `packages/core/src/routes/admin/actions.ts`).
- AuthZ is enforced via policy entries on resource `action_def`:
  - Read: `GET /actions`, `GET /actions/:id`, `GET /actions/:id/versions`, `GET /actions/:id/versions/:version`; scope `actions:read` (executors may read when policy allows).
  - Write: `POST /actions`, `PATCH /actions/:id`, `DELETE /actions/:id`, `POST /actions/:id/versions`, `POST /actions/:id/versions/{version}/activate`, `POST /actions/:id/test-run`; scope `actions:write`.
- Capability validation is DB-backed (`PluginCapability.kind = ACTION`, `isEnabled = true`). Never rely on the runtime registry from within routes.
- Delete semantics: return 409 when pipelines reference the action or when `ActionInvocation` history exists; prefer `isEnabled=false` toggles when in use.
- Versioning is ChangeLog-backed: create/update/activate append `ACTION_DEFINITION` entries; `materializeVersion` is used to serve historical state.
- `POST /actions/{id}/test-run` enqueues onto the queue and records the invoking user via `manualInvokerId`.

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

- Unit tests live alongside the source files they cover using `*.test.ts` only. Use a single test file per source file with the same basename. Example: `src/foo/bar.ts` → `src/foo/bar.test.ts`.
- All shared test setup, helpers, and fixtures live under `packages|apps/*/tests/` (keep them out of `src`).
- Global setup per workspace: `tests/setup/global.ts` (e.g., Core uses `packages/core/tests/setup/global.ts`).
- Integration tests: `tests/integration/**/*.test.ts` within each package/app.
- E2E tests: `tests/e2e/**/*.e2e.test.ts` (use Testcontainers for Postgres, MinIO, MailHog). No external network calls.
- Vitest config per package should:
  - Include both `src/**/*.test.ts` and `tests/**/*.test.ts`.
  - Register `tests/setup/global.ts` as `setupFiles` (if present).
  - Add `@tests` alias pointing to `./tests` for clean imports from unit tests.
  - Map additional aliases/mocks as needed (e.g., Core may map `@latchflow/db` to a Prisma mock for unit tests).
- TypeScript: repo‑level typecheck excludes tests; if you want IDE path resolution for `@tests`, add a per‑package `tsconfig.test.json` with `paths: { '@tests/*': ['./tests/*'] }` and configure your editor to use it for tests.
- All tests must be runnable with `pnpm -r test` from the repo root.
- Mock S3/email in unit/integration tests; E2E uses local containers only.

---

## Pitfalls & Gotchas

- We're using the ESLint recommended rules which includes `no-explicit-any`. Please exercise robust typing practices to avoid rework.
- Prisma migrations fail if DB container is not ready — check docker compose ps.
- MailHog runs on port 8025 for local email viewing.
- MinIO access keys must match .env for upload/download tests.
- When adding tests to another package, mirror the layout:
  - Create `packages/<pkg>/tests/` with `setup/`, `helpers/`, `fixtures/`, `integration/`, and `e2e/` as needed.
  - Add `packages/<pkg>/vitest.config.ts` to include both unit and tests patterns, register setup, and define the `@tests` alias.
  - Optionally add scripts: `test:unit` (runs `vitest run src`), `test:integration` (runs `vitest run tests/integration`), `test:e2e` (runs `vitest run tests/e2e`).

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
