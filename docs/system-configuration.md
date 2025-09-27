# System Configuration Management

Latchflow stores runtime system configuration in the `SystemConfig` table. This allows operators to adjust settings without restarts and keep an audited history of every change.

## Storage Model

- Each entry is keyed by `key` (e.g. `SMTP_URL`).
- Non-secret values live in the `value` JSON column; secret values are AES‑GCM encrypted into `encrypted`.
- Metadata tracks `category`, optional JSON schema, arbitrary metadata, active flag, and the user who created/updated the record.
- ChangeLog snapshots run under the `SYSTEM_CONFIG` entity, so every mutation is audit logged with the acting user.

## Precedence Rules

1. Database configuration is authoritative.
2. Seeded values (`metadata.source = "environment_seed"`) are tagged as `database_seeded` to distinguish them from user-authored entries.
3. Environment variables are only consulted when a key has no active database value. When seeding discovers an environment value, it creates a database record so the application uses the DB from then on.

Secrets are always encrypted at rest and never returned by the admin API unless an operator explicitly requests `includeSecrets=true`. Otherwise, secret `value`s are redacted as `"[REDACTED]"`.

## Seeding & Migration

At startup the core service calls `SystemConfigService.seedFromEnvironment` with the known mappings (`EMAIL_CONFIG_MAPPING`, etc.). Any environment variable that does not already exist in the database is inserted with metadata `{ source: "environment_seed" }`. This provides a seamless bridge while the admin migrates settings into the UI.

For email delivery, the system seeds `SMTP_URL` and `SMTP_FROM` and exposes the `/system/config/test` endpoint to validate connectivity. The admin API also resolves SMTP settings via `SystemConfigService`, so invite flows use the database configuration automatically once present.

## Admin API

All endpoints live under `/system/config` and require the `system-config:read` / `system-config:write` scopes:

- `GET /system/config` – list configuration (with filtering, pagination, and secret masking).
- `PUT /system/config` – transactional bulk upsert.
- `GET/PUT/DELETE /system/config/:key` – convenience methods for single keys.
- `POST /system/config/test` – validate configuration payloads, with special handling for SMTP connectivity tests.

Audit entries are generated for every write, and deletions are soft (`isActive=false`).

## Testing Guidance

- Unit tests cover `SystemConfigService` (encryption, validation, seeding, precedence) and `SystemConfigBulkService` redaction behaviour.
- Integration tests under `packages/core/src/routes/admin/system-config.test.ts` exercise the admin routes, including secret masking and the SMTP test endpoint.
- When adding new configuration categories:
  - Extend the mapping constant in `system-config-core.ts`.
  - Provide default schemas/metadata when helpful.
  - Add route-level tests that confirm secrets stay redacted and precedence is preserved.
