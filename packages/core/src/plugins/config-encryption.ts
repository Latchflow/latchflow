import { Prisma } from "@latchflow/db";
import { encryptValue, decryptValue, type EncMode } from "../crypto/encryption.js";
import type { AppConfig } from "../config/env-config.js";

const ENCRYPTED_MARKER = "__lf_encrypted";

export interface ConfigEncryptionOptions {
  mode: EncMode;
  masterKey?: Buffer;
}

export function resolveConfigEncryption(config: AppConfig): ConfigEncryptionOptions {
  if (config.ENCRYPTION_MODE === "aes-gcm" && config.ENCRYPTION_MASTER_KEY_B64) {
    let masterKey: Buffer;
    try {
      masterKey = Buffer.from(config.ENCRYPTION_MASTER_KEY_B64, "base64");
    } catch (err) {
      throw new Error(
        `Failed to decode ENCRYPTION_MASTER_KEY_B64: ${(err as Error).message ?? String(err)}`,
      );
    }

    if (masterKey.length !== 32) {
      throw new Error("ENCRYPTION_MASTER_KEY_B64 must decode to 32 bytes for aes-gcm");
    }

    return {
      mode: "aes-gcm",
      masterKey,
    };
  }
  return { mode: "none" };
}

export function encryptConfig(
  value: unknown,
  opts: ConfigEncryptionOptions,
): Prisma.InputJsonValue | Prisma.JsonNullValueInput {
  if (value === undefined || value === null) {
    return Prisma.JsonNull;
  }
  if (opts.mode !== "aes-gcm" || !opts.masterKey) {
    return value as Prisma.InputJsonValue;
  }
  const serialized = JSON.stringify(value);
  const cipher = encryptValue(serialized, opts.masterKey);
  return { [ENCRYPTED_MARKER]: true, value: cipher } as unknown as Prisma.InputJsonValue;
}

export function decryptConfig(value: unknown, opts: ConfigEncryptionOptions): unknown {
  if (value === null || value === undefined) return value;
  if (opts.mode !== "aes-gcm" || !opts.masterKey) return value;
  if (typeof value === "object" && value !== null && ENCRYPTED_MARKER in value) {
    const envelope = value as { value?: string };
    if (!envelope.value) return null;
    const decrypted = decryptValue(envelope.value, opts.masterKey);
    return JSON.parse(decrypted);
  }
  return value;
}

export function isEncryptedConfig(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && ENCRYPTED_MARKER in (value as object));
}
