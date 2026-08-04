const { prisma } = require('../models/db');
const { updateTrace, safeRecordAgentEvent } = require('./agent-observability.service');
const {
  AGENT_EVENT_DEFINITIONS,
  isTerminalTraceStatus,
  isTerminalRunStatus,
  validateTraceInvariants,
  validateRunInvariants,
  validateActionInvariants,
  isHistoricalUnresolvedTrace
} = require('./agent-state-machine.service');

const TRACE_INCLUDE = {
  run: { include: { actions: { orderBy: { createdAt: 'asc' } } } },
  events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }
};

function phaseIssues(events) {
  const grouped = new Map();
  for (const event of events || []) {
    if (!grouped.has(event.phase)) grouped.set(event.phase, []);
    grouped.get(event.phase).push(event);
  }
  return [...grouped.entries()]
    .filter(([, phaseEvents]) => phaseEvents.some((event) => event.status === 'started'))
    .filter(([, phaseEvents]) => !phaseEvents.some((event) => AGENT_EVENT_DEFINITIONS[event.eventType]?.terminalForPhase || ['completed', 'failed', 'skipped'].includes(event.status)))
    .map(([phase]) => phase);
}

function expectedTraceStatus(runStatus) {
  if (runStatus === 'completed') return 'completed';
  if (runStatus === 'partially_completed') return 'partially_completed';
  if (runStatus === 'failed') return 'failed';
  if (runStatus === 'cancelled') return 'cancelled';
  if (runStatus === 'executing') return 'executing';
  return 'awaiting_approval';
}

async function loadTrace(traceId) {
  return prisma.agentExecutionTrace.findUnique({ where: { id: traceId }, include: TRACE_INCLUDE });
}

function inspectTrace(trace) {
  const run = trace?.run;
  const historicalUnresolved = isHistoricalUnresolvedTrace(trace, run);
  const invariantErrors = validateTraceInvariants(trace, run, trace.events).filter((error) => !(historicalUnresolved && error === 'deduplicated_trace_missing_source_trace'));
  return {
    traceId: trace.id,
    traceStatus: trace.status,
    runId: trace.runId,
    invariantErrors,
    runInvariantErrors: run ? validateRunInvariants(run) : [],
    actionInvariantErrors: (run?.actions || []).flatMap((action) => validateActionInvariants(action).map((error) => ({ actionId: action.id, error }))),
    unmatchedPhases: phaseIssues(trace.events),
    stale: ['active', 'awaiting_approval', 'executing'].includes(trace.status) && Date.now() - new Date(trace.updatedAt).getTime() > 15 * 60 * 1000
  };
}

async function findInconsistentAgentStates() {
  const traces = await prisma.agentExecutionTrace.findMany({ include: TRACE_INCLUDE, orderBy: { createdAt: 'asc' } });
  const inspected = traces.map(inspectTrace);
  return {
    activeBeyondThreshold: inspected.filter((row) => row.stale),
    terminalMissingCompletedAt: inspected.filter((row) => isTerminalTraceStatus(row.traceStatus) && row.invariantErrors.includes('terminal_trace_missing_completedAt')),
    deduplicatedMissingRun: inspected.filter((row) => row.traceStatus === 'deduplicated' && row.invariantErrors.includes('deduplicated_trace_missing_run')),
    historicalUnresolved: inspected.filter((row) => isHistoricalUnresolvedTrace(traces.find((trace) => trace.id === row.traceId), traces.find((trace) => trace.id === row.traceId)?.run)),
    completedRunsWithUnfinishedActions: inspected.filter((row) => row.runInvariantErrors.includes('completed_run_has_unfinished_actions')),
    executingActionsBeyondThreshold: traces.flatMap((trace) => (trace.run?.actions || []).filter((action) => action.status === 'executing' && Date.now() - new Date(action.updatedAt).getTime() > 15 * 60 * 1000).map((action) => ({ traceId: trace.id, runId: trace.runId, actionId: action.id }))),
    unmatchedPhaseStarts: inspected.filter((row) => row.unmatchedPhases.length),
    contradictoryTraces: inspected.filter((row) => row.invariantErrors.length || row.runInvariantErrors.length || row.actionInvariantErrors.length)
  };
}

async function reconcileTrace(traceId, { dryRun = false } = {}) {
  const trace = await loadTrace(traceId);
  if (!trace) return { traceId, repaired: false, reason: 'not_found' };
  const report = inspectTrace(trace);
  const repairs = [];

  if (trace.status === 'deduplicated' && !trace.runId) {
    const runId = trace.events.find((event) => event.eventType === 'dedupe_hit' && event.runId)?.runId;
    if (runId) {
      const original = await prisma.agentExecutionTrace.findFirst({ where: { runId, id: { not: trace.id }, status: { not: 'deduplicated' } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } });
      repairs.push({ type: 'link_reused_run', runId, sourceTraceId: original?.id || null });
    }
  }
  if (trace.status === 'deduplicated' && trace.runId && !isHistoricalUnresolvedTrace(trace, trace.run) && (trace.traceKind !== 'deduplicated_request' || !trace.sourceTraceId)) {
    const original = await prisma.agentExecutionTrace.findFirst({ where: { runId: trace.runId, id: { not: trace.id }, status: { not: 'deduplicated' } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } });
    repairs.push({ type: 'classify_deduplicated_trace', sourceTraceId: trace.sourceTraceId || original?.id || null });
  }

  if (trace.run && isTerminalRunStatus(trace.run.status) && !isTerminalTraceStatus(trace.status)) {
    repairs.push({ type: 'align_trace_to_run', status: expectedTraceStatus(trace.run.status) });
  }

  if (!dryRun) {
    for (const repair of repairs) {
      if (repair.type === 'link_reused_run') {
        await prisma.agentExecutionTrace.update({ where: { id: trace.id }, data: { runId: repair.runId, sourceTraceId: repair.sourceTraceId, traceKind: 'deduplicated_request', status: 'deduplicated', completedAt: trace.completedAt || new Date() } });
      } else if (repair.type === 'classify_deduplicated_trace') {
        await prisma.agentExecutionTrace.update({ where: { id: trace.id }, data: { traceKind: 'deduplicated_request', sourceTraceId: repair.sourceTraceId, completedAt: trace.completedAt || new Date() } });
      } else if (repair.type === 'align_trace_to_run') {
        await updateTrace(trace.id, { status: repair.status, completedAt: trace.completedAt || (isTerminalTraceStatus(repair.status) ? new Date() : null) });
      }
      await safeRecordAgentEvent({ traceId: trace.id, runId: trace.runId, phase: 'system', eventType: 'state_reconciled', status: 'warning', title: 'Agent state reconciled', metadata: { status: repair.status || repair.type } });
    }
  }

  return { traceId, repaired: !dryRun && repairs.length > 0, repairs, issues: report };
}

async function repairSafeStateMismatches({ dryRun = true } = {}) {
  const traces = await prisma.agentExecutionTrace.findMany({ select: { id: true } });
  const results = [];
  for (const trace of traces) results.push(await reconcileTrace(trace.id, { dryRun }));
  return results.filter((result) => result.repairs?.length);
}

module.exports = { findInconsistentAgentStates, reconcileTrace, reconcileRun: reconcileTrace, repairSafeStateMismatches, inspectTrace, phaseIssues };
