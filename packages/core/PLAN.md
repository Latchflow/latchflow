# PLAN.md — Patch OpenAPI Spec to Align With File-First Model & Admin/Portal/CLI Needs

## Scope
Only modify the OpenAPI (OAS) to match our API plan. Do NOT implement DB or server route code in this PR. The goal is to:
- Represent files as first‑class objects independent of bundles.
- Add missing endpoints for file CRUD, bundle–file join management, portal access, plugins/capabilities, and system endpoints.
- Normalize schemas (Error, Page, ObjectMeta, File, BundleObject) and security across paths.
- Split OAS into modular files and add a bundled artifact.

---

## Tasks

### 1) Restructure the spec into multiple files
Create folder layout:
- openapi/openapi.yaml                       # root orchestrator (3.1)
- openapi/paths/
  - health.yaml
  - system.yaml                               # /openapi.json, /health/live, /health/ready
  - auth/
    - admin.yaml
    - recipient.yaml
    - cli.yaml
  - files.yaml
  - bundles.yaml
  - bundle-objects.yaml                       # attach/detach/update listing
  - recipients.yaml
  - plugins.yaml
  - capabilities.yaml
  - triggers.yaml
  - actions.yaml
  - pipelines.yaml
  - users.yaml
  - portal.yaml
- openapi/components/
  - schemas/
    - Error.yaml
    - Page.yaml
    - ObjectMeta.yaml
    - File.yaml
    - Bundle.yaml
    - BundleObject.yaml
    - Recipient.yaml
    - Plugin.yaml
    - Capability.yaml
    - TriggerDefinition.yaml
    - ActionDefinition.yaml
    - TriggerAction.yaml
    - User.yaml
    - DeviceStartResponse.yaml
    - DevicePollPending.yaml
    - DevicePollSuccess.yaml
  - parameters/
    - Cursor.yaml
    - Limit.yaml
  - securitySchemes/
    - cookieAdmin.yaml
    - cookieRecipient.yaml
    - bearer.yaml

Update openapi/openapi.yaml:
- Keep info/servers/tags.
- Replace inline paths/components with $ref entries pointing to the files above.

### 2) Normalize security & conventions
- Security schemes:
  - cookieAdmin: apiKey in cookie lf_admin_sess
  - cookieRecipient: apiKey in cookie lf_recipient_sess
  - bearer: http bearer (opaque) — set bearerFormat to opaque and description to “CLI API token”
- Conventions:
  - Pagination params: cursor (string), limit (1..200, default 50)
  - Pagination shape in responses: { items: T[], nextCursor?: string }
  - Errors: { error: string, message?: string } for all 4xx/5xx responses
  - All admin write operations require cookieAdmin
  - CLI endpoints accept bearer; some may also allow cookieAdmin (e.g., listing tokens in the UI)
  - Portal endpoints require cookieRecipient

### 3) Schemas — add/replace
- Error.yaml
  type: object; required: [error]; properties: error (string), message (string)
- Page.yaml
  type: object; required: [items]; properties: items (array, any), nextCursor (string, nullable)
- ObjectMeta.yaml
  type: object; required: [id, updatedAt]; properties: id (uuid), updatedAt (date-time), createdAt (date-time)
- File.yaml  (first‑class file)
  required: [id, key, size, contentType, updatedAt]
  properties: id (uuid), key (string), size (integer), contentType (string), metadata (object<string,string>), etag (string), updatedAt (date-time)
- Bundle.yaml
  required: [id, name, ownerId, createdAt]; properties: id (uuid), name, description?, ownerId, createdAt (date-time)
- BundleObject.yaml  (bundle–file join)
  required: [id, bundleId, fileId]
  properties: id (uuid), bundleId (uuid), fileId (uuid), path (string), sortOrder (integer), required (boolean), addedAt (date-time)
- Recipient.yaml
  required: [id, email]; properties: id (uuid), email (email), displayName?
- Plugin.yaml
  required: [id, name, version, capabilities]; properties: id (uuid), name, version, capabilities (Capability[])
- Capability.yaml
  required: [kind, key, displayName]; properties: kind (enum TRIGGER|ACTION), key (string), displayName (string), jsonSchema (object)
- TriggerDefinition.yaml / ActionDefinition.yaml / TriggerAction.yaml / User.yaml
  Align to earlier plan: include id/createdAt where applicable and use capabilityKey + config + enabled for definitions.
- Device* schemas
  Keep DeviceStartResponse / DevicePollPending / DevicePollSuccess; ensure token_type enum: bearer.

### 4) Paths — add/mutate to match the plan
Keep existing paths that already match; otherwise replace/extend as below.

#### System
- GET /openapi.json                      # public; serves bundled JSON (see tooling)
- GET /health/live                       # public; liveness
- GET /health/ready                      # public; readiness
- GET /health                            # summary { status, queue, storage } (keep)

#### Auth (Admin)
- POST /auth/admin/start                 # body { email }
- GET  /auth/admin/callback?token=...    # 204 or 302; sets cookie
- POST /auth/admin/logout
- GET  /auth/me                          # returns { user, session }
- GET  /whoami                           # unified identity (cookieAdmin or bearer): { kind: "admin"|"cli", user, scopes? }

