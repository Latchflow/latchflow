import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/db.js", () => {
  const recipientSession = { findUnique: vi.fn() };
  return { getDb: () => ({ recipientSession }), __rs: recipientSession } as any;
});

describe("requireRecipient", () => {
  it("rejects without cookie", async () => {
    const { requireRecipient } = await import("../../src/middleware/require-recipient.js");
    const req = { headers: {} } as any;
    await expect(requireRecipient(req)).rejects.toMatchObject({ status: 401 });
  });

  it("rejects when bundle mismatch in scoped route", async () => {
    const mod = await import("../../src/db.js");
    (mod as any).__rs.findUnique.mockResolvedValueOnce({
      jti: "tok",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60000),
      bundleId: "B1",
    });
    const { requireRecipient } = await import("../../src/middleware/require-recipient.js");
    const req = { headers: { cookie: "lf_recipient_sess=tok" }, params: { bundleId: "B2" } } as any;
    await expect(requireRecipient(req, true)).rejects.toMatchObject({ status: 403 });
  });

  it("returns session when valid", async () => {
    const mod = await import("../../src/db.js");
    (mod as any).__rs.findUnique.mockResolvedValueOnce({
      jti: "tok",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60000),
      bundleId: "B1",
    });
    const { requireRecipient } = await import("../../src/middleware/require-recipient.js");
    const req = { headers: { cookie: "lf_recipient_sess=tok" }, params: { bundleId: "B1" } } as any;
    const out = await requireRecipient(req, true);
    expect(out.session.jti).toBe("tok");
  });
});
