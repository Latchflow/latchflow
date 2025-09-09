-- CreateTable
CREATE TABLE "public"."FileUploadReservation" (
    "id" TEXT NOT NULL,
    "tempKey" TEXT NOT NULL,
    "desiredKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "requestedContentType" TEXT,
    "requestedSize" BIGINT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "FileUploadReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FileUploadReservation_tempKey_key" ON "public"."FileUploadReservation"("tempKey");

-- CreateIndex
CREATE INDEX "FileUploadReservation_expiresAt_idx" ON "public"."FileUploadReservation"("expiresAt");

-- AddForeignKey
ALTER TABLE "public"."FileUploadReservation" ADD CONSTRAINT "FileUploadReservation_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
