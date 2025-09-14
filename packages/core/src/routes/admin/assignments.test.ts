import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpHandler } from "../../http/http-server.js";

// Mock DB client
const db = {
  bundleAssignment: {
    findMany: vi.fn(async () => [] as any[]),
  },
  downloadEvent: {
    count: vi.fn(async () => 0),
  },
};

vi.mock("../../db/db.js", () => ({ getDb: () => db }));

// Default: requireSession passes for admin permission middleware
vi.mock("../../middleware/require-session.js", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "u1", role: "ADMIN" } })),
}));

function makeServer() {
  const handlers = new Map<string, HttpHandler>();
  const server = {
    get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
  } as any;
  return { handlers, server };
}

describe("admin assignments routes", () => {
  beforeEach(() => {
    db.bundleAssignment.findMany.mockReset();
    db.downloadEvent.count.mockReset();
  });

  it("GET /admin/bundles/:bundleId/assignments returns summaries", async () => {
    const { handlers, server } = makeServer();
    const { registerAssignmentAdminRoutes } = await import("./assignments.js");
    registerAssignmentAdminRoutes(server);
    const now = Date.now();
    db.bundleAssignment.findMany.mockResolvedValueOnce([
      {
        id: "A1",
        bundleId: "B1",
        recipientId: "R1",
        isEnabled: true,
        maxDownloads: 3,
        cooldownSeconds: 10,
        lastDownloadAt: new Date(now - 15000),
        bundle: { id: "B1", name: "Bundle 1" },
        recipient: { id: "R1", email: "r@example.com", name: "Rec" },
        updatedAt: new Date(now),
      },
    ] as any);
    db.downloadEvent.count.mockResolvedValueOnce(2);
    const h = handlers.get("GET /admin/bundles/:bundleId/assignments")!;
    let status = 0;
    let body: any = null;
    await h({ params: { bundleId: "B1" } } as any, {
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
    expect(body.items[0].bundleId).toBe("B1");
    expect(body.items[0].downloadsUsed).toBe(2);
    expect(body.items[0].downloadsRemaining).toBe(1);
  });

  it("GET /admin/recipients/:recipientId/assignments returns summaries", async () => {
    const { handlers, server } = makeServer();
    const { registerAssignmentAdminRoutes } = await import("./assignments.js");
    registerAssignmentAdminRoutes(server);
    db.bundleAssignment.findMany.mockResolvedValueOnce([
      {
        id: "A2",
        bundleId: "B2",
        recipientId: "R2",
        isEnabled: true,
        maxDownloads: null,
        cooldownSeconds: null,
        lastDownloadAt: null,
        bundle: { id: "B2", name: "Bundle 2" },
        recipient: { id: "R2", email: "r2@example.com", name: null },
        updatedAt: new Date(),
      },
    ] as any);
    db.downloadEvent.count.mockResolvedValueOnce(0);
    const h = handlers.get("GET /admin/recipients/:recipientId/assignments")!;
    let status = 0;
    let body: any = null;
    await h({ params: { recipientId: "R2" } } as any, {
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
    expect(body.items[0].recipientId).toBe("R2");
    expect(body.items[0].downloadsRemaining).toBeNull();
  });
});
