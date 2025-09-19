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
- Docker Compose includes Postgres and MinIO (S3‑compatible). MailHog is planned.
- OpenAPI spec lives in `packages/core/openapi` with scripts to lint/bundle/preview.

### Recipient Portal Model (Account‑Scoped)
- Recipients authenticate once (OTP) at the account level; no per‑bundle verification step after login.
- After login, recipients can:
  - `GET /portal/me` — identity and a list of accessible bundles
  - `GET /portal/bundles` — paginated list of enabled bundles they’re assigned to
  - `GET /portal/bundles/{bundleId}/objects` — enabled files within a bundle
  - `GET /portal/bundles/{bundleId}` — stream the zipped bundle archive
- Enforce limits atomically on download:
  - `maxDownloads` per assignment
  - `cooldownSeconds` between downloads
  - Every download creates a `DownloadEvent` row and updates `lastDownloadAt`.
- Assignment status endpoint for UX:
  - `GET /portal/assignments` — returns per‑assignment summary with downloads used/remaining and cooldown timing.

### Enable/Disable Semantics
- `Recipient.isEnabled`, `Bundle.isEnabled`, `BundleAssignment.isEnabled`, and `BundleObject.isEnabled` control visibility and access without deleting data.
- Portal lists and downloads require all relevant flags to be enabled.

## Quick Start
Prerequisites: Node 20+, pnpm 9/10, Docker. Dev container/Codespace config included for convenience.

1) Install deps
```
pnpm install
```

2) Start services (Postgres, MinIO)
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

### Admin Login in Development (No Email)

If you don't have an SMTP server (MailHog) configured, enable a dev-only helper that returns a login URL directly from the API instead of sending an email.

1) Enable dev auth in your environment:
```
ALLOW_DEV_AUTH=true
```
2) Start the login flow by posting your email to the core service:
```
curl -sS -X POST http://localhost:3001/auth/admin/start \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com"}'
```
3) In dev mode, you'll receive a JSON payload containing a `login_url`:
```
{"login_url":"/auth/admin/callback?token=..."}
```
4) Open that URL in your browser against your core service host (e.g., `http://localhost:3001`) to complete login and set the admin session cookie.

Notes:
- This behavior is disabled by default and should not be enabled in production.
- On first successful login when no admins exist, the user is granted ADMIN automatically (bootstrap).

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

### Build Artifacts & Auto‑Rebuilds
- Bundles are stored as zipped archives in object storage. ETag preference:
  - Prefer storage‑native ETag for HTTP responses; fallback to stored checksum (sha256) when needed.
- Composition digest:
  - Each bundle stores a `bundleDigest` (sha256 over ordered `{fileId, file.contentHash, path, required, sortOrder}`) to skip redundant rebuilds.
- Rebuild pipeline:
  - On file content changes (upload/commit), the system enqueues an async rebuild for referencing bundles.
  - Rebuilder coalesces multiple events per bundle, debounces bursts, and guarantees one build at a time.
  - While rebuilding, existing artifacts continue to serve; when done, the pointer (`Bundle.storagePath`/`checksum`) is updated atomically.
  - Lazy backstop: portal downloads and object listings compute the current digest and enqueue a rebuild if drift is detected — this never blocks the response stream.
- Manual control (admin):
  - `POST /admin/bundles/{bundleId}/build` → enqueues a rebuild (accepts `{ force?: boolean }`)
  - `GET /admin/bundles/{bundleId}/build/status` → returns `idle|queued|running` and last result

### Admin Assignment Summaries
- Management endpoints expose assignment status with pagination:
  - `GET /admin/bundles/{bundleId}/assignments`
  - `GET /admin/recipients/{recipientId}/assignments`
  - Items include: downloads used/remaining, cooldown timing, enable flags, and recipient/bundle labels.

### Admin Bundle Objects
- Manage file attachments within a bundle (enqueues a rebuild via the scheduler on writes):
  - `GET /bundles/{bundleId}/objects` — list with file metadata, ordered by `sortOrder`. Cursor pagination via `nextCursor`.
  - `POST /bundles/{bundleId}/objects` — attach files; accepts an array or `{ items: [...] }`. Defaults:
    - `path` ← `File.key` when omitted
    - `sortOrder` ← `(max(sortOrder) + 1)` when omitted
    - Enforces uniqueness per bundle on `(bundleId, fileId)` and is idempotent.
  - `PATCH /bundles/{bundleId}/objects/{id}` — update `path`, `sortOrder`, `required`, `isEnabled` (soft toggle). Some deployments use a POST alias for this update.
  - `DELETE /bundles/{bundleId}/objects/{id}` — detach (idempotent).

