# PLAN.md — Latchflow Core Bootstrap (Express HTTP + Pluggable Queue)

## Objective
Stand up the initial 'packages/core' service with:
- Express-based HTTP API behind a small adapter
- Pluggable queue interface (default in-memory driver + driver injection)
- Trigger→Action orchestration over the queue
- Minimal REST routes (health + admin stubs)
- Tests and scripts

## Deliverables
- 'src/index.ts' — bootstrap server, load plugins, init DB, wire queue + runners
- 'src/config.ts' — env parsing (dotenv + zod), includes queue + http settings
- 'src/db.ts' — Prisma client import wrapper from '@latchflow/db'
- 'src/plugins/plugin-loader.ts' — scan, validate, upsert, register trigger/action capabilities
- 'src/queue/types.ts' — queue interfaces
- 'src/queue/memory-queue.ts' — default in-memory queue
- 'src/queue/loader.ts' — selects driver via env (memory/custom path/package)
- 'src/runtime/trigger-runner.ts' — start trigger listeners, persist 'TriggerEvent', enqueue actions
- 'src/runtime/action-runner.ts' — consume queue, execute actions, persist 'ActionInvocation'
- 'src/http/http-server.ts' — minimal server interface (framework-agnostic)
- 'src/http/express-server.ts' — Express adapter (express.json, helmet, cors, pino-http)
- 'src/http/validate.ts' — zod-powered request validator middleware/wrapper
- 'src/routes/health.ts' — GET '/health' → '{ status: "ok", queue: <driver> }'
- 'src/routes/admin/*.ts' — CRUD stubs for Bundle, Recipient, TriggerDefinition, ActionDefinition
- 'jest.config.ts' + 2–3 tests
- pnpm scripts: 'dev', 'test', 'lint'

## Constraints
- TypeScript strict mode, Node 20+, pnpm workspaces
- No hardcoded trigger/action types; use plugin registry
- Import Prisma client only from '@latchflow/db'
- Every trigger firing must create a 'TriggerEvent'
- Every action execution must create an 'ActionInvocation'
- Use env vars; validate with zod (no secrets in repo)
- Admin/portal must not access DB directly
- HTTP layer swappable via adapter

## HTTP Design (Express adapter)
- Middleware: 'express.json()', 'helmet()', 'cors()', 'pino-http' for request logging
- Validation: zod schemas per route via a 'validate' wrapper (body/query/params)
- Error handling: centralized JSON errors with 'status', 'code', 'message'
- Future-proof: only 'express-server.ts' depends on Express; routes and handlers depend on 'HttpServer' interface

## Queue Design (pluggable)
- Env:
  - 'QUEUE_DRIVER' (default: 'memory')
  - 'QUEUE_DRIVER_PATH' (optional: file path to custom module)
  - 'QUEUE_CONFIG_JSON' (optional: JSON for driver-specific config)
- Interface (see 'src/queue/types.ts'):
  - 'enqueueAction({ actionDefinitionId, triggerEventId, context })'
  - 'consumeActions(handler)'
  - 'stop()'
- Default implementation: simple in-memory FIFO with graceful shutdown

## Steps
1) Read 'AGENTS.md', 'README.md', and 'packages/db/prisma/schema.prisma' to confirm schema and rules.
2) Create directory/file structure per Deliverables.
3) Implement 'config.ts' with dotenv + zod:
   - 'DATABASE_URL' (required), 'PORT' (default 3001), 'PLUGINS_PATH' (default 'packages/plugins')
   - 'QUEUE_DRIVER' (default 'memory'), 'QUEUE_DRIVER_PATH' (optional), 'QUEUE_CONFIG_JSON' (optional JSON)
4) Implement 'plugins/plugin-loader.ts':
   - Scan 'PLUGINS_PATH', import modules, validate a 'capabilities' array (kind, key, displayName, configSchema)
   - Upsert 'Plugin' + 'PluginCapability' rows; keep runtime refs in memory map
5) Implement queue: 'types.ts', 'memory-queue.ts', 'loader.ts' as specified
6) Implement 'runtime/trigger-runner.ts':
   - Resolve active 'TriggerDefinition' rows and their capability handlers
   - 'startListening(ctx)' per trigger; on fire → insert 'TriggerEvent', resolve mapped 'ActionDefinition'(s) via 'TriggerAction', enqueue each action
7) Implement 'runtime/action-runner.ts':
   - 'queue.consumeActions(handler)' where handler loads action capability, executes, and writes 'ActionInvocation' (status, result JSON, timings, error)
   - Leave retries/backoff minimal; future policy can live in driver
8) Implement HTTP adapter and wire routes:
   - 'http-server.ts' interface + 'express-server.ts' with helmet/cors/pino-http and JSON error handler
   - 'validate.ts' helper for zod schemas
   - 'routes/health.ts' and 'routes/admin/*.ts' stubs using 'HttpServer'
9) Wire bootstrap in 'index.ts':
   - Load config, connect DB, load plugins
   - Initialize queue (via loader) and start action consumer
   - Start trigger runner
   - Create HTTP server using Express adapter; register routes; listen on 'PORT'
10) Tests:
    - Unit: plugin loader with a fake plugin module
    - Unit: memory queue enqueues/consumes in order
    - Integration: fake trigger fires once → expect one 'TriggerEvent' and one 'ActionInvocation'
11) Local run:
    - 'docker compose up -d'
    - 'pnpm -F db exec prisma migrate dev && pnpm -F db exec prisma generate'
    - 'pnpm -F core dev' then GET '/health'
