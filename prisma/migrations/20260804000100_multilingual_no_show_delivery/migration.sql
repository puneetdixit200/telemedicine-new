-- Reserve no-show occurrences and persist the exact approved patient draft.
ALTER TABLE "Appointment"
  ADD COLUMN IF NOT EXISTS "noShowVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "noShowOccurrenceId" TEXT;
CREATE INDEX IF NOT EXISTS "Appointment_noShowOccurrenceId_idx" ON "Appointment" ("noShowOccurrenceId");

ALTER TABLE "ExternalConsultMessage"
  ADD COLUMN IF NOT EXISTS "title" TEXT,
  ADD COLUMN IF NOT EXISTS "agentActionId" TEXT,
  ADD COLUMN IF NOT EXISTS "messageDraftId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "ExternalConsultMessage_agentActionId_key" ON "ExternalConsultMessage" ("agentActionId");

ALTER TABLE "AgentAction"
  ADD COLUMN IF NOT EXISTS "messageDraftId" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedContentHash" TEXT;

DO $$ BEGIN
  CREATE TYPE "AgentMessageDraftStatus" AS ENUM ('draft', 'approved', 'superseded', 'delivered', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AgentExecutionStepStatus" AS ENUM ('pending', 'waiting', 'executing', 'completed', 'failed', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "AgentMessageDraft" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "runId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "AgentMessageDraftStatus" NOT NULL DEFAULT 'draft',
  "languageCode" TEXT NOT NULL,
  "languageName" TEXT NOT NULL,
  "languageScript" TEXT NOT NULL,
  "languageDirection" TEXT NOT NULL,
  "languageSource" TEXT NOT NULL,
  "languageFallbackUsed" BOOLEAN NOT NULL DEFAULT false,
  "notificationTitle" TEXT NOT NULL,
  "notificationBody" TEXT NOT NULL,
  "generationSource" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  CONSTRAINT "AgentMessageDraft_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AgentMessageDraft_runId_version_key" ON "AgentMessageDraft" ("runId", "version");
CREATE INDEX IF NOT EXISTS "AgentMessageDraft_runId_status_idx" ON "AgentMessageDraft" ("runId", "status");
DO $$ BEGIN
  ALTER TABLE "AgentMessageDraft" ADD CONSTRAINT "AgentMessageDraft_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "AgentExecutionStep" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "runId" TEXT NOT NULL,
  "traceId" TEXT,
  "actionId" TEXT,
  "sequence" INTEGER NOT NULL,
  "stepKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" "AgentExecutionStepStatus" NOT NULL DEFAULT 'pending',
  "notBefore" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "metadata" JSONB,
  CONSTRAINT "AgentExecutionStep_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AgentExecutionStep_runId_stepKey_key" ON "AgentExecutionStep" ("runId", "stepKey");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentExecutionStep_runId_sequence_key" ON "AgentExecutionStep" ("runId", "sequence");
CREATE INDEX IF NOT EXISTS "AgentExecutionStep_runId_status_sequence_idx" ON "AgentExecutionStep" ("runId", "status", "sequence");
DO $$ BEGIN
  ALTER TABLE "AgentExecutionStep" ADD CONSTRAINT "AgentExecutionStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
