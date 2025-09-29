import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncMode = "none" | "aes-gcm";

export interface EncryptionStreamMetadata {
  algorithm: "aes-256-gcm";
  iv: string; // base64 encoded
  authTag: string; // base64 encoded
}

export interface EncryptStreamResult {
  stream: NodeJS.ReadableStream;
  metadata: Promise<EncryptionStreamMetadata | null>;
}

type EncryptStreamWrapper = (stream: NodeJS.ReadableStream) => EncryptStreamResult;

type DecryptStreamWrapper = (
  stream: NodeJS.ReadableStream,
  metadata?: EncryptionStreamMetadata | null,
) => NodeJS.ReadableStream;

const STREAM_AAD = Buffer.from("latchflow-stream");

export function wrapEncryptStream(mode: EncMode, masterKey?: Buffer): EncryptStreamWrapper {
  if (mode === "none") {
    return (stream: NodeJS.ReadableStream) => ({
      stream,
      metadata: Promise.resolve(null),
    });
  }

  if (mode === "aes-gcm") {
    if (!masterKey) {
      throw new Error("Master key is required for aes-gcm encryption");
    }
    const key = validateMasterKey(masterKey);

    return (stream: NodeJS.ReadableStream) => {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(STREAM_AAD);

      const encryptedStream = stream.pipe(cipher);

      const metadataPromise = new Promise<EncryptionStreamMetadata>((resolve, reject) => {
        const cleanup = () => {
          stream.removeListener("error", onError);
          cipher.removeListener("error", onError);
          cipher.removeListener("finish", onFinish);
        };

        const onError = (err: unknown) => {
          cleanup();
          reject(err as Error);
        };

        const onFinish = () => {
          try {
            const authTag = cipher.getAuthTag();
            cleanup();
            resolve({
              algorithm: "aes-256-gcm",
              iv: iv.toString("base64"),
              authTag: authTag.toString("base64"),
            });
          } catch (err) {
            cleanup();
            reject(err as Error);
          }
        };

        stream.once("error", onError);
        cipher.once("error", onError);
        cipher.once("finish", onFinish);
      });

      return { stream: encryptedStream, metadata: metadataPromise };
    };
  }

  throw new Error(`Unsupported encryption mode: ${mode}`);
}

export function wrapDecryptStream(mode: EncMode, masterKey?: Buffer): DecryptStreamWrapper {
  if (mode === "none") {
    return (stream: NodeJS.ReadableStream) => stream;
  }

  if (mode === "aes-gcm") {
    if (!masterKey) {
      throw new Error("Master key is required for aes-gcm decryption");
    }
    const key = validateMasterKey(masterKey);

    return (stream: NodeJS.ReadableStream, metadata?: EncryptionStreamMetadata | null) => {
      if (!metadata) {
        throw new Error("Encryption metadata is required for aes-gcm decryption");
      }
      if (metadata.algorithm !== "aes-256-gcm") {
        throw new Error(`Unsupported encryption algorithm: ${metadata.algorithm}`);
      }

      const iv = Buffer.from(metadata.iv, "base64");
      if (iv.length !== IV_LENGTH) {
        throw new Error("Invalid IV length for aes-gcm");
      }
      const authTag = Buffer.from(metadata.authTag, "base64");

      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(STREAM_AAD);
      decipher.setAuthTag(authTag);

      return stream.pipe(decipher);
    };
  }

  throw new Error(`Unsupported encryption mode: ${mode}`);
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
