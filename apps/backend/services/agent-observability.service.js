const crypto = require('crypto');
const { prisma } = require('../models/db');
const { transitionTraceStatus, AGENT_EVENT_DEFINITIONS } = require('./agent-state-machine.service');

const SAFE_METADATA_KEYS = new Set([
  'provider', 'model', 'durationMs', 'responseLength', 'promptTokens', 'completionTokens', 'totalTokens',
  'httpStatus', 'retryCount', 'reason', 'errorCode', 'appointmentStatus', 'availableSlotCount',
  'medicineCount', 'hasFollowUpDate', 'priorNoShowCount', 'actionId', 'toolName', 'riskLevel',
  'approvedById', 'approvalTimestamp', 'scheduled', 'messageId', 'reminderId', 'dedupeKey',
  'validationCategory', 'status'
  , 'languageCode', 'languageName', 'languageScript', 'languageDirection', 'languageSource', 'languageFallbackUsed',
  'generationSource', 'messageDraftId', 'contentHash', 'stepSequence'
]);

function safeScalar(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 300);
  return undefined;
}

function sanitizeAgentEventMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => SAFE_METADATA_KEYS.has(key))
      .map(([key, value]) => [key, safeScalar(value)])
      .filter(([, value]) => value !== undefined)
  );
}

function traceContext({ traceId, correlationId, requestId, agentType, appointmentId, actorId } = {}) {
  return { traceId, correlationId, requestId, agentType, appointmentId, actorId };
}

async function createAgentTrace({ agentType, appointmentId, requestedById, requestId, correlationId = crypto.randomUUID() }) {
  const trace = await prisma.agentExecutionTrace.create({
    data: { agentType, appointmentId, requestedById, requestId: requestId || null, correlationId }
  });
  return traceContext({ traceId: trace.id, correlationId: trace.correlationId, requestId, agentType, appointmentId, actorId: requestedById });
}

async function recordAgentEvent({ traceId, runId, actionId, phase, eventType, status, title, message, durationMs, metadata } = {}) {
  if (!traceId) return null;
  const definition = AGENT_EVENT_DEFINITIONS[eventType];
  if (!definition) {
    console.warn('[agent-observability] unregistered event type', { eventType: eventType || 'unknown', traceId, runId: runId || null });
  }
  return prisma.agentExecutionEvent.create({
    data: {
      traceId, runId: runId || null, actionId: actionId || null, phase, eventType, status,
      title: String(title || eventType).slice(0, 200), message: message ? String(message).slice(0, 500) : null,
      durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : null,
      metadata: sanitizeAgentEventMetadata(metadata)
    }
  });
}

async function safeRecordAgentEvent(payload) {
  try {
    return await recordAgentEvent(payload);
  } catch (error) {
    console.warn('[agent-observability] event write failed', {
      eventType: payload?.eventType || 'unknown', traceId: payload?.traceId || null,
      error: String(error?.message || error).slice(0, 200)
    });
    return null;
  }
}

async function safeObservabilityOperation(operation, context = {}) {
  try {
    return await operation();
  } catch (error) {
    console.warn('[agent-observability] operation failed', {
      operation: context.operation || 'unknown',
      traceId: context.traceId || null,
      runId: context.runId || null,
      errorCode: error?.code || null,
      errorMessage: String(error?.message || error).slice(0, 300)
    });
    return null;
  }
}

async function linkTraceToRun(traceId, runId) {
  if (!traceId || !runId) return null;
  return prisma.agentExecutionTrace.update({ where: { id: traceId }, data: { runId } });
}

async function updateTrace(traceId, data) {
  if (!traceId) return null;
  if (data?.status && prisma.agentExecutionTrace?.findUnique) {
    const current = await prisma.agentExecutionTrace.findUnique({ where: { id: traceId }, select: { status: true } });
    if (current?.status) transitionTraceStatus({ from: current.status, to: data.status });
  }
  return prisma.agentExecutionTrace.update({ where: { id: traceId }, data });
}

async function completeAgentTrace(traceId, status = 'completed') {
  return updateTrace(traceId, { status, completedAt: new Date() });
}

async function failAgentTrace(traceId, error) {
  return updateTrace(traceId, {
    status: 'failed', completedAt: new Date(), errorCode: error?.code || 'AGENT_WORKFLOW_FAILED',
    errorMessage: String(error?.message || error || 'Agent workflow failed').slice(0, 500)
  });
}

async function withAgentPhase({ traceId, runId, actionId, phase, startEventType, completedEventType, failedEventType, title, metadata }, operation) {
  const startedAt = Date.now();
  await safeRecordAgentEvent({ traceId, runId, actionId, phase, eventType: startEventType, status: 'started', title, metadata });
  try {
    const result = await operation();
    await safeRecordAgentEvent({ traceId, runId, actionId, phase, eventType: completedEventType, status: 'completed', title, durationMs: Date.now() - startedAt, metadata });
    return result;
  } catch (error) {
    await safeRecordAgentEvent({ traceId, runId, actionId, phase, eventType: failedEventType, status: 'failed', title, durationMs: Date.now() - startedAt, metadata: { ...metadata, errorCode: error?.code || 'AGENT_WORKFLOW_FAILED' } });
    throw error;
  }
}

module.exports = {
  createAgentTrace, linkTraceToRun, recordAgentEvent, safeRecordAgentEvent, sanitizeAgentEventMetadata,
  completeAgentTrace, failAgentTrace, updateTrace, withAgentPhase, traceContext, safeObservabilityOperation
};
