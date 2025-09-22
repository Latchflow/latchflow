declare module "@opentelemetry/sdk-metrics" {
  export class PeriodicExportingMetricReader {
    constructor(options: unknown);
    shutdown(): Promise<void>;
  }

  export class MeterProvider {
    constructor(options?: unknown);
    addMetricReader(reader: PeriodicExportingMetricReader): void;
    getMeter(
      name: string,
      options?: Record<string, unknown>,
    ): {
      createCounter(
        name: string,
        options?: Record<string, unknown>,
      ): { add(value: number, attributes?: Record<string, unknown>): void };
      createHistogram(
        name: string,
        options?: Record<string, unknown>,
      ): { record(value: number, attributes?: Record<string, unknown>): void };
    };
    shutdown(): Promise<void>;
  }
}

declare module "@opentelemetry/exporter-metrics-otlp-http" {
  export class OTLPMetricExporter {
    constructor(options?: Record<string, unknown>);
  }
}

declare module "@opentelemetry/resources" {
  export class Resource {
    constructor(attributes?: Record<string, unknown>);
    static default(): { merge(other: Resource): Resource };
    merge(other: Resource): Resource;
    readonly attributes: Record<string, unknown>;
  }
}

declare module "@opentelemetry/semantic-conventions" {
  export const SemanticResourceAttributes: Record<string, string>;
}

declare module "@opentelemetry/api" {
  export namespace metrics {
    function setGlobalMeterProvider(provider: unknown): void;
  }
  export namespace diag {
    function setLogger(logger: unknown, level?: unknown): void;
  }
  export class DiagConsoleLogger {}
  export const DiagLogLevel: Record<string, unknown>;
}
