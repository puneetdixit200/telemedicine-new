-- A single AgentRun may be referenced by its original execution trace and
-- multiple later deduplicated request traces.
DROP INDEX IF EXISTS "AgentExecutionTrace_runId_key";
DO $$ BEGIN
  CREATE TYPE "AgentTraceKind" AS ENUM ('execution', 'deduplicated_request');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE "AgentExecutionTrace"
  ADD COLUMN IF NOT EXISTS "traceKind" "AgentTraceKind" NOT NULL DEFAULT 'execution',
  ADD COLUMN IF NOT EXISTS "sourceTraceId" TEXT;
CREATE INDEX IF NOT EXISTS "AgentExecutionTrace_runId_createdAt_idx"
  ON "AgentExecutionTrace" ("runId", "createdAt");
