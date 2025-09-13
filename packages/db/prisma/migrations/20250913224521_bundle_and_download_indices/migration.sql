-- CreateIndex
CREATE INDEX "BundleAssignment_updatedAt_idx" ON "public"."BundleAssignment"("updatedAt");

-- CreateIndex
CREATE INDEX "DownloadEvent_bundleAssignmentId_idx" ON "public"."DownloadEvent"("bundleAssignmentId");
