# PLAN.md — Multi‑file OpenAPI (OAS) for Core API

## Objective
Create a multi‑file OpenAPI 3.1 spec for `packages/core`, split by paths/components, wired with `$ref`s, with tooling to lint/preview/bundle, and a route to serve the bundled JSON from the running core service.

## Deliverables
- Directory scaffold under `packages/core/openapi/`:
  - `openapi.yaml` (root orchestrator)
  - `paths/` (one file per endpoint group)
  - `components/schemas/`, `components/parameters/`, `components/securitySchemes/`
  - `dist/` (bundled output; git‑ignored)
- NPM scripts (repo root) for lint/preview/bundle/validate
- Dev dependencies: `@redocly/cli`, `swagger-cli`
- Express route (read‑only) to serve `/openapi.json` from the core service (bundled artifact copied into `dist`)
- Minimal starter content: health + auth (admin/recipient/CLI) + files + bundles + recipients + plugins + triggers + actions + pipelines + users + portal (skeletons are fine; keep request/response schemas referenced from components)

## Folder Layout (to create)
packages/core/openapi/
  openapi.yaml
  paths/
    health.yaml
    auth/
      admin.yaml
      recipient.yaml
      cli.yaml
    files.yaml
    bundles.yaml
    recipients.yaml
    plugins.yaml
    triggers.yaml
    actions.yaml
    pipelines.yaml
    users.yaml
    portal.yaml
  components/
    schemas/
      Error.yaml
      Page.yaml
      ObjectMeta.yaml
      Bundle.yaml
      Recipient.yaml
      Plugin.yaml
      TriggerDefinition.yaml
      ActionDefinition.yaml
      TriggerAction.yaml
      User.yaml
      DeviceStartResponse.yaml
      DevicePollPending.yaml
      DevicePollSuccess.yaml
    parameters/
      Cursor.yaml
      Limit.yaml
    securitySchemes/
      cookieAdmin.yaml
      cookieRecipient.yaml
      bearer.yaml
  dist/   # generated (git‑ignored)

## .gitignore updates
- Add lines:
  - 'packages/core/openapi/dist/'
  - 'openapi/dist/'

## Root Spec (packages/core/openapi/openapi.yaml)
- OpenAPI 3.1 metadata (title "Latchflow Core API", version "0.2.0", server http://localhost:3001)
- 'tags' list (Health, Auth (Admin), Auth (Recipient), Auth (CLI), Files, Bundles, Recipients, Plugins, Triggers, Actions, Pipelines, Executors/Users, Portal, Config, Audit)
- 'paths' section only contains $refs to the split files/anchors, e.g.:
  - '/health' → './paths/health.yaml'
  - '/auth/admin/start' → './paths/auth/admin.yaml#/postStart'
  - '/files' → './paths/files.yaml#/list'
  - Continue for every route we’ve defined so far
- 'components' references:
  - 'securitySchemes.cookieAdmin' → './components/securitySchemes/cookieAdmin.yaml'
  - 'parameters.Cursor', 'parameters.Limit'
  - All shared schemas listed above

## Example Path Files (skeletons)
- 'paths/health.yaml': define 'get' with 200 response containing '{ status, queue, storage }'
- 'paths/auth/admin.yaml':
  - Anchor blocks (YAML anchors) named 'postStart', 'getCallback', 'postLogout', 'getMe'
  - Each block contains method, summary, request/response shapes and references shared schemas
- 'paths/files.yaml':
  - Anchors: 'list', 'upload', 'byId', 'move', 'download'
  - 'list' uses pagination parameters and returns 'Page' with 'ObjectMeta' items
- Replicate anchor pattern for other groups (bundles, recipients, plugins, triggers, actions, pipelines, users, portal)

## Example Component Files (skeletons)
- 'components/schemas/Error.yaml': object with 'error' and optional 'message'
- 'components/parameters/Cursor.yaml': query param 'cursor' (string)
- 'components/securitySchemes/bearer.yaml': HTTP bearer scheme
- Populate the rest as thin placeholders referencing field names we already use; keep required fields minimal for now

## Tooling (root package.json)
- Add devDependencies:
  - '@redocly/cli': '^1.16.0'
  - 'swagger-cli': '^4.0.4'
- Add scripts:
  - 'oas:lint': 'redocly lint packages/core/openapi/openapi.yaml'
  - 'oas:preview': 'redocly preview-docs packages/core/openapi/openapi.yaml'
  - 'oas:bundle': 'redocly bundle packages/core/openapi/openapi.yaml -o packages/core/openapi/dist/openapi.json && mkdir -p openapi/dist && cp packages/core/openapi/dist/openapi.json openapi/dist/openapi.json'
  - 'oas:validate': 'swagger-cli validate packages/core/openapi/openapi.yaml'

## Serve the Bundle from Core
- During 'pnpm oas:bundle', ensure 'packages/core/openapi/dist/openapi.json' exists
- Copy the bundled file into the built server output on build (e.g., as 'packages/core/dist/openapi.json')
- Add a route (e.g., 'src/routes/meta.ts'):
  - 'GET /openapi.json' → reads and streams the bundled JSON from the runtime path
- Register this route in 'src/index.ts' after the health route
- Do not expose non‑bundled source files over HTTP

## Constraints & Conventions
- All $ref paths are relative to 'openapi.yaml' or the current file (use './' prefixes)
- Use YAML anchors inside path group files; reference via fragments like '#/list'
- Keep secrets/config out of the spec (show shapes only; no real values)
- Maintain backward compatibility: once a path ships, only additive changes without breaking consumers

## Steps for Codex
1) Create folder tree and empty files exactly as listed
2) Populate 'openapi.yaml' with metadata, tags, 'paths' refs, and 'components' refs
3) Add minimal content for:
   - 'paths/health.yaml'
   - 'paths/auth/admin.yaml', 'paths/auth/recipient.yaml', 'paths/auth/cli.yaml' (use anchors)
   - 'paths/files.yaml', 'paths/bundles.yaml', 'paths/recipients.yaml', 'paths/plugins.yaml', 'paths/triggers.yaml', 'paths/actions.yaml', 'paths/pipelines.yaml', 'paths/users.yaml', 'paths/portal.yaml'
   - 'components/*' placeholders (schemas/parameters/securitySchemes)
4) Update root 'package.json' with devDeps and scripts; add .gitignore entries
5) Implement '/openapi.json' route in core and wire it in 'src/index.ts'
6) Run:
   - 'pnpm oas:lint'
   - 'pnpm oas:validate'
   - 'pnpm oas:bundle'
   - Start core and verify 'GET /openapi.json' returns the bundled spec

## Acceptance Checklist
- 'packages/core/openapi/openapi.yaml' composes without unresolved $refs
- 'pnpm oas:lint' and 'pnpm oas:validate' succeed
- 'pnpm oas:bundle' emits 'packages/core/openapi/dist/openapi.json' and a copy at 'openapi/dist/openapi.json'
- Running core: 'GET /openapi.json' returns the bundled JSON with correct 'info', 'servers', 'paths', and 'components'
- At least these routes are present in 'paths/': health; auth (admin/recipient/cli); files; bundles; recipients; plugins; triggers; actions; pipelines; users; portal
- No nested backticks or invalid YAML emitted in the split files
