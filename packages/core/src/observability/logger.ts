import pino from "pino";
import { trace } from "@opentelemetry/api";

export interface LoggerConfig {
  level?: string;
  pretty?: boolean;
  redact?: string[];
}

function createBaseLogger(config: LoggerConfig = {}) {
  const {
    level = process.env.LOG_LEVEL || "info",
    pretty = process.env.LOG_PRETTY === "true" || process.env.NODE_ENV === "development",
    redact = ["password", "token", "secret", "authorization", "cookie"],
  } = config;

  const transport = pretty
    ? pino.transport({
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      })
    : undefined;

  return pino(
    {
      level,
      redact,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
      },
      mixin() {
        const span = trace.getActiveSpan();
        if (span) {
          const spanContext = span.spanContext();
          return {
            traceId: spanContext.traceId,
            spanId: spanContext.spanId,
          };
        }
        return {};
      },
    },
    transport,
  );
}

export const logger = createBaseLogger();

export function createChildLogger(context: Record<string, unknown>) {
  return logger.child(context);
}

export function createRequestLogger(requestId?: string) {
  return createChildLogger({ component: "http", requestId });
}

export function createStorageLogger() {
  return createChildLogger({ component: "storage" });
}

export function createAuthLogger() {
  return createChildLogger({ component: "auth" });
}

export function createAuthzLogger() {
  return createChildLogger({ component: "authz" });
}

export function createPluginLogger(pluginName?: string) {
  return createChildLogger({ component: "plugin", pluginName });
}

export function createRuntimeLogger() {
  return createChildLogger({ component: "runtime" });
}

export function createDatabaseLogger() {
  return createChildLogger({ component: "database" });
}
