import { describe, it, expect, afterEach } from "vitest";
import { loadConfig } from "./config.js";

describe("config loader", () => {
  it("parses required and defaults", () => {
    const cfg = loadConfig({
      DATABASE_URL: "postgres://user:pass@localhost:5432/db",
      PLUGINS_PATH: "packages/plugins",
      QUEUE_DRIVER: "memory",
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg.DATABASE_URL).toBeDefined();
    expect(cfg.PORT).toBe(3001);
    expect(cfg.QUEUE_DRIVER).toBe("memory");
  });

  it("parses QUEUE_CONFIG_JSON when provided", () => {
    const cfg = loadConfig({
      DATABASE_URL: "postgres://user:pass@localhost:5432/db",
      QUEUE_CONFIG_JSON: JSON.stringify({ concurrency: 2 }),
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg.QUEUE_CONFIG_JSON).toEqual({ concurrency: 2 });
  });

  it("throws on invalid QUEUE_CONFIG_JSON", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgres://x",
        QUEUE_CONFIG_JSON: "{not-json",
      } as any),
    ).toThrow(/Invalid QUEUE_CONFIG_JSON/);
  });

  it("throws when API_TOKEN_SCOPES_DEFAULT is not an array", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgres://x",
        API_TOKEN_SCOPES_DEFAULT: "{}",
      } as any),
    ).toThrow(/Invalid API_TOKEN_SCOPES_DEFAULT/);
  });

  it("parses authz metrics configuration", () => {
    const cfg = loadConfig({
      DATABASE_URL: "postgres://user:pass@localhost:5432/db",
      AUTHZ_METRICS_ENABLED: "true",
      AUTHZ_METRICS_OTLP_URL: "http://collector:4318/v1/metrics",
      AUTHZ_METRICS_OTLP_HEADERS: JSON.stringify({ Authorization: "Bearer test" }),
      AUTHZ_METRICS_EXPORT_INTERVAL_MS: "5000",
      AUTHZ_METRICS_EXPORT_TIMEOUT_MS: "10000",
      AUTHZ_METRICS_ENABLE_DIAGNOSTICS: "true",
      AUTHZ_METRICS_SERVICE_NAME: "latchflow-core-tests",
      AUTHZ_METRICS_SERVICE_NAMESPACE: "latchflow",
      AUTHZ_METRICS_SERVICE_INSTANCE_ID: "test-node",
    } as unknown as NodeJS.ProcessEnv);

    expect(cfg.AUTHZ_METRICS_ENABLED).toBe(true);
    expect(cfg.AUTHZ_METRICS_OTLP_URL).toBe("http://collector:4318/v1/metrics");
    expect(cfg.AUTHZ_METRICS_OTLP_HEADERS).toEqual({ Authorization: "Bearer test" });
    expect(cfg.AUTHZ_METRICS_EXPORT_INTERVAL_MS).toBe(5000);
    expect(cfg.AUTHZ_METRICS_EXPORT_TIMEOUT_MS).toBe(10000);
    expect(cfg.AUTHZ_METRICS_ENABLE_DIAGNOSTICS).toBe(true);
    expect(cfg.AUTHZ_METRICS_SERVICE_NAME).toBe("latchflow-core-tests");
    expect(cfg.AUTHZ_METRICS_SERVICE_NAMESPACE).toBe("latchflow");
    expect(cfg.AUTHZ_METRICS_SERVICE_INSTANCE_ID).toBe("test-node");
  });

  it("throws when required env missing", () => {
    expect(() => loadConfig({} as any)).toThrow(/Invalid environment/);
  });
});

describe("AUTH_COOKIE_SECURE defaulting", () => {
  const oldEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = oldEnv;
  });

  it("defaults to false in development", () => {
    process.env.NODE_ENV = "development";
    const cfg = loadConfig({
      DATABASE_URL: "postgres://user:pass@localhost:5432/db",
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg.AUTH_COOKIE_SECURE).toBe(false);
  });

  it("defaults to true otherwise", () => {
    process.env.NODE_ENV = "production";
    const cfg = loadConfig({
      DATABASE_URL: "postgres://user:pass@localhost:5432/db",
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg.AUTH_COOKIE_SECURE).toBe(true);
  });

  it("respects explicit AUTH_COOKIE_SECURE=true", () => {
    process.env.NODE_ENV = "development";
    const cfg = loadConfig({
      DATABASE_URL: "postgres://user:pass@localhost:5432/db",
      AUTH_COOKIE_SECURE: "true",
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg.AUTH_COOKIE_SECURE).toBe(true);
  });
});