Notes
- Writes schedule a debounced rebuild; serving of the previous artifact is uninterrupted until the pointer swap completes.
- OpenAPI documents both PATCH and a POST alias for updates to reflect implementation constraints of the HTTP layer.

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

### MinIO + Signed Uploads (Dev Container friendly)

When Core runs inside a dev container, it should reach MinIO via the Docker network, while browsers/Postman on the host use localhost. Configure separate endpoints in the S3 driver:

- `endpoint`: used by the server for S3 operations (HEAD/PUT/COPY/GET/DELETE). Set to `http://minio:9000`.
- `presignEndpoint`: used only for presigned URLs returned to clients. Set to `http://localhost:9000`.

Ports and console
- API: `http://localhost:9000`
- Console: `http://localhost:19001` (mapped to container `:9001`)

Example env for MinIO
```
STORAGE_DRIVER=s3
STORAGE_BUCKET=latchflow-dev
STORAGE_CONFIG_JSON={
  "region":"us-east-1",
  "endpoint":"http://minio:9000",
  "presignEndpoint":"http://localhost:9000",
  "forcePathStyle":true,
  "accessKeyId":"minioadmin",
  "secretAccessKey":"minioadmin",
  "ensureBucket":true
}
```

Checksum and metadata
- The signed PUT response includes required headers. Send them exactly as returned:
  - `x-amz-checksum-sha256` (base64; signature‑bound)
  - `x-amz-meta-sha256` (hex; stored as object metadata)
  - `content-type` (must match the presigned value)
- Commit (`POST /files/commit`) verifies via `HEAD` only:
  - Uses `ChecksumSHA256` when available (S3).
  - Falls back to `metadata.sha256` on MinIO.

Tips
- Request a fresh `POST /files/upload-url` before each upload. Reusing old URLs may miss required headers.
- If commit returns `CHECKSUM_MISMATCH`, ensure your upload included both headers and the exact content type.

## Security & Testing
- Never embed secrets; always use environment variables.
- Tests use Vitest; no external network calls. E2E tests may use local containers via Testcontainers.
- Testing conventions (repo‑wide):
  - Unit tests live next to the code they cover (e.g., `src/foo/bar.test.ts`). One test file per module.
  - All shared test setup/helpers/fixtures live under `packages|apps/*/tests/`.
  - Global setup per workspace: `tests/setup/global.ts` (registered via Vitest config).
  - Integration tests: `tests/integration/**/*.test.ts` at the package root.
  - E2E tests: `tests/e2e/**/*.e2e.test.ts` (use Testcontainers for Postgres, MinIO, MailHog).
  - Each package should have a `vitest.config.ts` that includes both `src/**/*.test.ts` and `tests/**/*.test.ts`, registers setup, and defines aliases, including `@tests` → `./tests`.
  - Example Core scripts:
    - `pnpm -F core test` — run all Core tests
    - `pnpm -F core test:unit` — unit tests only (`src/**/*.test.ts`)
    - `pnpm -F core test:integration` — integration tests only (`tests/integration/**/*.test.ts`)
    - `pnpm -F core test:e2e` — E2E tests only (`tests/e2e/**/*.e2e.test.ts`)
  - Repo‑wide runs: `pnpm -r test` (all packages).

## Admin Triggers (CRUD + Test-Fire)
- API paths (route code lives under `packages/core/src/routes/admin/triggers.ts`):
  - `GET /triggers` — list with filters: `q`, `pluginId`, `capabilityKey`, `enabled`, `updatedSince`, plus `limit`/`cursor`.
  - `POST /triggers` — create with `{ name, capabilityId, config }`; validates capability exists in DB and `kind=TRIGGER`.
  - `GET /triggers/{id}` — get by id.
  - `PATCH /triggers/{id}` — update `{ name?, isEnabled?, config? }`.
  - `DELETE /triggers/{id}` — 409 when referenced by pipelines or has events; prefer disabling.
  - `POST /triggers/{id}/test-fire` — enqueues actions by creating a `TriggerEvent` and dispatching to the action queue.
