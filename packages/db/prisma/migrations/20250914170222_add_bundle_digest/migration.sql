-- AlterTable
ALTER TABLE "public"."Bundle" ADD COLUMN     "bundleDigest" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "Bundle_bundleDigest_idx" ON "public"."Bundle"("bundleDigest");
