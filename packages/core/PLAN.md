# PLAN — Add createdBy/updatedBy provenance and ChangeLog history

## Summary
Introduce provenance fields (createdBy, updatedBy) across key config entities and implement an append‑only ChangeLog with diffs plus configurable snapshotting. We will use an aggregate‑root ChangeLog strategy: history chains live on aggregates (e.g., Pipeline, Bundle) and capture their embedded children, avoiding duplicate per‑child logs. This aligns the data model with our audit‑first philosophy and enables “who changed what when” plus time‑travel reads.

We want to provide a knob that allows a user to choose whether they prefer to keep change records slim to preserve more disk space or make versions easier to reproduce by storing full snapshots more often so we've decided to make the interval between full snapshots adjustable via the `HISTORY_SNAPSHOT_INTERVAL` param.

## Goals
- Provenance: capture the actor for creations and updates.
- History: persist every configuration change as an immutable log entry.
- Recovery: allow reconstructing any past version quickly via periodic snapshots.
- Minimal friction: app‑layer implementation; no DB triggers.

## Scope
Entities receiving provenance fields (at minimum):
- Pipeline (aggregate root)
- PipelineStep (child of Pipeline)
- PipelineTrigger (child of Pipeline)
- Recipient (independent root)
- Bundle (aggregate root)
- BundleObject (child of Bundle)
- BundleAssignment (child of Bundle)
- TriggerDefinition (independent root)
- ActionDefinition (independent root)

New table:
- ChangeLog (aggregate history; entries are written for aggregate roots and independent roots only)

## Non‑Goals
- Runtime event history is unchanged: TriggerEvent, ActionInvocation, DownloadEvent remain as is.
- No UI for history browsing in this PR; we only add the backend foundation.
- No organization/tenant scoping changes.

## Schema Changes (Prisma)
- Add createdBy and updatedBy to the scoped entities above.
  - `createdByUserId` (string, nullable)
  - `updatedByUserId` (string, nullable)
  - `createdByActionId` (string, nullable)
  - `updatedByActionId` (string, nullable)
  - Check that exactly one of the `createdBy` fields is not null.
  - Check that exactly one of the `updatedBy` fields is not null.

-- Add ChangeLog table:
  - `id` (cuid)
  - `entityType` (string enum in code; aggregate/independent roots only: PIPELINE, BUNDLE, RECIPIENT, TRIGGER_DEFINITION, ACTION_DEFINITION)
  - `entityId` (uuid/string)
  - `version` (int, increments per entityType+entityId)
  - `isSnapshot` (boolean)
  - `state` (JSONB, nullable; present when isSnapshot=true)
  - `diff` (JSONB, nullable; present when isSnapshot=false)
  - `hash` (text; sha256 of the materialized post‑change state)
  - `actorType` (enum "USER" | "ACTION" | "SYSTEM"; SYSTEM reserved for scheduled/maintenance tasks)
  - `actorUserId` (nullable, only used if change was made by a human user)
  - `actorInvocationId` (nullable, FK to ActionInvocation.id; primary runtime provenance for ACTION)
  - `actorActionDefinitionId` (nullable, FK to ActionDefinition.id; which action definition effected the change)
  - `onBehalfOfUserId` (nullable, used to identify the user who kicked off an action that caused a change)
  - `changeNote` (text, nullable; optional human or auto-generated note describing the change)
  - `createdAt` (timestamp default now)
  - Unique index on (entityType, entityId, version)
  - Secondary index on (entityType, entityId, isSnapshot)
  - Optional: `changedPath` (text JSON Pointer to the primary changed subpath within the aggregate), `changeKind` (enum ChangeKind: ADD_CHILD | UPDATE_CHILD | REMOVE_CHILD | REORDER | UPDATE_PARENT)

- Prisma enums:
  - Add `ChangeKind` enum with values: `ADD_CHILD`, `UPDATE_CHILD`, `REMOVE_CHILD`, `REORDER`, `UPDATE_PARENT`.
  - Update `actorType` enum in code/migrations to include `SYSTEM`.

- Guardrails in SQL migration:
  - CHECK constraint to enforce exactly one of state or diff per row depending on isSnapshot.
  - DEFERRABLE unique constraints for sortOrder if not already present (PipelineStep by pipelineId, PipelineTrigger by triggerId).
  - Indexes via raw SQL: add DESC index on (entityType, entityId, version DESC) and a partial index on (entityType, entityId, version DESC) WHERE isSnapshot = true for nearest-snapshot scans.

## Runtime/Service Changes
- Add a provenance middleware/util that resolves the current actor userId for admin routes and service calls.
- Wrap each config mutation in a single transaction:
  1) Load current materialized aggregate state for the owner entity (aggregate root or independent root).
  2) Apply the mutation to the live row(s). For child edits, only the child rows and the parent aggregate's updatedBy/updatedAt are changed.
  3) Compute next version and write ChangeLog against the owner entity (aggregate root):
     - If snapshot interval reached or structural change, write snapshot row of the canonical aggregate (parent + embedded children).
     - Otherwise compute JSON Patch diff vs prior materialized aggregate state and write diff row.
     - Compute and store sha256 hash of the post‑change materialized aggregate state.
  4) Do not write ChangeLog rows for child tables; rely on the parent’s chain. Ensure parent aggregates are “touched” (updatedAt/updatedBy) on child edits.

