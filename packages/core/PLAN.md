# PLAN.md — Patch OpenAPI Spec for Missing Admin, Portal, and Observability Endpoints (Spec-Only)

## Scope
Update only the OpenAPI (OAS) to cover the full MVP contract. Do NOT change DB or server code in this PR. The goal is to make the spec authoritative so frontends/CLI can proceed in parallel.

## What to keep (already good)
- Auth families (Admin magic-link, Recipient OTP, CLI device flow + API tokens)
- Files as first‑class objects, independent of bundles
- Bundles, Recipients, Plugins (list/install/uninstall), Health
- Split-file OAS structure and bundling scripts

## Changes to make

### 1) System & Observability
Add new path file openapi/paths/system.yaml and wire in root:
- GET /openapi.json — public; serves bundled JSON
- GET /health/live — public; liveness
- GET /health/ready — public; readiness (DB, queue, storage checks)
Keep GET /health (summary { status, queue, storage }) as-is.

### 2) Auth utilities (Admin & CLI)
In openapi/paths/auth/admin.yaml:
- GET /whoami — works with cookieAdmin OR bearer; returns { kind: "admin"|"cli", user, scopes? }
- GET /auth/sessions — list the caller’s active admin sessions (metadata only; spec now, impl later)
- POST /auth/sessions/revoke — body { sessionId }; 204

In openapi/paths/auth/cli.yaml:
- POST /auth/cli/tokens — create a token with { name?, scopes?, ttlDays? }; returns masked preview + token once
- POST /auth/cli/tokens/rotate — body { tokenId }; returns new token, old revoked

Security notes in each op:
- cookieAdmin for admin pages
- bearer for CLI token endpoints (also allow cookieAdmin where we want UI to manage tokens)

### 3) Files (Admin) — fuller object management
In openapi/paths/files.yaml:
- GET /files — add query params:
  - prefix (string)
  - q (string; optional free-text over key/metadata)
  - unassigned (boolean; files not referenced by any bundle) — spec only, impl later
  Returns Page<File>
- POST /files/upload — keep multipart upload; clarify 201 + ETag header
- POST /files/upload-url — returns { url, fields?, headers?, expiresAt } for pre-signed large uploads (optional path; spec now)
- GET /files/{id} — response schema = File
- PATCH /files/{id}/metadata — body { metadata: object<string,string> } → 204
- POST /files/{id}/move — body { newKey } → 204
- POST /files/batch/delete — body { ids: string[] } → 204
- POST /files/batch/move — body { items: { id, newKey }[] } → 204
- DELETE /files/{id} — 204
- GET /files/{id}/download — stream binary (admin)

### 4) Bundles (Admin)
In openapi/paths/bundles.yaml:
- GET /bundles — Page<Bundle>
- POST /bundles — { name, description? } → 201
- GET /bundles/{bundleId} — Bundle
- PATCH /bundles/{bundleId} — { name?, description? } → 204
- DELETE /bundles/{bundleId} — 204
- GET /bundles/{bundleId}/objects — Page<BundleObjectWithFile>
  - Define BundleObjectWithFile schema: { bundleObject: BundleObject, file: File }

### 5) Bundle Objects (Admin) — attach/detach/update
New file openapi/paths/bundle-objects.yaml:
- POST /bundles/{bundleId}/objects — body accepts one or many:
  - { fileId, path?, sortOrder?, required? } | { items: [...] }
  → 201 with created objects
- PATCH /bundles/{bundleId}/objects/{id} — { path?, sortOrder?, required? } → 204
- DELETE /bundles/{bundleId}/objects/{id} → 204

### 6) Recipients (Admin)
In openapi/paths/recipients.yaml:
- GET /recipients — Page<Recipient> with optional q
- POST /recipients — { email, displayName? } → 201
- GET /recipients/{recipientId} — Recipient
- GET /bundles/{bundleId}/recipients — { recipients: Recipient[] }
- POST /bundles/{bundleId}/recipients — { recipientId } → 204
- DELETE /bundles/{bundleId}/recipients — query recipientId → 204
- POST /bundles/{bundleId}/recipients/batch — { recipientIds: string[] } → 204

### 7) Portal (Recipient)
In openapi/paths/portal.yaml:
- GET /portal/me — recipient identity + allowed bundles (array of { bundleId, name })
- GET /portal/bundles — list accessible bundles (Page<Bundle>)
- GET /portal/bundles/{bundleId}/objects — Page<File> limited to attached files
- GET /portal/bundles/{bundleId} — download (stream) or 302 to signed URL
- POST /portal/auth/otp/resend — rate-limited resend; 204

