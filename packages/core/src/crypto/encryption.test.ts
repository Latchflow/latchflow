import { describe, it, expect } from "vitest";
import { wrapEncryptStream, wrapDecryptStream } from "../crypto/encryption.js";
import { Readable } from "node:stream";

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return Buffer.concat(chunks);
}

describe("encryption wrappers", () => {
  it("none mode is pass-through", async () => {
    const enc = wrapEncryptStream("none");
    const dec = wrapDecryptStream("none");
    const src = Readable.from(Buffer.from("abc"));
    const { stream: encStream, metadata } = enc(src);
    const encrypted = await collect(encStream);
    expect(encrypted.toString()).toBe("abc");
    expect(await metadata).toBeNull();
    const decStream = dec(Readable.from(encrypted));
    const roundtrip = await collect(decStream);
    expect(roundtrip.toString()).toBe("abc");
  });

  it("aes-gcm requires master key", () => {
    expect(() => wrapEncryptStream("aes-gcm")).toThrow("Master key is required");
    expect(() => wrapDecryptStream("aes-gcm")).toThrow("Master key is required");
  });

  it("aes-gcm round trip encrypts and decrypts stream", async () => {
    const masterKey = Buffer.alloc(32, 7);
    const plaintext = Buffer.from("hello latchflow");

    const encrypt = wrapEncryptStream("aes-gcm", masterKey);
    const { stream: encryptedStream, metadata } = encrypt(Readable.from(plaintext));
    const encrypted = await collect(encryptedStream);
    const meta = await metadata;
    expect(meta).toBeTruthy();
    expect(meta!.algorithm).toBe("aes-256-gcm");
    expect(typeof meta!.iv).toBe("string");
    expect(typeof meta!.authTag).toBe("string");

    const decrypt = wrapDecryptStream("aes-gcm", masterKey);
    const decrypted = await collect(decrypt(Readable.from(encrypted), meta));
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it("aes-gcm decrypt throws without metadata", () => {
    const masterKey = Buffer.alloc(32, 5);
    const decrypt = wrapDecryptStream("aes-gcm", masterKey);
    expect(() => decrypt(Readable.from(Buffer.alloc(0)))).toThrow(
      "Encryption metadata is required",
    );
  });
});
