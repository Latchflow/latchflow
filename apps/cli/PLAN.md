# Latchflow CLI — oclif Design & Implementation Guide

> Goal: deliver a polished `latchflow` (alias: `lf`) CLI that mirrors admin/portal flows for headless environments, built with **oclif** (TypeScript). This guide defines UX, command layout, HTTP mappings, config, auth, error semantics, and code scaffolding.

---

## 1) Principles & UX

* **Make the happy path one command.** Sensible defaults; prompt only when needed.
* **Human + machine friendly.** Pretty tables by default; `--json`/`--yaml` for scripts.
* **Idempotent & explicit.** Never surprise‑create; destructive ops require `--yes` and support `--dry-run` where feasible.
* **Secure by default.** Device‑code login, OS keychain for tokens, no plaintext secrets.
* **Composability.** Every command returns stable fields and non‑zero exit codes on failure.
* **Don’t hardcode plugin types.** All trigger/action creation uses registry‑provided schemas.

---

## 2) Project Scaffolding (oclif)

**Packages**

* `apps/cli/` (TypeScript, oclif v3)
* Minimum Node 20, pnpm workspaces

**Bootstrap**

```bash
pnpm dlx oclif@latest single latchflow --typescript --bin latchflow --package apps/cli
cd apps/cli
pnpm add undici zod keytar env-paths yaml mime ora chalk cli-table3
pnpm add -D @types/node @types/keytar vitest tsx undici-mock @types/cli-table
```

**Structure**

```
apps/cli/
  src/
    sdk/            # API client wrapper + types
    config/         # profile & keychain helpers
    core/           # BaseCommand, global flags, formatting utils
    commands/
      login.ts
      whoami.ts
      tokens/{list,create,rotate,revoke}.ts
      files/{list,upload,download,move,rm,metadata}.ts
      bundles/{list,create,get,update,rm}.ts
      bundles/objects/{list,attach,update,detach}.ts
      recipients/{list,create,get}.ts
      pipelines/{list,create,update,rm}.ts
      triggers/{list,create,update,rm}.ts
      actions/{list,create,update,rm}.ts
      plugins/{list,install,uninstall}.ts
      events/{list,trigger,action,download}.ts    # read-only observability
  test/
  package.json
```

---

## 3) Config & Environments

* **Paths:** resolve via `env-paths` (respects XDG on Linux, proper dirs on macOS/Windows). File: `config.json` in the app config dir.
* **Profiles:** multiple profiles in a single file.
* **Shape:**

```json
{
  "defaultProfile": "dev",
  "profiles": {
    "dev": { "baseUrl": "https://dev.api.latchflow.com", "tokenId": "..." },
    "staging": { "baseUrl": "https://staging.api.latchflow.com" }
  }
}
```

* **Selection precedence:** `--profile` > `LF_PROFILE` > config default.
* **Overrides:** `--api-url` or `LF_API_URL` for custom/self‑hosted; `--env dev|staging|prod` convenience to set `baseUrl`.
* **Token storage:** opaque bearer tokens kept in OS keychain under service `latchflow:<profile>`.
* **Keychain fallback:** if keychain unavailable (headless CI), allow `LF_TOKEN` or `LF_KEYCHAIN=disabled` to use in‑memory or file‑scoped fallback with a clear warning. Never write tokens to repo paths.

---

## 4) Authentication (Device Code + Tokens)

**Flow A: Device authorization**

1. `lf login --email you@company.com [--device-name "My Laptop"]`
2. CLI calls `/auth/cli/device/start` → prints `user_code` and `verification_uri`.
3. User visits the URL, an admin approves the code (web/admin).
4. CLI polls `/auth/cli/device/poll` until it receives `access_token` + scopes.
5. CLI persists token to keychain and writes token metadata in the profile.

**Flow B: Token lifecycle (admin)**

* `lf tokens:list` → GET `/auth/cli/tokens`
* `lf tokens:create --name "CI:release" --scope bundles:write --ttl-days 30` → POST `/auth/cli/tokens`
* `lf tokens:revoke --id <uuid>` → POST `/auth/cli/tokens/revoke`
* `lf tokens:rotate --id <uuid>` → POST `/auth/cli/tokens/rotate`

**Helpers**

* `lf whoami` prints principal kind (`admin|cli`), email, scopes.
* Auto‑refresh not needed (opaque tokens). Prompt to `lf login` when 401.
* **Fallbacks:** Prefer PAT creation in web UI and `LF_TOKEN` for CI when device flow isn’t usable. Optionally enable dev‑only email/password behind `LF_DEV_AUTH=1` to mint a short‑lived token.

---

## 5) Command Surface (v0)

> All list commands support `--limit`, `--cursor`, `--json`, `--select <fields>`, `--q <term>` (alias: `--filter`).

### Identity & Sessions

* `lf whoami` — GET `/whoami`

### Files