12) Commit and open PR titled 'feat(core): express http adapter, pluggable queue, and runtime bootstrap'

## Example Stubs (use single quotes here; swap to backticks after paste)

'// src/http/http-server.ts'
export interface HttpServer {
  get(path: string, handler: (req: any, res: any) => Promise<void> | void): void;
  post(path: string, handler: (req: any, res: any) => Promise<void> | void): void;
  put(path: string, handler: (req: any, res: any) => Promise<void> | void): void;
  delete(path: string, handler: (req: any, res: any) => Promise<void> | void): void;
  use(mw: any): void;
  listen(port: number): Promise<void>;
}

'// src/http/express-server.ts'
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
export function createExpressServer(): HttpServer {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(pinoHttp());
  // Basic JSON error handler
  app.use((err: any, _req: any, res: any, _next: any) => {
    const status = typeof err?.status === 'number' ? err.status : 500;
    res.status(status).json({ status: 'error', code: err?.code || 'INTERNAL', message: err?.message || 'Internal Server Error' });
  });
  return {
    get: (p, h) => app.get(p, (req, res, next) => Promise.resolve(h(req, res)).catch(next)),
    post: (p, h) => app.post(p, (req, res, next) => Promise.resolve(h(req, res)).catch(next)),
    put: (p, h) => app.put(p, (req, res, next) => Promise.resolve(h(req, res)).catch(next)),
    delete: (p, h) => app.delete(p, (req, res, next) => Promise.resolve(h(req, res)).catch(next)),
    use: (mw) => app.use(mw),
    listen: (port) => new Promise((resolve) => app.listen(port, resolve)),
  };
}

'// src/http/validate.ts'
import { ZodSchema } from 'zod';
export function validate(opts: { body?: ZodSchema; query?: ZodSchema; params?: ZodSchema }) {
  return (handler: (req: any, res: any) => Promise<void> | void) => {
    return async (req: any, res: any) => {
      if (opts.params) req.params = opts.params.parse(req.params);
      if (opts.query) req.query = opts.query.parse(req.query);
      if (opts.body) req.body = opts.body.parse(req.body);
      return handler(req, res);
    };
  };
}

'// src/routes/health.ts'
export function registerHealthRoutes(server: HttpServer, ctx: { queueName: string }) {
  server.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', queue: ctx.queueName });
  });
}

'// src/queue/types.ts'
export interface LatchflowQueue {
  enqueueAction(payload: { actionDefinitionId: string; triggerEventId: string; context?: Record<string, unknown> }): Promise<void>;
  consumeActions(handler: (msg: { actionDefinitionId: string; triggerEventId: string; context?: Record<string, unknown> }) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
}
export type QueueFactory = (opts: { config: unknown }) => Promise<LatchflowQueue>;

'// src/queue/loader.ts'
import { QueueFactory, LatchflowQueue } from './types';
export async function loadQueue(driver: string, pathOrNull: string | null, config: unknown): Promise<{ name: string; queue: LatchflowQueue }> {
  if (!driver || driver === 'memory') {
    const { createMemoryQueue } = await import('./memory-queue');
    return { name: 'memory', queue: await createMemoryQueue({ config }) };
  }
  if (pathOrNull) {
    const mod = await import(pathOrNull);
    const factory: QueueFactory = (mod as any).default ?? (mod as any).createQueue;
    return { name: driver, queue: await factory({ config }) };
  }
  const mod = await import('packages/plugins/queue/' + driver).catch(() => import(driver));
  const factory: QueueFactory = (mod as any).default ?? (mod as any).createQueue;
  return { name: driver, queue: await factory({ config }) };
}

'// src/index.ts' (wire everything together)
import { createExpressServer } from './http/express-server';
import { registerHealthRoutes } from './routes/health';
import { loadQueue } from './queue/loader';
import { loadConfig } from './config';
import { startActionConsumer } from './runtime/action-runner';
import { startTriggerRunner } from './runtime/trigger-runner';
async function main() {
  const config = loadConfig();
  // init DB and plugin capabilities here ...
  const { name: queueName, queue } = await loadQueue(config.QUEUE_DRIVER, config.QUEUE_DRIVER_PATH ?? null, config.QUEUE_CONFIG_JSON ?? null);
  await startActionConsumer(queue, { executeAction: async () => {/* TODO */} });
  await startTriggerRunner({ onFire: async (msg) => queue.enqueueAction(msg) });
  const server = createExpressServer();
  registerHealthRoutes(server, { queueName });
  await server.listen(config.PORT);
}
main().catch((err) => { console.error(err); process.exit(1); });

## Acceptance Checklist
- GET '/health' returns '{ status: "ok", queue: "<driver>" }'
- Unknown route returns a 404 JSON via Express default or custom handler
- Validation errors return 400 JSON
- Firing a fake trigger inserts one 'TriggerEvent' and enqueues mapped actions
- Action consumer executes an action and inserts one 'ActionInvocation'
- Swapping queue works via 'QUEUE_DRIVER' or 'QUEUE_DRIVER_PATH'
- 'pnpm -r test' passes locally; 'pnpm -F core dev' serves '/health'

## Follow-ups (next PRs)
- Optional: 'zod-to-openapi' to emit OpenAPI for admin/portal/CLI clients
- Add Redis driver example in 'packages/plugins/queue/redis'
- Retry policy abstraction and dead-letter support in queue
- Metrics hooks (timings, failure counts) in action/trigger runners
