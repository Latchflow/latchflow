**Testing Overview**
- Goal: fast, reliable tests with no external dependencies and clear conventions across all workspaces.
- Tools: Vitest for unit/integration tests; MSW-based shared testkit for HTTP-layer mocking; Docker services (Postgres, MinIO, MailHog) for E2E when needed.

**Conventions**
- Colocation: place unit tests next to the code they cover using `*.test.ts` or `*.spec.ts`.
- Global setup (Core): `packages/core/src/test/setup.ts` is reserved for bootstrap only (e.g., virtual mocks). Do not add tests under `src/test`.
- No external network calls: mock everything (use MSW/fixtures for HTTP and in-memory/test doubles for other IO).
- Run everything from repo root: `pnpm -r test` (workspace-aware).

**Running Tests**
- All workspaces: `pnpm -r test`
- Lint before commit: `pnpm -r lint`
- Core only: `pnpm -F core test` (and `pnpm -F core test:coverage` if defined)
- DB client: `pnpm -F db test` (if present)

**Local Services For E2E**
- Start dev dependencies: `docker compose up -d` (Postgres, MinIO, MailHog)
- Environment: copy `.env.defaults` to `.env` where needed; tests may read from `.env.defaults` via project scripts.
- Rule of thumb: prefer unit/integration tests without containers; reach for E2E only when exercising real persistence/storage flows is essential.

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
- A minimal virtual mock for `@latchflow/db` is provided in `packages/core/src/test/setup.ts` to prevent accidental DB resolution in unit tests; integration/E2E can replace it with a real client as needed.
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

**CI Considerations**
- Run `pnpm -r lint` and `pnpm -r test`.
- For E2E that require containers, start Docker services before the test step.
- Keep test output deterministic; default to MSW for network to avoid flakiness.

**FAQ**
- Where do I put a test-wide mock or polyfill? Use the workspace’s setup file (e.g., Core’s `src/test/setup.ts`).
- How do I add a new scenario to the testkit? Add it under `packages/testkit` and publish it for all apps; avoid duplicating scenarios across apps.
- Can I add snapshot tests? Yes, but prefer specific assertions for logic-heavy code; snapshot rendering for UI is OK if stable.

