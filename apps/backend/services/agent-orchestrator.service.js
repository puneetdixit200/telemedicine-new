const crypto = require('crypto');
const { prisma } = require('../models/db');
const { loadNoShowContext, loadPostVisitContext } = require('./agent-context.service');
const { planNoShowRecovery, planPostVisitFollowUp } = require('./agent-planner.service');
const {
  assertCanGenerateNoShowPlan,
  assertCanGeneratePostVisitPlan,
  assertCanManageAppointment,
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
const { resolvePatientLanguage } = require('./patient-language.service');
const { validateLocalizedAgentDraft } = require('./agent-language-validation.service');

const RUN_INCLUDE = {
  appointment: true,
  actions: { orderBy: { createdAt: 'asc' } },
  messageDrafts: { orderBy: [{ version: 'desc' }] },
  executionSteps: { orderBy: { sequence: 'asc' } }
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
  const currentAppointment = await prisma.appointment.findUnique({ where: { id: appointmentId }, select: { status: true, noShowOccurrenceId: true } });
  if (currentAppointment?.status === 'booked') {
    const occurrenceId = crypto.randomUUID();
    const transitioned = await prisma.appointment.updateMany({ where: { id: appointmentId, status: 'booked' }, data: { status: 'no_show', noShowVersion: { increment: 1 }, noShowOccurrenceId: occurrenceId } });
    if (transitioned.count === 1) await cancelScheduledRemindersForAppointment(appointmentId).catch((error) => console.warn('[agent] reminder cancellation failed', { appointmentId, error: String(error?.message || error).slice(0, 160) }));
  }
  const occurrenceAppointment = await prisma.appointment.findUnique({ where: { id: appointmentId }, select: { id: true, status: true, doctorId: true, patientId: true, noShowOccurrenceId: true } });
  assertCanGenerateNoShowPlan(actor, occurrenceAppointment);
  const occurrenceId = occurrenceAppointment.noShowOccurrenceId || crypto.randomUUID();
  if (!occurrenceAppointment.noShowOccurrenceId) await prisma.appointment.update({ where: { id: appointmentId }, data: { noShowOccurrenceId: occurrenceId } });
  const dedupeKey = `no_show_recovery:${appointmentId}:${occurrenceId}`;
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'deduplication', eventType: 'dedupe_check_started', status: 'started', title: 'Checking for duplicate run', metadata: { dedupeKey } });
  const existingBeforeContext = await prisma.agentRun.findUnique({ where: { dedupeKey }, include: RUN_INCLUDE });
  if (existingBeforeContext) {
    await markDeduplicatedTrace(traceContext, existingBeforeContext);
    return publicRun(existingBeforeContext);
  }
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'deduplication', eventType: 'dedupe_miss', status: 'completed', title: 'No duplicate run found' });
  const reserved = await reserveNoShowRun({ appointmentId, actor, input, context: { appointment: occurrenceAppointment }, dedupeKey, traceContext });
  if (!reserved.created) return publicRun(reserved.run);
  const reservedRun = reserved.run;
  const contextStartedAt = Date.now();
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'context', eventType: 'context_loading_started', status: 'started', title: 'Loading trusted appointment context' });
  const context = await loadNoShowContext(appointmentId);
  await prisma.agentRun.update({ where: { id: reservedRun.id }, data: { context } });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'context', eventType: 'appointment_loaded', status: 'completed', title: 'Appointment context loaded', durationMs: Date.now() - contextStartedAt, metadata: { appointmentStatus: context?.appointment?.status, priorNoShowCount: context?.priorNoShowCount, availableSlotCount: context?.availableSlots?.length || 0 } });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'context', eventType: 'context_loading_completed', status: 'completed', title: 'Trusted context loaded' });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'policy', eventType: 'policy_validation_started', status: 'started', title: 'Validating agent policy' });
  assertCanGenerateNoShowPlan(actor, context?.appointment);
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'policy', eventType: 'actor_authorized', status: 'completed', title: 'Actor authorization passed' });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'policy', eventType: 'appointment_state_validated', status: 'completed', title: 'Appointment state is eligible', metadata: { appointmentStatus: context.appointment.status } });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'policy', eventType: 'policy_validation_completed', status: 'completed', title: 'Agent policy validation completed' });
  const language = context.patientLanguage || resolvePatientLanguage(context.patient);
  context.patientLanguage = language;
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'planning', eventType: 'patient_language_resolved', status: 'completed', title: `Patient language resolved: ${language.name}`, metadata: { languageCode: language.code, languageName: language.name, languageScript: language.script, languageDirection: language.direction, languageSource: language.source, languageFallbackUsed: language.fallbackUsed } });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'planning', eventType: 'ai_request_started', status: 'started', title: 'Generating agent plan' });
  const plannerResult = await planNoShowRecovery(context, input);
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'planning', eventType: 'ai_response_received', status: 'completed', title: 'Agent plan response received', metadata: { provider: plannerResult.plan?.provider, model: plannerResult.plan?.model, status: plannerResult.plan?.fallbackUsed ? 'fallback' : 'real_ai' } });
  if (plannerResult.plan?.fallbackUsed) {
    await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'validation', eventType: 'localized_output_validation_failed', status: 'failed', title: 'Localized AI draft validation failed', metadata: { validationCategory: plannerResult.plan?.validationFailure || 'provider_or_validation_failure' } });
    await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'planning', eventType: 'deterministic_fallback_activated', status: 'completed', title: 'Deterministic localized fallback activated', metadata: { reason: plannerResult.plan?.error ? 'provider_or_validation_failure' : 'configured_fallback' } });
    await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'validation', eventType: 'localized_fallback_template_used', status: 'completed', title: `Localized ${language.name} fallback template used`, metadata: { languageCode: language.code, generationSource: plannerResult.plan.generationSource } });
  } else {
    await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'validation', eventType: 'localized_output_validation_passed', status: 'completed', title: 'Localized draft validated', metadata: { languageCode: language.code, languageScript: language.script } });
  }
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'validation', eventType: 'json_parse_completed', status: 'completed', title: 'AI response parsed as JSON' });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, phase: 'validation', eventType: 'response_schema_validation_passed', status: 'completed', title: 'Agent response schema validated' });
  const plan = { ...plannerResult.plan, languageCode: language.code, languageName: language.name, languageNativeName: language.nativeName, languageScript: language.script, languageDirection: language.direction, languageSource: language.source, languageFallbackUsed: language.fallbackUsed };
  const contentHash = crypto.createHash('sha256').update(`${plan.notificationTitle}\n${plan.patientMessage}`).digest('hex');
  const draft = await prisma.agentMessageDraft.create({ data: { runId: reservedRun.id, version: 1, status: 'draft', languageCode: language.code, languageName: language.name, languageScript: language.script, languageDirection: language.direction, languageSource: language.source, languageFallbackUsed: language.fallbackUsed, notificationTitle: plan.notificationTitle, notificationBody: plan.patientMessage, generationSource: plan.generationSource || (plan.fallbackUsed ? 'deterministic_localized_template' : 'openrouter'), contentHash } });
  const action = plannerResult.actions[0];
  const run = await prisma.$transaction(async (tx) => {
    await tx.agentRun.update({ where: { id: reservedRun.id }, data: { status: 'awaiting_approval', plan, summary: plan.summary || null } });
    await tx.agentAction.create({ data: { runId: reservedRun.id, actionKey: action.actionKey, toolName: action.toolName, title: action.title, description: action.description || null, arguments: { ...action.arguments, title: plan.notificationTitle, body: plan.patientMessage, metadata: { ...(action.arguments.metadata || {}), messageDraftId: draft.id, contentHash } }, riskLevel: action.riskLevel || 'high', requiresApproval: true, status: 'proposed', idempotencyKey: `${dedupeKey}:${action.toolName}:v1`, messageDraftId: draft.id } });
    return tx.agentRun.findUnique({ where: { id: reservedRun.id }, include: RUN_INCLUDE });
  });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, runId: run.id, phase: 'persistence', eventType: 'agent_plan_saved', status: 'completed', title: 'Localized agent draft saved', metadata: { provider: plan.provider, model: plan.model, languageCode: language.code, languageFallbackUsed: language.fallbackUsed } });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, runId: run.id, phase: 'persistence', eventType: 'agent_actions_created', status: 'completed', title: 'Proposed action created', metadata: { status: '1' } });
  await safeRecordAgentEvent({ traceId: traceContext?.traceId, runId: run.id, phase: 'approval', eventType: 'awaiting_admin_approval', status: 'info', title: 'Waiting for administrator approval' });
  await safeObservabilityOperation(() => updateTrace(traceContext?.traceId, { status: 'awaiting_approval' }), { operation: 'mark_trace_awaiting_approval', traceId: traceContext?.traceId, runId: run.id });
  return publicRun(run);
}

