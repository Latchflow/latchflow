/*
  Warnings:

  - You are about to drop the `TriggerAction` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."TriggerAction" DROP CONSTRAINT "TriggerAction_actionDefinitionId_fkey";

-- DropForeignKey
ALTER TABLE "public"."TriggerAction" DROP CONSTRAINT "TriggerAction_triggerDefinitionId_fkey";

-- AlterTable
ALTER TABLE "public"."Bundle" ADD COLUMN     "description" TEXT;

-- DropTable
DROP TABLE "public"."TriggerAction";

-- CreateTable
CREATE TABLE "public"."Pipeline" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PipelineStep" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PipelineTrigger" (
    "pipelineId" TEXT NOT NULL,
    "triggerId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineTrigger_pkey" PRIMARY KEY ("pipelineId","triggerId")
);

-- CreateIndex
CREATE UNIQUE INDEX "pipelinestep_sort_unique" ON "public"."PipelineStep"("pipelineId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "pipelinetrigger_sort_unique" ON "public"."PipelineTrigger"("triggerId", "sortOrder");

-- AddForeignKey
ALTER TABLE "public"."PipelineStep" ADD CONSTRAINT "PipelineStep_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "public"."Pipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PipelineStep" ADD CONSTRAINT "PipelineStep_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "public"."ActionDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PipelineTrigger" ADD CONSTRAINT "PipelineTrigger_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "public"."Pipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PipelineTrigger" ADD CONSTRAINT "PipelineTrigger_triggerId_fkey" FOREIGN KEY ("triggerId") REFERENCES "public"."TriggerDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
