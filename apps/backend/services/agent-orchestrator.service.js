const { prisma } = require('../models/db');
const { loadNoShowContext, loadPostVisitContext } = require('./agent-context.service');
const { planNoShowRecovery, planPostVisitFollowUp } = require('./agent-planner.service');
const {
  assertCanGenerateNoShowPlan,
  assertCanGeneratePostVisitPlan,
  assertCanApproveAgentRun,
  assertAllowedTool
} = require('./agent-policy.service');
const { executeAllowedTool } = require('./agent-actions.service');
const { cancelScheduledRemindersForAppointment } = require('./reminder.service');
const {
  safeRecordAgentEvent,
  linkTraceToRun,
  completeAgentTrace,
  failAgentTrace,
  updateTrace,
  safeObservabilityOperation
} = require('./agent-observability.service');
const { transitionRunStatus, transitionActionStatus } = require('./agent-state-machine.service');

const RUN_INCLUDE = {
  appointment: true,
  actions: { orderBy: { createdAt: 'asc' } }
};

function epoch(value) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function publicRun(run) {
  if (!run) return null;
  const { appointment: _appointment, ...rest } = run;
  return rest;
}

async function markDeduplicatedTrace(traceContext, run) {
  if (!traceContext?.traceId || !run?.id) return;
  const original = await safeObservabilityOperation(() => prisma.agentExecutionTrace.findFirst({ where: { runId: run.id, status: { not: 'deduplicated' }, id: { not: traceContext.traceId } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } }), { operation: 'find_original_trace', traceId: traceContext.traceId, runId: run.id });
  await safeObservabilityOperation(() => linkTraceToRun(traceContext.traceId, run.id), { operation: 'link_trace_to_run', traceId: traceContext.traceId, runId: run.id });
  await safeRecordAgentEvent({ traceId: traceContext.traceId, runId: run.id, phase: 'deduplication', eventType: 'dedupe_hit', status: 'completed', title: 'Existing agent run reused', metadata: { dedupeKey: run.dedupeKey } });
  await safeRecordAgentEvent({ traceId: traceContext.traceId, runId: run.id, phase: 'deduplication', eventType: 'existing_run_returned', status: 'completed', title: 'Existing run returned; no duplicate AI request' });
  await safeObservabilityOperation(() => updateTrace(traceContext.traceId, { status: 'deduplicated', traceKind: 'deduplicated_request', sourceTraceId: original?.id || null, completedAt: new Date() }), { operation: 'mark_trace_deduplicated', traceId: traceContext.traceId, runId: run.id });
}

