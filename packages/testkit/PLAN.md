# Latchflow Testkit — Shared API Mocks & Contract Testing Plan

Audience: Admin UI, Portal, CLI teams • Owners: DX/Test WG • Status: Draft (v0)

> Goal: one **source‑of‑truth mock layer** for all apps that mirrors the OpenAPI contract, runs in Node **and** browser, and makes “happy path” and edge‑case tests trivial without spinning up the Core service.

---

## 1) Why a shared suite?

* **Consistency:** All apps test against identical behavior/messages, so UX and error handling match.
* **Contract safety:** Mocks are generated/validated from `openapi.json` so drift is visible early.
* **Speed:** Unit/integration tests avoid Docker; E2E keeps using the real stack.

---

## 2) Packages (pnpm workspaces)

```
packages/
  testkit/
    api-types/         # generated TS types from OpenAPI (+ zod validators)
    msw-handlers/      # request handlers for both Node & browser
    fixtures/          # factories for spec schemas (Bundle, File, Recipient, ...)
    scenarios/         # opinionated seeds ("empty", "one-bundle", errors)
    utils/             # common helpers: paging, auth gates, error envelopes
```

Publish each as an internal package (no npm publish): `@latchflow/testkit-*`.

---

## 3) Tech choices

* **Types/validators:** `openapi-typescript` for types; `zod` schemas generated via a small adapter (or hand‑rolled for critical shapes).
* **HTTP mocking:** **MSW** (Mock Service Worker) with `@mswjs/interceptors` for Node. Works for React apps, Next.js, and CLI (Node 20). No network calls during unit tests.
* **Optionally**: **Prism** mock server (Stoplight) for manual dev against fake endpoints. Useful for quick demos but not required for unit tests.

---

## 4) Handlers design

* Handlers live at `packages/testkit/msw-handlers/src/handlers.ts` and map 1:1 to OpenAPI paths.
* Backed by an **in‑memory store** (Maps) seeded by scenario objects.
* **Auth gates**: simulate `cookieAdmin`, `cookieRecipient`, and `bearer` via flags and headers. Expose toggles to force 401/403/429.
* **Pagination**: helpers implement `limit/cursor` consistently.
* **Errors**: always return the canonical `Error` envelope with `code`, `message`, and `requestId`.

Example handler sketch:

```ts
// GET /bundles
http.get(api('/bundles'), ({ request, cookies, url }) => {
  requireAdmin(cookies); // throws to standardize 401
  const { items, nextCursor } = paginate(db.bundles, url.searchParams);
  return HttpResponse.json({ items, nextCursor });
});
```

---

## 5) Fixtures & factories

* One factory per schema in `openapi.json` with stable defaults and overridable fields.
* Deterministic IDs/time unless `opts.random` is set.
* Attach cross‑references correctly (e.g., `BundleObject.fileId` matches a File in the store).

Factories:

```ts
makeFile(overrides?) => File
makeBundle(overrides?) => Bundle
makeBundleObject({ bundleId, fileId, ... }) => BundleObject
makeRecipient(overrides?) => Recipient
...
```

---

## 6) Scenarios

* `emptyWorkspace()` — no data; health OK.
* `singleBundleHappyPath()` — 1 bundle, 2 files, 1 recipient, simple pipeline.
* `downloadLimited()` — bundle with per‑recipient cooldown + maxDownloads enforced.
* `authRequired()` — force 401s until login helpers invoked.
* `rateLimited()` — 429s with retry‑after on selected routes.
* `validationErrors()` — simulate missing fields, bad enums, etc.

Each returns `{ dbSeed, handlers, controls }` where `controls` exposes runtime knobs (enable/disable auth, inject next error, clear store…).

---

## 7) Using in each app

### Admin UI / Portal (Next.js + Vitest)

```ts
// apps/admin-ui/test/setup.ts
import { setupServer } from 'msw/node';
import { makeHandlers, scenarios } from '@latchflow/testkit-msw-handlers';

const { handlers, controls } = scenarios.singleBundleHappyPath();
export const server = setupServer(...makeHandlers(handlers));

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
```

### CLI (Node 20 + undici)

```ts
// apps/cli/test/setup.ts
import { setupServer } from 'msw/node';
import { handlers } from '@latchflow/testkit-msw-handlers';

const server = setupServer(...handlers());
beforeAll(() => server.listen());
afterAll(() => server.close());
```

---

## 8) Contract‑safety checks

* **Spec hash guard:** generate a SHA256 of `openapi.json` during build and emit to `packages/testkit/api-types/VERSION.json`.
* In CI, fail if the spec hash changed without re‑generating testkit artifacts.
* **Runtime validation:** in `dev` mode, validate mock responses against zod schemas and log when mocks drift.

---

## 9) Error catalog (stable codes)

Create `packages/testkit/utils/error.ts`:

```ts
export const E = {
  UNAUTHORIZED: { code: 'UNAUTHORIZED', message: 'Login required' },
  FORBIDDEN:    { code: 'FORBIDDEN', message: 'Not allowed' },
  NOT_FOUND:    { code: 'NOT_FOUND', message: 'Not found' },
  RATE_LIMITED: { code: 'RATE_LIMITED', message: 'Too many requests' },
  VALIDATION:   { code: 'VALIDATION_ERROR', message: 'Invalid input' },
} as const;
```

Handlers wrap these into the standard error envelope.

---

## 10) Streaming & uploads

* **Downloads**: return a small Buffer/Blob stream in mocks; attach `content-type` headers where the spec says `octet-stream`.
* **Uploads**: accept `multipart/form-data`, store a tiny Buffer; respect `contentType` and echo `ETag`.

---

## 11) Prism (optional local mock server)

Provide a script:

```
pnpm -F testkit-api-types prism:mock # spins up Prism against openapi.json
```

Use only for manual dev (storybook, quick demos). Unit tests should keep using MSW/interceptors for speed and reliability.

---

## 12) Developer ergonomics

* `createClient()` helper that reads `process.env.LF_API_URL` and wires MSW when tests run.
* Factories ship with `faker` opt‑in to randomize content while keeping referential integrity.
* Snapshot‑friendly: provide pretty‑print helpers that strip volatile fields.

---

## 13) Versioning & governance

* Owner: DX/Test WG
* Release: bump minor when adding routes/fields, major on breaking changes.
* CI job `testkit-verify` blocks merges when OpenAPI changed but testkit not re‑generated.

---

## 14) Rollout plan

1. Scaffold `packages/testkit/*` and add generator scripts.
2. Implement minimal handlers for: `/whoami`, `/files` (list/upload/delete), `/bundles` (CRUD), `/bundles/{id}/objects`, `/recipients` (CRUD), `/auth/cli/*`.
3. Swap Admin UI, Portal, and CLI unit tests to use the shared handlers.
4. Add scenarios for 401/403/429 and validation errors.
5. Add streaming/download and upload coverage.

**Definition of Done**

* Apps can run unit tests without Core.
* Error surfaces are consistent across apps.
* CI fails when spec drifts without mock regeneration.

---

## 15) Open questions

* Do we want Prism in CI for contract tests alongside MSW? (default: not required)
* Should factories be purely deterministic by default? (default: yes)
* Do we mock the portal archive route as a real zip stream or as a placeholder download? (default: placeholder)
