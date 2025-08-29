import type { $Enums, Prisma } from "@latchflow/db";
type BootstrapUserRecord = { id: string; email: string; roles: string[] | null };

/**
 * Promote the given user to ADMIN and EXECUTOR roles if and only if this
 * is the only user that exists in the system. Must be called within a
 * transaction; pass the transaction client as `tx`.
 *
 * Returns true if roles were updated; false otherwise.
 */
export async function bootstrapGrantAdminIfOnlyUserTx(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  const userCount = await tx.user.count();
  if (userCount !== 1) return false;

  const u = (await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, roles: true },
  })) as BootstrapUserRecord | null;
  if (!u) return false;

  const currentRoles = u.roles ?? [];
  const needsAdmin = !currentRoles.includes("ADMIN");
  const needsExec = !currentRoles.includes("EXECUTOR");
  if (!needsAdmin && !needsExec) return false;

  const roles = Array.from(
    new Set([...currentRoles, "EXECUTOR", "ADMIN"]),
  ) as unknown as $Enums.UserRole[];
  await tx.user.update({ where: { id: u.id }, data: { roles } });
  // eslint-disable-next-line no-console
  console.log(`[auth] Bootstrap: granted ADMIN to ${u.email}`);
  return true;
}
