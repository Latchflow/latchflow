**Testing Overview**
- Goal: fast, reliable tests with no external dependencies beyond local containers and clear conventions across all workspaces.
- Tools: Vitest for unit/integration/e2e tests; MSW-based shared testkit for HTTP-layer mocking; Testcontainers (Postgres, MinIO, MailHog) for E2E when needed.

**Conventions**
- Unit tests (colocated): `src/**/<module>.test.ts` — one test file per module.
- All shared setup/helpers/fixtures: `packages|apps/*/tests/` (keep `src` for production code only).
- Global setup per workspace: `tests/setup/global.ts` (registered in Vitest config).
- Integration tests: `tests/integration/**/*.test.ts`.
- E2E tests: `tests/e2e/**/*.e2e.test.ts` (use Testcontainers; no external network).
- Import helpers from `tests` via the `@tests` alias (provided by Vitest alias; optional per‑package `tsconfig.test.json` can add editor path mapping).
- Run everything from repo root: `pnpm -r test` (workspace-aware).

**Running Tests**
- All workspaces: `pnpm -r test`
- Lint before commit: `pnpm -r lint`
- Per package (example):
  - All: `pnpm -F core test`
  - Unit only: `pnpm -F core test:unit`
  - Integration only: `pnpm -F core test:integration`
  - E2E only: `pnpm -F core test:e2e`

**Local Services For E2E**
- Preferred: let tests start containers on demand using Testcontainers.
- Alternative (manual): `docker compose up -d` (Postgres, MinIO, MailHog) for local debugging.
- Environment: copy `.env.defaults` to `.env` where needed; E2E tests should configure services programmatically.
- Rule of thumb: prefer unit/integration tests without containers; use E2E when exercising real persistence/storage flows is essential.

**Shared Testkit**
- Location: `packages/testkit/*` (e.g., `@latchflow/testkit-msw-handlers`).
- Purpose: consistent mocks/fixtures/scenarios for HTTP APIs across Core, CLI, Admin UI, and Portal.
- Quick start (Node + MSW):
  - `import { scenarios, makeHandlers } from '@latchflow/testkit-msw-handlers'`
  - `setupServer(...makeHandlers(scenarios.singleBundleHappyPath().handlers)({ http, HttpResponse }))`
  - `beforeAll(() => server.listen())`
  - `afterAll(() => server.close())`
  - `afterEach(() => server.resetHandlers())`
- Guidance:
  - Scenarios encapsulate common paths (happy-path auth, bundle browse/download, trigger/action flows).
  - Prefer scenario composition over ad-hoc mocks to keep tests declarative and maintainable.
  - Extend scenarios in `packages/testkit` when adding new product flows; avoid bespoke mocks per app when possible.

**Core Service Tests**
- Unit tests live in `packages/core/src/**/*.test.ts`.
- Global setup moves to `packages/core/tests/setup/global.ts` and can provide virtual mocks for unit tests (e.g., `@latchflow/db`) while E2E swaps to real clients via Testcontainers.
- History/Audit helpers (examples): `src/history/*.test.ts` exercise canonical serialization, ChangeLog materialization, and snapshot cadence. Keep IO mocked unless explicitly testing DB migrations or storage.

**CLI Tests (apps/cli)**
- Use the shared testkit to mock Core’s HTTP API (MSW in Node).
- For interactive flows (device code, polling), test logic in small units; use end-to-end tests with MSW for the HTTP exchanges.
- Avoid shelling out to a real binary in unit tests; prefer testing command handlers/functions directly. For E2E, spawn the CLI process inside the repo with controlled env and mocked network.

**Admin UI Tests (apps/admin-ui)**
- Unit/component tests: mock data via testkit scenarios + MSW (browser/JSDOM).
- Page/route tests: prefer Playwright (optional) with MSW for network; keep it local and deterministic.
- Do not hit real services; leverage the same scenarios as CLI/Portal for consistency.

**Portal Tests (apps/portal)**
- Mirror Admin UI approach: component tests plus MSW-powered route tests.
- Reuse testkit scenarios for recipient auth, OTP/magic link flows, listing bundles, and download initiation.

**Plugin Tests (packages/plugins/*)**
- Objective: validate plugin capability contracts (Trigger/Action) and configuration schemas.
- Recommended structure (TBD details as SDK matures):
  - Unit tests: validate plugin config parsing/validation (zod/json-schema), and pure business logic in isolation.
  - Contract tests: run plugin against a lightweight in-memory harness that simulates the Core runtime callbacks (capability registry, emit TriggerEvent/ActionInvocation), and assert emitted effects.
  - Integration tests: optional end-to-end with Core service in dev mode, mocked storage/email, and Postgres container.
- SDK/Harness (TBD):
  - Provide a `@latchflow/plugin-testkit` that spins a minimal runtime with your plugin registered, exposes hooks to fire triggers and observe actions, and supplies built-in mocks for storage/queue/email.
  - Ensure no real network calls; everything remains in-memory or containerized locally.

**Patterns And Anti-Patterns**
- Do:
  - Keep tests small and colocated; prefer explicit, descriptive scenarios.
  - Mock at the boundary (HTTP via MSW, storage via in-memory drivers), not deep inside functions.
  - Use fixtures/builders for repetitive setup; keep them in `packages/testkit` or `src/test-utils` per workspace.
- Avoid:
  - Hitting real external services.
  - Large fixture blobs checked into source; prefer builders and focused fixtures.
  - Catch-all “integration tests” that do everything; split into focused layers (unit, integration-with-mocks, e2e-with-local-services).
  - Splitting tests for a single module across multiple files; keep them in one `*.test.ts` sharing the module basename.

**CI Considerations**
- Run `pnpm -r lint` and `pnpm -r test`.
- Ensure CI runners have Docker available for Testcontainers.
- Type-checking: root TypeScript config excludes tests; rely on Vitest for test-time type checking or add optional per‑package `tsconfig.test.json`.
- Keep test output deterministic; default to MSW for network in unit/integration; E2E uses local containers only.

**FAQ**
- Where do I put a test-wide mock or polyfill? Use the workspace’s `tests/setup/global.ts`.
- How do I add a new scenario to the testkit? Add it under `packages/testkit` and publish it for all apps; avoid duplicating scenarios across apps.
- Can I add snapshot tests? Yes, but prefer specific assertions for logic-heavy code; snapshot rendering for UI is OK if stable.