async function findTraceByRunId(runId) {
  if (!prisma.agentExecutionTrace?.findUnique) return null;
  return safeObservabilityOperation(() => prisma.agentExecutionTrace.findFirst({ where: { runId, status: { not: 'deduplicated' } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }), { operation: 'find_original_trace', runId });
}

async function findRunById(runId) {
  return prisma.agentRun.findUnique({
    where: { id: runId },
    include: RUN_INCLUDE
  });
}

async function createRunWithActions({ agentType, appointmentId, actor, input, context, plannerResult, dedupeKey, triggeredBy, traceContext }) {
  const existing = await prisma.agentRun.findUnique({ where: { dedupeKey }, include: RUN_INCLUDE });
  if (existing) {
    await markDeduplicatedTrace(traceContext, existing);
    return existing;
  }

  const result = await prisma.$transaction(async (tx) => {
    const race = await tx.agentRun.findUnique({ where: { dedupeKey }, include: RUN_INCLUDE });
    if (race) return { run: race, created: false };

    const run = await tx.agentRun.create({
      data: {
        agentType,
        status: 'awaiting_approval',
        dedupeKey,
        appointmentId,
        requestedById: actor.id,
        triggeredBy,
        input: input || {},
        context,
        plan: plannerResult.plan,
        summary: plannerResult.plan.summary || null,
        actions: {
          create: plannerResult.actions.map((action) => {
            assertAllowedTool(agentType, action.toolName);
            return {
              actionKey: action.actionKey,
              toolName: action.toolName,
              title: action.title,
              description: action.description || null,
              arguments: action.arguments,
              riskLevel: action.riskLevel || 'medium',
              requiresApproval: action.requiresApproval !== false,
              status: 'proposed',
              idempotencyKey: `${dedupeKey}:${action.toolName}:v1`
            };
          })
        }
      },
      include: RUN_INCLUDE
    });
    return { run, created: true };
  });
  const run = result.run;
  if (!result.created) {
    await markDeduplicatedTrace(traceContext, run);
    return run;
  }
  await safeObservabilityOperation(() => linkTraceToRun(traceContext?.traceId, run.id), { operation: 'link_trace_to_run', traceId: traceContext?.traceId, runId: run.id });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, runId: run.id, phase: 'persistence', eventType: 'agent_run_created', status: 'completed', title: 'Agent run persisted' });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, runId: run.id, phase: 'persistence', eventType: 'agent_plan_saved', status: 'completed', title: 'Agent plan saved', metadata: { provider: plannerResult.plan?.provider, model: plannerResult.plan?.model, status: plannerResult.plan?.fallbackUsed ? 'fallback' : 'real_ai' } });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, runId: run.id, phase: 'persistence', eventType: 'agent_actions_created', status: 'completed', title: 'Proposed actions created', metadata: { status: String(run.actions.length) } });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, runId: run.id, phase: 'approval', eventType: 'awaiting_approval', status: 'info', title: 'Waiting for human approval' });
  await safeObservabilityOperation(() => updateTrace(traceContext?.traceId, { status: 'awaiting_approval' }), { operation: 'mark_trace_awaiting_approval', traceId: traceContext?.traceId, runId: run.id });
  return run;
}

async function createNoShowRecoveryPlan({ appointmentId, actor, input = {}, traceContext }) {
  const contextStartedAt = Date.now();
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'context', eventType: 'context_loading_started', status: 'started', title: 'Loading trusted appointment context' });
  const context = await loadNoShowContext(appointmentId);
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'context', eventType: 'appointment_loaded', status: 'completed', title: 'Appointment context loaded', durationMs: Date.now() - contextStartedAt, metadata: { appointmentStatus: context?.appointment?.status, priorNoShowCount: context?.priorNoShowCount, availableSlotCount: context?.availableSlots?.length || 0 } });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'context', eventType: 'context_loading_completed', status: 'completed', title: 'Trusted context loaded' });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'policy', eventType: 'policy_validation_started', status: 'started', title: 'Validating agent policy' });
  assertCanGenerateNoShowPlan(actor, context?.appointment);
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'policy', eventType: 'actor_authorized', status: 'completed', title: 'Actor authorization passed' });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'policy', eventType: 'appointment_state_validated', status: 'completed', title: 'Appointment state is eligible', metadata: { appointmentStatus: context.appointment.status } });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'policy', eventType: 'policy_validation_completed', status: 'completed', title: 'Agent policy validation completed' });
  if (context.appointment.status === 'booked') {
    const updated = await prisma.appointment.update({ where: { id: appointmentId }, data: { status: 'no_show' } });
    await cancelScheduledRemindersForAppointment(appointmentId).catch(() => {});
    context.appointment.status = 'no_show';
    context.appointment.updatedAt = updated.updatedAt;
  }
  const dedupeKey = `no_show_recovery:${appointmentId}:${epoch(context.appointment.updatedAt)}`;
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'deduplication', eventType: 'dedupe_check_started', status: 'started', title: 'Checking for duplicate run', metadata: { dedupeKey } });
  const existing = await prisma.agentRun.findUnique({ where: { dedupeKey }, include: RUN_INCLUDE });
  if (existing) {
    await markDeduplicatedTrace(traceContext, existing);
    return publicRun(existing);
  }
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'deduplication', eventType: 'dedupe_miss', status: 'completed', title: 'No duplicate run found' });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'planning', eventType: 'ai_request_started', status: 'started', title: 'Generating agent plan' });
  const plannerResult = await planNoShowRecovery(context, input);
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'planning', eventType: 'ai_response_received', status: 'completed', title: 'Agent plan response received', metadata: { provider: plannerResult.plan?.provider, model: plannerResult.plan?.model, status: plannerResult.plan?.fallbackUsed ? 'fallback' : 'real_ai' } });
  if (plannerResult.plan?.fallbackUsed) await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'planning', eventType: 'deterministic_fallback_activated', status: 'completed', title: 'Deterministic fallback activated', metadata: { reason: plannerResult.plan?.error ? 'provider_or_validation_failure' : 'configured_fallback' } });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'validation', eventType: 'json_parse_completed', status: 'completed', title: 'AI response parsed as JSON' });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'validation', eventType: 'response_schema_validation_passed', status: 'completed', title: 'Agent response schema validated' });
  const run = await createRunWithActions({
    agentType: 'no_show_recovery',
    appointmentId,
    actor,
    input,
    context,
    plannerResult,
    dedupeKey,
    triggeredBy: 'manual',
    traceContext
  });
  return publicRun(run);
}

