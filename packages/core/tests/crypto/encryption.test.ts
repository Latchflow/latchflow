import { describe, it, expect } from "vitest";
import { wrapEncryptStream, wrapDecryptStream } from "../../src/crypto/encryption.js";
import { Readable } from "node:stream";

describe("encryption wrappers", () => {
  it("none mode is pass-through", async () => {
    const enc = wrapEncryptStream("none");
    const dec = wrapDecryptStream("none");
    const src = Readable.from(Buffer.from("abc"));
    const encStream = enc(src);
    const decStream = dec(encStream);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      decStream.on("data", (c: Buffer) => chunks.push(c));
      decStream.on("end", () => resolve());
      decStream.on("error", reject);
    });
    expect(Buffer.concat(chunks).toString()).toBe("abc");
  });

  it("aes-gcm not implemented throws", () => {
    expect(() => wrapEncryptStream("aes-gcm")).toThrow();
  });

  it("decrypt wrapper for aes-gcm returns pass-through", async () => {
    const dec = wrapDecryptStream("aes-gcm");
    const src = Readable.from(Buffer.from("xyz"));
    const out: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      dec(src)
        .on("data", (c: Buffer) => out.push(c))
        .on("end", () => resolve())
        .on("error", reject);
    });
    expect(Buffer.concat(out).toString()).toBe("xyz");
  });
});
