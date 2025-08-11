// Import shared Prisma client instance from the db package.
import { prisma } from "@latchflow/db";

export function getDb() {
  return prisma;
}

export type DbClient = typeof prisma;
