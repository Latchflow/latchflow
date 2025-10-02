import { describe, it, expect, beforeAll } from "vitest";
import type { HttpHandler, HttpServer, RequestLike } from "../../src/http/http-server.js";
import { loadConfig } from "../../src/config/env-config.js";
import { getEnv } from "@tests/helpers/containers";
import { waitForMessage, extractMagicLinkPath } from "@tests/helpers/mailhog";
import { createResponseCapture } from "@tests/helpers/response";
import { InMemoryEmailProviderRegistry } from "../../src/services/email-provider-registry.js";
import { EmailDeliveryService } from "../../src/email/delivery-service.js";

function makeServer() {
  const handlers = new Map<string, HttpHandler>();
  const server: HttpServer = {
    get: (p, h) => {
      handlers.set(`GET ${p}`, h);
      return undefined as any;
    },
    post: (p, h) => {
      handlers.set(`POST ${p}`, h);
      return undefined as any;
    },
    put: (p, h) => {
      handlers.set(`PUT ${p}`, h);
      return undefined as any;
    },
    delete: (p, h) => {
      handlers.set(`DELETE ${p}`, h);
      return undefined as any;
    },
    use: () => undefined as any,
    listen: async () => undefined as any,
  } as unknown as HttpServer;
  return { handlers, server };
}

function parseSetCookie(setCookie: string | string[] | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!setCookie) return cookies;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const c of arr) {
    const [pair] = c.split(";");
    const idx = pair.indexOf("=");
    if (idx > -1) {
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      cookies[name] = value;
    }
  }
  return cookies;
}

describe("E2E: admin magic-link login (dev-allowed)", () => {
  beforeAll(() => {
    // Ensure containers env is initialized (DATABASE_URL set in e2e setup)
    expect(getEnv().postgres.url).toBeTruthy();
  });

  it("creates a user, returns login_url, and issues session cookie", async () => {
    // Prepare config from environment and enable dev auth path
    process.env.ALLOW_DEV_AUTH = "true";
    process.env.AUTH_COOKIE_SECURE = "false";
    const config = loadConfig(process.env);

    const { handlers, server } = makeServer();
    // Import routes after DATABASE_URL is set by E2E setup
    const { registerAdminAuthRoutes } = await import("../../src/routes/auth/admin.js");
    const emailService = new EmailDeliveryService({
      registry: new InMemoryEmailProviderRegistry(),
      systemConfig: { get: async () => null },
      config,
    });
    registerAdminAuthRoutes(server, config, { emailService });

    // Ensure target user exists (avoid relying on first-user bootstrap)
    const { prisma } = await import("@latchflow/db");
    await prisma.user.upsert({
      where: { email: "e2e.admin@example.com" },
      update: {},
      create: { email: "e2e.admin@example.com" },
    });

    // 1) Request magic link start
    const hStart = handlers.get("POST /auth/admin/start")!;
    const rcStart = createResponseCapture();
    await hStart(
      { body: { email: "e2e.admin@example.com" }, headers: {} } as unknown as RequestLike,
      rcStart.res,
    );
    if (![200, 204].includes(rcStart.status)) {
      throw new Error(`start failed: ${JSON.stringify(rcStart.body)}`);
    }
    // In dev mode we expect JSON with login_url
    const loginUrl: string | undefined = rcStart.body?.login_url;
    expect(loginUrl).toBeTruthy();
    const urlObj = new URL(`http://localhost${loginUrl}`);
    const token = urlObj.searchParams.get("token");
    expect(token).toBeTruthy();

    // 2) Redeem token
    const hCb = handlers.get("GET /auth/admin/callback")!;
    const rcCb = createResponseCapture();
    await hCb({ query: { token }, headers: {} } as unknown as RequestLike, rcCb.res);
    expect([204, 302]).toContain(rcCb.status);

    // 3) Capture session cookie
    const setCookie = rcCb.headers["Set-Cookie"] ?? rcCb.headers["set-cookie"];
    const cookies = parseSetCookie(setCookie as any);
    const sess = cookies["lf_admin_sess"];
    expect(typeof sess).toBe("string");

    // 4) Verify session belongs to the user (avoid role check here)
    const session = await prisma.session.findUnique({
      where: { jti: sess },
      include: { user: true },
    });
    expect(session?.user?.email).toBe("e2e.admin@example.com");
  });
});

