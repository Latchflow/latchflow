import fs from "node:fs";
import path from "node:path";
import type { DbClient } from "../db/db.js";
import { createPluginLogger } from "../observability/logger.js";
import {
  loadPluginByName,
  upsertPluginsIntoDb,
  type PluginRuntimeRegistry,
} from "./plugin-loader.js";

export interface PluginWatcherOptions {
  pluginsPath: string;
  runtime: PluginRuntimeRegistry;
  db: DbClient;
  systemConfig?: import("../config/system-config-core.js").SystemConfigService;
  debounceMs?: number;
}

export interface PluginWatcher {
  close(): void;
}

export function startPluginWatcher(options: PluginWatcherOptions): PluginWatcher {
  const debounceMs = options.debounceMs ?? 150;
  const absBase = path.resolve(process.cwd(), options.pluginsPath);
  const logger = createPluginLogger("watcher");

  if (!fs.existsSync(absBase)) {
    logger.warn({ path: absBase }, "Plugin watch path does not exist, skipping watcher");
    return { close() {} };
  }

  const pluginTimers = new Map<string, NodeJS.Timeout>();
  const inflight = new Map<string, Promise<void>>();
  const pluginWatchers = new Map<string, fs.FSWatcher>();
  let closed = false;

  const scheduleReload = (pluginName: string) => {
    if (closed) return;
    const timer = pluginTimers.get(pluginName);
    if (timer) clearTimeout(timer);
    pluginTimers.set(
      pluginName,
      setTimeout(() => {
        pluginTimers.delete(pluginName);
        triggerReload(pluginName).catch((err) => {
          logger.error(
            { plugin: pluginName, error: err instanceof Error ? err.message : err },
            "Plugin reload failed",
          );
        });
      }, debounceMs),
    );
  };

  const triggerReload = async (pluginName: string) => {
    if (closed) return;
    if (inflight.has(pluginName)) return inflight.get(pluginName);
    const reloadPromise = (async () => {
      const pluginLogger = createPluginLogger(pluginName);
      const plugin = await loadPluginByName(options.pluginsPath, pluginName, { cacheBust: true });
      if (!plugin) {
        // Plugin directory might have been removed; remove from runtime and stop watching.
        await options.runtime.removePlugin(pluginName);
        const watcher = pluginWatchers.get(pluginName);
        if (watcher) {
          watcher.close();
          pluginWatchers.delete(pluginName);
        }
        pluginLogger.warn("Plugin directory missing; removed from runtime");
        return;
      }

      await options.runtime.removePlugin(pluginName);
      await upsertPluginsIntoDb(options.db, [plugin], options.runtime, {
        systemConfig: options.systemConfig,
      });
      pluginLogger.info("Plugin hot-reloaded");
    })();
    inflight.set(pluginName, reloadPromise);
    try {
      await reloadPromise;
    } finally {
      inflight.delete(pluginName);
    }
  };

  const watchPluginDir = (pluginName: string) => {
    if (pluginWatchers.has(pluginName)) return;
    const dir = path.join(absBase, pluginName);
    try {
      const stats = fs.statSync(dir);
      if (!stats.isDirectory()) return;
    } catch {
      return;
    }

    try {
      const watcher = fs.watch(dir, { persistent: false }, () => scheduleReload(pluginName));
      pluginWatchers.set(pluginName, watcher);
    } catch (err) {
      logger.warn(
        { plugin: pluginName, error: err instanceof Error ? err.message : err },
        "Failed to watch plugin directory",
      );
    }
  };

  const baseWatcher = fs.watch(absBase, { persistent: false }, (_event, filename) => {
    if (typeof filename !== "string" || !filename) return;
    watchPluginDir(filename);
    scheduleReload(filename);
  });

  for (const entry of fs.readdirSync(absBase, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      watchPluginDir(entry.name);
    }
  }

  return {
    close() {
      if (closed) return;
      closed = true;
      baseWatcher.close();
      for (const watcher of pluginWatchers.values()) {
        watcher.close();
      }
      pluginWatchers.clear();
      for (const timer of pluginTimers.values()) {
        clearTimeout(timer);
      }
      pluginTimers.clear();
    },
  };
}