### Concurrency & Versioning
- Lock owner row: for each mutation, `SELECT ... FOR UPDATE` the owner aggregate row (Pipeline/Bundle or independent root) to serialize concurrent mutations.
- Version allocation: read latest version for (entityType, entityId) inside the txn, compute next, and insert the ChangeLog row.
- Optimistic retry (optional): if skipping the row lock, catch unique violations on (entityType, entityId, version), refetch latest version, recompute, and retry up to a small cap.
- Reorders: ensure child sort-order uniques are DEFERRABLE and run reorders within a single transaction with constraints initially deferred.

- Config
  - Add env or config knob: HISTORY_SNAPSHOT_INTERVAL (default: 20).
  - Add MAX_CHAIN_DEPTH safety cap (default: 200) to force a snapshot if chains grow too long.
  - Define canonical aggregate serialization (stable ordering and redaction rules) for PIPELINE and BUNDLE materialization.

## Aggregate State Shape (Canonical)
- Principles: aggregate root embeds its children; exclude secrets, large blobs, volatile and non-config/runtime fields; keep ordering deterministic; keep payload minimal but sufficient to fully reconstruct. Examples are illustrative; defer to the Prisma schema for exact fields.
- Canonicalization rules:
  - Object keys sorted lexicographically during stringification for hashing.
  - Arrays sorted by `sortOrder` then `id` (as string compare) when present.
  - Omit volatile fields from canonical state to reduce noise: `createdAt`, `updatedAt` (timestamps), and DB-only linkage fields (FK backrefs). Keep `createdBy*/updatedBy*` only on the aggregate root object, not duplicated on children.
  - Redact secret-bearing config fields. Prefer references (`secretRef`) over placeholder masking so materialization can recover the effective config without exposing secrets in history.
  - Normalize: omit `undefined`, keep `null` as `null`; booleans and numbers use JSON primitives.

Example — Pipeline (aggregate root)
```json
{
  "id": "pl_123",
  "name": "Weekly Publishing",
  "description": "Publishes bundles every Friday",
  "isEnabled": true,
  "steps": [
    {
      "id": "ps_1",
      "actionId": "act_publish_s3",
      "sortOrder": 1,
      "isEnabled": true
    },
    {
      "id": "ps_2",
      "actionId": "act_email_notify",
      "sortOrder": 2,
      "isEnabled": true
    }
  ],
  "triggers": [
    {
      "triggerId": "tr_cron_friday",
      "sortOrder": 1,
      "isEnabled": true
    }
  ],
  "createdByUserId": "usr_abc",
  "updatedByUserId": "usr_abc"
}
```

Example — Bundle (aggregate root)
```json
{
  "id": "b_456",
  "name": "Q3 Finance Pack",
  "objects": [
    { "id": "bo_1", "fileId": "file_1", "path": "report.pdf", "required": true, "notes": null, "sortOrder": 1 },
    { "id": "bo_2", "fileId": "file_2", "path": "notes.txt",  "required": false, "notes": null, "sortOrder": 2 }
  ],
  "assignments": [
    { "id": "ba_1", "recipientId": "rcp_1", "maxDownloads": 3, "cooldownSeconds": 3600, "verificationType": "OTP" },
    { "id": "ba_2", "recipientId": "rcp_2", "maxDownloads": 1, "cooldownSeconds": null,  "verificationType": null }
  ],
  "policy": { "rateLimitPerRecipient": 2 },
  "createdByUserId": "usr_abc",
  "updatedByUserId": "usr_xyz"
}
```

Hashing and diffing
- Hash the canonical JSON string of the aggregate after applying redaction and ordering rules.
- JSON Patch diffs are computed against the canonical aggregate object; `changedPath` should be a JSON Pointer within this shape (e.g., `/steps/1/actionId`, `/steps/0/sortOrder`, `/assignments/0/maxDownloads`).

## Exclusions Per Entity (Volatile and Non-Config)
- General exclusions across all aggregates/children:
  - Timestamps: `createdAt`, `updatedAt`, and child `addedAt`/`lastDownloadAt`.
  - DB linkage keys within children that are redundant in the aggregate: e.g., `pipelineId` on `PipelineStep`/`PipelineTrigger`, `bundleId` on `BundleObject`/`BundleAssignment`.
  - Creator/updater on children: exclude `createdBy`/`updatedBy` from child objects in canonical state; retain on the aggregate root.
  - Runtime/derived fields: counters, statuses, verification flags, and checksums not part of configuration.
