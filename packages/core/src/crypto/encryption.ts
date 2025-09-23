import { createCipher, createDecipher, randomBytes } from "node:crypto";

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

export function encryptValue(value: string, masterKey: Buffer): string {
  const iv = randomBytes(16);
  const cipher = createCipher("aes-256-gcm", masterKey);
  cipher.setAAD(Buffer.from("systemconfig"));

  let encrypted = cipher.update(value, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

export function decryptValue(encryptedValue: string, masterKey: Buffer): string {
  const parts = encryptedValue.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted value format");
  }

  const [ivHex, authTagHex, encrypted] = parts;
  const _iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = createDecipher("aes-256-gcm", masterKey);
  decipher.setAAD(Buffer.from("systemconfig"));
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
