import { createHash, randomBytes } from "crypto";

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
