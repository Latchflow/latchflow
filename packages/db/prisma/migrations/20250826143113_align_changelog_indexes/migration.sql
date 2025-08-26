-- CreateIndex
CREATE INDEX "ChangeLog_entityType_entityId_isSnapshot_version_idx" ON "public"."ChangeLog"("entityType", "entityId", "isSnapshot", "version");
