import { describe, it, expect, vi } from "vitest";

vi.mock("../db/db.js", () => {
  const recipientSession = { findUnique: vi.fn() };
  const recipient = { findUnique: vi.fn() };
  const bundleAssignment = { findFirst: vi.fn() };
  return {
    getDb: () => ({ recipientSession, recipient, bundleAssignment }),
    __rs: recipientSession,
    __r: recipient,
    __ba: bundleAssignment,
  } as any;
});

describe("requireRecipient", () => {
  it("rejects without cookie", async () => {
    const { requireRecipient } = await import("../middleware/require-recipient.js");
    const req = { headers: {} } as any;
    await expect(requireRecipient(req)).rejects.toMatchObject({ status: 401 });
  });

  it("rejects when no assignment for bundle in scoped route", async () => {
    const mod = await import("../db/db.js");
    (mod as any).__rs.findUnique.mockResolvedValueOnce({
      jti: "tok",
      recipientId: "R1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60000),
    });
    (mod as any).__r.findUnique.mockResolvedValueOnce({ id: "R1", isEnabled: true });
    (mod as any).__ba.findFirst.mockResolvedValueOnce(null);
    const { requireRecipient } = await import("../middleware/require-recipient.js");
    const req = { headers: { cookie: "lf_recipient_sess=tok" }, params: { bundleId: "B2" } } as any;
    await expect(requireRecipient(req, true)).rejects.toMatchObject({ status: 403 });
  });

  it("returns session and assignment when valid for bundle", async () => {
    const mod = await import("../db/db.js");
    (mod as any).__rs.findUnique.mockResolvedValueOnce({
      jti: "tok",
      recipientId: "R1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60000),
    });
    (mod as any).__r.findUnique.mockResolvedValueOnce({ id: "R1", isEnabled: true });
    (mod as any).__ba.findFirst.mockResolvedValueOnce({ id: "A1" });
    const { requireRecipient } = await import("../middleware/require-recipient.js");
    const req = { headers: { cookie: "lf_recipient_sess=tok" }, params: { bundleId: "B1" } } as any;
    const out = await requireRecipient(req, true);
    expect(out.session.jti).toBe("tok");
    expect(out.assignment.id).toBe("A1");
  });
});