- AuthZ & scopes: guarded by `requireAdminOrApiToken` with `triggers:read` (list/get) and `triggers:write` (create/update/delete/test-fire). Admins always allowed; executors allowed to read when policy permits.
- Capability validation is DB-backed (`PluginCapability`), not the in-memory registry.
- Auditing: create and update append ChangeLog for `TRIGGER_DEFINITION` (sensitive config redacted in canonical view).
- Example (bearer token):
  - `curl -sS -H 'Authorization: Bearer lfk_...' http://localhost:3001/triggers`
  - `curl -sS -X POST -H 'Authorization: Bearer lfk_...' -H 'Content-Type: application/json' \
      -d '{"name":"Cron","capabilityId":"<capId>","config":{"schedule":"* * * * *"}}' \
      http://localhost:3001/triggers`

## Admin Actions (CRUD + Versions + Test-Run)
- API paths (route code lives under `packages/core/src/routes/admin/actions.ts`):
  - `GET /actions` — list with filters: `q`, `pluginId`, `kind`, `enabled`, `updatedSince`, plus pagination (`limit`/`cursor`).
  - `POST /actions` — create with `{ name, capabilityId, config }`; validates capability via DB (`PluginCapability.kind = ACTION`, `isEnabled = true`).
  - `GET /actions/{id}` — fetch a single definition.
  - `PATCH /actions/{id}` — update `{ name?, isEnabled? }`.
  - `DELETE /actions/{id}` — returns 409 when referenced by pipelines or has invocations; prefer disabling when in use.
  - `GET /actions/{id}/versions` — list ChangeLog history for the definition.
  - `POST /actions/{id}/versions` — persist a new configuration version (appends ChangeLog entry).
  - `GET /actions/{id}/versions/{version}` — materialize historical state.
  - `POST /actions/{id}/versions/{version}/activate` — rollback to a prior version (updates config, appends ChangeLog).
  - `POST /actions/{id}/test-run` — enqueue a manual invocation on the action queue (records `manualInvokerId`).
- AuthZ & scopes: guarded by `requireAdminOrApiToken` with `actions:read` (list/get/version read) and `actions:write` (create/update/delete/version-create/activate/test-run).
- Capability validation is DB-backed; routes never depend on the in-memory registry.
- Auditing: every create/update/version/activation appends ChangeLog for `ACTION_DEFINITION` (canonically redacted config).
- Example (bearer token):
  - `curl -sS -H 'Authorization: Bearer lfk_...' http://localhost:3001/actions`
  - `curl -sS -X POST -H 'Authorization: Bearer lfk_...' -H 'Content-Type: application/json' \
      -d '{"name":"Email","capabilityId":"<capId>","config":{"template":"welcome"}}' \
      http://localhost:3001/actions`

## Admin Users (CRUD + Sessions)
- API paths (route code lives under `packages/core/src/routes/admin/users.ts`):
  - `GET /users` — list with filters: `q`, `role`, `isActive`, `updatedSince`, plus pagination (`limit`/`cursor`).
  - `POST /users` — create an active user; returns 201 with the user DTO.
  - `POST /users/invite` — create an inactive invitee and issue a magic link (dev mode returns `loginUrl`).
  - `GET /users/{id}` — fetch a single user by id.
  - `PATCH /users/{id}` — update `{ name?, displayName?, role?, isActive? }`; updates append a `USER` ChangeLog entry.
  - `DELETE /users/{id}` — returns 409 (`DELETE_DISABLED`); prefer PATCH with `isActive=false`.
  - `GET /users/{id}/sessions` — list active (unrevoked, unexpired) admin sessions for the user.
  - `POST /users/{id}/revoke` — revoke all sessions for the user (sets `revokedAt`).
- AuthZ & scopes: guarded by `requireAdminOrApiToken` with `users:read` / `users:write`; no executor access in v1.
- ChangeLog: user create/update/deactivate append entries for `USER`; historical reads via `GET /users/{id}/versions` (future work).
- Invites share the same magic link delivery as `/auth/admin/start`; SMTP is optional in dev.

