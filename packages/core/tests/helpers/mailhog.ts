// MailHog HTTP API helpers for E2E tests

export type MailhogMessage = {
  ID: string;
  Content: {
    Headers: Record<string, string[]>;
    Body: string;
  };
};

export async function fetchMessages(baseUrl: string): Promise<MailhogMessage[]> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v2/messages`);
  if (!res.ok) throw new Error(`MailHog fetch failed: ${res.status}`);
  const data = (await res.json()) as { total: number; items: MailhogMessage[] };
  return data.items ?? [];
}

export async function waitForMessage(
  baseUrl: string,
  predicate: (m: MailhogMessage) => boolean,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<MailhogMessage> {
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  const intervalMs = opts?.intervalMs ?? 250;
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const items = await fetchMessages(baseUrl);
    const found = items.find(predicate);
    if (found) return found;
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for MailHog message");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export function extractFirstLinkFromHtml(html: string): string | null {
  const match = html.match(/href="([^"]+)"/i);
  return match?.[1] ?? null;
}

export function extractMagicLinkPath(body: string): string | null {
  // Try HTML href first
  const href = body.match(/href="(\/auth\/admin\/callback\?token=[^"]+)"/i)?.[1];
  if (href) return href;
  // Fallback: plain text path
  const plain = body.match(/(\/auth\/admin\/callback\?token=[A-Za-z0-9\-_]+)/i)?.[1] ?? null;
  return plain;
}
