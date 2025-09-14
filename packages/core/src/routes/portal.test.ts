import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpHandler } from "../http/http-server.js";
import { Readable } from "node:stream";

// Mock DB client used by requireRecipient and routes
const db = {
  recipientSession: { findUnique: vi.fn(async () => null) },
  recipient: { findUnique: vi.fn(async () => null) },
  bundleAssignment: {
    findMany: vi.fn(async () => [] as any[]),
    findFirst: vi.fn(async () => null as any),
    update: vi.fn(async () => ({}) as any),
  },
  bundleObject: { findMany: vi.fn(async () => [] as any[]) },
  bundle: { findUnique: vi.fn(async () => null as any) },
  downloadEvent: { create: vi.fn(async () => ({}) as any), count: vi.fn(async () => 0) },
};
vi.mock("../db/db.js", () => ({ getDb: () => db }));

function makeServer() {
  const handlers = new Map<string, HttpHandler>();
  const server = {
    get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
  } as any;
  const storage = {
    getFileStream: vi.fn(async () => Readable.from(Buffer.from("ok"))),
  } as any;
  return { handlers, storage };
}

function resCapture() {
  let status = 0;
  let body: any = null;
  const headers: Record<string, string | string[]> = {};
  let streamed = false;
  let sentHeaders: Record<string, string | string[]> | undefined;
  const res = {
    status(c: number) {
      status = c;
      return this as any;
    },
    json(p: any) {
      body = p;
    },
    header(name: string, value: any) {
      headers[name] = value;
      return this as any;
    },
    redirect() {},
    sendStream(_body?: any, h?: Record<string, string | string[]>) {
      streamed = true;
      sentHeaders = h;
    },
    sendBuffer() {},
  } as any;
  return {
    res,
    get status() {
      return status;
    },
    get body() {
      return body;
    },
    get headers() {
      return headers;
    },
    get streamed() {
      return streamed;
    },
    get sentHeaders() {
      return sentHeaders;
    },
  };
}

function futureDate(ms = 60_000) {
  return new Date(Date.now() + ms);
}

