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

- Unit tests live alongside source files using `*.test.ts` or `*.spec.ts` names.
- A single global setup file for Core lives at `packages/core/src/test/setup.ts`.
- Do not add tests under `src/test` beyond the setup file; colocate tests with their source instead.
- E2E tests spin up local services (Postgres, MinIO, MailHog).
- All tests must be runnable with pnpm -r test from repo root.
- Mock S3/email in tests — no external dependencies.

---

## Pitfalls & Gotchas

- Prisma migrations fail if DB container is not ready — check docker compose ps.
- MailHog runs on port 8025 for local email viewing.
- MinIO access keys must match .env for upload/download tests.

---

## Useful Paths

- Prisma schema — packages/db/prisma/schema.prisma
- Built-in plugins — packages/plugins/core
- Plugin capability examples — packages/plugins/core/*

---

## See Also

- README.md — human-oriented overview.
- docs/plugin-sdk.md — plugin authoring guide.
- docs/architecture.md — high-level system design.