* `lf files:list [--prefix <p>] [--q <term>] [--unassigned] [--all]`
* `lf files:upload <path> [--key <key>] [--content-type <mime>] [--concurrency <n>] [--part-size <bytes>] [--progress] [--resume]`
* `lf files:download <id> <dest> [--progress] [--stdout]`
* `lf files:move <id> <newKey>`
* `lf files:move-batch --file moves.csv` (CSV: `id,newKey`)
* `lf files:get <id>`
* `lf files:rm <id> --yes [--force]`
* `lf files:rm-batch <id...> --yes` or `--file ids.txt` or `--stdin`
* `lf files:metadata <id> --set key=value [--set key=value ...]`

### Bundles

* `lf bundles:list`
* `lf bundles:create --name <str> [--description <str>]`
* `lf bundles:get <bundleId>`
* `lf bundles:update <bundleId> [--name <str>] [--description <str>]`
* `lf bundles:rm <bundleId>`
* `lf bundles:objects:list <bundleId>`
* `lf bundles:objects:attach <bundleId> --file <fileId>:<path> [...repeat]`
* `lf bundles:objects:update <bundleId> <objectId> [--path <p>] [--sort <n>] [--required <bool>]`
* `lf bundles:objects:detach <bundleId> <objectId>`

### Recipients

* `lf recipients:list [--q <term>]`
* `lf recipients:create --email <addr> [--name <str>]`
* `lf recipients:get <recipientId>`
* `lf bundles:recipients:list <bundleId>`
* `lf bundles:recipients:attach <bundleId> --recipient <id> [...repeat]`
* `lf bundles:recipients:detach <bundleId> --recipient <id>`

### Triggers & Actions & Pipelines

* `lf triggers:list|create|update|rm`
* `lf actions:list|create|update|rm`
* `lf pipelines:list|create|update|rm`
* Registry‑aware creation/update: `--capability <key>` (alias: `--type`) and `--config key=val` or `--from-file config.json`; validate against capability `jsonSchema` from `/capabilities`.

### Plugins

* `lf plugins:list`
* `lf plugins:install --source <url/path> [--verify-signature]`
* `lf plugins:uninstall <pluginId>`

### Events (observability)

* `lf events:list [--kind trigger|action|download] [--bundle <id>] [--all]` — TBD
* Read‑only views into TriggerEvent, ActionInvocation, DownloadEvent to aid debugging once audit endpoints ship.

---

## 6) HTTP Mappings (summary)

* Health: `GET /health`
* Auth (device): `POST /auth/cli/device/start` → `POST /auth/cli/device/poll`
* Tokens: `GET|POST /auth/cli/tokens`, `POST /auth/cli/tokens/{revoke|rotate}`
* Files: `GET /files`, `GET /files/{id}`, `POST /files/upload`, `POST /files/upload-url` (pre‑signed), `GET /files/{id}/download`, `POST /files/{id}/move`, `POST /files/batch/move`, `PATCH /files/{id}/metadata`, `DELETE /files/{id}`, `POST /files/batch/delete`
* Bundles: `GET|POST /bundles`, `GET|PATCH|DELETE /bundles/{bundleId}`
* Bundle objects: `GET|POST /bundles/{bundleId}/objects`, `PATCH|DELETE /bundles/{bundleId}/objects/{id}`
* Recipients: `GET|POST /recipients`, lookups by id, bundle attachments
* Triggers/Actions/Pipelines: CRUD routes; create expects `capabilityKey` + `config`
* Plugins: `GET /plugins`, `POST /plugins/install`, `DELETE /plugins/{pluginId}`
* Capabilities (no hardcoding types): `GET /capabilities` returns `{ kind, key, displayName, jsonSchema }` used for client‑side validation.

---

## 7) Output & Formatting

* Default: table with common columns; truncate long strings with ellipsis.
* `--json`: raw API envelopes (as is). `--yaml`: convert JSON → YAML with deterministic key ordering (sort object keys).
* `--select`: comma‑separated field list (dot‑paths supported). Example: `--select id,name,createdAt`.
* `--no-headers`: suppress table headers (for shell loops).
* `--columns` to override table columns for compact views.

---

## 8) Errors & Exit Codes

* `1`: general error; `2`: validation/usage; `3`: unauthorized; `4`: not found; `5`: rate limited.
* Show API `code` and `message` if present. For 429, suggest and honor `--retry <n>` with exponential backoff (with jitter).
* Debug with `--verbose` (prints requestId + curl‑repro line; Authorization redacted).

---

## 9) SDK Wrapper (CLI → API)

* Use `undici` fetch; wrap with small client: `sdk/request.ts`.
* Pluggable base URL + bearer from keychain; add `User-Agent: latchflow-cli/<ver> (<platform>)`.
* Middleware: requestId tracing, pagination helper (`--all`), retry/backoff, and a `poll()` utility for device flow.

**Type safety**

* Import OpenAPI types from `@latchflow/api-types` (generated from the core OpenAPI doc).
* Add minimal Zod validation for critical responses (auth, pagination envelope, IDs) and inputs at the CLI boundary.

---

## 10) Security Rails

