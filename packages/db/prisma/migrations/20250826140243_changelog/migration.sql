-- CreateEnum
CREATE TYPE "public"."ActorType" AS ENUM ('USER', 'ACTION', 'SYSTEM');

-- CreateEnum
CREATE TYPE "public"."ChangeKind" AS ENUM ('ADD_CHILD', 'UPDATE_CHILD', 'REMOVE_CHILD', 'REORDER', 'UPDATE_PARENT');

-- CreateTable
CREATE TABLE "public"."ChangeLog" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "isSnapshot" BOOLEAN NOT NULL,
    "state" JSONB,
    "diff" JSONB,
    "hash" TEXT NOT NULL,
    "actorType" "public"."ActorType" NOT NULL,
    "actorUserId" TEXT,
    "actorInvocationId" TEXT,
    "actorActionDefinitionId" TEXT,
    "onBehalfOfUserId" TEXT,
    "changeNote" TEXT,
    "changedPath" TEXT,
    "changeKind" "public"."ChangeKind",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChangeLog_entityType_entityId_isSnapshot_idx" ON "public"."ChangeLog"("entityType", "entityId", "isSnapshot");

-- CreateIndex
CREATE INDEX "ChangeLog_createdAt_idx" ON "public"."ChangeLog"("createdAt");

-- CreateIndex
CREATE INDEX "ChangeLog_actorType_idx" ON "public"."ChangeLog"("actorType");

-- CreateIndex
CREATE INDEX "ChangeLog_actorUserId_createdAt_idx" ON "public"."ChangeLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ChangeLog_actorActionDefinitionId_createdAt_idx" ON "public"."ChangeLog"("actorActionDefinitionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeLog_entityType_entityId_version_key" ON "public"."ChangeLog"("entityType", "entityId", "version");

-- Enforce exactly one of state or diff depending on isSnapshot
ALTER TABLE "public"."ChangeLog"
  ADD CONSTRAINT "ChangeLog_state_diff_check"
  CHECK (("isSnapshot" AND "state" IS NOT NULL AND "diff" IS NULL)
      OR (NOT "isSnapshot" AND "state" IS NULL AND "diff" IS NOT NULL));

-- Latest-version and nearest-snapshot lookup indexes (DESC and partial)
-- Note: We rely on the unique index (entityType, entityId, version) and a composite index declared in Prisma
-- on (entityType, entityId, isSnapshot, version). Postgres can scan btree indexes in reverse order, so an
-- explicit DESC index is not necessary. Partial indexes are omitted to avoid Prisma drift.

-- AddForeignKey
ALTER TABLE "public"."ChangeLog" ADD CONSTRAINT "ChangeLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ChangeLog" ADD CONSTRAINT "ChangeLog_actorInvocationId_fkey" FOREIGN KEY ("actorInvocationId") REFERENCES "public"."ActionInvocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ChangeLog" ADD CONSTRAINT "ChangeLog_actorActionDefinitionId_fkey" FOREIGN KEY ("actorActionDefinitionId") REFERENCES "public"."ActionDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ChangeLog" ADD CONSTRAINT "ChangeLog_onBehalfOfUserId_fkey" FOREIGN KEY ("onBehalfOfUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Note: We considered replacing unique indexes on sort-order with DEFERRABLE UNIQUE constraints to simplify reorders,
-- but Prisma models these as unique indexes. We'll keep the existing indexes and handle reorders application-side
-- using a conflict-free renumbering strategy (see PLAN.md) to avoid transient duplicates.
