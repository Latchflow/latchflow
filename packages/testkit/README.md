# Latchflow Testkit

Shared API mocks, fixtures, and scenarios for unit/integration tests across Admin UI, Portal, and CLI. Provides a single source-of-truth mock layer aligned with the Core OpenAPI contract.

## What You Get
- API types: Lightweight TypeScript types for common entities and paging/error envelopes.
- Utils: Error catalog, auth gates, and pagination helpers.
- Fixtures: Deterministic factories for Files, Bundles, Recipients.
- Scenarios: Opinionated seeds (empty workspace, single bundle happy path) with in-memory store and runtime controls.
- MSW adapter: Build request handlers for Node and browser without hard-coding `msw` into the package.
- Spec hash: Script to emit a SHA256 hash of `openapi.json` for drift detection.

## Packages
- `@latchflow/testkit-api-types` — Core types + spec hash script
- `@latchflow/testkit-utils` — Error helpers, auth gates, pagination
- `@latchflow/testkit-fixtures` — Entity factories
- `@latchflow/testkit-scenarios` — In-memory store + scenarios
- `@latchflow/testkit-msw-handlers` — Adapter to MSW

All of these are internal workspace packages; they are not published to npm.

## Quick Start (Vitest + Node)
```ts
// test/setup.ts
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { scenarios, makeHandlers } from '@latchflow/testkit-msw-handlers';

const { handlers, controls } = scenarios.singleBundleHappyPath();
const server = setupServer(...makeHandlers(handlers)({ http, HttpResponse }));

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

// Optional: tweak auth on a per-test basis
// controls.auth.set('admin', false)
// controls.reset()
```

For browser tests (e.g., Playwright component or Storybook), use `setupWorker` from `msw` and pass the same `{ http, HttpResponse }` interface into `makeHandlers`.

## Scenarios & Controls
- `scenarios.emptyWorkspace()` — Empty DB; health OK.
- `scenarios.singleBundleHappyPath()` — 1 bundle, 2 files, 1 recipient; simple wiring.

Each scenario returns:
- `store`: In-memory store (Maps) you can read/inspect.
- `handlers`: Transport-agnostic route descriptors consumed by the MSW adapter.
- `controls`:
  - `auth`: `AuthGates` with `set(role, allowed)` toggles for `admin`, `recipient`, `cli`.
  - `reset()`: Clear and reseed the in-memory store to the original scenario seed.

## Endpoints Covered (initial)
- `GET /whoami`
- `GET /files`
- `GET /bundles`
- `GET /recipients`
- `GET /bundles/:bundleId/objects`

More endpoints (uploads, deletes, CLI auth, portal downloads) can be added incrementally.

## Fixtures
```ts
import { makeFile, makeBundle, makeRecipient } from '@latchflow/testkit-fixtures';

const file = makeFile({ name: 'notes.txt', size: 42 });
const bundle = makeBundle({ name: 'Release 1' });
const recip = makeRecipient({ email: 'user@example.com' });
```

Factories are deterministic by default; you can override fields to maintain referential integrity.

## Error Catalog
```ts
import { E, errorEnvelope } from '@latchflow/testkit-utils';
// E.UNAUTHORIZED, E.FORBIDDEN, E.NOT_FOUND, E.RATE_LIMITED, E.VALIDATION
```

Handlers wrap these into the standard error envelope shape.

## Contract Safety
- Run `pnpm -F @latchflow/testkit-api-types build` to write `packages/testkit/api-types/VERSION.json` with the SHA256 of `packages/core/openapi/dist/openapi.json`.
- In CI, compare the stored hash against a freshly computed one; fail if there’s drift without regeneration.

## TypeScript & Module Resolution
- The repo root `tsconfig.json` maps `@latchflow/testkit-*` to their `src` files, so you can import by package name during development without building.
- We use `"module": "NodeNext"`. Use explicit `.js` extensions for relative imports in ESM files.

If you adopt the testkit in another repo, either:
- Install the packages (so imports resolve to `dist`), or
- Mirror the `tsconfig` path mappings to point at `src`.

## Overriding Handlers in Tests
You can override a route for a specific test using `server.use`:
```ts
import { http, HttpResponse } from 'msw';

// Force files list to be empty for a specific test
server.use(
  http.get('*/files', () => HttpResponse.json({ items: [] }, { status: 200 }))
);
```

## FAQ
- Why not publish? This is an internal contract test/mocks kit tailored to our API lifecycle and CI checks.
- Is this for E2E? No. E2E should run against real services (Docker Compose). The testkit targets unit/integration tests.
- Can I add a new scenario? Yes. Create a new function alongside existing scenarios that seeds the in-memory store and returns route descriptors.

## Contributing
- Follow repo ESLint/Prettier rules (TypeScript strict).
- Don’t add network calls in tests. Keep mocks deterministic.
- Update this README and `packages/testkit/PLAN.md` as new endpoints and scenarios are added.

