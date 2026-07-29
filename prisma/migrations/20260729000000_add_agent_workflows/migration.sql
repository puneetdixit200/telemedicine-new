-- CreateEnum
CREATE TYPE "AgentType" AS ENUM ('no_show_recovery', 'post_visit_follow_up');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('planned', 'awaiting_approval', 'executing', 'completed', 'partially_completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "AgentActionStatus" AS ENUM ('proposed', 'approved', 'rejected', 'executing', 'completed', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "AgentRiskLevel" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "agentType" "AgentType" NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'planned',
    "dedupeKey" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "input" JSONB,
    "context" JSONB,
    "plan" JSONB,
    "summary" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentAction" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "runId" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "arguments" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "riskLevel" "AgentRiskLevel" NOT NULL DEFAULT 'medium',
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "status" "AgentActionStatus" NOT NULL DEFAULT 'proposed',
    "idempotencyKey" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "AgentAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_dedupeKey_key" ON "AgentRun"("dedupeKey");

-- CreateIndex
CREATE INDEX "AgentRun_appointmentId_agentType_createdAt_idx" ON "AgentRun"("appointmentId", "agentType", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_requestedById_createdAt_idx" ON "AgentRun"("requestedById", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_status_createdAt_idx" ON "AgentRun"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentAction_idempotencyKey_key" ON "AgentAction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AgentAction_runId_status_idx" ON "AgentAction"("runId", "status");

-- CreateIndex
CREATE INDEX "AgentAction_approvedById_approvedAt_idx" ON "AgentAction"("approvedById", "approvedAt");

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
