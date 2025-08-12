# PLAN.md — Latchflow Core Bootstrap (Express HTTP + Pluggable Queue + Storage)

## Objective
Stand up the initial 'packages/core' service with:
- Express-based HTTP API behind a small adapter
- Pluggable queue (default in-memory) for Trigger→Action orchestration
- Core-owned storage service (drivers + optional encryption) — plugins do not touch storage
- Minimal REST routes (health, admin stubs, portal download)
- Tests and scripts

## Deliverables
- 'src/index.ts' — bootstrap server, load plugins, init DB, wire queue + storage + runners
- 'src/config.ts' — env parsing (dotenv + zod) incl. queue and storage settings
- 'src/db.ts' — Prisma client wrapper import from '@latchflow/db'
- 'src/plugins/plugin-loader.ts' — scan, validate, upsert, register trigger/action capabilities
- 'src/queue/types.ts' | 'src/queue/memory-queue.ts' | 'src/queue/loader.ts'
- 'src/runtime/trigger-runner.ts' — start trigger listeners, persist 'TriggerEvent', enqueue actions
- 'src/runtime/action-runner.ts' — consume queue, execute actions, persist 'ActionInvocation'
- 'src/http/http-server.ts' | 'src/http/express-server.ts' | 'src/http/validate.ts'
- 'src/routes/health.ts' — GET '/health' → '{ status: "ok", queue, storage }'
- 'src/routes/admin/*.ts' — CRUD stubs (Bundle, Recipient, TriggerDefinition, ActionDefinition)
- 'src/routes/portal/download.ts' — GET '/portal/bundles/:bundleId' (recipient-verified stream + 'DownloadEvent')
- 'src/storage/types.ts' — storage driver interface
- 'src/storage/loader.ts' — select driver via env (memory/fs/s3/custom path)
- 'src/storage/memory.ts' — in-memory dev driver
- 'src/storage/fs.ts' — local filesystem dev driver
- 'src/storage/s3.ts' — S3/MinIO driver (MVP config; can stub if not ready)
- 'src/storage/service.ts' — core storage facade (encryption wrapper + helpers)
- 'src/crypto/encryption.ts' — no-op and AES-GCM helpers (envelope-ready, MVP can be 'none')
- 'jest.config.ts' + a few tests
- pnpm scripts: 'dev', 'test', 'lint'

## Constraints
- TypeScript strict mode, Node 20+, pnpm workspaces
- No hardcoded trigger/action types; all via plugin registry
- Import Prisma client only from '@latchflow/db'
- Every trigger firing must create a 'TriggerEvent'
- Every action execution must create an 'ActionInvocation'
- Every successful portal download must create a 'DownloadEvent'
- Plugins (triggers/actions) must not call storage directly; they receive high-level helpers from core
- Env-configured drivers; validate config with zod; no secrets hardcoded

## Config (storage + queue)
- Queue:
  - 'QUEUE_DRIVER' (default 'memory'), 'QUEUE_DRIVER_PATH' (optional), 'QUEUE_CONFIG_JSON' (optional JSON)
- Storage:
  - 'STORAGE_DRIVER' (default 'fs' in dev, suggest 's3' in docker), 'STORAGE_DRIVER_PATH' (optional), 'STORAGE_CONFIG_JSON' (optional JSON)
  - For FS: 'STORAGE_BASE_PATH=./.data/storage'
  - For S3/MinIO: 'STORAGE_S3_ENDPOINT', 'STORAGE_S3_REGION', 'STORAGE_S3_ACCESS_KEY', 'STORAGE_S3_SECRET_KEY', 'STORAGE_S3_FORCE_PATH_STYLE=true', 'STORAGE_BUCKET_PREFIX=latchflow-'
  - Encryption (MVP default 'none'): 'ENCRYPTION_MODE=none|aes-gcm', 'ENCRYPTION_MASTER_KEY_B64=...'

## Storage design (core-owned)
- One driver per deployment (memory/fs/s3/custom)
- Core facade wraps driver with optional encryption and policy
- Portal downloads go through core (MVP) to enforce verification/limits and write 'DownloadEvent'
- Actions get a minimal helper (e.g., 'createReleaseLink') that returns a portal URL — not a raw storage URL

