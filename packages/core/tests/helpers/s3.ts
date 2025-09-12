// S3/MinIO helpers for E2E tests

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function putPresigned(
  url: string,
  body: Uint8Array,
  opts: { headers?: Record<string, string> } = {},
): Promise<Response> {
  return fetch(url, {
    method: "PUT",
    body,
    headers: opts.headers ?? {},
  });
}
