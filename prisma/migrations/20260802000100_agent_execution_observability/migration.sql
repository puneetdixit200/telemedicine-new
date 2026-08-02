-- Durable, server-generated agent observability for the admin operations center.
CREATE TYPE "AgentTraceStatus" AS ENUM ('active', 'awaiting_approval', 'executing', 'completed', 'partially_completed', 'failed', 'deduplicated', 'cancelled');
CREATE TYPE "AgentEventPhase" AS ENUM ('trigger', 'context', 'policy', 'deduplication', 'planning', 'validation', 'persistence', 'approval', 'execution', 'notification', 'completion', 'system');
CREATE TYPE "AgentEventStatus" AS ENUM ('started', 'progress', 'completed', 'failed', 'skipped', 'warning', 'info');

CREATE TABLE "AgentExecutionTrace" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "correlationId" TEXT NOT NULL,
  "requestId" TEXT,
  "agentType" "AgentType" NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "runId" TEXT,
  "status" "AgentTraceStatus" NOT NULL DEFAULT 'active',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  CONSTRAINT "AgentExecutionTrace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentExecutionEvent" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "traceId" TEXT NOT NULL,
  "runId" TEXT,
  "actionId" TEXT,
  "phase" "AgentEventPhase" NOT NULL,
  "eventType" TEXT NOT NULL,
  "status" "AgentEventStatus" NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT,
  "durationMs" INTEGER,
  "metadata" JSONB,
  CONSTRAINT "AgentExecutionEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentExecutionTrace_correlationId_key" ON "AgentExecutionTrace"("correlationId");
CREATE UNIQUE INDEX "AgentExecutionTrace_runId_key" ON "AgentExecutionTrace"("runId");
CREATE INDEX "AgentExecutionTrace_status_createdAt_idx" ON "AgentExecutionTrace"("status", "createdAt");
CREATE INDEX "AgentExecutionTrace_appointmentId_createdAt_idx" ON "AgentExecutionTrace"("appointmentId", "createdAt");
CREATE INDEX "AgentExecutionTrace_requestedById_createdAt_idx" ON "AgentExecutionTrace"("requestedById", "createdAt");
CREATE INDEX "AgentExecutionTrace_agentType_createdAt_idx" ON "AgentExecutionTrace"("agentType", "createdAt");
CREATE INDEX "AgentExecutionEvent_traceId_createdAt_idx" ON "AgentExecutionEvent"("traceId", "createdAt");
CREATE INDEX "AgentExecutionEvent_runId_createdAt_idx" ON "AgentExecutionEvent"("runId", "createdAt");
CREATE INDEX "AgentExecutionEvent_actionId_createdAt_idx" ON "AgentExecutionEvent"("actionId", "createdAt");
CREATE INDEX "AgentExecutionEvent_phase_status_createdAt_idx" ON "AgentExecutionEvent"("phase", "status", "createdAt");

ALTER TABLE "AgentExecutionTrace" ADD CONSTRAINT "AgentExecutionTrace_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentExecutionTrace" ADD CONSTRAINT "AgentExecutionTrace_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentExecutionTrace" ADD CONSTRAINT "AgentExecutionTrace_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentExecutionEvent" ADD CONSTRAINT "AgentExecutionEvent_traceId_fkey" FOREIGN KEY ("traceId") REFERENCES "AgentExecutionTrace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentExecutionEvent" ADD CONSTRAINT "AgentExecutionEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentExecutionEvent" ADD CONSTRAINT "AgentExecutionEvent_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "AgentAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AgentExecutionTrace" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentExecutionEvent" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read agent execution traces"
  ON "AgentExecutionTrace" FOR SELECT TO authenticated
  USING (public.telemedicine_is_admin());
CREATE POLICY "Admins can read agent execution events"
  ON "AgentExecutionEvent" FOR SELECT TO authenticated
  USING (public.telemedicine_is_admin());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'AgentExecutionTrace') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE "AgentExecutionTrace";
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'AgentExecutionEvent') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE "AgentExecutionEvent";
    END IF;
  END IF;
END $$;
