-- Non-negative guardrails
ALTER TABLE "PipelineStep"     ADD CONSTRAINT pipelinestep_sort_nonneg     CHECK ("sortOrder" >= 0);
ALTER TABLE "PipelineTrigger"  ADD CONSTRAINT pipelinetrigger_sort_nonneg  CHECK ("sortOrder" >= 0);
