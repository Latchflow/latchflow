import { loadConfig } from "./config/config.js";
import { getDb } from "./db/db.js";
import { createExpressServer } from "./http/express-server.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerAdminAuthRoutes } from "./routes/auth/admin.js";
import { registerRecipientAuthRoutes } from "./routes/auth/recipient.js";
import { registerCliAuthRoutes } from "./routes/auth/cli.js";
import { loadQueue } from "./queue/loader.js";
import { startActionConsumer } from "./runtime/action-runner.js";
import { startTriggerRunner } from "./runtime/trigger-runner.js";
import {
  loadPlugins,
  PluginRuntimeRegistry,
  upsertPluginsIntoDb,
} from "./plugins/plugin-loader.js";
import { loadStorage } from "./storage/loader.js";
import { createStorageService } from "./storage/service.js";
import { registerOpenApiRoute } from "./routes/openapi.js";
import { registerPortalRoutes } from "./routes/portal.js";
import { registerPluginRoutes } from "./routes/admin/plugins.js";
import { registerTriggerAdminRoutes } from "./routes/admin/triggers.js";
import { registerActionAdminRoutes } from "./routes/admin/actions.js";
import { registerFileAdminRoutes } from "./routes/admin/files.js";
import { registerBundleBuildAdminRoutes } from "./routes/admin/bundle-build.js";
import { createBundleRebuildScheduler } from "./bundles/scheduler.js";
import { registerAssignmentAdminRoutes } from "./routes/admin/assignments.js";
import { registerBundleObjectsAdminRoutes } from "./routes/admin/bundle-objects.js";
import { registerPipelineAdminRoutes } from "./routes/admin/pipelines.js";
import { registerUserAdminRoutes } from "./routes/admin/users.js";

export async function main() {
  const config = loadConfig();

  // Initialize DB (lazy in getDb) and load plugins into registry + DB
  const runtime = new PluginRuntimeRegistry();
  try {
    const db = getDb();
    const loaded = await loadPlugins(config.PLUGINS_PATH);
    await upsertPluginsIntoDb(db, loaded, runtime);
    // eslint-disable-next-line no-console
    console.log(`[core] Plugins loaded: ${loaded.length}`);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[core] Skipping plugin DB upsert (DB unavailable?):", (e as Error).message);
  }

  // Initialize storage
  const { name: storageName, storage } = await loadStorage(
    config.STORAGE_DRIVER,
    config.STORAGE_DRIVER_PATH ?? null,
    {
      basePath: config.STORAGE_BASE_PATH,
      bucket: config.STORAGE_BUCKET,
      config: config.STORAGE_CONFIG_JSON,
    },
  );
  const bucket = config.STORAGE_BUCKET ?? "latchflow-dev";
  const _storageService = createStorageService({
    driver: storage,
    bucket,
    keyPrefix: config.STORAGE_KEY_PREFIX,
  });
  // storage service passed explicitly to route registrations

  // Initialize queue and consumer
  const { name: queueName, queue } = await loadQueue(
    config.QUEUE_DRIVER,
    config.QUEUE_DRIVER_PATH ?? null,
    config.QUEUE_CONFIG_JSON ?? null,
  );

  await startActionConsumer(queue, {
    executeAction: async () => {
      // TODO: resolve action capability and execute it
      return null;
    },
  });

  const triggerRunner = await startTriggerRunner({
    onFire: async (msg) => queue.enqueueAction(msg),
  });

  // Start HTTP server
  const server = createExpressServer();
  // Health checks for readiness
  const checkDb = async () => {
    const db = getDb();
    type MinimalDb = {
      user?: { count: () => Promise<number> };
      $queryRaw?: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
    };
    const maybe = db as unknown as MinimalDb;
    if (maybe.user?.count) {
      await maybe.user.count();
      return;
    }
    if (maybe.$queryRaw) {
      await maybe.$queryRaw`SELECT 1`;
    }
  };
  const checkStorage = async () => {
    const key = `${config.STORAGE_KEY_PREFIX ? config.STORAGE_KEY_PREFIX + "/" : ""}__healthcheck__`;
    await storage.put({ bucket, key, body: Buffer.from("ok") });
    await storage.del({ bucket, key });
  };
  const checkQueue = async () => {
    // For now we assume queue was loaded successfully; no-op
    return;
  };

  // Initialize bundle rebuild scheduler before route registration
  const rebuilder = createBundleRebuildScheduler({ db: getDb(), storage: _storageService });
  registerHealthRoutes(server, { queueName, storageName, checkDb, checkQueue, checkStorage });
  registerAdminAuthRoutes(server, config);
  registerRecipientAuthRoutes(server, config);
  registerPortalRoutes(server, { storage: _storageService, scheduler: rebuilder });
  registerCliAuthRoutes(server, config);
  registerPluginRoutes(server);
  registerTriggerAdminRoutes(server, { fireTriggerOnce: triggerRunner.fireTriggerOnce, config });
  registerActionAdminRoutes(server, { queue, config });
  registerPipelineAdminRoutes(server, { config });
  registerUserAdminRoutes(server, config);
  registerFileAdminRoutes(server, {
    storage: _storageService,
    onFilesChanged: async (fileIds) => {
      await rebuilder.scheduleForFiles(fileIds);
    },
  });
  registerBundleObjectsAdminRoutes(server, { scheduler: rebuilder });
  registerBundleBuildAdminRoutes(server, { storage: _storageService, scheduler: rebuilder });
  registerAssignmentAdminRoutes(server);
  registerOpenApiRoute(server);
  await server.listen(config.PORT);
  // eslint-disable-next-line no-console
  console.log(`[core] HTTP server listening on :${config.PORT}`);
}

// Only run when executed directly
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
