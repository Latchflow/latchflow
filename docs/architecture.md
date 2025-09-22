# Latchflow Architecture

This document explains the runtime shape and key flows with an emphasis on the portal auth model, assignment enforcement, and the bundle auto‑rebuild pipeline.

## Portal Auth (Account‑Scoped)

- Recipients authenticate via OTP and establish a cookie session that is not tied to a specific bundle.
- After login, authorization checks are done per request:
  - Lists only show enabled bundles and files the recipient is assigned to.
  - Downloads enforce limits atomically (see below).

### Endpoints
- `GET /portal/me` — identity and accessible bundles (`{ bundleId, name }`).
- `GET /portal/bundles` — cursor‑paginated view over enabled assignments.
- `GET /portal/bundles/{bundleId}/objects` — enabled files within the bundle.
- `GET /portal/bundles/{bundleId}` — stream zipped bundle artifact.
- `GET /portal/assignments` — per‑assignment summary (downloads used/remaining, cooldown timing).

### Assignment Enforcement
- Every download runs inside an atomic guard:
  - Counts used downloads, compares against `maxDownloads`.
  - Checks `lastDownloadAt + cooldownSeconds` against now.
  - Inserts a `DownloadEvent` and updates `lastDownloadAt` when allowed.

### Enable/Disable Flags
- The following flags control access without data deletion:
  - `Recipient.isEnabled`
  - `Bundle.isEnabled`
  - `BundleAssignment.isEnabled`
  - `BundleObject.isEnabled`

## Bundle Artifacts & Auto‑Rebuilds

### Storage & ETags
- Bundles are stored as zip archives in object storage.
- Downloads prefer the storage‑native `ETag`; fallback to the DB checksum (sha256) if the HEAD call fails.

### Composition Digest
- `Bundle.bundleDigest` stores a sha256 over ordered contents `{ fileId, file.contentHash, path, required, sortOrder }`.
- Rebuilds skip when the newly computed digest matches the stored one (unless `force` is used).

### Rebuilder
- In‑memory scheduler per process:
  - Debounces rebuild requests per bundle (2s by default).
  - Coalesces concurrent requests and guarantees one build flight at a time.
  - Records last result (`built` or `skipped`).
- Triggers:
  - File content changes (upload or commit) locate referencing bundles and enqueue rebuilds.
  - Lazy backstop: portal routes compute digest and enqueue when drift is detected; serving is never blocked.
  - BundleObject CRUD/reorder hooks enqueue directly (implemented in admin bundle-objects routes).

### Manual Admin Control
- `POST /admin/bundles/{bundleId}/build` — enqueues an async build; supports `{ force: boolean }`.
- `GET /admin/bundles/{bundleId}/build/status` — returns `idle|queued|running`, current pointers, and last result.

### Atomic Pointer Update
- Builds stream files into a deterministic zip, upload via storage service, then atomically update:
  - `Bundle.storagePath` to the new object key
  - `Bundle.checksum` to the storage ETag (fallback sha256)
  - `Bundle.bundleDigest` to the computed digest
- Old artifacts continue to serve until the pointer swap completes.

## Admin Assignment Summaries

- Admin views expose the same status calculations used by the portal:
  - `GET /admin/bundles/{bundleId}/assignments`
  - `GET /admin/recipients/{recipientId}/assignments`
- Items include: downloads used/remaining, cooldown timing, enable flags, and labels.

## Plugin Registry (Overview)

- Triggers and actions are declared by installed plugins and registered at startup.
- The core runtime orchestrates trigger → action pipelines; no hard‑coded types.

## Admin Authorization (AuthZ v2)

Latchflow’s admin/executor API now enforces compiled, rule‑based authorization instead of coarse role checks.

### Data model
- `PermissionPreset` stores the canonical rule list (`Permission[]`) and maintains a monotonically increasing `version`.
- Every user stores `permissionPresetId`, optional `directPermissions`, and a deterministic `permissionsHash` (SHA‑256) over the effective rule bundle. Presets or direct edits must recompute this hash so caches stay coherent.

### Evaluation pipeline
1. The HTTP layer resolves a route signature to a policy entry (see `packages/core/src/authz/policy.ts`).
2. Rules are compiled via `compilePermissions` into per-resource/action buckets and cached per `rulesHash`.
3. Each candidate rule evaluates its `where` constraints (bundle IDs, pipeline IDs, trigger/action kinds, tags, environments, `ownerIsSelf`, and optional time windows).
4. Matched rules apply input guards before side effects (`allowParams`, `denyParams`, `schemaRefs`, `valueRules`, `rateLimit`, `dryRunOnly`). Rate-limit violations immediately return `429`.
5. Successful matches emit OpenTelemetry metrics (`authz_decision_total`, cache/compilation counters, 2FA events) with provenance (`rulesHash`, `presetId`, `ruleId`).

### Cache behaviour
- Compiled bundles live in an in-memory cache keyed by `rulesHash`.
- Invalidation triggers include preset edits, activations/rollbacks, direct rule updates, and feature-flag flips (`AUTHZ_V2`, `AUTHZ_V2_SHADOW`).

