import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setGlobalMeterProvider = vi.fn();
const diagSetLogger = vi.fn();
const counters = new Map<string, { add: ReturnType<typeof vi.fn> }>();
const histograms = new Map<string, { record: ReturnType<typeof vi.fn> }>();
const createdProviders: FakeMeterProvider[] = [];
const createdReaders: FakeMetricReader[] = [];
let exporterOptions: unknown;
let mergedResource: FakeResource | undefined;

class FakeCounter {
  public readonly add = vi.fn();
}

class FakeHistogram {
  public readonly record = vi.fn();
}

class FakeMeter {
  createCounter(name: string) {
    const counter = new FakeCounter();
    counters.set(name, counter);
    return counter;
  }

  createHistogram(name: string) {
    const histogram = new FakeHistogram();
    histograms.set(name, histogram);
    return histogram;
  }
}

class FakeMetricReader {
  public readonly shutdown = vi.fn().mockResolvedValue(undefined);
  constructor(public readonly options: unknown) {
    createdReaders.push(this);
  }
}

class FakeMeterProvider {
  public readonly meter = new FakeMeter();
  public readonly shutdown = vi.fn().mockResolvedValue(undefined);
  public readonly readers: FakeMetricReader[] = [];

  constructor(public readonly options: unknown) {
    createdProviders.push(this);
  }

  addMetricReader(reader: FakeMetricReader) {
    this.readers.push(reader);
  }

  getMeter() {
    return this.meter;
  }
}

class FakeExporter {
  constructor(options: unknown) {
    exporterOptions = options;
  }
}

class FakeResource {
  constructor(public readonly attributes: Record<string, unknown>) {}

  static default() {
    return {
      merge: (other: FakeResource) => {
        mergedResource = other;
        return other;
      },
    };
  }
}

const SemanticResourceAttributes = {
  SERVICE_NAME: "service.name",
  SERVICE_NAMESPACE: "service.namespace",
  SERVICE_INSTANCE_ID: "service.instance.id",
} as const;

vi.mock(
  "@opentelemetry/api",
  () => ({
    metrics: { setGlobalMeterProvider },
    diag: { setLogger: diagSetLogger },
    DiagConsoleLogger: class {},
    DiagLogLevel: { INFO: "info" },
  }),
  { virtual: true },
);

vi.mock(
  "@opentelemetry/sdk-metrics",
  () => ({
    MeterProvider: FakeMeterProvider,
    PeriodicExportingMetricReader: FakeMetricReader,
  }),
  { virtual: true },
);

vi.mock("@opentelemetry/exporter-metrics-otlp-http", () => ({ OTLPMetricExporter: FakeExporter }), {
  virtual: true,
});

vi.mock("@opentelemetry/resources", () => ({ Resource: FakeResource }), { virtual: true });

vi.mock("@opentelemetry/semantic-conventions", () => ({ SemanticResourceAttributes }), {
  virtual: true,
});

function resetState() {
  setGlobalMeterProvider.mockClear();
  diagSetLogger.mockClear();
  counters.clear();
  histograms.clear();
  createdProviders.length = 0;
  createdReaders.length = 0;
  exporterOptions = undefined;
  mergedResource = undefined;
}

async function loadMetricsModule() {
  await vi.resetModules();
  return import("./metrics.js");
}

beforeEach(() => {
  resetState();
});

afterEach(async () => {
  try {
    const mod = await import("./metrics.js");
    await mod.shutdownAuthzMetrics();
  } catch {
    // ignore when module was not loaded
  }
});

