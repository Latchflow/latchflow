-- AlterTable
ALTER TABLE "public"."ActionInvocation" ADD COLUMN     "pipelineId" TEXT,
ADD COLUMN     "pipelineRunId" TEXT,
ADD COLUMN     "pipelineStepId" TEXT,
ADD COLUMN     "stepIndex" INTEGER;

-- CreateTable
CREATE TABLE "public"."PipelineRun" (
    "id" TEXT NOT NULL,
    "triggerEventId" TEXT,
    "pipelineId" TEXT NOT NULL,
    "status" "public"."InvocationStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "result" JSONB,

    CONSTRAINT "PipelineRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PipelineRun_triggerEventId_pipelineId_startedAt_idx" ON "public"."PipelineRun"("triggerEventId", "pipelineId", "startedAt");

-- CreateIndex
CREATE INDEX "ActionInvocation_triggerEventId_pipelineId_startedAt_idx" ON "public"."ActionInvocation"("triggerEventId", "pipelineId", "startedAt");

-- CreateIndex
CREATE INDEX "ActionInvocation_pipelineStepId_startedAt_idx" ON "public"."ActionInvocation"("pipelineStepId", "startedAt");

-- AddForeignKey
ALTER TABLE "public"."ActionInvocation" ADD CONSTRAINT "ActionInvocation_pipelineStepId_fkey" FOREIGN KEY ("pipelineStepId") REFERENCES "public"."PipelineStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ActionInvocation" ADD CONSTRAINT "ActionInvocation_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "public"."Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ActionInvocation" ADD CONSTRAINT "ActionInvocation_pipelineRunId_fkey" FOREIGN KEY ("pipelineRunId") REFERENCES "public"."PipelineRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PipelineRun" ADD CONSTRAINT "PipelineRun_triggerEventId_fkey" FOREIGN KEY ("triggerEventId") REFERENCES "public"."TriggerEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PipelineRun" ADD CONSTRAINT "PipelineRun_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "public"."Pipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
