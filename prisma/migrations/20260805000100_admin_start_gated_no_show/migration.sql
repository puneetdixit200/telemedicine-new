ALTER TYPE "AgentRunStatus" ADD VALUE IF NOT EXISTS 'queued_for_start' BEFORE 'planned';

ALTER TABLE "AgentRun"
  ADD COLUMN IF NOT EXISTS "workflowStartedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "workflowStartedById" TEXT,
  ADD COLUMN IF NOT EXISTS "approvalAvailableAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "AgentRun_workflowStartedAt_idx" ON "AgentRun"("workflowStartedAt");
