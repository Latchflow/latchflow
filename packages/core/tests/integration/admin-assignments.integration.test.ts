import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpHandler } from "../../src/http/http-server.js";

// Prisma-like mock
const db = {
  bundleAssignment: {
    findMany: vi.fn(async (): Promise<any[]> => []),
  },
  downloadEvent: {
    count: vi.fn(async (): Promise<number> => 0),
  },
};

vi.mock("../../src/db/db.js", () => ({ getDb: () => db }));

// Allow through permission middleware
vi.mock("../../src/middleware/require-session.js", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "u1", role: "ADMIN" } })),
}));

function makeServer() {
  const handlers = new Map<string, HttpHandler>();
  const server = {
    get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
  } as any;
  return { handlers, server };
}

describe("admin assignments routes (integration)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    db.bundleAssignment.findMany.mockReset();
    db.downloadEvent.count.mockReset();
  });

  it("GET /admin/bundles/:bundleId/assignments returns summaries and respects limit", async () => {
    const { handlers, server } = makeServer();
    const { registerAssignmentAdminRoutes } = await import("../../src/routes/admin/assignments.js");
    registerAssignmentAdminRoutes(server);

    // Seed two rows but expect only one due to limit=1
    const now = new Date();
    db.bundleAssignment.findMany.mockImplementationOnce(async (args: any) => {
      // Verify limit is passed to DB
      expect(args?.take).toBe(1);
      return [
        {
          id: "A1",
          bundleId: "B1",
          recipientId: "R1",
          isEnabled: true,
          maxDownloads: 3,
          cooldownSeconds: 10,
          lastDownloadAt: new Date(now.getTime() - 60000), // cooldown elapsed
          bundle: { id: "B1", name: "Bundle 1" },
          recipient: { id: "R1", email: "r@example.com", name: "Rec" },
          updatedAt: now,
          _count: { downloadEvents: 2 },
        },
      ] as any[];
    });

    const h = handlers.get("GET /admin/bundles/:bundleId/assignments")!;
    let status = 0;
    let body: any = null;
    await h({ params: { bundleId: "B1" }, query: { limit: "1" } } as any, {
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
    expect(body.items.length).toBe(1);
    const it0 = body.items[0];
    expect(it0.assignmentId).toBe("A1");
    expect(it0.bundleId).toBe("B1");
    expect(it0.bundleName).toBe("Bundle 1");
    expect(it0.recipientId).toBe("R1");
    expect(it0.recipientEmail).toBe("r@example.com");
    expect(it0.downloadsUsed).toBe(2);
    expect(it0.maxDownloads).toBe(3);
    expect(it0.downloadsRemaining).toBe(1);
    expect(it0.cooldownRemainingSeconds).toBe(0);
  }, 10_000);

  it("GET /admin/recipients/:recipientId/assignments falls back to downloadEvent.count when _count missing", async () => {
    const { handlers, server } = makeServer();
    const { registerAssignmentAdminRoutes } = await import("../../src/routes/admin/assignments.js");
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
    db.downloadEvent.count.mockResolvedValueOnce(1);

    const h = handlers.get("GET /admin/recipients/:recipientId/assignments")!;
    let status = 0;
    let body: any = null;
    await h({ params: { recipientId: "R2" }, query: { limit: "10" } } as any, {
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
    const it0 = body.items[0];
    expect(it0.recipientId).toBe("R2");
    expect(it0.downloadsUsed).toBe(1);
    expect(it0.maxDownloads).toBeNull();
    expect(it0.downloadsRemaining).toBeNull();
  });
});
