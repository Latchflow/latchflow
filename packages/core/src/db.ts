// NOTE: In this repo, the Prisma client is generated under packages/db.
// The architectural rule is to import the Prisma client only from that package.
// For now, we import PrismaClient from '@prisma/client' which resolves to the generated client.
// If a dedicated package export is introduced (e.g., '@latchflow/db'), update this import accordingly.
import { PrismaClient } from "@prisma/client";

let prisma: PrismaClient | null = null;

export function getDb(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

export type DbClient = PrismaClient;
