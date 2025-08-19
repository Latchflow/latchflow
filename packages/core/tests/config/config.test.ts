import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config.js";

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
});
