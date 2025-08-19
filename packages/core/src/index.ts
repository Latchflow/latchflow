import { loadConfig } from "./config.js";
import { getDb } from "./db.js";
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
  const _storageService = createStorageService({
    driver: storage,
    bucket: config.STORAGE_BUCKET ?? "latchflow-dev",
    keyPrefix: config.STORAGE_KEY_PREFIX,
  });

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

  await startTriggerRunner({
    onFire: async (msg) => queue.enqueueAction(msg),
  });

  // Start HTTP server
  const server = createExpressServer();
  registerHealthRoutes(server, { queueName, storageName });
  registerAdminAuthRoutes(server, config);
  registerRecipientAuthRoutes(server, config);
  registerCliAuthRoutes(server, config);
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
