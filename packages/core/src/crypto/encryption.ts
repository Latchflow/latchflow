import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncMode = "none" | "aes-gcm";

export function wrapEncryptStream(mode: EncMode, _masterKey?: Buffer) {
  if (mode === "none") return (s: NodeJS.ReadableStream) => s;
  // TODO: implement AES-GCM streaming; MVP no-op for shape compatibility
  if (mode === "aes-gcm") throw new Error("aes-gcm not implemented in MVP");
  return (s: NodeJS.ReadableStream) => s;
}

export function wrapDecryptStream(mode: EncMode, _masterKey?: Buffer) {
  if (mode === "none") return (s: NodeJS.ReadableStream) => s;
  return (s: NodeJS.ReadableStream) => s;
}

const AAD = Buffer.from("systemconfig");
const IV_LENGTH = 12; // Recommended length for GCM

function validateMasterKey(masterKey: Buffer): Buffer {
  if (masterKey.length !== 32) {
    throw new Error("Encryption master key must be 32 bytes for aes-256-gcm");
  }
  return masterKey;
}

export function encryptValue(value: string, masterKey: Buffer): string {
  const key = validateMasterKey(masterKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);

  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptValue(encryptedValue: string, masterKey: Buffer): string {
  const parts = encryptedValue.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted value format");
  }

  const [ivHex, authTagHex, encrypted] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(encrypted, "hex");

  const key = validateMasterKey(masterKey);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(AAD);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return decrypted.toString("utf8");
}