#### Auth (Recipient)
- POST /auth/recipient/start             # body { recipientId, bundleId }
- POST /auth/recipient/verify            # body { recipientId, bundleId, otp }
- POST /auth/recipient/logout

#### Auth (CLI)
- POST /auth/cli/device/start            # body { email, deviceName? } → DeviceStartResponse
- POST /auth/cli/device/approve          # admin only; body { user_code }
- POST /auth/cli/device/poll             # body { device_code } → Pending/Success
- GET  /auth/cli/tokens                  # allow cookieAdmin or bearer
- POST /auth/cli/tokens/revoke           # allow cookieAdmin or bearer; body { tokenId }

#### Files (admin)
- GET    /files                          # list with optional ?prefix=&unassigned=bool (paging)
- POST   /files/upload                   # multipart: { key, file, contentType?, metadata? } → 201 + ETag header
- GET    /files/{id}                     # metadata (File schema)
- POST   /files/{id}/move                # body { newKey } → 204
- DELETE /files/{id}                     # 204 (optionally require If-Match)
- GET    /files/{id}/download            # stream (admin)

#### Bundles (admin)
- GET    /bundles                        # page
- POST   /bundles                        # create { name, description? }
- GET    /bundles/{bundleId}
- PATCH  /bundles/{bundleId}             # update name/description
- DELETE /bundles/{bundleId}
- GET    /bundles/{bundleId}/objects     # list BundleObject + embedded file metadata (paged)

#### Bundle Objects (admin)
- POST   /bundles/{bundleId}/objects     # attach one or many files: [{ fileId, path?, sortOrder?, required? }]
- PATCH  /bundles/{bundleId}/objects/{id}# update path/sortOrder/required
- DELETE /bundles/{bundleId}/objects/{id}

#### Recipients (admin)
- GET  /recipients                       # page, optional ?q=
- POST /recipients                       # create { email, displayName? }
- GET  /recipients/{recipientId}
- GET  /bundles/{bundleId}/recipients
- POST /bundles/{bundleId}/recipients    # attach { recipientId }
- DELETE /bundles/{bundleId}/recipients  # detach via ?recipientId=

#### Portal (recipient)
- GET /portal/me
- GET /portal/bundles
- GET /portal/bundles/{bundleId}/objects
- GET /portal/bundles/{bundleId}         # download (stream) or 302 to signed URL

#### Plugins & Capabilities (admin)
- GET  /plugins
- POST /plugins/install                  # { source, verifySignature? } → 202
- DELETE /plugins/{pluginId}
- GET  /capabilities                     # merged trigger/action capability registry

#### Triggers / Actions / Pipelines (admin)
- GET  /triggers; POST /triggers
- PATCH /triggers/{id}; DELETE /triggers/{id}
- GET  /actions;  POST /actions
- PATCH /actions/{id};  DELETE /actions/{id}
- GET  /pipelines; POST /pipelines
- PATCH /pipelines/{id}; DELETE /pipelines/{id}

#### Users (admin)
- GET  /users                            # page, optional ?q=
- PATCH /users/{id}/roles                # { roles: string[] }

### 5) Fix inconsistencies in the current spec
- Change Files GET by id schema to use File (id, key, size, contentType, metadata?, etag?, updatedAt).
- Ensure all list endpoints return Page shape: { items, nextCursor } (remove limit from response payload; it’s a param).
- Set Limit.max to 200 (not 100).
- Set bearer.securityScheme.bearerFormat to opaque (not JWT).
- Ensure every 4xx/5xx references the shared Error schema.
- Add security blocks to any paths missing them:
  - Admin paths → cookieAdmin
  - CLI token list/revoke → bearer or cookieAdmin
  - Portal paths → cookieRecipient

### 6) Tooling
Add dev scripts at repo root to work with multi-file OAS:
- oas:lint      → redocly lint openapi/openapi.yaml
- oas:validate  → swagger-cli validate openapi/openapi.yaml
- oas:bundle    → redocly bundle openapi/openapi.yaml -o openapi/dist/openapi.json
- oas:preview   → redocly preview-docs openapi/openapi.yaml

Do not add server code, but include a note in the PR description that /openapi.json will be served by core in a follow-up.

---

## Acceptance Criteria

- Spec is split into files as per layout; openapi/openapi.yaml uses $ref to include them.
- oas:validate and oas:lint pass.
- oas:bundle produces openapi/dist/openapi.json.
- Security schemes are consistent and used across all paths.
- Error responses use the shared Error schema.
- Pagination on all list endpoints uses { items, nextCursor } and the shared Cursor/Limit params.
- File model is first‑class (File schema) and bundle membership is expressed via BundleObject and dedicated endpoints.
- New paths exist for: files CRUD, bundle objects attach/detach/update, portal listing/download, capabilities, whoami, health/live, health/ready, openapi.json.
- No DB or server implementation changes are included in this PR (spec-only).

---

## Notes to Reviewer
This PR intentionally defines the contract ahead of implementation so admin‑ui, portal, and CLI can develop in parallel. A follow‑up PR will add database models and route handlers that conform to this spec.