## Steps
1) Read 'AGENTS.md', 'README.md', and 'packages/db/prisma/schema.prisma'.
2) Create directory/file structure per Deliverables.
3) Implement 'config.ts' with zod; include queue + storage + encryption envs.
4) Implement storage:
   - 'storage/types.ts' interface (see stub below)
   - Drivers: 'memory.ts' (Map), 'fs.ts' (node fs streams), 's3.ts' (aws-sdk v3/minio client)
   - 'storage/loader.ts' selects driver via env or custom module path
   - 'crypto/encryption.ts' with 'none' (pass-through) and stubbed 'aes-gcm' helpers
   - 'storage/service.ts' exposes high-level API used by routes and action context
5) Implement queue ('types.ts' / 'memory-queue.ts' / 'loader.ts').
6) Implement 'trigger-runner.ts' and 'action-runner.ts':
   - Pass a context to actions that includes 'createReleaseLink' and 'prisma', not raw storage
7) HTTP layer:
   - Express adapter + error/validation middleware
   - 'routes/portal/download.ts' that verifies recipient access, streams from storage, and writes 'DownloadEvent'
   - 'routes/health.ts' returns '{ status, queue, storage }'
8) Wire bootstrap in 'index.ts': load config, DB, plugins, storage, queue; start consumers/listeners; mount routes.
9) Tests:
   - Unit: memory storage put/get, queue enqueue/consume
   - Integration: fake trigger fires → action uses 'createReleaseLink' → GET download streams and logs 'DownloadEvent'
10) Local run:
    - 'docker compose up -d'
    - 'pnpm -F db exec prisma migrate dev && pnpm -F db exec prisma generate'
    - 'pnpm -F db build' (if needed) and 'pnpm -F core dev'
11) PR: 'feat(core): storage service + portal download, pluggable queue, express bootstrap'

## Example stubs (use single quotes here; swap to backticks after paste)

'// src/storage/types.ts'
export interface StorageDriver {
  put(opts: {
    bucket: string; key: string;
    body: Buffer | NodeJS.ReadableStream;
    contentType?: string; metadata?: Record<string,string>;
  }): Promise<{ etag?: string; size?: number }>;
  getStream(opts: { bucket: string; key: string; range?: [number, number] }): Promise<NodeJS.ReadableStream>;
  head(opts: { bucket: string; key: string }): Promise<{ size: number; contentType?: string; metadata?: Record<string,string> }>;
  del(opts: { bucket: string; key: string }): Promise<void>;
  createSignedGetUrl?(opts: { bucket: string; key: string; expiresSeconds: number }): Promise<string>;
}

'// src/storage/loader.ts'
import type { StorageDriver } from './types';
export async function loadStorage(driver: string, pathOrNull: string | null, config: unknown): Promise<{ name: string; storage: StorageDriver }> {
  if (!driver || driver === 'memory') {
    const { createMemoryStorage } = await import('./memory');
    return { name: 'memory', storage: await createMemoryStorage({ config }) };
  }
  if (driver === 'fs' && !pathOrNull) {
    const { createFsStorage } = await import('./fs');
    return { name: 'fs', storage: await createFsStorage({ config }) };
  }
  if (driver === 's3' && !pathOrNull) {
    const { createS3Storage } = await import('./s3');
    return { name: 's3', storage: await createS3Storage({ config }) };
  }
  const mod = await import(pathOrNull ?? driver);
  const factory = (mod as any).default ?? (mod as any).createStorage;
  return { name: driver, storage: await factory({ config }) };
}

'// src/crypto/encryption.ts'
import { Readable } from 'node:stream';
export type EncMode = 'none' | 'aes-gcm';
export function wrapEncryptStream(mode: EncMode, masterKey?: Buffer) {
  if (mode === 'none') return (s: NodeJS.ReadableStream) => s;
  // TODO: implement AES-GCM streaming; MVP can be no-op with a TODO note
  return (s: NodeJS.ReadableStream) => s;
}
export function wrapDecryptStream(mode: EncMode, masterKey?: Buffer) {
  if (mode === 'none') return (s: NodeJS.ReadableStream) => s;
  return (s: NodeJS.ReadableStream) => s;
}

