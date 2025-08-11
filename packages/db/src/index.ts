// packages/db/src/index.ts
import { PrismaClient } from "../generated/prisma";

type GlobalWithPrisma = typeof globalThis & {
  prisma?: PrismaClient;
};

const g = globalThis as GlobalWithPrisma;
export const prisma = g.prisma ?? (g.prisma = new PrismaClient());

// Re-export all Prisma types and client for consumers
export * from "../generated/prisma";
