import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpHandler } from "../../src/http/http-server.js";
import { Readable } from "node:stream";

// Prisma-like mock
const db = {
  recipientSession: { findUnique: vi.fn(async (): Promise<any> => null) },
  recipient: { findUnique: vi.fn(async (): Promise<any> => null) },
  bundleAssignment: {
    findMany: vi.fn(async (): Promise<any[]> => []),
    findFirst: vi.fn(async (): Promise<any | null> => null),
    update: vi.fn(async (): Promise<any> => ({})),
  },
  bundleObject: { findMany: vi.fn(async (): Promise<any[]> => []) },
  bundle: { findUnique: vi.fn(async (): Promise<any | null> => null) },
  downloadEvent: {
    create: vi.fn(async (): Promise<any> => ({})),
    count: vi.fn(async (): Promise<number> => 0),
  },
};

vi.mock("../../src/db/db.js", () => ({ getDb: () => db }));

function makeServer() {
  const handlers = new Map<string, HttpHandler>();
  const storage = {
    getFileStream: vi.fn(async () => Readable.from(Buffer.from("ok"))),
  } as any;
  return { handlers, storage };
}

function futureDate(ms = 60_000) {
  return new Date(Date.now() + ms);
}

describe("portal routes (integration)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    for (const model of Object.values(db) as any[]) {
      for (const fn of Object.values(model) as any[]) {
        if (typeof fn?.mockReset === "function") fn.mockReset();
      }
    }
  });

  it("GET /portal/me returns recipient and bundles", async () => {
    const { handlers, storage } = makeServer();
    const { registerPortalRoutes } = await import("../../src/routes/portal.js");
    registerPortalRoutes({ get: serverGet } as any, { storage });

    // register helper
    function serverGet(path: string, h: HttpHandler) {
      handlers.set(`GET ${path}`, h);
    }

    db.recipientSession.findUnique.mockResolvedValueOnce({
      jti: "tok",
      recipientId: "R1",
      expiresAt: futureDate(),
    });
    db.recipient.findUnique.mockResolvedValueOnce({ id: "R1", isEnabled: true });
    db.bundleAssignment.findMany.mockResolvedValueOnce([
      { bundle: { id: "B1", name: "Bundle 1" } },
      { bundle: { id: "B2", name: "Bundle 2" } },
    ]);

    const h = handlers.get("GET /portal/me")!;
    let status = 0;
    let body: any = null;
    await h({ headers: { cookie: "lf_recipient_sess=tok" } } as any, {
      status(c: number) {
        status = c;
        return this as any;
      },
      json(p: any) {
        body = p;
      },
      header() {
        return this as any;
      },
      redirect() {},
      sendStream() {},
      sendBuffer() {},
    });
    expect(status).toBe(200);
    expect(body?.recipient?.id).toBe("R1");
    expect(body?.bundles?.length).toBe(2);
  });

  it("GET /portal/bundles returns items list", async () => {
    const { handlers, storage } = makeServer();
    const { registerPortalRoutes } = await import("../../src/routes/portal.js");
    registerPortalRoutes({ get: serverGet } as any, { storage });
    function serverGet(path: string, h: HttpHandler) {
      handlers.set(`GET ${path}`, h);
    }
    db.recipientSession.findUnique.mockResolvedValueOnce({
      jti: "tok",
      recipientId: "R1",
      expiresAt: futureDate(),
    });
    db.recipient.findUnique.mockResolvedValueOnce({ id: "R1", isEnabled: true });
    db.bundleAssignment.findMany.mockResolvedValueOnce([
      { bundle: { id: "B1", name: "Bundle 1" } },
    ]);
    const h = handlers.get("GET /portal/bundles")!;
    let status = 0;
    let body: any = null;
    await h({ headers: { cookie: "lf_recipient_sess=tok" } } as any, {
      status(c: number) {
        status = c;
        return this as any;
      },
      json(p: any) {
        body = p;
      },
      header() {
        return this as any;
      },
      redirect() {},
      sendStream() {},
      sendBuffer() {},
    });
    expect(status).toBe(200);
    expect(Array.isArray(body?.items)).toBe(true);
    expect(body?.items?.[0]?.id).toBe("B1");
    // Ensure we asked DB with isEnabled filters
    const args = db.bundleAssignment.findMany.mock.calls[0]?.[0] ?? {};
    expect(args?.where?.isEnabled).toBe(true);
    expect(args?.where?.recipient?.isEnabled).toBe(true);
    expect(args?.where?.bundle?.isEnabled).toBe(true);
  });

  it("GET /portal/bundles/:bundleId/objects lists files", async () => {
    const { handlers, storage } = makeServer();
    const { registerPortalRoutes } = await import("../../src/routes/portal.js");
    registerPortalRoutes({ get: serverGet } as any, { storage });
    function serverGet(path: string, h: HttpHandler) {
      handlers.set(`GET ${path}`, h);
    }
    db.recipientSession.findUnique.mockResolvedValueOnce({
      jti: "tok",
      recipientId: "R1",
      expiresAt: futureDate(),
    });
    db.recipient.findUnique.mockResolvedValueOnce({ id: "R1", isEnabled: true });
    db.bundleAssignment.findFirst.mockResolvedValueOnce({
      id: "A1",
      bundleId: "B1",
      recipientId: "R1",
      isEnabled: true,
    });
    db.bundleObject.findMany.mockResolvedValueOnce([
      { file: { id: "F1", key: "k1" } },
      { file: { id: "F2", key: "k2" } },
    ]);
    const h = handlers.get("GET /portal/bundles/:bundleId/objects")!;
    let status = 0;
    let body: any = null;
    await h({ headers: { cookie: "lf_recipient_sess=tok" }, params: { bundleId: "B1" } } as any, {
      status(c: number) {
        status = c;
        return this as any;
      },
      json(p: any) {
        body = p;
      },
      header() {
        return this as any;
      },
      redirect() {},
      sendStream() {},
      sendBuffer() {},
    });
    expect(status).toBe(200);
    expect(body?.items?.length).toBe(2);
    // Ensure we asked DB with isEnabled filter and sort
    const args = db.bundleObject.findMany.mock.calls[0]?.[0] ?? {};
    expect(args?.where?.isEnabled).toBe(true);
    expect(args?.orderBy?.sortOrder).toBe("asc");
  });

  it("GET /portal/bundles/:bundleId enforces verification", async () => {
    const { handlers, storage } = makeServer();
    const { registerPortalRoutes } = await import("../../src/routes/portal.js");
    registerPortalRoutes({ get: serverGet } as any, { storage });
    function serverGet(path: string, h: HttpHandler) {
      handlers.set(`GET ${path}`, h);
    }
    db.recipientSession.findUnique.mockResolvedValue({
      jti: "tok",
      recipientId: "R1",
      expiresAt: futureDate(),
    });
    db.recipient.findUnique.mockResolvedValue({ id: "R1", isEnabled: true });
    db.bundleAssignment.findFirst.mockResolvedValue({
      id: "A1",
      bundleId: "B1",
      recipientId: "R1",
      isEnabled: true,
      verificationType: "OTP",
      verificationMet: false,
    });
    const h = handlers.get("GET /portal/bundles/:bundleId")!;
    let status = 0;
    let body: any = null;
    await h({ headers: { cookie: "lf_recipient_sess=tok" }, params: { bundleId: "B1" } } as any, {
      status(c: number) {
        status = c;
        return this as any;
      },
      json(p: any) {
        body = p;
      },
      header() {
        return this as any;
      },
      redirect() {},
      sendStream() {},
      sendBuffer() {},
    });
    expect(status).toBe(403);
    expect(body?.code).toBe("VERIFICATION_REQUIRED");
  });

  it("GET /portal/bundles/:bundleId streams bundle when allowed", async () => {
    const { handlers, storage } = makeServer();
    const { registerPortalRoutes } = await import("../../src/routes/portal.js");
    registerPortalRoutes({ get: serverGet } as any, { storage });
    function serverGet(path: string, h: HttpHandler) {
      handlers.set(`GET ${path}`, h);
    }
    db.recipientSession.findUnique.mockResolvedValue({
      jti: "tok",
      recipientId: "R1",
      expiresAt: futureDate(),
    });
    db.recipient.findUnique.mockResolvedValue({ id: "R1", isEnabled: true });
    db.bundleAssignment.findFirst.mockResolvedValue({
      id: "A1",
      bundleId: "B1",
      recipientId: "R1",
      isEnabled: true,
      verificationType: null,
      verificationMet: true,
      lastDownloadAt: null,
      cooldownSeconds: null,
      maxDownloads: null,
    });
    db.downloadEvent.count.mockResolvedValue(0);
    db.bundle.findUnique.mockResolvedValue({
      id: "B1",
      storagePath: "objects/sha256/aa/bb/hhh",
      checksum: "etag",
    });
    const h = handlers.get("GET /portal/bundles/:bundleId")!;
    let sent = false;
    await h({ headers: { cookie: "lf_recipient_sess=tok" }, params: { bundleId: "B1" } } as any, {
      status() {
        return this as any;
      },
      json() {},
      header() {
        return this as any;
      },
      redirect() {},
      sendStream() {
        sent = true;
      },
      sendBuffer() {},
    });
    expect(sent).toBe(true);
    expect(db.downloadEvent.create).toHaveBeenCalledOnce();
    expect(db.bundleAssignment.update).toHaveBeenCalledOnce();
  });

  it("GET /portal/bundles/:bundleId returns 429 during cooldown window", async () => {
    const { handlers, storage } = makeServer();
    const { registerPortalRoutes } = await import("../../src/routes/portal.js");
    registerPortalRoutes({ get: serverGet } as any, { storage });
    function serverGet(path: string, h: HttpHandler) {
      handlers.set(`GET ${path}`, h);
    }
    db.recipientSession.findUnique.mockResolvedValue({
      jti: "tok",
      recipientId: "R1",
      expiresAt: futureDate(),
    });
    db.recipient.findUnique.mockResolvedValue({ id: "R1", isEnabled: true });
    db.bundleAssignment.findFirst.mockResolvedValue({
      id: "A1",
      bundleId: "B1",
      recipientId: "R1",
      isEnabled: true,
      verificationType: null,
      verificationMet: true,
      lastDownloadAt: new Date(Date.now() - 2000),
      cooldownSeconds: 10,
      maxDownloads: null,
    });
    const h = handlers.get("GET /portal/bundles/:bundleId")!;
    let status = 0;
    let body: any = null;
    await h({ headers: { cookie: "lf_recipient_sess=tok" }, params: { bundleId: "B1" } } as any, {
      status(c: number) {
        status = c;
        return this as any;
      },
      json(p: any) {
        body = p;
      },
      header() {
        return this as any;
      },
      redirect() {},
      sendStream() {},
      sendBuffer() {},
    });
    expect(status).toBe(429);
    expect(body?.code).toBe("COOLDOWN_ACTIVE");
  });

  it("GET /portal/bundles/:bundleId returns 403 when maxDownloads reached", async () => {
    const { handlers, storage } = makeServer();
    const { registerPortalRoutes } = await import("../../src/routes/portal.js");
    registerPortalRoutes({ get: serverGet } as any, { storage });
    function serverGet(path: string, h: HttpHandler) {
      handlers.set(`GET ${path}`, h);
    }
    db.recipientSession.findUnique.mockResolvedValue({
      jti: "tok",
      recipientId: "R1",
      expiresAt: futureDate(),
    });
    db.recipient.findUnique.mockResolvedValue({ id: "R1", isEnabled: true });
    db.bundleAssignment.findFirst.mockResolvedValue({
      id: "A1",
      bundleId: "B1",
      recipientId: "R1",
      isEnabled: true,
      verificationType: null,
      verificationMet: true,
      lastDownloadAt: null,
      cooldownSeconds: null,
      maxDownloads: 3,
    });
    db.downloadEvent.count.mockResolvedValue(3);
    const h = handlers.get("GET /portal/bundles/:bundleId")!;
    let status = 0;
    let body: any = null;
    await h({ headers: { cookie: "lf_recipient_sess=tok" }, params: { bundleId: "B1" } } as any, {
      status(c: number) {
        status = c;
        return this as any;
      },
      json(p: any) {
        body = p;
      },
      header() {
        return this as any;
      },
      redirect() {},
      sendStream() {},
      sendBuffer() {},
    });
    expect(status).toBe(403);
    expect(body?.code).toBe("MAX_DOWNLOADS_EXCEEDED");
  });

  it("returns 403 when recipient is disabled", async () => {
    const { handlers, storage } = makeServer();
    const { registerPortalRoutes } = await import("../../src/routes/portal.js");
    registerPortalRoutes({ get: serverGet } as any, { storage });
    function serverGet(path: string, h: HttpHandler) {
      handlers.set(`GET ${path}`, h);
    }
    db.recipientSession.findUnique.mockResolvedValue({
      jti: "tok",
      recipientId: "R1",
      expiresAt: futureDate(),
    });
    db.recipient.findUnique.mockResolvedValue({ id: "R1", isEnabled: false });
    const h = handlers.get("GET /portal/me")!;
    let status = 0;
    await h({ headers: { cookie: "lf_recipient_sess=tok" } } as any, {
      status(c: number) {
        status = c;
        return this as any;
      },
      json() {},
      header() {
        return this as any;
      },
      redirect() {},
      sendStream() {},
      sendBuffer() {},
    });
    expect(status).toBe(403);
  });
});
