import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config.js";

describe("config invalid branches", () => {
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

  it("throws when required env missing", () => {
    expect(() => loadConfig({} as any)).toThrow(/Invalid environment/);
  });
});