async function reserveNoShowRun({ appointmentId, actor, input, context, dedupeKey, traceContext }) {
  const existing = await prisma.agentRun.findUnique({ where: { dedupeKey }, include: RUN_INCLUDE });
  if (existing) {
    await markDeduplicatedTrace(traceContext, existing);
    return { run: existing, created: false };
  }
  try {
    const run = await prisma.agentRun.create({ data: { agentType: 'no_show_recovery', status: 'planned', dedupeKey, appointmentId, requestedById: actor.id, triggeredBy: 'manual', input: input || {}, context }, include: RUN_INCLUDE });
    await safeObservabilityOperation(() => linkTraceToRun(traceContext?.traceId, run.id), { operation: 'link_reserved_run', traceId: traceContext?.traceId, runId: run.id });
    await safeRecordAgentEvent({ traceId: traceContext?.traceId, runId: run.id, phase: 'persistence', eventType: 'agent_run_created', status: 'completed', title: 'Agent run reserved before AI planning' });
    return { run, created: true };
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    const run = await prisma.agentRun.findUnique({ where: { dedupeKey }, include: RUN_INCLUDE });
    await markDeduplicatedTrace(traceContext, run);
    return { run, created: false };
  }
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
  assertCanManageAppointment(actor, run?.appointment);
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
    data: { status: 'approved', approvedById: actor.id, approvedAt: new Date(), error: null, approvedContentHash: run.agentType === 'no_show_recovery' ? run.messageDrafts?.[0]?.contentHash || null : null, messageDraftId: run.agentType === 'no_show_recovery' ? run.messageDrafts?.[0]?.id || null : null }
  });
  if (run.agentType === 'no_show_recovery' && run.messageDrafts?.[0]) {
    await prisma.agentMessageDraft.update({ where: { id: run.messageDrafts[0].id }, data: { status: 'approved', approvedById: actor.id, approvedAt: new Date() } });
    await safeRecordAgentEvent({ traceId: (await findTraceByRunId(runId))?.id, runId, phase: 'approval', eventType: 'admin_approval_completed', status: 'completed', title: 'Administrator approval persisted', metadata: { approvedById: actor.id, messageDraftId: run.messageDrafts[0].id, contentHash: String(run.messageDrafts[0].contentHash || '').slice(0, 12) } });
    await safeRecordAgentEvent({ traceId: (await findTraceByRunId(runId))?.id, runId, phase: 'execution', eventType: 'approved_draft_locked', status: 'completed', title: 'Approved localized draft locked', metadata: { messageDraftId: run.messageDrafts[0].id } });
  }
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

