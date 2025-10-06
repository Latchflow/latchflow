import { describe, it, expect } from "vitest";

import {
  encryptConfig,
  decryptConfig,
  resolveConfigEncryption,
  isEncryptedConfig,
  type ConfigEncryptionOptions,
} from "./config-encryption.js";

describe("config encryption", () => {
  const sample = { secret: "hunter2", nested: { token: "abc123" } };

  it("returns plaintext when encryption disabled", () => {
    const options: ConfigEncryptionOptions = { mode: "none" };
    const encrypted = encryptConfig(sample, options);
    expect(encrypted).toEqual(sample);
    expect(isEncryptedConfig(encrypted)).toBe(false);
    const decrypted = decryptConfig(encrypted, options);
    expect(decrypted).toEqual(sample);
  });

  it("encrypts and decrypts config with AES-GCM", () => {
    const config = {
      ENCRYPTION_MODE: "aes-gcm",
      ENCRYPTION_MASTER_KEY_B64: Buffer.from("0123456789abcdef0123456789abcdef").toString("base64"),
    } as unknown as Parameters<typeof resolveConfigEncryption>[0];

    const options = resolveConfigEncryption(config);
    const encrypted = encryptConfig(sample, options);

    expect(encrypted).not.toEqual(sample);
    expect(typeof encrypted).toBe("object");
    expect(isEncryptedConfig(encrypted)).toBe(true);
    expect(JSON.stringify(encrypted)).not.toContain(sample.secret);
    const decrypted = decryptConfig(encrypted, options);
    expect(decrypted).toEqual(sample);
  });

  it("throws when the master key cannot be decoded", () => {
    const badConfig = {
      ENCRYPTION_MODE: "aes-gcm",
      ENCRYPTION_MASTER_KEY_B64: Buffer.from("too-short").toString("base64"),
    } as unknown as Parameters<typeof resolveConfigEncryption>[0];

    expect(() => resolveConfigEncryption(badConfig)).toThrow(/must decode to 32 bytes/);
  });
});
