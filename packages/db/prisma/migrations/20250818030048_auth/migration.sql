-- CreateTable
CREATE TABLE "public"."Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MagicLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "MagicLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RecipientSession" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "RecipientSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RecipientOtp" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RecipientOtp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_jti_key" ON "public"."Session"("jti");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "public"."Session"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MagicLink_tokenHash_key" ON "public"."MagicLink"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "RecipientSession_jti_key" ON "public"."RecipientSession"("jti");

-- CreateIndex
CREATE INDEX "RecipientSession_recipientId_bundleId_idx" ON "public"."RecipientSession"("recipientId", "bundleId");

-- CreateIndex
CREATE INDEX "RecipientOtp_recipientId_bundleId_idx" ON "public"."RecipientOtp"("recipientId", "bundleId");

-- AddForeignKey
ALTER TABLE "public"."Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MagicLink" ADD CONSTRAINT "MagicLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
