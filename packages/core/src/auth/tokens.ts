import { createHash, randomBytes, randomInt } from "crypto";

export function randomToken(len = 32): string {
  // URL-safe base64 without padding
  const buf = randomBytes(len);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function genOtp(digits = 6): string {
  const max = 10 ** digits;
  const num = Math.floor(Math.random() * max);
  return num.toString().padStart(digits, "0");
}

export function randomTokenBase64Url(bytes = 32): string {
  return randomToken(bytes);
}

export function formatApiToken(prefix: string, raw: string): string {
  return `${prefix}${raw}`;
}

export function makeUserCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // avoid confusing chars
  const pick = (n: number) =>
    Array.from({ length: n }, () => alphabet[randomInt(alphabet.length)]).join("");
  return `${pick(4)}-${pick(4)}`;
}

export function makeDeviceCode(): string {
  return randomTokenBase64Url(32);
}