describe("portal routes (unit)", () => {
  beforeEach(() => {
    for (const model of Object.values(db) as any[]) {
      for (const fn of Object.values(model) as any[]) {
        if (typeof fn?.mockReset === "function") fn.mockReset();
      }
    }
  });

  it("rejects without cookie on /portal/me", async () => {
    const { handlers, storage } = makeServer();
    const { registerPortalRoutes } = await import("./portal.js");
    registerPortalRoutes(
      { get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h) } as any,
      {
        storage,
      } as any,
    );
    const h = handlers.get("GET /portal/me")!;
    const rc = resCapture();
    await h({ headers: {} } as any, rc.res);
    expect(rc.status).toBe(401);
    expect(rc.body?.code).toBe("UNAUTHORIZED");
  });

  it("/portal/me returns recipient and bundles when authenticated", async () => {
    const { handlers, storage } = makeServer();
    const { registerPortalRoutes } = await import("./portal.js");
    registerPortalRoutes(
      { get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h) } as any,
      {
        storage,
      } as any,
    );
    db.recipientSession.findUnique.mockResolvedValueOnce({
      jti: "tok",
      recipientId: "R1",
      expiresAt: futureDate(),
    } as any);
    db.recipient.findUnique.mockResolvedValueOnce({ id: "R1", isEnabled: true } as any);
    db.bundleAssignment.findMany.mockResolvedValueOnce([
      { bundle: { id: "B1", name: "Bundle 1" } },
      { bundle: { id: "B2", name: "Bundle 2" } },
    ] as any);
    const h = handlers.get("GET /portal/me")!;
    const rc = resCapture();
    await h({ headers: { cookie: "lf_recipient_sess=tok" } } as any, rc.res);
    expect(rc.status).toBe(200);
    expect(rc.body?.recipient?.id).toBe("R1");
    expect(rc.body?.bundles?.length).toBe(2);
    expect(rc.body?.bundles?.[0]?.bundleId).toBe("B1");
  });

  it("/portal/bundles/:bundleId/objects lists files when authorized", async () => {
    const { handlers, storage } = makeServer();
    const { registerPortalRoutes } = await import("./portal.js");
    registerPortalRoutes(
      { get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h) } as any,
      {
        storage,
      } as any,
    );
    db.recipientSession.findUnique.mockResolvedValueOnce({
      jti: "tok",
      recipientId: "R1",
      expiresAt: futureDate(),
    } as any);
    db.recipient.findUnique.mockResolvedValueOnce({ id: "R1", isEnabled: true } as any);
    db.bundleAssignment.findFirst.mockResolvedValueOnce({
      id: "A1",
      bundleId: "B1",
      recipientId: "R1",
      isEnabled: true,
    } as any);
    db.bundleObject.findMany.mockResolvedValueOnce([
      { file: { id: "F1" } },
      { file: { id: "F2" } },
    ] as any);
    const h = handlers.get("GET /portal/bundles/:bundleId/objects")!;
    const rc = resCapture();
    await h(
      { headers: { cookie: "lf_recipient_sess=tok" }, params: { bundleId: "B1" } } as any,
      rc.res,
    );
    expect(rc.status).toBe(200);
    expect(rc.body?.items?.length).toBe(2);
  });

  it("/portal/bundles/:bundleId streams even when assignment has verificationType (login-only verification)", async () => {
    const { handlers, storage } = makeServer();
    const { registerPortalRoutes } = await import("./portal.js");
    registerPortalRoutes(
      { get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h) } as any,
      {
        storage,
      } as any,
    );
    db.recipientSession.findUnique.mockResolvedValueOnce({
      jti: "tok",
      recipientId: "R1",
      expiresAt: futureDate(),
    } as any);
    db.recipient.findUnique.mockResolvedValueOnce({ id: "R1", isEnabled: true } as any);
    db.bundleAssignment.findFirst.mockResolvedValueOnce({
      id: "A1",
      bundleId: "B1",
      recipientId: "R1",
      isEnabled: true,
      verificationType: "OTP",
      verificationMet: false,
    } as any);
    const h = handlers.get("GET /portal/bundles/:bundleId")!;
    const rc = resCapture();
    // allow when limits permit
    db.downloadEvent.count.mockResolvedValueOnce(0);
    db.bundle.findUnique.mockResolvedValueOnce({
      id: "B1",
      storagePath: "path",
      checksum: "etag",
    } as any);
    await h(
      { headers: { cookie: "lf_recipient_sess=tok" }, params: { bundleId: "B1" } } as any,
      rc.res,
    );
    expect(rc.streamed).toBe(true);
  });

  it("/portal/bundles/:bundleId streams when allowed", async () => {
    const { handlers, storage } = makeServer();
    const { registerPortalRoutes } = await import("./portal.js");
    registerPortalRoutes(
      { get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h) } as any,
      {
        storage,
      } as any,
    );
    db.recipientSession.findUnique.mockResolvedValueOnce({
      jti: "tok",
      recipientId: "R1",
      expiresAt: futureDate(),
    } as any);
    db.recipient.findUnique.mockResolvedValueOnce({ id: "R1", isEnabled: true } as any);
    db.bundleAssignment.findFirst.mockResolvedValueOnce({
      id: "A1",
      bundleId: "B1",
      recipientId: "R1",
      isEnabled: true,
      verificationType: null,
      verificationMet: true,
    } as any);
    db.downloadEvent.count.mockResolvedValueOnce(0);
    db.bundle.findUnique.mockResolvedValueOnce({
      id: "B1",
      storagePath: "objects/sha256/aa/bb/cccc",
      checksum: "etag",
    } as any);
    const h = handlers.get("GET /portal/bundles/:bundleId")!;
    const rc = resCapture();
    await h(
      { headers: { cookie: "lf_recipient_sess=tok" }, params: { bundleId: "B1" } } as any,
      rc.res,
    );
    // sendStream implies a 200 default in the real server adapter; here we just assert streaming occurred
    expect(rc.streamed).toBe(true);
  });

  it("/portal/bundles/:bundleId sets ETag from storage HEAD when available, otherwise checksum", async () => {
    const { handlers } = makeServer();
    const { registerPortalRoutes } = await import("./portal.js");
    const storage = {
      headFile: vi.fn(async () => ({ etag: "stor-etag" })),
      getFileStream: vi.fn(async () => Readable.from(Buffer.from("ok"))),
    } as any;
    registerPortalRoutes(
      { get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h) } as any,
      { storage } as any,
    );
    db.recipientSession.findUnique.mockResolvedValueOnce({
      jti: "tok",
      recipientId: "R1",
      expiresAt: futureDate(),
    } as any);
    db.recipient.findUnique.mockResolvedValueOnce({ id: "R1", isEnabled: true } as any);
    db.bundleAssignment.findFirst.mockResolvedValueOnce({
      id: "A1",
      bundleId: "B1",
      recipientId: "R1",
      isEnabled: true,
    } as any);
    db.downloadEvent.count.mockResolvedValueOnce(0);
    db.bundle.findUnique.mockResolvedValueOnce({
      id: "B1",
      storagePath: "path",
      checksum: "dbsum",
    } as any);
    const h = handlers.get("GET /portal/bundles/:bundleId")!;
    const rc = resCapture();
    await h(
      { headers: { cookie: "lf_recipient_sess=tok" }, params: { bundleId: "B1" } } as any,
      rc.res,
    );
    expect(rc.streamed).toBe(true);
    expect(rc.sentHeaders?.["ETag"]).toBe("stor-etag");

    // Now simulate missing headFile -> fallback to checksum
    const rc2 = resCapture();
    (storage.headFile as any).mockRejectedValueOnce(new Error("nope"));
    // Re-seed DB mocks for second request
    db.recipientSession.findUnique.mockResolvedValueOnce({
      jti: "tok",
      recipientId: "R1",
      expiresAt: futureDate(),
    } as any);
    db.recipient.findUnique.mockResolvedValueOnce({ id: "R1", isEnabled: true } as any);
    db.bundleAssignment.findFirst.mockResolvedValueOnce({
      id: "A1",
      bundleId: "B1",
      recipientId: "R1",
      isEnabled: true,
    } as any);
    db.downloadEvent.count.mockResolvedValueOnce(0);
    db.bundle.findUnique.mockResolvedValueOnce({
      id: "B1",
      storagePath: "path",
      checksum: "dbsum",
    } as any);
    await h(
      { headers: { cookie: "lf_recipient_sess=tok" }, params: { bundleId: "B1" } } as any,
      rc2.res,
    );
    expect(rc2.streamed).toBe(true);
    expect(rc2.sentHeaders?.["ETag"]).toBe("dbsum");
  });

  it("/portal/bundles/:bundleId schedules rebuild when digest mismatch (lazy)", async () => {
    const { handlers } = makeServer();
    const { registerPortalRoutes } = await import("./portal.js");
    const storage = {
      headFile: vi.fn(async () => ({ etag: "stor-etag" })),
      getFileStream: vi.fn(async () => Readable.from(Buffer.from("ok"))),
    } as any;
    const scheduler = { schedule: vi.fn(async () => void 0) } as any;
    registerPortalRoutes(
      { get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h) } as any,
      { storage, scheduler } as any,
    );
    db.recipientSession.findUnique.mockResolvedValueOnce({
      jti: "tok",
      recipientId: "R1",
      expiresAt: futureDate(),
    } as any);
    db.recipient.findUnique.mockResolvedValueOnce({ id: "R1", isEnabled: true } as any);
    db.bundleAssignment.findFirst.mockResolvedValueOnce({
      id: "A1",
      bundleId: "B1",
      recipientId: "R1",
      isEnabled: true,
    } as any);
    // First bundle fetch for route
    db.bundle.findUnique.mockResolvedValueOnce({
      id: "B1",
      storagePath: "path",
      checksum: "dbsum",
      bundleDigest: "old",
    } as any);
    // Second bundle fetch inside lazy check compares digest
    db.bundle.findUnique.mockResolvedValueOnce({ bundleDigest: "old" } as any);
    // Mock computeBundleDigest via DB: it calls bundle.findUnique under the hood, but
    // our second findUnique is used above; to force mismatch, ensure compute returns different digest
    // Here we instead let computeBundleDigest run and keep the mismatch by simulating different values
    const h = handlers.get("GET /portal/bundles/:bundleId")!;
    const rc = resCapture();
    await h(
      { headers: { cookie: "lf_recipient_sess=tok" }, params: { bundleId: "B1" } } as any,
      rc.res,
    );
    // Allow the setTimeout(0) to fire
    await new Promise((r) => setTimeout(r, 0));
    expect(rc.streamed).toBe(true);
    expect(scheduler.schedule).toHaveBeenCalledWith("B1");
  });

  it("GET /portal/assignments returns per-assignment status", async () => {
    const { handlers, storage } = makeServer();
    const { registerPortalRoutes } = await import("./portal.js");
    registerPortalRoutes(
      { get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h) } as any,
      { storage } as any,
    );
    db.recipientSession.findUnique.mockResolvedValueOnce({
      jti: "tok",
      recipientId: "R1",
      expiresAt: futureDate(),
    } as any);
    db.recipient.findUnique.mockResolvedValueOnce({ id: "R1", isEnabled: true } as any);
    const now = Date.now();
    db.bundleAssignment.findMany.mockResolvedValueOnce([
      {
        id: "A1",
        bundleId: "B1",
        maxDownloads: 5,
        cooldownSeconds: null,
        lastDownloadAt: null,
        bundle: { id: "B1", name: "Bundle 1" },
      },
      {
        id: "A2",
        bundleId: "B2",
        maxDownloads: null,
        cooldownSeconds: 10,
        lastDownloadAt: new Date(now - 3000),
        bundle: { id: "B2", name: "Bundle 2" },
      },
    ] as any);
    db.downloadEvent.count.mockResolvedValueOnce(2);
    db.downloadEvent.count.mockResolvedValueOnce(1);
    const h = handlers.get("GET /portal/assignments")!;
    const rc = resCapture();
    await h({ headers: { cookie: "lf_recipient_sess=tok" } } as any, rc.res);
    expect(rc.status).toBe(200);
    expect(Array.isArray(rc.body?.items)).toBe(true);
    const a1 = rc.body.items.find((x: any) => x.bundleId === "B1");
    expect(a1.maxDownloads).toBe(5);
    expect(a1.downloadsUsed).toBe(2);
    expect(a1.downloadsRemaining).toBe(3);
    const a2 = rc.body.items.find((x: any) => x.bundleId === "B2");
    expect(a2.maxDownloads).toBeNull();
    expect(a2.downloadsRemaining).toBeNull();
    expect(a2.cooldownSeconds).toBe(10);
    expect(a2.cooldownRemainingSeconds).toBeGreaterThan(0);
  });
});
