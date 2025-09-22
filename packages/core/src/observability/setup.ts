import type { AppConfig } from "../config/config.js";
import { initializeAuthzMetrics, type AuthzMetricsHandle } from "./metrics.js";

export type ConfiguredAuthzMetrics = {
  shutdown?: () => Promise<void>;
};

export async function configureAuthzMetrics(config: AppConfig): Promise<ConfiguredAuthzMetrics> {
  if (!config.AUTHZ_METRICS_ENABLED || process.env.NODE_ENV === "test") {
    return {};
  }

  const initPromise: Promise<AuthzMetricsHandle | null> = initializeAuthzMetrics({
    url: config.AUTHZ_METRICS_OTLP_URL,
    headers: config.AUTHZ_METRICS_OTLP_HEADERS,
    serviceName: config.AUTHZ_METRICS_SERVICE_NAME,
    serviceNamespace: config.AUTHZ_METRICS_SERVICE_NAMESPACE,
    serviceInstanceId: config.AUTHZ_METRICS_SERVICE_INSTANCE_ID,
    exportIntervalMillis: config.AUTHZ_METRICS_EXPORT_INTERVAL_MS,
    exportTimeoutMillis: config.AUTHZ_METRICS_EXPORT_TIMEOUT_MS,
    enableDiagnostics: config.AUTHZ_METRICS_ENABLE_DIAGNOSTICS,
  }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn(`[core] Authz metrics initialization failed: ${(err as Error).message}`);
    return null;
  });

  return {
    shutdown: async () => {
      const handle = await initPromise;
      if (handle?.shutdown) {
        await handle.shutdown();
      }
    },
  };
}