- Pipeline (aggregate root): include `id`, `name`, `description`, `isEnabled`, ordered `steps` and `triggers`. Exclude `createdAt`, `updatedAt`.
- PipelineStep (child): include `id`, `actionId`, `sortOrder`, `isEnabled`. Exclude `pipelineId`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`.
- PipelineTrigger (child): include `triggerId`, `sortOrder`, `isEnabled`. Exclude `pipelineId`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`.
- Bundle (aggregate root): include `id`, `name`, ordered `objects` and `assignments`, and any policy/config fields. Exclude `createdAt`, `updatedAt`, `storagePath`, `checksum` if these are derived from the underlying files/storage.
- BundleObject (child): include `id`, `fileId`, `path`, `required`, `notes`, `sortOrder`. Exclude `bundleId`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, `addedAt`.
- BundleAssignment (child): include `id`, `recipientId`, `maxDownloads`, `cooldownSeconds`, `verificationType`. Exclude `bundleId`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, `verificationMet`, `lastDownloadAt`.
- Recipient (independent root): include `id`, `email`, `name`, `isEnabled` if present, and keep root `createdBy`/`updatedBy`. Exclude `createdAt`, `updatedAt`.
- TriggerDefinition (independent root): include `id`, `name`, `capabilityId`, redacted `config`, `isEnabled`, keep root `createdBy`/`updatedBy`. Exclude `createdAt`, `updatedAt`.
- ActionDefinition (independent root): include `id`, `name`, `capabilityId`, redacted `config`, `isEnabled`, keep root `createdBy`/`updatedBy`. Exclude `createdAt`, `updatedAt`.

## API Changes (in this PR, backend only)
- No route shape changes required to land this.
- Internally record createdBy/updatedBy on create/update endpoints for the affected entities.
- Prepare follow‑up routes for history:
  - GET /{entity}/{id}/history (list versions)
  - GET /{entity}/{id}/history/{version} (materialized state at version)
  These can be added in a subsequent PR.

## Migration Plan
1) Add columns createdBy and updatedBy to target tables.
   - Backfill: set createdBy to a “system” user id for existing rows, or null if we allow nullable.
   - Leave updatedBy null for existing rows.

2) Create ChangeLog table and supporting indexes and CHECK constraint.

3) Add service‑layer helpers for:
   - serializeAggregate(entityType, id): canonical aggregate JSON (parent + children) without blobs/secrets for PIPELINE and BUNDLE; canonical entity JSON for independent roots
   - computePatch(prev, next): RFC6902 JSON Patch
   - applyPatch(state, patch): materialize forward
   - appendChangeLog(tx, args): writes a row with versioning and hashing
   - materializeVersion(entityType, id, version): loads nearest snapshot and applies diffs to reconstruct the aggregate/entity

4) Update mutations for entities in scope to:
   - require actor id
   - write ChangeLog inside the same transaction for the owner (aggregate root or independent root) only
   - update updatedBy on the touched entity and the parent aggregate where applicable

5) Add unit tests:
   - Creating a Pipeline writes ChangeLog v1 snapshot of the aggregate; updates to the Pipeline or its children write diffs; every Nth change writes a snapshot.
   - Child edits (e.g., add/remove/reorder steps, add/remove triggers) write exactly one ChangeLog row on the Pipeline and none on child tables.
   - Reordering steps produces a diff and materializes correctly.
   - Bundle child edits (objects/assignments) behave identically at the Bundle aggregate.
   - Hash mismatch detection rejects corrupted chains.
   - updatedBy reflects the actor on both the touched child and the parent; createdBy set on create.

6) Add seed/migration shims:
   - Provide a “system” user id or allow null createdBy for seeds.
   - Backfill initial v1 snapshots for existing aggregates/entities to anchor history going forward (Pipeline, Bundle, Recipient, TriggerDefinition, ActionDefinition).

7) Enums and metadata:
   - Add Prisma enum `ChangeKind` and wire `ChangeLog.changeKind` (nullable) to it.
   - Extend `actorType` to include `SYSTEM`; backfill existing rows as USER/ACTION accordingly; set `SYSTEM` for future scheduled/maintenance changes.

## Rollback Plan
- Schema: keep ChangeLog table and columns; code paths can be turned off by a feature flag if necessary.
- Data: since ChangeLog is append‑only, it’s safe to leave in place; we can prune by entity later.

## Observability
- Add structured logs around ChangeLog writes and version materialization latency.
- Emit counters: changelog_writes_total, changelog_snapshots_total, changelog_materialize_failures_total.

## Security and Compliance
- Ensure createdBy/updatedBy come from authenticated admin context; never accept them from client payloads.
- Exclude secrets and large blobs from snapshots; store references instead.
- Hash the materialized aggregate/entity state to make the history chain tamper‑evident.

## Open Questions
- Do we need per‑entity overrides for snapshot interval or per‑aggregate overrides?
- Should we expose effectiveUpdatedAt for triggers derived from attached pipelines in a read projection (not persisted)?
- Do we want a changeNote field in ChangeLog to allow commit‑style messages from the UI?

## Acceptance Criteria
- All scoped entities persist createdBy/updatedBy correctly.
- ChangeLog entries are written only for aggregate roots and independent roots, capturing child edits under the parent aggregate chain, with the configured snapshot cadence.
- Materializing any historical version returns a consistent aggregate/entity object.
- Tests cover create, update, reorder, snapshot cadence, and tamper detection.
- No changes to public API response shapes in this PR.
