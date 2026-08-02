const { prisma } = require('../models/db');
const { createSupabaseExpressClient, getSupabaseAnonKey, getSupabaseUrl } = require('../services/supabase-auth.service');

const TRACE_INCLUDE = {
  appointment: { select: { id: true, status: true, doctorId: true, patientId: true, startAt: true } },
  requestedBy: { select: { id: true, role: true, fullName: true } },
  run: { include: { actions: { orderBy: { createdAt: 'asc' } } } },
  events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }
};

function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || '?';
}

function safePlan(plan) {
  if (!plan || typeof plan !== 'object') return null;
  const allowed = ['summary', 'patientMessage', 'patientFriendlySummary', 'medicationExplanation', 'nextSteps', 'warningSigns', 'rationale', 'safetyNotes', 'model', 'provider', 'fallbackUsed', 'aiMetadata'];
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
    hasFollowUpDate: Boolean(prescription.followUpDate)
  };
}

function safeAction(action) {
  if (!action) return null;
  return {
    id: action.id, actionKey: action.actionKey, toolName: action.toolName, title: action.title,
    description: action.description, riskLevel: action.riskLevel, requiresApproval: action.requiresApproval,
    status: action.status, approvedById: action.approvedById, approvedAt: action.approvedAt,
    executedAt: action.executedAt, result: action.result || null, error: action.error || null,
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
  return {
    id: trace.id, correlationId: trace.correlationId, requestId: trace.requestId, agentType: trace.agentType,
    appointmentId: trace.appointmentId, status: trace.status, startedAt: trace.startedAt,
    completedAt: trace.completedAt, createdAt: trace.createdAt, updatedAt: trace.updatedAt,
    errorCode: trace.errorCode, errorMessage: trace.errorMessage,
    appointment: trace.appointment ? { id: trace.appointment.id, status: trace.appointment.status, startAt: trace.appointment.startAt } : null,
    actor: trace.requestedBy ? { id: trace.requestedBy.id, role: trace.requestedBy.role, name: trace.requestedBy.fullName } : null,
    patient: trace.appointment?.patientId ? { id: trace.appointment.patientId, display: 'Patient' } : null,
    run: run ? {
      id: run.id, agentType: run.agentType, status: run.status, dedupeKey: run.dedupeKey,
      triggeredBy: run.triggeredBy, summary: run.summary, plan: safePlan(run.plan), context: safeContext(run.context),
      startedAt: run.startedAt, completedAt: run.completedAt, createdAt: run.createdAt,
      actions: (run.actions || []).map(safeAction)
    } : null,
    events: (trace.events || []).map(safeEvent)
  };
}

function parseLimit(value, fallback = 30) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 100) : fallback;
}

async function listTraces(req) {
  const limit = parseLimit(req.query.limit);
  const where = {};
  if (req.query.status) where.status = String(req.query.status);
  if (req.query.agentType) where.agentType = String(req.query.agentType);
  if (req.query.activeOnly === 'true') where.status = { in: ['active', 'awaiting_approval', 'executing'] };
  if (req.query.after) where.createdAt = { lt: new Date(String(req.query.after)) };
  const traces = await prisma.agentExecutionTrace.findMany({ where, take: limit + 1, orderBy: { createdAt: 'desc' }, include: TRACE_INCLUDE });
  const hasMore = traces.length > limit;
  const rows = traces.slice(0, limit).map(safeTrace);
  return { rows, nextCursor: hasMore ? rows[rows.length - 1].createdAt : null };
}

async function overview() {
  const now = new Date();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const traces = await prisma.agentExecutionTrace.findMany({ where: { createdAt: { gte: dayStart } }, include: { run: { select: { plan: true, startedAt: true, completedAt: true } }, events: { select: { durationMs: true, phase: true, eventType: true } } } });
  const count = (status) => traces.filter((trace) => trace.status === status).length;
  const runs = traces.map((trace) => trace.run).filter(Boolean);
  const aiRuns = runs.filter((run) => run.plan && run.plan.fallbackUsed === false);
  const fallbackRuns = runs.filter((run) => run.plan && run.plan.fallbackUsed === true);
  const durations = runs.map((run) => new Date(run.completedAt || 0).getTime() - new Date(run.startedAt || 0).getTime()).filter((value) => value > 0);
  return {
    activeRuns: traces.filter((trace) => ['active', 'awaiting_approval', 'executing'].includes(trace.status)).length,
    awaitingApproval: count('awaiting_approval'), executing: count('executing'), completedToday: count('completed'),
    failedToday: count('failed'), partiallyCompletedToday: count('partially_completed'),
    realAiSuccessRate: runs.length ? Math.round((aiRuns.length / runs.length) * 100) : 0,
    fallbackRate: runs.length ? Math.round((fallbackRuns.length / runs.length) * 100) : 0,
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
    if (req.query.after) where.createdAt = { gt: new Date(String(req.query.after)) };
    const rows = await prisma.agentExecutionEvent.findMany({ where, take: 250, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    return res.json({ ok: true, events: rows.map(safeEvent), nextCursor: rows.length ? rows[rows.length - 1].createdAt : req.query.after || null });
  },
  run: async (req, res) => {
    const trace = await prisma.agentExecutionTrace.findUnique({ where: { runId: req.params.runId }, include: TRACE_INCLUDE });
    if (!trace) return res.status(404).json({ ok: false, code: 'AGENT_RUN_NOT_FOUND', error: 'Agent run not found.' });
    return res.json({ ok: true, trace: safeTrace(trace) });
  },
  metrics: async (req, res) => res.json({ ok: true, range: req.query.range || '24h', ...(await overview()) })
};

module.exports = { adminAgentsController, safeTrace, safeEvent, safePlan, safeContext, initials };