### 2FA & re-auth enforcement
- When `AUTHZ_REQUIRE_ADMIN_2FA=1`, all admin routes require an MFA-enrolled account plus a recent challenge within `AUTHZ_REAUTH_WINDOW_MIN` minutes.
- Failures return `401` with `{ "status": "error", "code": "MFA_REQUIRED" }`. Sessions past the re-auth window surface `code: "MFA_REQUIRED"` and `reason: "stale_reauth"` in metrics.

### Simulator endpoint
- `POST /admin/permissions/simulate` evaluates a hypothetical request in shadow mode without executing side effects.
- Request body:
  ```json
  {
    "userId": "usr_123",
    "method": "POST",
    "path": "/actions",
    "body": { "name": "My Action", "capabilityId": "cap_webhook" }
  }
  ```
- Response fields include `decision` (`ALLOW|DENY`), `reason`, `rulesHash`, matched rule metadata, and preset provenance.
- Simulations emit `authz_simulation_total` metrics for observability.

### Permission preset API surface
- `GET /admin/permissions/presets` — list presets (cursor pagination, search via `q` or `updatedSince`).
- `POST /admin/permissions/presets` — create preset with rules.
- `GET /admin/permissions/presets/{id}` — fetch current version (includes `rulesHash`).
- `PATCH /admin/permissions/presets/{id}` — rename or update rules in place.
- `DELETE /admin/permissions/presets/{id}` — returns `409` when assigned; prefer toggling `isEnabled` when added.
- Versioning endpoints (`/versions`, `/versions/{version}`, `/versions/{version}/activate`) are backed by ChangeLog snapshots.

### Rollout playbook
1. Ship with `AUTHZ_V2_SHADOW=1`, `AUTHZ_V2=0` to record would-deny metrics without blocking traffic.
2. Monitor `authz_decision_total{effectiveDecision="deny", evaluationMode="shadow"}` to find gaps.
3. Populate presets/direct rules, recompute `permissionsHash`, and replay simulator scenarios for high-risk routes.
4. Flip `AUTHZ_V2=1` once denial metrics converge to the expected baseline; retain shadow logging for at least one release.
5. Enforce administrator MFA (`AUTHZ_REQUIRE_ADMIN_2FA=1`) before enabling enforce mode in production.

## History & ChangeLog Strategy

Latchflow records configuration changes using a parent‑aggregate ChangeLog. Aggregate roots (Pipeline, Bundle, Recipient, TriggerDefinition, ActionDefinition, User) receive history rows; child mutations are captured by serialising the full parent state.

- **Aggregate snapshots vs. diffs** — Every ChangeLog entry stores either a full canonical snapshot (`isSnapshot=true`) or a JSON Patch diff against the previous version. Snapshot cadence is controlled by `HISTORY_SNAPSHOT_INTERVAL`, with an additional guard (`HISTORY_MAX_CHAIN_DEPTH`) that forces a snapshot when diff chains grow too long.
- **Canonical serialisation** — Each aggregate is materialised via `serializeAggregate`, which orders child collections deterministically, redacts sensitive config, and omits volatile fields like timestamps, linkage IDs, and child provenance. Hashes are computed from this canonical JSON to detect drift.
- **Append‑only provenance** — Entries include actor context (`actorType`, `actorUserId`, `actorInvocationId`, etc.) and optional `changeNote`/`changedPath` metadata so we can answer “who changed what, when”. Application code never mutates an existing ChangeLog row.
- **Parent responsibility** — Any write that affects an aggregate (including step reorders, trigger attachments, or bundle assignment edits) must update the parent’s `updatedBy` and append a ChangeLog row for that parent aggregate. Children do not have independent history tables.
- **Materialisation** — Historical reads use `materializeVersion`, which walks the ChangeLog entries for an aggregate, applies the latest snapshot, then replays diffs to build the requested version.

This strategy keeps history compact while ensuring we can time‑travel entire aggregates without redundant per‑child logs. When adding new admin endpoints (e.g., pipelines/steps), ensure mutations flow through the same helper APIs so provenance and ChangeLog state remain consistent.
## Admin Bundle Objects

- Endpoints to manage attachments within a bundle:
  - `GET /bundles/{bundleId}/objects` — returns `BundleObjectWithFile[]` in `sortOrder`.
  - `POST /bundles/{bundleId}/objects` — attach files; defaults `path` to `File.key`, `sortOrder` to `max+1`; idempotent on `(bundleId,fileId)`.
  - `PATCH /bundles/{bundleId}/objects/{id}` — update `path`, `sortOrder`, `required`, `isEnabled`.
  - `DELETE /bundles/{bundleId}/objects/{id}` — detach (idempotent).

Semantics
- Every write schedules a debounced rebuild for the bundle.
- Rebuilds are coalesced; one build flight at a time; existing artifact continues to serve.
- The HTTP layer uses POST for updates internally; the OpenAPI exposes both PATCH (preferred) and a POST alias to reflect this.
