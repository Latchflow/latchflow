# Latchflow

Trigger-gated secure file release system — store encrypted bundles and release them only when specific conditions are met.

Latchflow began as a “digital legacy” tool — a way to pass files to specific people after your death — but its trigger-driven architecture makes it useful for many other release scenarios: timed publishing, workflow automation, or conditional data sharing.

## Core Concepts
- Bundles: Secure sets of files assigned to recipients.
- Recipients: People or endpoints allowed to retrieve specific bundles.
- Triggers: Events that start a release process (cron schedules, webhooks, manual overrides, dead-man’s switch, etc.).
- Actions: What happens after a trigger (send email, publish signed URL, push webhook, etc.).
- Pipelines/Steps: How triggers relate to actions. Defines a set of actions (steps) to be executed in order after a trigger is fired.
- Executors: Humans with scoped admin permissions to manage bundles, run actions, and perform other managerial tasks.
- Audit Log: Every trigger, action, and download is recorded.

## Current State
- Workspaces present: `packages/core` (service runtime, API), `packages/db` (Prisma client), `packages/testkit/*` (shared mocks/fixtures/scenarios).
- Planned but not yet in repo: `apps/admin-ui`, `apps/portal`, `apps/cli`, `packages/plugins/*`.
- Docker Compose includes Postgres only; MinIO/MailHog are planned.
- OpenAPI spec lives in `packages/core/openapi` with scripts to lint/bundle/preview.

## Quick Start
Prerequisites: Node 20+, pnpm 9/10, Docker. Dev container/Codespace config included for convenience.

1) Install deps
```
pnpm install
```

2) Start Postgres
```
docker compose up -d
```

3) Configure environment
- Copy `.env.defaults` to `.env` to override as needed, or rely on defaults.
- Ensure `DATABASE_URL` points to your Postgres (defaults use `host.docker.internal`).

4) Migrate and generate Prisma client
```
pnpm db:migrate
pnpm db:generate
```

5) Run the core service
```
pnpm core:dev
```

## Scripts
- `pnpm db:migrate`: Runs Prisma migrate in `@latchflow/db`.
- `pnpm db:generate`: Generates Prisma client in `@latchflow/db`.
- `pnpm core:dev`: Starts the core HTTP service (Express + plugins/queue/storage init).
- `pnpm core:test`: Runs Core tests with Vitest. Use `core:test:coverage` for coverage.
- `pnpm -r lint` / `pnpm -r test`: Lint or test across workspaces.
- `pnpm oas:preview`: Preview OpenAPI docs; `oas:bundle`/`oas:bundle:yaml` to bundle; `oas:validate` to validate.

## Testkit (Shared Mocks)
- Shared unit/integration testing kit for all apps using MSW-based handlers, fixtures, and scenarios.
- Quick start for tests (Node):
  - `import { scenarios, makeHandlers } from '@latchflow/testkit-msw-handlers'`
  - `setupServer(...makeHandlers(scenarios.singleBundleHappyPath().handlers)({ http, HttpResponse }))`
- See `packages/testkit/README.md` for detailed usage, scenarios, and CI spec-hash guidance.

## Features (In Progress)
- Encrypted storage: Optional per-bundle encryption keys.
- Plugin system: Extend with new triggers/actions/storage; registry is dynamic, not hardcoded.
- Full audit trail: Prisma models for TriggerEvent, ActionInvocation, DownloadEvent.
- Verification & limits: OTP/passphrase flows, per-recipient download caps, throttling (schema + runtime hooks under development).

## Architecture Overview
```
TriggerDefinition ──▶ PipelineStep ──▶ ActionDefinition
       │                                    │
  PluginCapability (TRIGGER)          PluginCapability (ACTION)
```
- Dynamic plugin registry: No hard-coded trigger/action types.
- Separation of concerns: Plugins handle business logic; core orchestrates and audits.
- Pluggable: Storage, triggers, and actions are swappable/extensible via plugins.

## Project Structure
```
packages/
  core/   - Service runtime, plugin loader, API, OpenAPI spec
  db/     - Prisma schema & generated client (@latchflow/db)
  testkit/ - Shared mocks, fixtures, scenarios, MSW adapter (@latchflow/testkit-*)

# Planned (not yet present in this repo)
apps/
  admin-ui/  - Next.js admin interface
  portal/    - Recipient portal
  cli/       - CLI
packages/plugins/
  core/      - Built-in plugins (cron, webhook, email, publish)
```

## Environment
- `.env.defaults`: Safe defaults for local dev; override with `.env`.
- Core config includes queue/storage drivers (defaults to in-memory queue and local FS).
- Key envs: `DATABASE_URL`, `PORT`, `PLUGINS_PATH`, `QUEUE_*`, `STORAGE_*`, `ENCRYPTION_*`.

## Security & Testing
- Never embed secrets; always use environment variables.
- Tests use Vitest; no external network calls.
- Run all tests with `pnpm -r test` or Core-only with `pnpm core:test`.

## Roadmap
- CLI, Admin UI, Recipient Portal, CLI, and built-in plugins are planned additions.
- See `docs/ROADMAP.md` for phased milestones.

## See Also
- `AGENTS.md`: Contributor-oriented architecture and guidelines.
- `packages/db/prisma/schema.prisma`: Data models for triggers/actions/audit/auth.