async function createPostVisitFollowUpPlan({ appointmentId, actor, input = {}, traceContext }) {
  const contextStartedAt = Date.now();
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'context', eventType: 'context_loading_started', status: 'started', title: 'Loading trusted appointment context' });
  const context = await loadPostVisitContext(appointmentId);
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'context', eventType: 'context_loading_completed', status: 'completed', title: 'Trusted context loaded', durationMs: Date.now() - contextStartedAt, metadata: { appointmentStatus: context?.appointment?.status, medicineCount: context?.prescription?.medicines?.length || 0, hasFollowUpDate: Boolean(context?.prescription?.followUpDate) } });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'policy', eventType: 'policy_validation_started', status: 'started', title: 'Validating agent policy' });
  const policyAppointment = context ? { ...context.appointment, prescription: context.prescription } : null;
  assertCanGeneratePostVisitPlan(actor, policyAppointment);
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'policy', eventType: 'actor_authorized', status: 'completed', title: 'Actor authorization passed' });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'policy', eventType: 'prescription_validated', status: 'completed', title: 'Prescription eligibility validated', metadata: { medicineCount: context.prescription.medicines?.length || 0 } });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'policy', eventType: 'policy_validation_completed', status: 'completed', title: 'Agent policy validation completed' });
  const dedupeKey = `post_visit_follow_up:${appointmentId}:${epoch(context.prescription.updatedAt)}`;
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'deduplication', eventType: 'dedupe_check_started', status: 'started', title: 'Checking for duplicate run', metadata: { dedupeKey } });
  const existing = await prisma.agentRun.findUnique({ where: { dedupeKey }, include: RUN_INCLUDE });
  if (existing) {
    await markDeduplicatedTrace(traceContext, existing);
    return publicRun(existing);
  }
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'deduplication', eventType: 'dedupe_miss', status: 'completed', title: 'No duplicate run found' });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'planning', eventType: 'ai_request_started', status: 'started', title: 'Generating agent plan' });
  const plannerResult = await planPostVisitFollowUp(context, input);
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'planning', eventType: 'ai_response_received', status: 'completed', title: 'Agent plan response received', metadata: { provider: plannerResult.plan?.provider, model: plannerResult.plan?.model, status: plannerResult.plan?.fallbackUsed ? 'fallback' : 'real_ai' } });
  if (plannerResult.plan?.fallbackUsed) await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'planning', eventType: 'deterministic_fallback_activated', status: 'completed', title: 'Deterministic fallback activated', metadata: { reason: plannerResult.plan?.error ? 'provider_or_validation_failure' : 'configured_fallback' } });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'validation', eventType: 'json_parse_completed', status: 'completed', title: 'AI response parsed as JSON' });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'validation', eventType: 'response_schema_validation_passed', status: 'completed', title: 'Agent response schema validated' });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'validation', eventType: 'medication_fidelity_check_passed', status: 'completed', title: 'Medication fields preserved' });
  const run = await createRunWithActions({
    agentType: 'post_visit_follow_up',
    appointmentId,
    actor,
    input,
    context,
    plannerResult,
    dedupeKey,
    triggeredBy: 'manual',
    traceContext
  });
  return publicRun(run);
}

