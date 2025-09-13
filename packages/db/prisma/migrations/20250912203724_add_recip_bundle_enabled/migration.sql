/*
  Warnings:

  - You are about to drop the column `bundleId` on the `RecipientOtp` table. All the data in the column will be lost.
  - You are about to drop the column `bundleId` on the `RecipientSession` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[bundleId,recipientId]` on the table `BundleAssignment` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "public"."BundleObject_bundleId_sortOrder_idx";

-- DropIndex
DROP INDEX "public"."RecipientOtp_recipientId_bundleId_idx";

-- DropIndex
DROP INDEX "public"."RecipientSession_recipientId_bundleId_idx";

-- AlterTable
ALTER TABLE "public"."Bundle" ADD COLUMN     "isEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "public"."BundleAssignment" ADD COLUMN     "isEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "public"."BundleObject" ADD COLUMN     "isEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "public"."Recipient" ADD COLUMN     "isEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "public"."RecipientOtp" DROP COLUMN "bundleId";

-- AlterTable
ALTER TABLE "public"."RecipientSession" DROP COLUMN "bundleId";

-- CreateIndex
CREATE INDEX "BundleAssignment_bundleId_recipientId_isEnabled_idx" ON "public"."BundleAssignment"("bundleId", "recipientId", "isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "BundleAssignment_bundleId_recipientId_key" ON "public"."BundleAssignment"("bundleId", "recipientId");

-- CreateIndex
CREATE INDEX "BundleObject_bundleId_isEnabled_sortOrder_idx" ON "public"."BundleObject"("bundleId", "isEnabled", "sortOrder");

-- CreateIndex
CREATE INDEX "Recipient_isEnabled_idx" ON "public"."Recipient"("isEnabled");

-- CreateIndex
CREATE INDEX "RecipientOtp_recipientId_idx" ON "public"."RecipientOtp"("recipientId");

-- CreateIndex
CREATE INDEX "RecipientSession_recipientId_expiresAt_idx" ON "public"."RecipientSession"("recipientId", "expiresAt");
