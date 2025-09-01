import type { Prisma } from "@latchflow/db";
type BootstrapUserRecord = { id: string; email: string; role: string | null };

/**
 * Promote the given user to ADMIN if and only if this
 * is the only user that exists in the system. Must be called within a
 * transaction; pass the transaction client as `tx`.
 *
 * Returns true if role was updated; false otherwise.
 */
export async function bootstrapGrantAdminIfOnlyUserTx(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  const userCount = await tx.user.count();
  if (userCount !== 1) return false;

  const u = (await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true },
  })) as BootstrapUserRecord | null;
  if (!u) return false;

  if (u.role === "ADMIN") return false;

  await tx.user.update({ where: { id: u.id }, data: { role: "ADMIN" } });
  // eslint-disable-next-line no-console
  console.log(`[auth] Bootstrap: granted ADMIN to ${u.email}`);
  return true;
}