## ChangeLog & Auditing
- Aggregate-only history: ChangeLog rows are written for root entities (Pipeline, Bundle, Recipient, TriggerDefinition, ActionDefinition). Child updates append history on the parent aggregate.
- Snapshots vs. diffs: `HISTORY_SNAPSHOT_INTERVAL` and `HISTORY_MAX_CHAIN_DEPTH` control when we persist full snapshots versus JSON Patch diffs; hashes protect against drift.
- Provenance: all admin mutations must populate `createdBy`/`updatedBy` and supply actor context so ChangeLog answers “who changed what, when”.
- See [docs/architecture.md#history--changelog-strategy](docs/architecture.md#history--changelog-strategy) for canonical serialisation rules and guidance when adding new endpoints.

## AuthN vs AuthZ (Current)
- AuthN (authentication): lives under `packages/core/src/auth` and `packages/core/src/middleware/require-session.ts`.
  - Establishes identity via admin session cookies or API tokens.
  - Do not perform role/permission checks here.
- AuthZ (authorization): lives under `packages/core/src/authz` and `packages/core/src/middleware/require-permission.ts`.
  - Central policy map: `src/authz/policy.ts` maps route signatures (e.g., `"GET /plugins"`) to required actions/resources.
  - Guard middleware: `requirePermission(policyEntryOrSignature)` wraps handlers to enforce the policy.
  - Context builder: `src/authz/context.ts` extracts user role and common IDs from requests.
  - Decision logging: `src/authz/decisionLog.ts` emits a structured JSON line for every ALLOW/DENY (stdout).

### API Tokens (Bearer)
- Purpose: scoped bearer tokens for programmatic/CLI access; browser UI keeps using the admin cookie.
- Scopes: start coarse with `core:read` (list/get) and `core:write` (create/update/delete). More granular `files:*`, `bundles:*`, etc. will follow.
- Precedence: if an `Authorization` header is present, bearer is used and cookie is ignored; omit the header to use the admin cookie.

Quick start (dev):
- Ensure you have an admin cookie (see “Admin Login in Development”). Then create a token:
  - `curl -sS -X POST http://localhost:3001/auth/cli/tokens \
    -H 'Content-Type: application/json' \
    -H 'Cookie: lf_admin_sess=YOUR_SESSION_JTI' \
    -d '{"name":"CLI Token","scopes":["core:read","core:write"]}'`
  - Response includes `token` (prefixed, e.g., `lfk_...`). Store it securely.
- Use the token:
  - `curl -sS http://localhost:3001/plugins -H 'Authorization: Bearer lfk_...'`

Device flow (alternative):
- Start device: `POST /auth/cli/device/start` with `email` and optional `deviceName` to receive `device_code` and `user_code`.
- Approve: `POST /auth/cli/device/approve` with `user_code` using an admin cookie session.
- Poll: `POST /auth/cli/device/poll` with `device_code` until it returns `{ access_token, token_type, scopes, expires_at }`.

Notes:
- Default scopes for new tokens are controlled by `API_TOKEN_SCOPES_DEFAULT` (JSON array). For stricter defaults, set to `["core:read"]`.
- Current bearer-enabled endpoints include:
  - `GET /plugins`, `GET /capabilities` → `core:read`
  - `POST /plugins/install`, `DELETE /plugins/:pluginId` → `core:write`
  - `GET /triggers`, `GET /triggers/{id}` → `triggers:read`
  - `POST /triggers`, `PATCH /triggers/{id}`, `DELETE /triggers/{id}`, `POST /triggers/{id}/test-fire` → `triggers:write`

### AuthZ v1 Behavior
- Admins: always allowed on guarded routes.
- Executors: allowed only when the policy entry sets `v1AllowExecutor: true` (typically read-only endpoints).
- How to guard a route:
  1) Add/update a `POLICY` entry in `src/authz/policy.ts` for the route signature.
  2) Wrap the handler: `server.get(path, requirePermission("GET /path")(handler))`.

### AuthZ v2 (Planned)
- Rules-based permissions backed by `PermissionPreset` and user `directPermissions` with a compiled, cached policy per user.
- Input guardrails for execute/create/update and 2FA enforcement for admin routes.

## Roadmap
- Admin UI, Recipient Portal, CLI, and built-in plugins are planned additions.
- See `docs/ROADMAP.md` for phased milestones.

## See Also
- `AGENTS.md`: Contributor-oriented architecture and guidelines.
- `packages/db/prisma/schema.prisma`: Data models for triggers/actions/audit/auth.
