const { prisma } = require('../models/db');
const { createSupabaseExpressClient, getSupabaseAnonKey, getSupabaseUrl } = require('../services/supabase-auth.service');
const { derivePipelineState, validateTraceInvariants, validateRunInvariants, isHistoricalUnresolvedTrace } = require('../services/agent-state-machine.service');
const { findInconsistentAgentStates, reconcileTrace } = require('../services/agent-state-reconciliation.service');
const { approveAndRunAgent } = require('../services/agent-orchestrator.service');

const TRACE_INCLUDE = {
  appointment: { select: { id: true, status: true, doctorId: true, patientId: true, startAt: true } },
  requestedBy: { select: { id: true, role: true, fullName: true } },
  run: { include: { actions: { orderBy: { createdAt: 'asc' } }, messageDrafts: { orderBy: [{ version: 'desc' }] }, executionSteps: { orderBy: [{ sequence: 'asc' }] } } },
  events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }
};

function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || '?';
}

function safePlan(plan) {
  if (!plan || typeof plan !== 'object') return null;
  const allowed = ['summary', 'patientMessage', 'notificationTitle', 'patientFriendlySummary', 'medicationExplanation', 'nextSteps', 'warningSigns', 'rationale', 'safetyNotes', 'model', 'provider', 'fallbackUsed', 'generationSource', 'languageCode', 'languageName', 'languageNativeName', 'languageScript', 'languageDirection', 'languageSource', 'languageFallbackUsed', 'aiMetadata'];
  return Object.fromEntries(allowed.filter((key) => plan[key] !== undefined).map((key) => [key, plan[key]]));
}

function safeContext(context) {
  if (!context || typeof context !== 'object') return null;
  const appointment = context.appointment || {};
  const prescription = context.prescription || {};
  return {
    appointmentStatus: appointment.status || null,
    availableSlotCount: Array.isArray(context.availableSlots) ? context.availableSlots.length : null,
    priorNoShowCount: Number.isFinite(context.priorNoShowCount) ? context.priorNoShowCount : null,
    medicineCount: Array.isArray(prescription.medicines) ? prescription.medicines.length : null,
    hasFollowUpDate: Boolean(prescription.followUpDate),
    patientLanguage: context.patientLanguage ? { code: context.patientLanguage.code, name: context.patientLanguage.name, script: context.patientLanguage.script, direction: context.patientLanguage.direction, source: context.patientLanguage.source, fallbackUsed: context.patientLanguage.fallbackUsed } : null
  };
}

function safeAction(action) {
  if (!action) return null;
  return {
    id: action.id, actionKey: action.actionKey, toolName: action.toolName, title: action.title,
    description: action.description, riskLevel: action.riskLevel, requiresApproval: action.requiresApproval,
    status: action.status, approvedById: action.approvedById, approvedAt: action.approvedAt,
    executedAt: action.executedAt, messageDraftId: action.messageDraftId || null, approvedContentHash: action.approvedContentHash || null, result: action.result || null, error: action.error || null,
    createdAt: action.createdAt, updatedAt: action.updatedAt
  };
}

function safeEvent(event) {
  return {
    id: event.id, createdAt: event.createdAt, traceId: event.traceId, runId: event.runId, actionId: event.actionId,
    phase: event.phase, eventType: event.eventType, status: event.status, title: event.title,
    message: event.message, durationMs: event.durationMs, metadata: event.metadata || {}
  };
}

