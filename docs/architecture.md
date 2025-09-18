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

## History & ChangeLog Strategy

Latchflow records configuration changes using a parent‑aggregate ChangeLog. Only aggregate roots (Pipeline, Bundle, Recipient, TriggerDefinition, ActionDefinition) receive history rows; child mutations are captured by serialising the full parent state.

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
