import { describe, it, expect, vi, beforeEach } from "vitest";
import { bootstrapGrantAdminIfOnlyUserTx } from "./bootstrap.js";
import type { Prisma } from "@latchflow/db";

describe("bootstrapGrantAdminIfOnlyUser", () => {
  const tx = {
    user: {
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    tx.user.count.mockReset();
    tx.user.findUnique.mockReset();
    tx.user.update.mockReset();
  });

  it("grants admin role when only one user exists", async () => {
    tx.user.count.mockResolvedValueOnce(1);
    tx.user.findUnique.mockResolvedValueOnce({ id: "u1", email: "a@b.co", role: "EXECUTOR" });
    tx.user.update.mockResolvedValueOnce({});

    const changed = await bootstrapGrantAdminIfOnlyUserTx(
      tx as unknown as Prisma.TransactionClient,
      "u1",
    );
    expect(changed).toBe(true);
    expect(tx.user.update).toHaveBeenCalled();
  });

  it("does nothing when multiple users exist", async () => {
    tx.user.count.mockResolvedValueOnce(2);
    const changed = await bootstrapGrantAdminIfOnlyUserTx(
      tx as unknown as Prisma.TransactionClient,
      "u1",
    );
    expect(changed).toBe(false);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("does nothing when user is already ADMIN", async () => {
    tx.user.count.mockResolvedValueOnce(1);
    tx.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      email: "a@b.co",
      role: "ADMIN",
    });
    const changed = await bootstrapGrantAdminIfOnlyUserTx(
      tx as unknown as Prisma.TransactionClient,
      "u1",
    );
    expect(changed).toBe(false);
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});
