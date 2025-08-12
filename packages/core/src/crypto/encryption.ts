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