* Tokens only in keychain; never on disk unless `LF_KEYCHAIN=disabled` (explicit CI opt‑out).
* Support `LF_TOKEN` env for CI. Emit warning when reading from env.
* Redact tokens in logs; scrub `Authorization` header in `--verbose` output.
* Enforce `--yes` on destructive operations; provide `--dry-run` where feasible.
* API security alignment: many admin CRUD endpoints in the spec currently require `cookieAdmin`. Coordinate with core to include `bearer` on endpoints used by CLI (or set a global security default) so CLI tokens work across files/bundles/recipients/triggers/actions/pipelines.

---

## 11) Testing Strategy

* **Unit:** config loader, keychain shim (with fallback), paginator (`--all`), formatters, retry logic.
* **HTTP mocks:** `undici-mock` for `/auth/cli/*`, `/files/*`, etc. No live network. Reuse factories/fixtures from `packages/testkit/` for consistent shapes and IDs.
* **Golden tests:** `--json` output for `list` commands; stable YAML via sorted keys; prefer `--select` in snapshots for stability.
* **Stream tests:** uploads/downloads use temp files and mocked streams; progress bars disabled in test mode.
* **Smoke:** run against local dev API (docker compose + seed script) in an opt‑in CI job.

---

## 12) Example Command Implementations

### `login.ts` (device flow — sketch)

```ts
import { Command, Flags } from '@oclif/core'
import { startDevice, pollDevice } from '../sdk/auth'
import { saveToken } from '../config/keychain'

export default class Login extends Command {
  static flags = {
    email: Flags.string({ char: 'e', required: true }),
    deviceName: Flags.string({ default: '' }),
    profile: Flags.string(),
  }
  async run() {
    const { flags } = await this.parse(Login)
    const start = await startDevice({ email: flags.email, deviceName: flags.deviceName })
    this.log(`Enter code ${start.user_code} at ${start.verification_uri}`)
    const res = await pollDevice({ device_code: start.device_code, interval: start.interval })
    await saveToken({ profile: flags.profile, token: res.access_token })
    this.log('Logged in. Token saved to keychain.')
  }
}
```

### `bundles/list.ts` (list w/ pagination)

```ts
import { BaseListCommand } from '../../sdk/base-list'
export default class BundlesList extends BaseListCommand {
  static description = 'List bundles'
  path() { return '/bundles' }
  columns() { return ['id','name','createdAt'] }
}
```

---

## 13) Global Flags & Base Command

* Global flags on all commands: `--profile`, `--api-url`, `--env`, `--json`, `--yaml`, `--select`, `--no-headers`, `--verbose`, `--retry <n>`.
* Implement `BaseCommand` in `src/core/base-command.ts` to parse globals, set up logger/spinner, resolve profile/baseUrl/token, and expose `this.client`.
* Consistent spinner/log behavior via `ora`; suppress spinners when `--json`/`--yaml`.

---

## 14) File Transfer Details

* Uploads: auto‑detect mime via `mime`; prefer presigned upload negotiated via API. Support multipart with `--part-size` and `--concurrency`; resumable state file in temp dir; progress with `--progress`.
* Downloads: stream to disk; verify checksum if API provides; support `--stdout` for piping; progress with `--progress`.

---

## 15) Pagination & Safety

* `--all` auto‑paginates until exhausted; expose `nextCursor` in `--json` output when not using `--all`.
* Destructive ops require `--yes`; `--force` skips confirmations where supported; `--dry-run` prints intended changes without mutating endpoints.

---

## 16) Distribution & Platform Notes

* Binaries: map `bin` to both `latchflow` and `lf`.
* Shell completions: provide `lf completions` for popular shells.
* Windows: ensure path handling and streaming work (use Node streams, avoid posix‑only APIs). Optional CI matrix for Linux + Windows.

---

## 17) Open Questions / Defaults

* **Profiles:** ship with `dev|staging|prod` presets? *Default: yes.*
* **Typegen:** adopt OpenAPI typegen now or later? *Default: later (v0+1); start with zod for critical paths.*
* **Retries:** global `--retry <n>` with exponential backoff? *Default: yes, for 429/5xx with jitter.*
* **Telemetry:** opt‑in `--report-errors` flag? *Default: defer until Beta.*
* **Capabilities endpoint shape:** confirm `/capabilities` includes complete `jsonSchema` for all keys and whether any per‑type schema endpoints are planned.
* **Bearer on admin endpoints:** align security requirements in OpenAPI so CLI bearer tokens are accepted for all relevant admin routes.

---

## 18) Appendix — Request Helpers (sketch)

```ts
// sdk/request.ts
export async function api<T>(method: string, path: string, opts: { query?: Record<string,any>, body?: any } = {}) {
  const baseUrl = await resolveBaseUrl();
  const token = await getToken();
  const url = new URL(path, baseUrl);
  if (opts.query) Object.entries(opts.query).forEach(([k,v]) => url.searchParams.set(k, String(v)))
  const res = await fetch(url, { method, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': ua() }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (!res.ok) throw await toCliError(res);
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() as Promise<T> : (res as any);
}
```
