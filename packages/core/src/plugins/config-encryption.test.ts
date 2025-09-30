import { describe, it, expect } from "vitest";
import { encryptConfig, decryptConfig, resolveConfigEncryption } from "./config-encryption.js";

describe("config-encryption", () => {
  it("returns value unchanged in none mode", () => {
    const opts = { mode: "none" as const };
    const config = { foo: "bar" };
    const stored = encryptConfig(config, opts);
    expect(stored).toEqual(config);
    expect(decryptConfig(stored, opts)).toEqual(config);
  });

  it("encrypts and decrypts payload with aes-gcm", () => {
    const masterKey = Buffer.alloc(32, 7);
    const opts = { mode: "aes-gcm" as const, masterKey };
    const config = { secret: "value", nested: { token: "abc" } };
    const stored = encryptConfig(config, opts);
    expect(stored).not.toEqual(config);
    expect(typeof stored).toBe("object");
    const decrypted = decryptConfig(stored, opts);
    expect(decrypted).toEqual(config);
  });

  it("resolves encryption options from app config", () => {
    const options = resolveConfigEncryption({
      ENCRYPTION_MODE: "none",
    } as any);
    expect(options).toEqual({ mode: "none" });

    const key = Buffer.alloc(32, 1).toString("base64");
    const aesOpts = resolveConfigEncryption({
      ENCRYPTION_MODE: "aes-gcm",
      ENCRYPTION_MASTER_KEY_B64: key,
    } as any);
    expect(aesOpts.mode).toBe("aes-gcm");
    expect(aesOpts.masterKey?.length).toBe(32);
  });
});