function safeTrace(trace) {
  const run = trace.run;
  const historicalUnresolved = isHistoricalUnresolvedTrace(trace, run);
  const invariantErrors = [...validateTraceInvariants(trace, run, trace.events), ...validateRunInvariants(run)].filter((error) => !(historicalUnresolved && error === 'deduplicated_trace_missing_source_trace'));
  const actions = run?.actions || [];
  return {
    id: trace.id, correlationId: trace.correlationId, requestId: trace.requestId, traceKind: trace.traceKind, sourceTraceId: trace.sourceTraceId, agentType: trace.agentType,
    appointmentId: trace.appointmentId, status: trace.status, startedAt: trace.startedAt,
    completedAt: trace.completedAt, createdAt: trace.createdAt, updatedAt: trace.updatedAt,
    errorCode: trace.errorCode, errorMessage: trace.errorMessage,
    appointment: trace.appointment ? { id: trace.appointment.id, status: trace.appointment.status, startAt: trace.appointment.startAt } : null,
    actor: trace.requestedBy ? { id: trace.requestedBy.id, role: trace.requestedBy.role, name: trace.requestedBy.fullName } : null,
    patient: trace.appointment?.patientId ? { id: trace.appointment.patientId, display: 'Patient' } : null,
    run: run ? {
      id: run.id, agentType: run.agentType, status: run.status, dedupeKey: run.dedupeKey,
      triggeredBy: run.triggeredBy, executionMode: run.input?.executionMode || 'live', summary: run.summary, plan: safePlan(run.plan), context: safeContext(run.context),
      startedAt: run.startedAt, completedAt: run.completedAt, createdAt: run.createdAt,
      actions: actions.map(safeAction),
      messageDrafts: (run.messageDrafts || []).map((draft) => ({ id: draft.id, version: draft.version, status: draft.status, languageCode: draft.languageCode, languageName: draft.languageName, languageScript: draft.languageScript, languageDirection: draft.languageDirection, languageSource: draft.languageSource, languageFallbackUsed: draft.languageFallbackUsed, notificationTitle: draft.notificationTitle, notificationBody: draft.notificationBody, generationSource: draft.generationSource, contentHash: String(draft.contentHash || '').slice(0, 12), approvedById: draft.approvedById, approvedAt: draft.approvedAt, deliveredAt: draft.deliveredAt })),
      executionSteps: (run.executionSteps || []).map((step) => ({ id: step.id, sequence: step.sequence, stepKey: step.stepKey, title: step.title, status: step.status, startedAt: step.startedAt, completedAt: step.completedAt, durationMs: step.durationMs, errorCode: step.errorCode }))
    } : null,
    events: (trace.events || []).map(safeEvent),
    integrity: historicalUnresolved ? { status: 'historical_unresolved', message: 'Original trace relationship was not recorded by the historical deployment.', requiresOperationalAction: false } : { status: invariantErrors.length ? 'inconsistent' : 'healthy', message: null, requiresOperationalAction: Boolean(invariantErrors.length) },
    presentation: {
      traceStatus: trace.status,
      outcome: trace.status === 'deduplicated' ? 'existing_run_reused' : trace.status,
      currentPhase: trace.status === 'awaiting_approval' ? 'approval' : trace.status === 'executing' ? 'execution' : null,
      isTerminal: ['completed', 'partially_completed', 'failed', 'deduplicated', 'cancelled'].includes(trace.status),
      requiresHumanAction: trace.status === 'awaiting_approval',
      linkedRunStatus: run?.status || null,
      model: run?.plan?.model || null,
      fallbackUsed: run?.plan?.fallbackUsed ?? null,
      pipeline: derivePipelineState({ trace, run, actions, events: trace.events || [] }),
      integrityStatus: historicalUnresolved ? 'historical_unresolved' : invariantErrors.length ? 'inconsistent' : 'healthy',
      invariantErrors
    }
  };
}

function parseLimit(value, fallback = 30) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 100) : fallback;
}

function parseCursor(value) {
  if (!value) return null;
  const [createdAt, id] = String(value).split('|');
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? null : { createdAt: date, id: id || null };
}

async function listTraces(req) {
  const limit = parseLimit(req.query.limit);
  const where = {};
  if (req.query.status) where.status = String(req.query.status);
  if (req.query.agentType) where.agentType = String(req.query.agentType);
  if (req.query.activeOnly === 'true') where.status = { in: ['active', 'awaiting_approval', 'executing'] };
  const cursor = parseCursor(req.query.after);
  if (cursor) where.OR = cursor.id
    ? [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }]
    : [{ createdAt: { lt: cursor.createdAt } }];
  const traces = await prisma.agentExecutionTrace.findMany({ where, take: limit + 1, orderBy: { createdAt: 'desc' }, include: TRACE_INCLUDE });
  const hasMore = traces.length > limit;
  const rows = traces.slice(0, limit).map(safeTrace);
  const last = rows[rows.length - 1];
  return { rows, nextCursor: hasMore && last ? `${new Date(last.createdAt).toISOString()}|${last.id}` : null };
}