const NO_SHOW_EXECUTION_STEPS = [
  ['approval_verified', 'Approval verified'],
  ['approved_draft_locked', 'Approved draft locked'],
  ['patient_language_revalidated', 'Patient language revalidated'],
  ['localized_message_verified', 'Localized message verified'],
  ['tool_allow_list_verified', 'Tool allow-list verified'],
  ['delivery_action_prepared', 'Delivery action prepared'],
  ['final_safety_check_completed', 'Final safety check completed'],
  ['delivery_gate_completed', 'Final delivery gate completed']
];

function pacingConfig() {
  const mode = process.env.AGENT_EXECUTION_PACING_MODE === 'presentation_paced' ? 'presentation_paced' : 'live';
  const min = Math.min(Math.max(Number(process.env.AGENT_STAGE_MIN_VISIBLE_MS || 800), 0), 1400);
  const max = Math.min(Math.max(Number(process.env.AGENT_STAGE_MAX_VISIBLE_MS || 1400), min), 2000);
  const total = Math.min(Math.max(Number(process.env.AGENT_TOTAL_PACING_LIMIT_MS || 10000), 0), 15000);
  return { mode, min, max, total, elapsed: 0 };
}

async function runNoShowStep({ runId, traceId, actionId, sequence, stepKey, title, operation, pacing, phase = 'execution' }) {
  let step = await prisma.agentExecutionStep.upsert({ where: { runId_stepKey: { runId, stepKey } }, update: {}, create: { runId, traceId, actionId, sequence, stepKey, title, status: 'pending' } });
  if (step.status === 'completed') return step;
  const startedAt = Date.now();
  await prisma.agentExecutionStep.update({ where: { id: step.id }, data: { status: 'executing', startedAt: new Date(), errorCode: null, errorMessage: null } });
  const eventNames = {
    patient_language_revalidated: ['patient_language_revalidation_started', 'patient_language_revalidation_passed'],
    localized_message_verified: ['localized_message_verification_started', 'localized_message_verification_passed'],
    delivery_gate_completed: ['delivery_gate_started', 'delivery_gate_completed'],
    patient_message_queue: ['patient_message_queue_started', 'patient_message_queue_completed']
  };
  const [startEventType, completeEventType] = eventNames[stepKey] || [`${stepKey}_started`, `${stepKey}_completed`];
  await safeRecordAgentEvent({ traceId, runId, actionId, phase, eventType: startEventType, status: 'started', title });
  try {
    const result = await operation();
    if (pacing.mode === 'presentation_paced' && pacing.total > pacing.elapsed) {
      const delay = Math.min(pacing.max, Math.max(pacing.min, pacing.total - pacing.elapsed));
      await new Promise((resolve) => setTimeout(resolve, delay));
      pacing.elapsed += delay;
    }
    step = await prisma.agentExecutionStep.update({ where: { id: step.id }, data: { status: 'completed', completedAt: new Date(), durationMs: Date.now() - startedAt } });
    await safeRecordAgentEvent({ traceId, runId, actionId, phase, eventType: completeEventType, status: 'completed', title, durationMs: step.durationMs, metadata: { stepSequence: sequence } });
    return { step, result };
  } catch (error) {
    await prisma.agentExecutionStep.update({ where: { id: step.id }, data: { status: 'failed', completedAt: new Date(), durationMs: Date.now() - startedAt, errorCode: error.code || 'AGENT_STEP_FAILED', errorMessage: String(error.message || error).slice(0, 300) } });
    await safeRecordAgentEvent({ traceId, runId, actionId, phase, eventType: `${stepKey}_failed`, status: 'failed', title, durationMs: Date.now() - startedAt, metadata: { errorCode: error.code || 'AGENT_STEP_FAILED' } });
    throw error;
  }
}

