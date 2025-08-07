-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('ADMIN', 'EXECUTOR', 'RECIPIENT');

-- CreateEnum
CREATE TYPE "public"."CapabilityKind" AS ENUM ('TRIGGER', 'ACTION');

-- CreateEnum
CREATE TYPE "public"."InvocationStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."VerificationType" AS ENUM ('MAGIC_LINK', 'OTP', 'PASSPHRASE');

-- CreateEnum
CREATE TYPE "public"."PermissionType" AS ENUM ('DOWNLOAD_ACCESS', 'SEND_MESSAGE', 'ADMIN_PANEL', 'OVERRIDE_RELEASE');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "public"."UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Recipient" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Bundle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BundleAssignment" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "maxDownloads" INTEGER,
    "cooldownSeconds" INTEGER,
    "verificationType" "public"."VerificationType",
    "verificationMet" BOOLEAN NOT NULL DEFAULT false,
    "lastDownloadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BundleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DownloadEvent" (
    "id" TEXT NOT NULL,
    "bundleAssignmentId" TEXT NOT NULL,
    "triggerEventId" TEXT,
    "downloadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT NOT NULL,
    "ip" TEXT NOT NULL,

    CONSTRAINT "DownloadEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Plugin" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT,
    "description" TEXT,
    "author" TEXT,
    "homepageUrl" TEXT,
    "repositoryUrl" TEXT,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plugin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PluginCapability" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "kind" "public"."CapabilityKind" NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "jsonSchema" JSONB,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PluginCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TriggerDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TriggerDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TriggerEvent" (
    "id" TEXT NOT NULL,
    "triggerDefinitionId" TEXT NOT NULL,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "context" JSONB NOT NULL,

    CONSTRAINT "TriggerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ActionDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TriggerAction" (
    "id" TEXT NOT NULL,
    "triggerDefinitionId" TEXT NOT NULL,
    "actionDefinitionId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TriggerAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ActionInvocation" (
    "id" TEXT NOT NULL,
    "actionDefinitionId" TEXT NOT NULL,
    "triggerEventId" TEXT,
    "manualInvokerId" TEXT,
    "status" "public"."InvocationStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "result" JSONB,

    CONSTRAINT "ActionInvocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ExecutorAssignment" (
    "id" TEXT NOT NULL,
    "executorId" TEXT NOT NULL,
    "bundleId" TEXT,
    "triggerDefinitionId" TEXT,

    CONSTRAINT "ExecutorAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ExecutorPermission" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "type" "public"."PermissionType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "activatedAfterTriggerId" TEXT,

    CONSTRAINT "ExecutorPermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Recipient_email_key" ON "public"."Recipient"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PluginCapability_pluginId_key_key" ON "public"."PluginCapability"("pluginId", "key");

-- AddForeignKey
ALTER TABLE "public"."BundleAssignment" ADD CONSTRAINT "BundleAssignment_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "public"."Bundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BundleAssignment" ADD CONSTRAINT "BundleAssignment_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "public"."Recipient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DownloadEvent" ADD CONSTRAINT "DownloadEvent_bundleAssignmentId_fkey" FOREIGN KEY ("bundleAssignmentId") REFERENCES "public"."BundleAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DownloadEvent" ADD CONSTRAINT "DownloadEvent_triggerEventId_fkey" FOREIGN KEY ("triggerEventId") REFERENCES "public"."TriggerEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PluginCapability" ADD CONSTRAINT "PluginCapability_pluginId_fkey" FOREIGN KEY ("pluginId") REFERENCES "public"."Plugin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TriggerDefinition" ADD CONSTRAINT "TriggerDefinition_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "public"."PluginCapability"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TriggerDefinition" ADD CONSTRAINT "TriggerDefinition_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TriggerEvent" ADD CONSTRAINT "TriggerEvent_triggerDefinitionId_fkey" FOREIGN KEY ("triggerDefinitionId") REFERENCES "public"."TriggerDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ActionDefinition" ADD CONSTRAINT "ActionDefinition_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "public"."PluginCapability"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TriggerAction" ADD CONSTRAINT "TriggerAction_triggerDefinitionId_fkey" FOREIGN KEY ("triggerDefinitionId") REFERENCES "public"."TriggerDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TriggerAction" ADD CONSTRAINT "TriggerAction_actionDefinitionId_fkey" FOREIGN KEY ("actionDefinitionId") REFERENCES "public"."ActionDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ActionInvocation" ADD CONSTRAINT "ActionInvocation_actionDefinitionId_fkey" FOREIGN KEY ("actionDefinitionId") REFERENCES "public"."ActionDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ActionInvocation" ADD CONSTRAINT "ActionInvocation_triggerEventId_fkey" FOREIGN KEY ("triggerEventId") REFERENCES "public"."TriggerEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ActionInvocation" ADD CONSTRAINT "ActionInvocation_manualInvokerId_fkey" FOREIGN KEY ("manualInvokerId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExecutorAssignment" ADD CONSTRAINT "ExecutorAssignment_executorId_fkey" FOREIGN KEY ("executorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExecutorAssignment" ADD CONSTRAINT "ExecutorAssignment_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "public"."Bundle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExecutorAssignment" ADD CONSTRAINT "ExecutorAssignment_triggerDefinitionId_fkey" FOREIGN KEY ("triggerDefinitionId") REFERENCES "public"."TriggerDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExecutorPermission" ADD CONSTRAINT "ExecutorPermission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "public"."ExecutorAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExecutorPermission" ADD CONSTRAINT "ExecutorPermission_activatedAfterTriggerId_fkey" FOREIGN KEY ("activatedAfterTriggerId") REFERENCES "public"."TriggerDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