describe("authz metrics", () => {
  it("initializes OpenTelemetry pipeline and records metrics", async () => {
    const {
      initializeAuthzMetrics,
      recordAuthzDecision,
      recordAuthzCache,
      recordAuthzCompilation,
      recordAuthzTwoFactor,
      recordAuthzSimulation,
      recordPluginActionMetric,
      recordPluginTriggerMetric,
    } = await loadMetricsModule();

    const handle = await initializeAuthzMetrics({
      url: "http://collector:4318/v1/metrics",
      headers: { Authorization: "token" },
      serviceName: "latchflow-core",
      serviceNamespace: "latchflow",
      serviceInstanceId: "core-1",
      exportIntervalMillis: 5_000,
      exportTimeoutMillis: 10_000,
      enableDiagnostics: true,
      meterName: "authz-custom",
    });

    expect(createdProviders).toHaveLength(1);
    expect(createdReaders).toHaveLength(1);
    expect(setGlobalMeterProvider).toHaveBeenCalledWith(createdProviders[0]);
    expect(diagSetLogger).toHaveBeenCalledTimes(1);
    expect(exporterOptions).toMatchObject({
      url: "http://collector:4318/v1/metrics",
      headers: { Authorization: "token" },
    });
    expect(mergedResource?.attributes).toMatchObject({
      [SemanticResourceAttributes.SERVICE_NAME]: "latchflow-core",
      [SemanticResourceAttributes.SERVICE_NAMESPACE]: "latchflow",
      [SemanticResourceAttributes.SERVICE_INSTANCE_ID]: "core-1",
    });

    recordAuthzDecision({
      routeId: "GET_/triggers",
      httpMethod: "GET",
      evaluationMode: "shadow",
      policyOutcome: "deny",
      effectiveDecision: "allow",
      reason: "BYPASSED",
      resource: "trigger_def",
      action: "read",
      userRole: "ADMIN",
      durationMs: 12,
      rulesHash: "abc",
    });
    const decisionCounter = counters.get("authz_decision_total");
    expect(decisionCounter?.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        route_id: "GET_/triggers",
        evaluation_mode: "shadow",
        effective_decision: "allow",
        rules_hash: "abc",
      }),
    );
    const decisionDuration = histograms.get("authz_decision_duration_ms");
    expect(decisionDuration?.record).toHaveBeenCalledWith(12, expect.any(Object));

    recordAuthzCache({ operation: "invalidate", rulesHash: "abc", reason: "preset_update" });
    expect(counters.get("authz_rules_cache_events_total")?.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ operation: "invalidate", reason: "preset_update" }),
    );

    recordAuthzCompilation({
      result: "success",
      rulesHash: "abc",
      durationMs: 3,
      directRuleCount: 2,
      presetRuleCount: 5,
    });
    expect(counters.get("authz_compilation_total")?.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ direct_rule_count: 2, preset_rule_count: 5 }),
    );
    expect(histograms.get("authz_compilation_duration_ms")?.record).toHaveBeenCalledWith(
      3,
      expect.any(Object),
    );

    recordAuthzTwoFactor({
      event: "challenge_failed",
      routeId: "POST_/actions",
      httpMethod: "POST",
      userRole: "ADMIN",
      reason: "invalid_code",
    });
    expect(counters.get("authz_two_factor_events_total")?.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ event: "challenge_failed", reason: "invalid_code" }),
    );

    recordAuthzSimulation({
      evaluationMode: "enforce",
      policyOutcome: "allow",
      effectiveDecision: "allow",
      userRole: "EXECUTOR",
      presetId: "preset-1",
    });
    expect(counters.get("authz_simulation_total")?.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ evaluation_mode: "enforce", preset_id: "preset-1" }),
    );

    recordPluginActionMetric({
      pluginId: "plug-1",
      pluginName: "core",
      capabilityId: "cap-1",
      capabilityKey: "gmail",
      definitionId: "act-1",
      status: "SUCCESS",
      durationMs: 42,
    });
    expect(counters.get("plugin_action_invocations_total")?.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ plugin_id: "plug-1", status: "SUCCESS" }),
    );
    expect(histograms.get("plugin_action_duration_ms")?.record).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ capability_key: "gmail" }),
    );

    recordPluginTriggerMetric({
      pluginId: "plug-1",
      pluginName: "core",
      capabilityId: "cap-2",
      capabilityKey: "cron",
      definitionId: "trig-1",
      outcome: "SUCCEEDED",
      latencyMs: 12,
    });
    expect(counters.get("plugin_trigger_emits_total")?.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ capability_key: "cron", outcome: "SUCCEEDED" }),
    );
    expect(histograms.get("plugin_trigger_latency_ms")?.record).toHaveBeenCalledWith(
      12,
      expect.objectContaining({ definition_id: "trig-1" }),
    );

    await handle?.shutdown?.();
    expect(createdReaders[0]?.shutdown).toHaveBeenCalledTimes(1);
    expect(createdProviders[0]?.shutdown).toHaveBeenCalledTimes(1);
  });

  it("is idempotent and ignores record calls before initialization", async () => {
    const { recordAuthzDecision, initializeAuthzMetrics, shutdownAuthzMetrics } =
      await loadMetricsModule();

    recordAuthzDecision({
      routeId: "noop",
      httpMethod: "GET",
      evaluationMode: "shadow",
      policyOutcome: "deny",
      effectiveDecision: "deny",
      reason: "NO_POLICY",
      resource: "trigger_def",
      action: "read",
      userRole: "ADMIN",
    });
    expect(counters.size).toBe(0);

    const handle = await initializeAuthzMetrics();
    const secondHandle = await initializeAuthzMetrics();
    expect(createdProviders).toHaveLength(1);
    expect(createdReaders).toHaveLength(1);
    await handle?.shutdown?.();
    await secondHandle?.shutdown?.();

    await shutdownAuthzMetrics();
  });
});