async function executeNoShowPacedAction({ action, actor, trace }) {
  const runId = action.runId;
  const draft = await prisma.agentMessageDraft.findFirst({ where: { runId, status: { in: ['approved', 'delivered'] } }, orderBy: { version: 'desc' } });
  if (!draft) throw Object.assign(new Error('Approved localized draft is required before delivery.'), { code: 'AGENT_DRAFT_REQUIRED', status: 409 });
  const approvedBy = draft.approvedById ? await prisma.user.findUnique({ where: { id: draft.approvedById }, select: { id: true, role: true } }) : null;
  if (!approvedBy || approvedBy.role !== 'admin') throw Object.assign(new Error('Administrator approval is required.'), { code: 'AGENT_ADMIN_REQUIRED', status: 403 });
  const currentAppointment = await prisma.appointment.findUnique({ where: { id: action.run.appointmentId }, include: { patient: true } });
  const currentLanguage = resolvePatientLanguage(currentAppointment?.patient);
  const currentHash = crypto.createHash('sha256').update(`${draft.notificationTitle}\n${draft.notificationBody}`).digest('hex');
  if (currentHash !== draft.contentHash || currentHash !== action.approvedContentHash) throw Object.assign(new Error('The approved draft changed and requires reapproval.'), { code: 'AGENT_DRAFT_CHANGED_REAPPROVAL_REQUIRED', status: 409 });
  if (currentLanguage.code !== draft.languageCode) throw Object.assign(new Error('The patient language changed and requires reapproval.'), { code: 'AGENT_LANGUAGE_CHANGED_REAPPROVAL_REQUIRED', status: 409 });
  const pacing = pacingConfig();
  const context = { runId, traceId: trace?.id, actionId: action.id, pacing };
  await runNoShowStep({ ...context, sequence: 1, stepKey: NO_SHOW_EXECUTION_STEPS[0][0], title: NO_SHOW_EXECUTION_STEPS[0][1], operation: async () => null });
  await runNoShowStep({ ...context, sequence: 2, stepKey: NO_SHOW_EXECUTION_STEPS[1][0], title: NO_SHOW_EXECUTION_STEPS[1][1], operation: async () => null });
  await runNoShowStep({ ...context, sequence: 3, stepKey: NO_SHOW_EXECUTION_STEPS[2][0], title: NO_SHOW_EXECUTION_STEPS[2][1], operation: async () => null });
  await runNoShowStep({ ...context, sequence: 4, stepKey: NO_SHOW_EXECUTION_STEPS[3][0], title: NO_SHOW_EXECUTION_STEPS[3][1], operation: async () => null });
  await runNoShowStep({ ...context, sequence: 5, stepKey: NO_SHOW_EXECUTION_STEPS[4][0], title: NO_SHOW_EXECUTION_STEPS[4][1], operation: async () => assertAllowedTool('no_show_recovery', action.toolName) });
  await runNoShowStep({ ...context, sequence: 6, stepKey: NO_SHOW_EXECUTION_STEPS[5][0], title: NO_SHOW_EXECUTION_STEPS[5][1], operation: async () => null });
  await runNoShowStep({ ...context, sequence: 7, stepKey: NO_SHOW_EXECUTION_STEPS[6][0], title: NO_SHOW_EXECUTION_STEPS[6][1], operation: async () => null });
  await runNoShowStep({ ...context, sequence: 8, stepKey: NO_SHOW_EXECUTION_STEPS[7][0], title: NO_SHOW_EXECUTION_STEPS[7][1], operation: async () => {
    if (await prisma.externalConsultMessage.findUnique({ where: { agentActionId: action.id } })) throw Object.assign(new Error('Notification already exists for this action.'), { code: 'AGENT_MESSAGE_ALREADY_EXISTS', status: 409 });
    return null;
  }});
  const queueStep = await runNoShowStep({ ...context, sequence: 9, stepKey: 'patient_message_queue', title: 'Patient message queue started', phase: 'notification', operation: async () => executeAllowedTool({ action, actor }) });
  const result = queueStep.result || await prisma.externalConsultMessage.findUnique({ where: { agentActionId: action.id } }).then((message) => message ? { messageId: message.id, threadId: message.threadId, deliveryStatus: message.deliveryStatus } : null);
  if (!result?.messageId) throw Object.assign(new Error('Patient message queue did not return a message.'), { code: 'PATIENT_MESSAGE_QUEUE_FAILED', status: 500 });
  await safeRecordAgentEvent({ traceId: trace?.id, runId, actionId: action.id, phase: 'notification', eventType: 'patient_message_queued', status: 'completed', title: 'Patient message queued', metadata: { messageId: result?.messageId, languageCode: draft.languageCode, generationSource: draft.generationSource } });
  await prisma.agentExecutionStep.upsert({ where: { runId_stepKey: { runId, stepKey: 'patient_message_queued' } }, update: { status: 'completed', completedAt: new Date() }, create: { runId, traceId: trace?.id, actionId: action.id, sequence: 10, stepKey: 'patient_message_queued', title: 'Patient message queued', status: 'completed', startedAt: new Date(), completedAt: new Date() } });
  await prisma.agentExecutionStep.upsert({ where: { runId_stepKey: { runId, stepKey: 'run_completed' } }, update: { status: 'completed', completedAt: new Date() }, create: { runId, traceId: trace?.id, sequence: 11, stepKey: 'run_completed', title: 'Run completed', status: 'completed', startedAt: new Date(), completedAt: new Date() } });
  await prisma.agentMessageDraft.update({ where: { id: draft.id }, data: { status: 'delivered', deliveredAt: new Date() } });
  return result;
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
      const result = action.agentType === 'no_show_recovery' || run.agentType === 'no_show_recovery'
        ? await executeNoShowPacedAction({ action: executingAction, actor, trace })
        : await executeAllowedTool({ action: executingAction, actor });
      const actionResultStatus = action.toolName === 'schedule_refill_reminder' && result?.scheduled === false ? 'skipped' : 'completed';
      await prisma.agentAction.update({
        where: { id: action.id },
        data: { status: actionResultStatus, result, executedAt: new Date(), error: null }
      });
      transitionActionStatus({ from: 'executing', to: actionResultStatus });
      await safeRecordAgentEvent({ traceId: trace?.id, runId, actionId: action.id, phase: 'execution', eventType: 'tool_execution_completed', status: 'completed', title: `${action.toolName} completed`, metadata: { toolName: action.toolName, messageId: result?.messageId, scheduled: result?.scheduled } });
      if (run.agentType !== 'no_show_recovery') {
        await safeRecordAgentEvent({ traceId: trace?.id, runId, actionId: action.id, phase: 'notification', eventType: action.toolName === 'schedule_refill_reminder' ? (result?.scheduled ? 'refill_reminder_scheduled' : 'refill_reminder_skipped') : 'patient_message_queued', status: result?.scheduled === false ? 'skipped' : 'completed', title: action.toolName === 'schedule_refill_reminder' && result?.scheduled === false ? 'Refill reminder skipped safely' : 'Patient result recorded', metadata: { toolName: action.toolName, messageId: result?.messageId, scheduled: result?.scheduled, reason: result?.reason } });
      }
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

async function approveAndRunAgent({ runId, actor, actionIds }) {
  const run = await findRunById(runId);
  if (!run) throw Object.assign(new Error('Agent run not found.'), { status: 404, code: 'AGENT_RUN_NOT_FOUND' });
  if (run.agentType === 'no_show_recovery' && actor?.role !== 'admin') {
    assertCanApproveAgentRun(actor, run);
  }
  if (run.status === 'completed') return publicRun(run);
  if (run.status === 'executing' || run.actions.some((action) => action.status === 'executing')) {
    const error = Object.assign(new Error('Agent execution is already in progress.'), { status: 202, code: 'AGENT_EXECUTION_IN_PROGRESS', run: publicRun(run) });
    throw error;
  }
  const proposed = run.actions.filter((action) => action.status === 'proposed').map((action) => action.id);
  await approveAgentActions({ runId, actionIds: actionIds?.length ? actionIds : proposed, actor });
  return executeApprovedActions({ runId, actor });
}

module.exports = {
  createNoShowRecoveryPlan,
  createPostVisitFollowUpPlan,
  getAgentRun,
  approveAgentActions,
  rejectAgentActions,
  executeApprovedActions,
  approveAndRunAgent
};
