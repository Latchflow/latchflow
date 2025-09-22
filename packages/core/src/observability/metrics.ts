import type { AuthorizeDecision, ExecAction, ExecResource } from "../authz/types";
import type { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { logger } from "./logger.js";

export type AuthzEvaluationMode = "shadow" | "enforce";

export type AuthzDecisionEffect = "allow" | "deny";

export type AuthzDecisionReason = AuthorizeDecision["reason"] | "BYPASSED";

export type AuthzDecisionMetric = {
  routeId: string;
  httpMethod: string;
  evaluationMode: AuthzEvaluationMode;
  policyOutcome: AuthzDecisionEffect;
  effectiveDecision: AuthzDecisionEffect;
  reason: AuthzDecisionReason;
  resource: ExecResource | "*";
  action: ExecAction;
  userRole: "ADMIN" | "EXECUTOR";
  userId?: string;
  presetId?: string;
  executorProfileId?: string;
  ruleId?: string;
  rulesHash?: string;
  requestId?: string;
  durationMs?: number;
};

export type AuthzCacheMetric = {
  operation: "hit" | "miss" | "invalidate";
  rulesHash: string;
  reason?:
    | "bootstrap"
    | "preset_update"
    | "direct_rule_update"
    | "assignment"
    | "flag_toggle"
    | "manual";
  presetId?: string;
  executorProfileId?: string;
};

export type AuthzCompilationResult = "success" | "failure";

export type AuthzCompilationMetric = {
  result: AuthzCompilationResult;
  rulesHash: string;
  durationMs?: number;
  presetId?: string;
  executorProfileId?: string;
  directRuleCount?: number;
  presetRuleCount?: number;
  errorName?: string;
};

export type AuthzTwoFactorEvent =
  | "challenge_required"
  | "challenge_satisfied"
  | "challenge_failed"
  | "session_expired";

export type AuthzTwoFactorMetric = {
  event: AuthzTwoFactorEvent;
  routeId: string;
  httpMethod: string;
  userRole: "ADMIN" | "EXECUTOR";
  userId?: string;
  reason?: "missing_2fa" | "stale_reauth" | "invalid_code" | "locked_out" | "unknown";
};

export type AuthzSimulationMetric = {
  evaluationMode: AuthzEvaluationMode;
  policyOutcome: AuthzDecisionEffect;
  effectiveDecision: AuthzDecisionEffect;
  userRole: "ADMIN" | "EXECUTOR";
  userId?: string;
  presetId?: string;
  executorProfileId?: string;
  ruleId?: string;
  rulesHash?: string;
};

export type AuthzMetricsOptions = {
  /** Full OTLP/HTTP endpoint URL. Defaults to http://localhost:4318/v1/metrics when not provided. */
  url?: string;
  /** Additional headers to send with OTLP requests. */
  headers?: Record<string, string>;
  /** Service name reported in resource attributes. Defaults to "latchflow-core". */
  serviceName?: string;
  /** Optional namespace for the service resource attribute. */
  serviceNamespace?: string;
  /** Instance identifier for distinguishing nodes. */
  serviceInstanceId?: string;
  /** Name used when registering the meter. Defaults to "latchflow-authz". */
  meterName?: string;
  /** Export interval (ms) for periodic metric reader. Defaults to 10s. */
  exportIntervalMillis?: number;
  /** Export timeout (ms). Defaults to 30s. */
  exportTimeoutMillis?: number;
  /** When true, enable console diagnostics for OpenTelemetry SDK warnings. */
  enableDiagnostics?: boolean;
};

const DEFAULT_EXPORT_INTERVAL = 10_000;
const DEFAULT_EXPORT_TIMEOUT = 30_000;
const DEFAULT_OTLP_URL = "http://localhost:4318/v1/metrics" as const;

type OtelCounter = { add(value: number, attributes?: Record<string, unknown>): void };
type OtelHistogram = { record(value: number, attributes?: Record<string, unknown>): void };

type AuthzMetricsState = {
  metricReader: PeriodicExportingMetricReader;
  meterProvider: MeterProvider;
  decisionCounter: OtelCounter;
  decisionDuration: OtelHistogram;
  cacheCounter: OtelCounter;
  compilationCounter: OtelCounter;
  compilationDuration: OtelHistogram;
  twoFactorCounter: OtelCounter;
  simulationCounter: OtelCounter;
};

let state: AuthzMetricsState | null = null;

async function loadOtelDependencies() {
  const [api, exporter, metricsSdk, resources, semconv] = await Promise.all([
    import("@opentelemetry/api"),
    import("@opentelemetry/exporter-metrics-otlp-http"),
    import("@opentelemetry/sdk-metrics"),
    import("@opentelemetry/resources"),
    import("@opentelemetry/semantic-conventions"),
  ]);
  return { api, exporter, metricsSdk, resources, semconv };
}

export type AuthzMetricsHandle = {
  shutdown: () => Promise<void>;
};

export async function initializeAuthzMetrics(
  options: AuthzMetricsOptions = {},
): Promise<AuthzMetricsHandle | null> {
  if (state) {
    return { shutdown: shutdownAuthzMetrics };
  }

  try {
    const { api, exporter, metricsSdk, resources, semconv } = await loadOtelDependencies();

    if (options.enableDiagnostics) {
      api.diag.setLogger(new api.DiagConsoleLogger(), api.DiagLogLevel.INFO);
    }

    const resource = resources.Resource.default().merge(
      new resources.Resource(
        sanitizeAttributes({
          [semconv.SemanticResourceAttributes.SERVICE_NAME]:
            options.serviceName ?? "latchflow-core",
          [semconv.SemanticResourceAttributes.SERVICE_NAMESPACE]: options.serviceNamespace,
          [semconv.SemanticResourceAttributes.SERVICE_INSTANCE_ID]: options.serviceInstanceId,
        }),
      ),
    );

    const meterProvider = new metricsSdk.MeterProvider({ resource });
    const metricReader = new metricsSdk.PeriodicExportingMetricReader({
      exporter: new exporter.OTLPMetricExporter({
        url: options.url ?? DEFAULT_OTLP_URL,
        headers: options.headers,
      }),
      exportIntervalMillis: options.exportIntervalMillis ?? DEFAULT_EXPORT_INTERVAL,
      exportTimeoutMillis: options.exportTimeoutMillis ?? DEFAULT_EXPORT_TIMEOUT,
    });

    meterProvider.addMetricReader(metricReader);
    api.metrics.setGlobalMeterProvider(meterProvider);

    const meter = meterProvider.getMeter(options.meterName ?? "latchflow-authz");

    state = {
      metricReader,
      meterProvider,
      decisionCounter: meter.createCounter("authz_decision_total", {
        description: "Total number of authorization decisions evaluated by the engine.",
      }),
      decisionDuration: meter.createHistogram("authz_decision_duration_ms", {
        description: "Observed latency (in milliseconds) of authorization evaluations.",
        unit: "ms",
      }),
      cacheCounter: meter.createCounter("authz_rules_cache_events_total", {
        description: "Events emitted by the authorization rules cache.",
      }),
      compilationCounter: meter.createCounter("authz_compilation_total", {
        description: "Count of rule compilation attempts.",
      }),
      compilationDuration: meter.createHistogram("authz_compilation_duration_ms", {
        description: "Duration of rule compilation runs in milliseconds.",
        unit: "ms",
      }),
      twoFactorCounter: meter.createCounter("authz_two_factor_events_total", {
        description: "Two-factor authentication checks performed for privileged routes.",
      }),
      simulationCounter: meter.createCounter("authz_simulation_total", {
        description: "Total authorization simulations executed via the simulator endpoint.",
      }),
    };

    return { shutdown: shutdownAuthzMetrics };
  } catch (err) {
    logger.warn(
      { error: (err as Error).message },
      "Failed to initialize OpenTelemetry for authz metrics",
    );
    state = null;
    return null;
  }
}

export async function shutdownAuthzMetrics() {
  if (!state) return;
  const { metricReader, meterProvider } = state;
  state = null;
  await Promise.all([
    metricReader.shutdown().catch((err: unknown) => {
      logger.warn({ error: (err as Error).message }, "Metric reader shutdown failed");
    }),
    meterProvider.shutdown().catch((err: unknown) => {
      logger.warn({ error: (err as Error).message }, "Meter provider shutdown failed");
    }),
  ]);
}

export function recordAuthzDecision(metric: AuthzDecisionMetric) {
  if (!state) return;
  const attrs = sanitizeAttributes({
    route_id: metric.routeId,
    http_method: metric.httpMethod,
    evaluation_mode: metric.evaluationMode,
    policy_outcome: metric.policyOutcome,
    effective_decision: metric.effectiveDecision,
    reason: metric.reason,
    resource: metric.resource,
    action: metric.action,
    user_role: metric.userRole,
    user_id: metric.userId,
    preset_id: metric.presetId,
    executor_profile_id: metric.executorProfileId,
    rule_id: metric.ruleId,
    rules_hash: metric.rulesHash,
  });
  state.decisionCounter.add(1, attrs);
  if (metric.durationMs != null) {
    state.decisionDuration.record(metric.durationMs, attrs);
  }
}

export function recordAuthzCache(metric: AuthzCacheMetric) {
  if (!state) return;
  const attrs = sanitizeAttributes({
    operation: metric.operation,
    rules_hash: metric.rulesHash,
    reason: metric.reason,
    preset_id: metric.presetId,
    executor_profile_id: metric.executorProfileId,
  });
  state.cacheCounter.add(1, attrs);
}

export function recordAuthzCompilation(metric: AuthzCompilationMetric) {
  if (!state) return;
  const attrs = sanitizeAttributes({
    result: metric.result,
    rules_hash: metric.rulesHash,
    preset_id: metric.presetId,
    executor_profile_id: metric.executorProfileId,
    direct_rule_count: metric.directRuleCount,
    preset_rule_count: metric.presetRuleCount,
    error_name: metric.errorName,
  });
  state.compilationCounter.add(1, attrs);
  if (metric.durationMs != null) {
    state.compilationDuration.record(metric.durationMs, attrs);
  }
}

export function recordAuthzTwoFactor(metric: AuthzTwoFactorMetric) {
  if (!state) return;
  const attrs = sanitizeAttributes({
    event: metric.event,
    route_id: metric.routeId,
    http_method: metric.httpMethod,
    user_role: metric.userRole,
    user_id: metric.userId,
    reason: metric.reason,
  });
  state.twoFactorCounter.add(1, attrs);
}

export function recordAuthzSimulation(metric: AuthzSimulationMetric) {
  if (!state) return;
  const attrs = sanitizeAttributes({
    evaluation_mode: metric.evaluationMode,
    policy_outcome: metric.policyOutcome,
    effective_decision: metric.effectiveDecision,
    user_role: metric.userRole,
    user_id: metric.userId,
    preset_id: metric.presetId,
    executor_profile_id: metric.executorProfileId,
    rule_id: metric.ruleId,
    rules_hash: metric.rulesHash,
  });
  state.simulationCounter.add(1, attrs);
}

function sanitizeAttributes(input: Record<string, string | number | boolean | undefined>) {
  const attrs: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null) {
      attrs[key] = value;
    }
  }
  return attrs;
}
