# Roadmap

| Milestone | Area | Description | Status |
| --- | --- | --- | --- |
| MVP | core | Monorepo scaffolding, pnpm workspaces, lint/test setup | done |
| MVP | core | Database package `@latchflow/db` with Prisma client | done |
| MVP | core | Schema v1 for users, recipients, bundles, triggers/actions, plugin registry, auth models | in progress |
| MVP | core | Core HTTP server (Express, CORS, Helmet, Pino) + health route | in progress |
| MVP | core | Config loader with typed env and `.env.defaults` | done |
| MVP | core | Plugin runtime registry, dynamic loader, DB upsert | in progress |
| MVP | core | Storage abstraction + FS driver (local dev) | in progress |
| MVP | core | Queue abstraction + in-memory driver | in progress |
| MVP | core | Encryption module (AES‑GCM) integration | in progress |
| MVP | core | Admin magic‑link auth endpoints | in progress |
| MVP | core | Recipient OTP auth endpoints | in progress |
| MVP | core | CLI device auth endpoints + API tokens | in progress |
| MVP | core | Audit events: TriggerEvent, ActionInvocation, DownloadEvent wired in runtime | not started |
| MVP | core | OpenAPI spec draft; lint/bundle/preview scripts | done |
| MVP | core | Core unit tests for config, health, loaders | in progress |
| MVP | cli | Bootstrap CLI workspace and executor | not started |
| MVP | cli | Device-code login and token storage | not started |
| MVP | cli | Bundle: create, upload, list, delete | not started |
| MVP | cli | Triggers/actions: create, link, reorder, enable/disable | not started |
| MVP | cli | Plugins: list, enable/disable | not started |
| MVP | admin ui | Bootstrap Next.js app, layout, design system seed | not started |
| MVP | admin ui | Magic-link login flow | not started |
| MVP | admin ui | Bundles/recipients CRUD | not started |
| MVP | admin ui | Pipeline builder for triggers ▶ actions | not started |
| MVP | admin ui | Audit log viewer (filter by bundle/trigger/user) | not started |
| MVP | recipient portal | Bootstrap Next.js app | not started |
| MVP | recipient portal | OTP/passphrase verification screen | not started |
| MVP | recipient portal | Bundle details + secure download (limits, cooldown) | not started |
| MVP | recipient portal | Download history and device recognition | not started |
| Alpha | core | Built‑in plugins: cron trigger | not started |
| Alpha | core | Built‑in plugins: webhook trigger | not started |
| Alpha | core | Built‑in plugins: email action (SMTP, MailHog local) | not started |
| Alpha | core | Built‑in plugins: publish action (signed URL) | not started |
| Alpha | core | Storage: S3/MinIO driver | not started |
| Alpha | core | Rate limiting + per‑recipient throttles | not started |
| Alpha | core | Executor permissions and overrides | not started |
| Alpha | cli | Bundle share/export helpers | not started |
| Alpha | admin ui | Recipient/bundle import/export | not started |
| Alpha | recipient portal | Download resume + link expiry UX | not started |
| Beta | core | E2E test harness with Docker (Postgres, MinIO, MailHog) | not started |
| Beta | core | CI: lint, typecheck, tests, coverage | not started |
| Beta | core | Observability: structured logs, request IDs, basic metrics | not started |
| Beta | cli | Rich errors, spinners, non‑zero exit codes | not started |
| Beta | admin ui | Role‑aware UI (owner/executor) | not started |
| Beta | recipient portal | Accessibility, i18n ready | not started |
| GA | core | Hardened auth, token rotation, scope defaults | not started |
| GA | core | Backward‑compatible plugin schema versioning | not started |
| GA | admin ui | Polished UX, docs links, empty‑state guides | not started |
| GA | recipient portal | Mobile polish and offline download queue | not started |
| Post‑GA | core | Multi‑tenant orgs and project scoping | not started |
| Post‑GA | core | Advanced workflows (conditional branches, retries) | not started |
| Post‑GA | admin ui | Analytics dashboards for releases/downloads | not started |
| Post‑GA | recipient portal | Native app handoff and device pairing | not started |