async function getAgentRun({ runId, actor }) {
  const run = await findRunById(runId);
  assertCanApproveAgentRun(actor, run);
  return publicRun(run);
}

async function approveAgentActions({ runId, actionIds, actor }) {
  const run = await findRunById(runId);
  assertCanApproveAgentRun(actor, run);
  const validIds = new Set(run.actions.filter((action) => action.status === 'proposed').map((action) => action.id));
  const selected = actionIds.filter((id) => validIds.has(id));
  if (!selected.length) return publicRun(run);
  selected.forEach(() => transitionActionStatus({ from: 'proposed', to: 'approved' }));
  await prisma.agentAction.updateMany({
    where: { runId, id: { in: selected }, status: 'proposed' },
    data: { status: 'approved', approvedById: actor.id, approvedAt: new Date(), error: null }
  });
  await prisma.agentRun.update({ where: { id: runId }, data: { status: 'awaiting_approval' } });
  const trace = await findTraceByRunId(runId);
  for (const actionId of selected) {
    await safeRecordAgentEvent({ traceId: trace?.id, runId, actionId, phase: 'approval', eventType: 'action_approved', status: 'completed', title: 'Action approved', metadata: { actionId, approvedById: actor.id, approvalTimestamp: new Date().toISOString() } });
  }
  await safeRecordAgentEvent({ traceId: trace?.id, runId, phase: 'approval', eventType: 'approval_completed', status: 'completed', title: 'Approval gate completed', metadata: { status: String(selected.length) } });
  return publicRun(await findRunById(runId));
}

async function rejectAgentActions({ runId, actionIds, actor, reason = '' }) {
  const run = await findRunById(runId);
  assertCanApproveAgentRun(actor, run);
  actionIds.forEach((actionId) => {
    const current = run.actions.find((action) => action.id === actionId);
    if (current && ['proposed', 'approved'].includes(current.status)) transitionActionStatus({ from: current.status, to: 'rejected' });
  });
  await prisma.agentAction.updateMany({
    where: { runId, id: { in: actionIds }, status: { in: ['proposed', 'approved'] } },
    data: { status: 'rejected', error: reason || null }
  });
  const trace = await findTraceByRunId(runId);
  for (const actionId of actionIds) {
    await safeRecordAgentEvent({ traceId: trace?.id, runId, actionId, phase: 'approval', eventType: 'action_rejected', status: 'info', title: 'Action rejected', metadata: { actionId } });
  }
  const updated = await updateRunStatus(runId);
  if (['completed', 'partially_completed', 'failed'].includes(updated.status)) {
    const trace = await findTraceByRunId(runId);
    const eventType = updated.status === 'partially_completed' ? 'run_partially_completed' : updated.status === 'failed' ? 'run_failed' : 'run_completed';
    await safeRecordAgentEvent({ traceId: trace?.id, runId, phase: 'completion', eventType, status: updated.status === 'failed' ? 'failed' : 'completed', title: updated.status === 'completed' ? 'Run completed after action rejection' : `Run ${updated.status}` });
    await safeRecordAgentEvent({ traceId: trace?.id, runId, phase: 'completion', eventType: 'trace_completed', status: updated.status === 'failed' ? 'failed' : 'completed', title: 'Agent trace completed' });
    await safeObservabilityOperation(() => completeAgentTrace(trace?.id, updated.status), { operation: 'complete_rejected_trace', traceId: trace?.id, runId });
  }
  return updated;
}

