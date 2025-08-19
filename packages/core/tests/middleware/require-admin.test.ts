import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/db.js", () => {
  const session = {
    findUnique: vi.fn(),
  };
  return {
    getDb: () => ({ session }),
    __session: session,
  } as any;
});

describe("requireAdmin", () => {
  it("rejects when cookie missing", async () => {
    const { requireAdmin } = await import("../../src/middleware/require-admin.js");
    const req = { headers: {} } as any;
    await expect(requireAdmin(req)).rejects.toMatchObject({ status: 401 });
  });

  it("rejects when role not ADMIN/EXECUTOR", async () => {
    const mod = await import("../../src/db.js");
    const db: any = (mod as any).getDb();
    db.session.findUnique.mockResolvedValueOnce({
      jti: "abc",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: "u1", email: "e", roles: ["VIEWER"] },
    });
    const { requireAdmin } = await import("../../src/middleware/require-admin.js");
    const req = { headers: { cookie: "lf_admin_sess=abc" } } as any;
    await expect(requireAdmin(req)).rejects.toMatchObject({ status: 403 });
  });

  it("returns user/session when authorized", async () => {
    const mod = await import("../../src/db.js");
    const db: any = (mod as any).getDb();
    db.session.findUnique.mockResolvedValueOnce({
      jti: "abc",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: "u1", email: "e", roles: ["EXECUTOR"] },
    });
    const { requireAdmin } = await import("../../src/middleware/require-admin.js");
    const req = { headers: { cookie: "lf_admin_sess=abc" } } as any;
    const out = await requireAdmin(req);
    expect(out.user.id).toBe("u1");
  });
});
