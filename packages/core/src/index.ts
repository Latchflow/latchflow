import { loadConfig } from "./config/env-config.js";
import { getDb } from "./db/db.js";
import { logger, createPluginLogger } from "./observability/logger.js";
import { createExpressServer } from "./http/express-server.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerAdminAuthRoutes } from "./routes/auth/admin.js";
import { registerRecipientAuthRoutes } from "./routes/auth/recipient.js";
import { registerCliAuthRoutes } from "./routes/auth/cli.js";
import { loadQueue } from "./queue/loader.js";
import { startActionConsumer } from "./runtime/action-runner.js";
import { startTriggerRunner } from "./runtime/trigger-runner.js";
import { TriggerRuntimeManager } from "./runtime/trigger-runtime-manager.js";
import {
  loadPlugins,
  PluginRuntimeRegistry,
  upsertPluginsIntoDb,
} from "./plugins/plugin-loader.js";
import { startPluginWatcher } from "./plugins/hot-reload.js";
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
import { registerPermissionPresetAdminRoutes } from "./routes/admin/permissionPresets.js";
import { configureAuthzMetrics } from "./observability/setup.js";
import { configureAuthzFlags } from "./authz/featureFlags.js";
import { registerBundleAdminRoutes } from "./routes/admin/bundles.js";
import { registerRecipientAdminRoutes } from "./routes/admin/recipients.js";
import { registerSystemConfigAdminRoutes } from "./routes/admin/system-config.js";
import {
  getSystemConfigService,
  seedSystemConfigFromEnvironment,
} from "./config/system-config-startup.js";
import { createStubPluginServiceRegistry } from "./services/stubs.js";
import { resolveConfigEncryption } from "./plugins/config-encryption.js";
import { InMemoryEmailProviderRegistry } from "./services/email-provider-registry.js";
import { EmailDeliveryService } from "./email/delivery-service.js";

export async function main() {
  const config = loadConfig();
  let configEncryption;
  try {
    configEncryption = resolveConfigEncryption(config);
  } catch (err) {
    logger.warn({ error: (err as Error).message }, "Falling back to unencrypted config storage");
    configEncryption = { mode: "none" } as const;
  }

  configureAuthzFlags({
    enforce: config.AUTHZ_V2,
    shadow: config.AUTHZ_V2_SHADOW,
    requireAdmin2fa: config.AUTHZ_REQUIRE_ADMIN_2FA,
    reauthWindowMin: config.AUTHZ_REAUTH_WINDOW_MIN,
    systemUserId: config.SYSTEM_USER_ID,
  });

  const metricsHandle = await configureAuthzMetrics(config);
  if (metricsHandle.shutdown) {
    const forwardSignal = (signal: NodeJS.Signals) => {
      process.once(signal, () => {
        void (async () => {
          try {
            await metricsHandle.shutdown?.();
          } catch (err) {
            logger.warn(
              { signal, error: (err as Error).message },
              "Failed to flush authz metrics on signal",
            );
          } finally {
            process.kill(process.pid, signal);
          }
        })();
      });
    };
    forwardSignal("SIGTERM");
    forwardSignal("SIGINT");
  }

  // Initialize DB (lazy in getDb) and load plugins into registry + DB
  const emailRegistry = new InMemoryEmailProviderRegistry();
  const pluginServices = createStubPluginServiceRegistry({ emailRegistry });
  const runtime = new PluginRuntimeRegistry(pluginServices);
  const db = getDb();
  let pluginsLoaded = false;
  let systemConfigService: Awaited<ReturnType<typeof getSystemConfigService>> | null = null;
  try {
    // Initialize system configuration and seed from environment
    systemConfigService = await getSystemConfigService(db, config);
    await seedSystemConfigFromEnvironment(systemConfigService, config);

    const loaded = await loadPlugins(config.PLUGINS_PATH);
    await upsertPluginsIntoDb(db, loaded, runtime);
    createPluginLogger().info({ count: loaded.length }, "Plugins loaded");
    pluginsLoaded = true;
  } catch (e) {
    createPluginLogger().warn(
      { error: (e as Error).message },
      "Skipping plugin DB upsert (DB unavailable?)",
    );
  }

  const emailService = new EmailDeliveryService({
    registry: emailRegistry,
    systemConfig: systemConfigService ?? { get: async () => null },
    config,
  });

  let pluginWatcher: ReturnType<typeof startPluginWatcher> | undefined;
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
    registry: runtime,
    encryption: configEncryption,
  });

  const triggerRunner = await startTriggerRunner({
    onFire: async (msg) => queue.enqueueAction(msg),
  });

  const triggerRuntimeManager = new TriggerRuntimeManager({
    db,
    registry: runtime,
    fireTrigger: triggerRunner.fireTriggerOnce,
    encryption: configEncryption,
  });
  await triggerRuntimeManager.startAll();

  const stopTriggerRuntimes = () => {
    triggerRuntimeManager
      .stopAll()
      .catch((err) =>
        logger.warn({ error: (err as Error).message }, "Failed to stop trigger runtimes"),
      );
  };

  if (pluginsLoaded && process.env.NODE_ENV !== "production") {
    try {
      pluginWatcher = startPluginWatcher({
        pluginsPath: config.PLUGINS_PATH,
        runtime,
        db,
      });
      const stopWatcher = () => pluginWatcher?.close();
      process.once("SIGINT", stopWatcher);
      process.once("SIGTERM", stopWatcher);
    } catch (err) {
      createPluginLogger("watcher").warn(
        { error: (err as Error).message },
        "Failed to start plugin watcher",
      );
    }
  }

  process.once("SIGINT", stopTriggerRuntimes);
  process.once("SIGTERM", stopTriggerRuntimes);

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
  registerAdminAuthRoutes(server, config, { emailService });
  registerRecipientAuthRoutes(server, config);
  registerPortalRoutes(server, { storage: _storageService, scheduler: rebuilder });
  registerCliAuthRoutes(server, config);
  registerPluginRoutes(server, { runtime });
  registerTriggerAdminRoutes(server, {
    fireTriggerOnce: triggerRunner.fireTriggerOnce,
    config,
    encryption: configEncryption,
    runtime,
    runtimeManager: triggerRuntimeManager,
  });
  registerActionAdminRoutes(server, { queue, config, encryption: configEncryption, runtime });
  registerPipelineAdminRoutes(server, { config });
  registerUserAdminRoutes(server, config, { emailService });
  registerPermissionPresetAdminRoutes(server, { config });
  registerBundleAdminRoutes(server, { scheduler: rebuilder, config });
  registerRecipientAdminRoutes(server, config);
  registerSystemConfigAdminRoutes(server, config);
  registerFileAdminRoutes(server, {
    storage: _storageService,
    onFilesChanged: async (fileIds) => {
      await rebuilder.scheduleForFiles(fileIds);
    },
  });
  registerBundleObjectsAdminRoutes(server, { scheduler: rebuilder, config });
  registerBundleBuildAdminRoutes(server, { storage: _storageService, scheduler: rebuilder });
  registerAssignmentAdminRoutes(server);
  registerOpenApiRoute(server);
  await server.listen(config.PORT);
  logger.info({ port: config.PORT }, "HTTP server listening");
}

// Only run when executed directly
if (require.main === module) {
  main().catch((err) => {
    logger.error({ error: err }, "Failed to start core");
    process.exit(1);
  });
}
