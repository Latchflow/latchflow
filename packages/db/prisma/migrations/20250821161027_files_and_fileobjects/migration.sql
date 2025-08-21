-- AlterTable
ALTER TABLE "public"."DownloadEvent" ADD COLUMN     "fileId" TEXT;

-- CreateTable
CREATE TABLE "public"."File" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "contentType" TEXT NOT NULL,
    "metadata" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BundleObject" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "path" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BundleObject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "File_key_key" ON "public"."File"("key");

-- CreateIndex
CREATE UNIQUE INDEX "File_storageKey_key" ON "public"."File"("storageKey");

-- CreateIndex
CREATE INDEX "File_contentHash_size_idx" ON "public"."File"("contentHash", "size");

-- CreateIndex
CREATE INDEX "File_updatedAt_idx" ON "public"."File"("updatedAt");

-- CreateIndex
CREATE INDEX "BundleObject_bundleId_sortOrder_idx" ON "public"."BundleObject"("bundleId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "BundleObject_bundleId_fileId_key" ON "public"."BundleObject"("bundleId", "fileId");

-- AddForeignKey
ALTER TABLE "public"."BundleObject" ADD CONSTRAINT "BundleObject_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "public"."Bundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BundleObject" ADD CONSTRAINT "BundleObject_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "public"."File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DownloadEvent" ADD CONSTRAINT "DownloadEvent_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "public"."File"("id") ON DELETE SET NULL ON UPDATE CASCADE;