describe("E2E: admin magic-link login (email delivery)", () => {
  beforeAll(() => {
    expect(getEnv().postgres.url).toBeTruthy();
  });

  it("sends email via SMTP and issues session after callback", async () => {
    // Ensure dev shortcut is disabled
    delete process.env.ALLOW_DEV_AUTH;
    process.env.AUTH_COOKIE_SECURE = "false";
    const config = loadConfig(process.env);

    const { handlers, server } = makeServer();
    const { registerAdminAuthRoutes } = await import("../../src/routes/auth/admin.js");
    const emailService = new EmailDeliveryService({
      registry: new InMemoryEmailProviderRegistry(),
      systemConfig: { get: async () => null },
      config,
    });
    registerAdminAuthRoutes(server, config, { emailService });

    const targetEmail = "e2e.admin2@example.com";
    // Ensure user exists post-bootstrap so /auth/admin/start will issue a magic link
    const { prisma } = await import("@latchflow/db");
    await prisma.user.upsert({
      where: { email: targetEmail },
      update: {},
      create: { email: targetEmail },
    });
    const hStart = handlers.get("POST /auth/admin/start")!;
    const rcStart = createResponseCapture();
    await hStart({ body: { email: targetEmail }, headers: {} } as any, rcStart.res);
    expect(rcStart.status).toBe(204);

    // Wait for email in MailHog and extract link
    const mhUrl = getEnv().mailhog.httpUrl;
    const msg = await waitForMessage(
      mhUrl,
      (m) => (m.Content.Body || "").includes("/auth/admin/callback?token="),
      { timeoutMs: 90_000 },
    );
    const html = msg.Content.Body || "";
    const link = extractMagicLinkPath(html);
    expect(link).toBeTruthy();

    // Redeem token
    const urlObj = new URL(`http://localhost${link}`);
    const token = urlObj.searchParams.get("token");
    expect(token).toBeTruthy();
    const hCb = handlers.get("GET /auth/admin/callback")!;
    const rcCb = createResponseCapture();
    await hCb({ query: { token }, headers: {} } as any, rcCb.res);
    expect([204, 302]).toContain(rcCb.status);

    // Verify a session was created and belongs to the target user (non-admins cannot call /auth/me)
    const setCookie = rcCb.headers["Set-Cookie"] ?? rcCb.headers["set-cookie"];
    const cookies = parseSetCookie(setCookie as any);
    const sess = cookies["lf_admin_sess"];
    expect(typeof sess).toBe("string");
    const session = await prisma.session.findUnique({
      where: { jti: sess },
      include: { user: true },
    });
    expect(session?.user?.email).toBe(targetEmail);
  });
});

describe("E2E: admin magic-link login (negative cases)", () => {
  beforeAll(() => {
    expect(getEnv().postgres.url).toBeTruthy();
  });

  it("rejects an invalid token with 401", async () => {
    delete process.env.ALLOW_DEV_AUTH;
    process.env.AUTH_COOKIE_SECURE = "false";
    const config = loadConfig(process.env);

    const { handlers, server } = makeServer();
    const { registerAdminAuthRoutes } = await import("../../src/routes/auth/admin.js");
    const emailService = new EmailDeliveryService({
      registry: new InMemoryEmailProviderRegistry(),
      systemConfig: { get: async () => null },
      config,
    });
    registerAdminAuthRoutes(server, config, { emailService });

    const hCb = handlers.get("GET /auth/admin/callback")!;
    const rcCb = createResponseCapture();
    await hCb({ query: { token: "totally_invalid_token" }, headers: {} } as any, rcCb.res);
    expect(rcCb.status).toBe(401);
    expect(rcCb.body?.code).toBe("INVALID_TOKEN");
  });

  it("rejects an expired token with 401", async () => {
    delete process.env.ALLOW_DEV_AUTH;
    process.env.AUTH_COOKIE_SECURE = "false";
    const config = loadConfig(process.env);

    const { prisma } = await import("@latchflow/db");
    const { sha256Hex } = await import("../../src/auth/tokens.js");

    // Seed a user and an expired magic link for them
    const email = "e2e.expired@example.com";
    const user = await prisma.user.upsert({ where: { email }, update: {}, create: { email } });
    const token = "expired_token_123";
    const tokenHash = sha256Hex(token);
    await prisma.magicLink.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() - 60_000),
        consumedAt: null,
      },
    });

    const { handlers, server } = makeServer();
    const { registerAdminAuthRoutes } = await import("../../src/routes/auth/admin.js");
    const emailService = new EmailDeliveryService({
      registry: new InMemoryEmailProviderRegistry(),
      systemConfig: { get: async () => null },
      config,
    });
    registerAdminAuthRoutes(server, config, { emailService });

    const hCb = handlers.get("GET /auth/admin/callback")!;
    const rcCb = createResponseCapture();
    await hCb({ query: { token }, headers: {} } as any, rcCb.res);
    expect(rcCb.status).toBe(401);
    expect(rcCb.body?.code).toBe("INVALID_TOKEN");
  });
});
