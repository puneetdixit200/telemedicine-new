'use strict';

const { prisma } = require('../models/db');
const { executeApprovedActions } = require('./agent-orchestrator.service');
const { safeRecordAgentEvent, updateTrace, safeObservabilityOperation } = require('./agent-observability.service');

const RETRYABLE_FAILURE_PATTERN = /(?:P1001|P1002|P2002|P2024|AGENT_STEP_FAILED|TOOL_EXECUTION_FAILED|PATIENT_MESSAGE_QUEUE_FAILED|ECONNRESET|ETIMEDOUT|timeout|temporar|connection)/i;

function workflowError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function retryFailedNoShowExecution({ runId, actor }) {
  if (actor?.role !== 'admin') {
    throw workflowError('AGENT_ADMIN_REQUIRED', 'Only an administrator can retry a failed no-show workflow.', 403);
  }

  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    include: {
      actions: { orderBy: { createdAt: 'asc' } },
      messageDrafts: { orderBy: { version: 'desc' } },
      executionSteps: { orderBy: { sequence: 'asc' } }
    }
  });

  if (!run || run.agentType !== 'no_show_recovery') {
    throw workflowError('AGENT_RUN_NOT_FOUND', 'No-show workflow not found.', 404);
  }
  if (run.status !== 'failed') {
    throw workflowError('AGENT_RETRY_NOT_AVAILABLE', 'Only a failed no-show workflow can be retried safely.');
  }

  const failedActions = run.actions.filter((action) => action.status === 'failed');
  if (failedActions.length !== 1 || run.actions.some((action) => action.status === 'executing')) {
    throw workflowError('AGENT_RETRY_STATE_UNSAFE', 'The failed workflow is not in a safe single-action retry state.');
  }

  const action = failedActions[0];
  const draft = run.messageDrafts.find((item) => item.id === action.messageDraftId) || run.messageDrafts[0];
  if (!draft || draft.status !== 'approved' || !draft.approvedById || draft.deliveredAt) {
    throw workflowError('AGENT_RETRY_DRAFT_UNSAFE', 'An unchanged approved and undelivered draft is required for retry.');
  }
  if (!action.approvedContentHash || action.approvedContentHash !== draft.contentHash) {
    throw workflowError('AGENT_RETRY_HASH_MISMATCH', 'The approved notification changed and must be reviewed again.');
  }

  const existingMessage = await prisma.externalConsultMessage.findUnique({ where: { agentActionId: action.id } });
  if (existingMessage) {
    throw workflowError('AGENT_RETRY_MESSAGE_EXISTS', 'A patient message already exists, so execution cannot be retried.');
  }

  const failureText = `${action.error || ''} ${run.error || ''}`;
  if (!RETRYABLE_FAILURE_PATTERN.test(failureText)) {
    throw workflowError('AGENT_RETRY_REQUIRES_REVIEW', 'This failure is not classified as a retryable infrastructure error.');
  }

  const trace = await prisma.agentExecutionTrace.findFirst({
    where: { runId, status: { not: 'deduplicated' } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
  });
  if (!trace) throw workflowError('AGENT_TRACE_NOT_FOUND', 'The original execution trace is required for retry.');

  await prisma.$transaction(async (tx) => {
    await tx.agentExecutionStep.updateMany({
      where: { runId, status: { in: ['failed', 'executing'] }, sequence: { gte: 100 } },
      data: {
        status: 'pending',
        startedAt: null,
        completedAt: null,
        durationMs: null,
        errorCode: null,
        errorMessage: null
      }
    });
    await tx.agentAction.update({
      where: { id: action.id },
      data: { status: 'approved', result: null, error: null, executedAt: null }
    });
    await tx.agentRun.update({
      where: { id: runId },
      data: {
        status: 'awaiting_approval',
        completedAt: null,
        error: null,
        input: { ...(run.input && typeof run.input === 'object' ? run.input : {}), executionMode: 'presentation_paced' }
      }
    });
    await tx.agentExecutionTrace.update({
      where: { id: trace.id },
      data: { status: 'awaiting_approval', completedAt: null, errorCode: null, errorMessage: null }
    });
  });

  await safeRecordAgentEvent({
    traceId: trace.id,
    runId,
    actionId: action.id,
    phase: 'system',
    eventType: 'state_reconciled',
    status: 'info',
    title: 'Failed execution prepared for safe retry',
    metadata: { reason: 'retryable_infrastructure_failure', priorFailure: failureText.slice(0, 160) }
  });
  await safeObservabilityOperation(
    () => updateTrace(trace.id, { status: 'awaiting_approval', completedAt: null, errorCode: null, errorMessage: null }),
    { operation: 'prepare_failed_execution_retry', traceId: trace.id, runId }
  );

  return executeApprovedActions({ runId, actor, executionMode: 'presentation_paced' });
}

module.exports = { retryFailedNoShowExecution, RETRYABLE_FAILURE_PATTERN };