### 8) Plugins & Capabilities (Admin)
In openapi/paths/plugins.yaml (keep):
- GET /plugins
- POST /plugins/install — { source, verifySignature? } → 202
- DELETE /plugins/{pluginId} → 204
Add openapi/paths/capabilities.yaml:
- GET /capabilities — { items: Capability[] } (merged registry; used to build forms)
- Optional soon: POST /plugins/{pluginId}/enable and /disable (spec placeholders ok)

### 9) Triggers / Actions / Pipelines (Admin)
In openapi/paths/triggers.yaml and actions.yaml:
- GET list, POST create, PATCH update, DELETE remove (already largely present; normalize shapes)
In openapi/paths/pipelines.yaml:
- GET /pipelines — Page<TriggerAction>
- POST /pipelines — { triggerId, actionId, sortOrder, enabled? } → 201
- PATCH /pipelines/{id} — { sortOrder?, enabled? } → 204
- DELETE /pipelines/{id} → 204
Optional stubs (commented in file): POST /triggers/{id}/test, POST /actions/{id}/test

### 10) Users (Admin)
In openapi/paths/users.yaml:
- GET /users — Page<User> with optional q
- PATCH /users/{id}/roles — { roles: string[] } → 204
- Optional: GET /users/{id} (spec only)

### 11) Components — schemas/parameters/security
Update or add schemas in openapi/components/schemas:
- Error: { error, message? }
- Page: { items: [], nextCursor?: string }
- File: { id(uuid), key, size(int), contentType, metadata(object<string,string>), etag?, createdAt?, updatedAt }
- ObjectMeta: keep if referenced elsewhere; prefer File for file endpoints
- Bundle, Recipient, Plugin, Capability, TriggerDefinition, ActionDefinition, TriggerAction, User
- BundleObject: { id, bundleId, fileId, path?, sortOrder?, required?, addedAt }
- BundleObjectWithFile: { bundleObject: BundleObject, file: File }
- DeviceStartResponse, DevicePollPending, DevicePollSuccess (ensure token_type enum includes bearer)
Parameters:
- Cursor (string), Limit (int 1..200 default 50)
Security:
- cookieAdmin (cookie lf_admin_sess), cookieRecipient (cookie lf_recipient_sess), bearer (http bearer, bearerFormat: opaque)

### 12) Error & security consistency
- Ensure every 4xx/5xx uses components/schemas/Error
- Each path declares the right security:
  - Admin routes → cookieAdmin (and optionally bearer for CLI-manageable ops)
  - CLI routes → bearer (also allow cookieAdmin where the UI manages tokens)
  - Portal routes → cookieRecipient
- Document 429 for rate-limited auth starts/verifies and device poll

### 13) Root wiring
In openapi/openapi.yaml:
- Add tags: System, Capabilities, Bundle Objects
- Reference new/updated path files with $ref fragments (anchors where used)
- Reference all components via $ref
- Keep servers / info as-is

### 14) Tooling (already present; reaffirm)
- oas:lint = redocly lint openapi/openapi.yaml
- oas:validate = swagger-cli validate openapi/openapi.yaml
- oas:bundle = redocly bundle openapi/openapi.yaml -o openapi/dist/openapi.json
- oas:preview = redocly preview-docs openapi/openapi.yaml

No server/DB changes in this PR. Add a note in the PR description that routes will be implemented to match the new contract in subsequent PRs.

## Acceptance Criteria
- Spec split remains valid; oas:validate and oas:lint pass without errors
- oas:bundle produces openapi/dist/openapi.json
- New endpoints appear with correct security blocks:
  - System: /openapi.json, /health/live, /health/ready
  - Auth utils: /whoami, /auth/sessions, /auth/sessions/revoke
  - CLI token mgmt: /auth/cli/tokens (create), /auth/cli/tokens/rotate
  - Files: list (prefix/q/unassigned), upload, upload-url, get, metadata patch, move, batch ops, delete, download
  - Bundles: CRUD + /objects listing
  - Bundle Objects: attach (single/batch), update, delete
  - Recipients: CRUD + attach/detach/list per bundle (+ batch attach)
  - Portal: me, bundles, bundle objects, download, otp/resend
  - Plugins & Capabilities: list/install/uninstall + /capabilities
  - Triggers/Actions/Pipelines: complete CRUD sets
  - Users: list + patch roles
- All list endpoints return Page shape { items, nextCursor }
- All error responses use the shared Error schema
- File schema is first‑class and used by file endpoints; Bundle membership handled via BundleObject endpoints
- No DB/server code changes included

## Notes
- Where behavior is “stream or 302”, document both responses; front-ends should handle either.
- The unassigned filter for /files is spec’d now; implementation later may require an index.
- Keep enums/strings broad enough (roles, scopes) to avoid breaking changes later.