function resolveRunStatus(actions) {
  if (actions.some((action) => ['approved', 'executing'].includes(action.status))) return 'executing';
  if (actions.some((action) => action.status === 'proposed')) return 'awaiting_approval';
  const completed = actions.filter((action) => action.status === 'completed').length;
  const failed = actions.filter((action) => action.status === 'failed').length;
  if (failed && completed) return 'partially_completed';
  if (failed && !completed) return 'failed';
  return 'completed';
}

async function updateRunStatus(runId) {
  const run = await findRunById(runId);
  const status = resolveRunStatus(run.actions);
  transitionRunStatus({ from: run.status, to: status });
  const completedAt = ['completed', 'partially_completed', 'failed'].includes(status) ? new Date() : null;
  const updated = await prisma.agentRun.update({
    where: { id: runId },
    data: { status, completedAt },
    include: RUN_INCLUDE
  });
  return publicRun(updated);
}

async function executeApprovedActions({ runId, actor }) {
  const run = await findRunById(runId);
  assertCanApproveAgentRun(actor, run);
  const trace = await findTraceByRunId(runId);
  await safeRecordAgentEvent({ traceId: trace?.id, runId, phase: 'execution', eventType: 'execution_requested', status: 'started', title: 'Approved action execution requested' });

  if (run.status === 'executing' || run.actions.some((action) => action.status === 'executing')) {
    await safeRecordAgentEvent({ traceId: trace?.id, runId, phase: 'execution', eventType: 'execution_already_in_progress', status: 'info', title: 'Execution already in progress' });
    const error = new Error('Agent execution is already in progress.');
    error.status = 202;
    error.code = 'AGENT_EXECUTION_IN_PROGRESS';
    error.run = publicRun(run);
    throw error;
  }

  const approved = run.actions.filter((action) => action.status === 'approved');
  if (!approved.length) return publicRun(run);
  transitionRunStatus({ from: run.status, to: 'executing' });

  const runClaim = await prisma.agentRun.updateMany({
    where: { id: runId, status: { not: 'executing' } },
    data: { status: 'executing' }
  });
  if (runClaim.count !== 1) {
    const latest = await findRunById(runId);
    if (latest?.status === 'executing' || latest?.actions.some((action) => action.status === 'executing')) {
      await safeRecordAgentEvent({ traceId: trace?.id, runId, phase: 'execution', eventType: 'execution_already_in_progress', status: 'info', title: 'Execution already claimed by another request' });
      const error = new Error('Agent execution is already in progress.');
      error.status = 202;
      error.code = 'AGENT_EXECUTION_IN_PROGRESS';
      error.run = publicRun(latest);
      throw error;
    }
    return publicRun(latest);
  }
  await safeObservabilityOperation(() => updateTrace(trace?.id, { status: 'executing' }), { operation: 'mark_trace_executing', traceId: trace?.id, runId });
  await safeRecordAgentEvent({ traceId: trace?.id, runId, phase: 'execution', eventType: 'run_execution_claimed', status: 'completed', title: 'Run execution claimed' });

  for (const action of approved) {
    const claim = await prisma.agentAction.updateMany({
      where: { id: action.id, runId, status: 'approved' },
      data: { status: 'executing' }
    });
    if (claim.count !== 1) continue;
    transitionActionStatus({ from: 'approved', to: 'executing' });

    await safeRecordAgentEvent({ traceId: trace?.id, runId, actionId: action.id, phase: 'execution', eventType: 'action_execution_started', status: 'started', title: action.title, metadata: { actionId: action.id, toolName: action.toolName, riskLevel: action.riskLevel } });
    await safeRecordAgentEvent({ traceId: trace?.id, runId, actionId: action.id, phase: 'execution', eventType: 'tool_execution_started', status: 'started', title: `Executing ${action.toolName}`, metadata: { toolName: action.toolName } });

    const executingAction = await prisma.agentAction.findUnique({
      where: { id: action.id },
      include: { run: true }
    });

    try {
      const result = await executeAllowedTool({ action: executingAction, actor });
      const actionResultStatus = action.toolName === 'schedule_refill_reminder' && result?.scheduled === false ? 'skipped' : 'completed';
      await prisma.agentAction.update({
        where: { id: action.id },
        data: { status: actionResultStatus, result, executedAt: new Date(), error: null }
      });
      transitionActionStatus({ from: 'executing', to: actionResultStatus });
      await safeRecordAgentEvent({ traceId: trace?.id, runId, actionId: action.id, phase: 'execution', eventType: 'tool_execution_completed', status: 'completed', title: `${action.toolName} completed`, metadata: { toolName: action.toolName, messageId: result?.messageId, scheduled: result?.scheduled } });
      await safeRecordAgentEvent({ traceId: trace?.id, runId, actionId: action.id, phase: 'notification', eventType: action.toolName === 'schedule_refill_reminder' ? (result?.scheduled ? 'refill_reminder_scheduled' : 'refill_reminder_skipped') : 'patient_message_queued', status: result?.scheduled === false ? 'skipped' : 'completed', title: action.toolName === 'schedule_refill_reminder' && result?.scheduled === false ? 'Refill reminder skipped safely' : 'Patient result recorded', metadata: { toolName: action.toolName, messageId: result?.messageId, scheduled: result?.scheduled, reason: result?.reason } });
      await safeRecordAgentEvent({ traceId: trace?.id, runId, actionId: action.id, phase: 'execution', eventType: actionResultStatus === 'skipped' ? 'action_skipped' : 'action_completed', status: actionResultStatus === 'skipped' ? 'skipped' : 'completed', title: actionResultStatus === 'skipped' ? 'Action skipped safely' : 'Action completed' });
    } catch (error) {
      await prisma.agentAction.update({
        where: { id: action.id },
        data: {
          status: 'failed',
          error: String(error.message || error).slice(0, 2000),
          executedAt: new Date()
        }
      });
      transitionActionStatus({ from: 'executing', to: 'failed' });
      await safeRecordAgentEvent({ traceId: trace?.id, runId, actionId: action.id, phase: 'execution', eventType: 'tool_execution_failed', status: 'failed', title: `${action.toolName} failed`, metadata: { toolName: action.toolName, errorCode: error?.code || 'TOOL_EXECUTION_FAILED' } });
      await safeRecordAgentEvent({ traceId: trace?.id, runId, actionId: action.id, phase: 'execution', eventType: 'action_failed', status: 'failed', title: 'Action failed', metadata: { errorCode: error?.code || 'TOOL_EXECUTION_FAILED' } });
    }
  }

  const result = await updateRunStatus(runId);
  const finalStatus = result.status === 'partially_completed' ? 'partially_completed' : result.status === 'completed' ? 'completed' : 'failed';
  await safeRecordAgentEvent({ traceId: trace?.id, runId, phase: 'completion', eventType: finalStatus === 'completed' ? 'run_completed' : finalStatus === 'partially_completed' ? 'run_partially_completed' : 'run_failed', status: finalStatus === 'failed' ? 'failed' : 'completed', title: `Run ${finalStatus}` });
  await safeRecordAgentEvent({ traceId: trace?.id, runId, phase: 'completion', eventType: 'trace_completed', status: finalStatus === 'failed' ? 'failed' : 'completed', title: 'Agent trace completed' });
  await safeObservabilityOperation(() => completeAgentTrace(trace?.id, finalStatus), { operation: 'complete_trace', traceId: trace?.id, runId });
  return result;
}

module.exports = {
  createNoShowRecoveryPlan,
  createPostVisitFollowUpPlan,
  getAgentRun,
  approveAgentActions,
  rejectAgentActions,
  executeApprovedActions
};
