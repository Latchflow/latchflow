import { describe, it, expect, vi } from "vitest";
import { sha256Hex, formatApiToken, makeUserCode, randomTokenBase64Url } from "./tokens.js";

describe("tokens utils", () => {
  it("sha256Hex is deterministic", () => {
    const h1 = sha256Hex("abc");
    const h2 = sha256Hex("abc");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it("formatApiToken adds prefix", () => {
    expect(formatApiToken("lfk_", "raw")).toBe("lfk_raw");
  });

  it("makeUserCode shape XXXX-XXXX", () => {
    const code = makeUserCode();
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it("randomTokenBase64Url produces url-safe string", () => {
    const t = randomTokenBase64Url(16);
    expect(/^[A-Za-z0-9_-]+$/.test(t)).toBe(true);
  });
});
