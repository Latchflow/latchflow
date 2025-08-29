-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "public"."User"("isActive");