'// src/storage/service.ts'
import type { StorageDriver } from './types';
type ServiceDeps = { driver: StorageDriver; bucketPrefix: string; encMode: 'none'|'aes-gcm'; masterKey?: Buffer };
export function createStorageService(deps: ServiceDeps) {
  const bucketFor = (ownerId: string) => `${deps.bucketPrefix}${ownerId}`;
  return {
    putBundleObject: async (ownerId: string, key: string, body: Buffer|NodeJS.ReadableStream, contentType?: string) => {
      const bucket = bucketFor(ownerId);
      return deps.driver.put({ bucket, key, body, contentType });
    },
    getBundleStream: async (ownerId: string, key: string) => {
      const bucket = bucketFor(ownerId);
      return deps.driver.getStream({ bucket, key });
    },
    // High-level helper used by actions (returns a portal URL, not a raw storage URL)
    createReleaseLink: async (args: { bundleId: string; recipientId: string; ttlSeconds?: number }) => {
      // MVP: return portal route; TTL can be enforced server-side later
      const url = `/portal/bundles/${args.bundleId}?rid=${args.recipientId}`;
      const expiresAt = args.ttlSeconds ? new Date(Date.now() + args.ttlSeconds*1000).toISOString() : undefined;
      return { url, expiresAt };
    },
  };
}

'// src/routes/portal/download.ts'
import type { HttpServer } from '../http/http-server';
export function registerPortalDownload(server: HttpServer, deps: {
  prisma: any;
  storage: { getBundleStream: (ownerId: string, key: string) => Promise<NodeJS.ReadableStream> };
}) {
  server.get('/portal/bundles/:bundleId', async (req: any, res: any) => {
    const { bundleId } = req.params;
    const recipientId = req.query?.rid;
    // TODO: verify recipient is allowed to access bundleId (OTP/passphrase/session)
    // TODO: look up storage key + ownerId for bundleId in DB
    // const key = ...
    // const ownerId = ...
    // const stream = await deps.storage.getBundleStream(ownerId, key);
    // stream.pipe(res);
    // TODO: write DownloadEvent (bundleId, recipientId, ip, userAgent, timestamp)
    res.status(501).json({ status: 'todo', bundleId, recipientId });
  });
}

'// passing helper into actions (excerpt)'
type ActionCtx = {
  prisma: any;
  createReleaseLink: (args: { bundleId: string; recipientId: string; ttlSeconds?: number }) => Promise<{ url: string; expiresAt?: string }>;
};
export function startActionConsumer(queue: any, deps: { prisma: any; storageService: any; executeActionImpl: (ctx: ActionCtx, defId: string, payload: any) => Promise<void> }) {
  return queue.consumeActions(async (msg: any) => {
    const ctx: ActionCtx = {
      prisma: deps.prisma,
      createReleaseLink: deps.storageService.createReleaseLink,
    };
    await deps.executeActionImpl(ctx, msg.actionDefinitionId, { triggerEventId: msg.triggerEventId, context: msg.context });
  });
}

## Acceptance checklist
- '/health' reports '{ status: "ok", queue: "<driver>", storage: "<driver>" }'
- Storage driver loads via env; FS driver writes/reads files under 'STORAGE_BASE_PATH'
- 'createReleaseLink' returns a portal URL; actions can call it without knowing storage internals
- Portal download route verifies access (placeholder), and a successful download writes a 'DownloadEvent'
- Triggers create 'TriggerEvent'; actions create 'ActionInvocation'
- All tests pass with 'pnpm -r test'

## Follow-ups (next PRs)
- Implement real AES-GCM envelope encryption and key handling
- Add S3/MinIO driver with signed URL support; optional proxy vs. redirect policy
- Add recipient verification middleware (OTP/passphrase) and per-recipient rate limits
- Add download tokens (short-lived HMAC) for emailed links and enforce TTL
- Metrics hooks for storage/queue timings and failure counts
