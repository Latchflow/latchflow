import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "./config.js";

describe("AUTH_COOKIE_SECURE defaulting", () => {
  const oldEnv = process.env.NODE_ENV;
  beforeEach(() => {
    // no-op
  });
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