async function overview() {
  const now = new Date();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const traces = await prisma.agentExecutionTrace.findMany({ where: { createdAt: { gte: dayStart } }, include: { run: { select: { plan: true, startedAt: true, completedAt: true } }, events: { select: { durationMs: true, phase: true, eventType: true } } } });
  const count = (status) => traces.filter((trace) => trace.status === status).length;
  const runs = traces.map((trace) => trace.run).filter(Boolean);
  const aiRuns = runs.filter((run) => run.plan && run.plan.fallbackUsed === false);
  const fallbackRuns = runs.filter((run) => run.plan && run.plan.fallbackUsed === true);
  const planningMetadata = runs.map((run) => run.plan?.aiMetadata).filter(Boolean);
  const firstAttemptSuccesses = planningMetadata.filter((meta) => meta.firstAttemptValid === true).length;
  const correctiveRetries = planningMetadata.filter((meta) => meta.correctiveRetryUsed === true);
  const retrySuccesses = correctiveRetries.filter((meta) => meta.fallbackUsed === false).length;
  const failureCount = (category) => planningMetadata.filter((meta) => meta.validationFailureCategory === category).length;
  const durations = runs.map((run) => new Date(run.completedAt || 0).getTime() - new Date(run.startedAt || 0).getTime()).filter((value) => value > 0);
  return {
    activeRuns: traces.filter((trace) => ['active', 'awaiting_approval', 'executing'].includes(trace.status)).length,
    awaitingApproval: count('awaiting_approval'), executing: count('executing'), completedToday: count('completed'),
    failedToday: count('failed'), partiallyCompletedToday: count('partially_completed'),
    realAiSuccessRate: runs.length ? Math.round((aiRuns.length / runs.length) * 100) : 0,
    fallbackRate: runs.length ? Math.round((fallbackRuns.length / runs.length) * 100) : 0,
    planningRequests: runs.length,
    firstAttemptAiSuccessCount: firstAttemptSuccesses,
    correctiveRetryCount: correctiveRetries.length,
    correctiveRetrySuccessCount: retrySuccesses,
    localizedFallbackCount: planningMetadata.filter((meta) => meta.finalGenerationSource === 'deterministic_localized_template').length,
    invalidJsonCount: failureCount('INVALID_JSON'),
    wrongLanguageCount: failureCount('wrong_language_or_script'),
    providerTimeoutCount: failureCount('PROVIDER_TIMEOUT'),
    providerHttpFailureCount: failureCount('PROVIDER_HTTP_ERROR'),
    averageTotalRunDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
    recentFailures: traces.filter((trace) => trace.status === 'failed').slice(-5).map((trace) => ({ id: trace.id, errorCode: trace.errorCode, errorMessage: trace.errorMessage }))
  };
}

const adminAgentsController = {
  realtimeToken: async (req, res) => {
    const supabase = createSupabaseExpressClient(req, res);
    const sessionResponse = await supabase.auth.getSession();
    if (sessionResponse.error || !sessionResponse.data?.session?.access_token) {
      return res.status(401).json({ ok: false, code: 'REALTIME_SESSION_UNAVAILABLE', error: 'Realtime session unavailable.' });
    }
    return res.json({ ok: true, url: getSupabaseUrl(), anonKey: getSupabaseAnonKey(), accessToken: sessionResponse.data.session.access_token });
  },
  overview: async (_req, res) => res.json({ ok: true, overview: await overview() }),
  traces: async (req, res) => res.json({ ok: true, ...(await listTraces(req)) }),
  trace: async (req, res) => {
    const trace = await prisma.agentExecutionTrace.findUnique({ where: { id: req.params.traceId }, include: TRACE_INCLUDE });
    if (!trace) return res.status(404).json({ ok: false, code: 'AGENT_TRACE_NOT_FOUND', error: 'Trace not found.' });
    return res.json({ ok: true, trace: safeTrace(trace) });
  },
  events: async (req, res) => {
    const where = {};
    if (req.params.traceId) where.traceId = req.params.traceId;
    const cursor = parseCursor(req.query.after);
    if (cursor) where.OR = cursor.id
      ? [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }]
      : [{ createdAt: { gt: cursor.createdAt } }];
    const rows = await prisma.agentExecutionEvent.findMany({ where, take: 250, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const last = rows.at(-1);
    return res.json({ ok: true, events: rows.map(safeEvent), nextCursor: last ? `${new Date(last.createdAt).toISOString()}|${last.id}` : req.query.after || null });
  },
  run: async (req, res) => {
    const trace = await prisma.agentExecutionTrace.findFirst({ where: { runId: req.params.runId, status: { not: 'deduplicated' } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: TRACE_INCLUDE });
    if (!trace) return res.status(404).json({ ok: false, code: 'AGENT_RUN_NOT_FOUND', error: 'Agent run not found.' });
    return res.json({ ok: true, trace: safeTrace(trace) });
  },
  approveAndRun: async (req, res) => {
    try {
      const run = await approveAndRunAgent({ runId: req.params.runId, actor: req.user, actionIds: Array.isArray(req.body?.actionIds) ? req.body.actionIds : [], executionMode: req.body?.executionMode || 'live' });
      return res.status(200).json({ ok: true, run });
    } catch (error) {
      return res.status(Number(error.status || 500)).json({ ok: false, code: error.code || 'AGENT_WORKFLOW_FAILED', error: error.message || 'Agent workflow failed.', ...(error.run ? { run: error.run } : {}) });
    }
  },
  metrics: async (req, res) => res.json({ ok: true, range: req.query.range || '24h', ...(await overview()) }),
  integrity: async (_req, res) => {
    const integrity = await findInconsistentAgentStates();
    const counts = Object.fromEntries(Object.entries(integrity).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0]));
    return res.json({ ok: true, integrity: { counts, samples: Object.fromEntries(Object.entries(integrity).map(([key, value]) => [key, Array.isArray(value) ? value.slice(0, 25) : []])) } });
  },
  reconcile: async (req, res) => res.json({ ok: true, result: await reconcileTrace(req.params.traceId, { dryRun: req.query.dryRun !== 'false' }) })
};

module.exports = { adminAgentsController, safeTrace, safeEvent, safePlan, safeContext, initials };
