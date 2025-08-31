-- AlterTable
ALTER TABLE "public"."ActionDefinition" ADD COLUMN     "systemOwned" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."TriggerDefinition" ADD COLUMN     "systemOwned" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "directPermissions" JSONB,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mfaEnforced" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "permissionPresetId" TEXT,
ADD COLUMN     "permissionsHash" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "role" "public"."UserRole";

-- CreateTable
CREATE TABLE "public"."PermissionPreset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "rules" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "PermissionPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PermissionPreset_name_key" ON "public"."PermissionPreset"("name");

-- CreateIndex
CREATE INDEX "User_isActive_role_idx" ON "public"."User"("isActive", "role");

-- CreateIndex
CREATE INDEX "User_permissionsHash_idx" ON "public"."User"("permissionsHash");

-- CreateIndex
CREATE INDEX "User_permissionPresetId_idx" ON "public"."User"("permissionPresetId");

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_permissionPresetId_fkey" FOREIGN KEY ("permissionPresetId") REFERENCES "public"."PermissionPreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PermissionPreset" ADD CONSTRAINT "PermissionPreset_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PermissionPreset" ADD CONSTRAINT "PermissionPreset_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
