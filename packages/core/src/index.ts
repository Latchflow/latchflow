import { loadConfig } from "./config";
import { getDb } from "./db";
import { createExpressServer } from "./http/express-server";
import { registerHealthRoutes } from "./routes/health";
import { loadQueue } from "./queue/loader";
import { startActionConsumer } from "./runtime/action-runner";
import { startTriggerRunner } from "./runtime/trigger-runner";
import { loadPlugins, PluginRuntimeRegistry, upsertPluginsIntoDb } from "./plugins/plugin-loader";

export async function main() {
  const config = loadConfig();

  // Initialize DB (lazy in getDb) and load plugins into registry + DB
  const db = getDb();
  const loaded = await loadPlugins(config.PLUGINS_PATH);
  const runtime = new PluginRuntimeRegistry();
  await upsertPluginsIntoDb(db, loaded, runtime);

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
  registerHealthRoutes(server, { queueName });
  await server.listen(config.PORT);
}

// Only run when executed directly
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
