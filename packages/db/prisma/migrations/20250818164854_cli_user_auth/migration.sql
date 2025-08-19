-- CreateTable
CREATE TABLE "public"."ApiToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopes" TEXT[],
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DeviceAuth" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "deviceName" TEXT,
    "deviceCodeHash" TEXT NOT NULL,
    "userCodeHash" TEXT NOT NULL,
    "intervalSec" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "tokenId" TEXT,

    CONSTRAINT "DeviceAuth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "public"."ApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiToken_userId_idx" ON "public"."ApiToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceAuth_deviceCodeHash_key" ON "public"."DeviceAuth"("deviceCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceAuth_userCodeHash_key" ON "public"."DeviceAuth"("userCodeHash");

-- AddForeignKey
ALTER TABLE "public"."ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DeviceAuth" ADD CONSTRAINT "DeviceAuth_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DeviceAuth" ADD CONSTRAINT "DeviceAuth_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "public"."ApiToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
