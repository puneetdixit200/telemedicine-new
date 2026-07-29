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

async function findRunById(runId) {
  return prisma.agentRun.findUnique({
    where: { id: runId },
    include: RUN_INCLUDE
  });
}

async function createRunWithActions({ agentType, appointmentId, actor, input, context, plannerResult, dedupeKey, triggeredBy }) {
  const existing = await prisma.agentRun.findUnique({ where: { dedupeKey }, include: RUN_INCLUDE });
  if (existing) return existing;

  return prisma.$transaction(async (tx) => {
    const race = await tx.agentRun.findUnique({ where: { dedupeKey }, include: RUN_INCLUDE });
    if (race) return race;

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
    return run;
  });
}

async function createNoShowRecoveryPlan({ appointmentId, actor, input = {} }) {
  const context = await loadNoShowContext(appointmentId);
  assertCanGenerateNoShowPlan(actor, context?.appointment);
  if (context.appointment.status === 'booked') {
    const updated = await prisma.appointment.update({ where: { id: appointmentId }, data: { status: 'no_show' } });
    await cancelScheduledRemindersForAppointment(appointmentId).catch(() => {});
    context.appointment.status = 'no_show';
    context.appointment.updatedAt = updated.updatedAt;
  }
  const dedupeKey = `no_show_recovery:${appointmentId}:${epoch(context.appointment.updatedAt)}`;
  const existing = await prisma.agentRun.findUnique({ where: { dedupeKey }, include: RUN_INCLUDE });
  if (existing) return publicRun(existing);
  const plannerResult = await planNoShowRecovery(context, input);
  const run = await createRunWithActions({
    agentType: 'no_show_recovery',
    appointmentId,
    actor,
    input,
    context,
    plannerResult,
    dedupeKey,
    triggeredBy: 'manual'
  });
  return publicRun(run);
}

async function createPostVisitFollowUpPlan({ appointmentId, actor, input = {} }) {
  const context = await loadPostVisitContext(appointmentId);
  const policyAppointment = context ? { ...context.appointment, prescription: context.prescription } : null;
  assertCanGeneratePostVisitPlan(actor, policyAppointment);
  const dedupeKey = `post_visit_follow_up:${appointmentId}:${epoch(context.prescription.updatedAt)}`;
  const existing = await prisma.agentRun.findUnique({ where: { dedupeKey }, include: RUN_INCLUDE });
  if (existing) return publicRun(existing);
  const plannerResult = await planPostVisitFollowUp(context, input);
  const run = await createRunWithActions({
    agentType: 'post_visit_follow_up',
    appointmentId,
    actor,
    input,
    context,
    plannerResult,
    dedupeKey,
    triggeredBy: 'manual'
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
  await prisma.agentAction.updateMany({
    where: { runId, id: { in: selected }, status: 'proposed' },
    data: { status: 'approved', approvedById: actor.id, approvedAt: new Date(), error: null }
  });
  await prisma.agentRun.update({ where: { id: runId }, data: { status: 'awaiting_approval' } });
  return publicRun(await findRunById(runId));
}

async function rejectAgentActions({ runId, actionIds, actor, reason = '' }) {
  const run = await findRunById(runId);
  assertCanApproveAgentRun(actor, run);
  await prisma.agentAction.updateMany({
    where: { runId, id: { in: actionIds }, status: { in: ['proposed', 'approved'] } },
    data: { status: 'rejected', error: reason || null }
  });
  return updateRunStatus(runId);
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
  await prisma.agentRun.update({ where: { id: runId }, data: { status: 'executing' } });

  const approved = run.actions.filter((action) => action.status === 'approved');
  for (const action of approved) {
    const claim = await prisma.agentAction.updateMany({
      where: { id: action.id, runId, status: 'approved' },
      data: { status: 'executing' }
    });
    if (claim.count !== 1) continue;

    const executingAction = await prisma.agentAction.findUnique({
      where: { id: action.id },
      include: { run: true }
    });

    try {
      const result = await executeAllowedTool({ action: executingAction, actor });
      await prisma.agentAction.update({
        where: { id: action.id },
        data: { status: 'completed', result, executedAt: new Date(), error: null }
      });
    } catch (error) {
      await prisma.agentAction.update({
        where: { id: action.id },
        data: {
          status: 'failed',
          error: String(error.message || error).slice(0, 2000),
          executedAt: new Date()
        }
      });
    }
  }

  return updateRunStatus(runId);
}

module.exports = {
  createNoShowRecoveryPlan,
  createPostVisitFollowUpPlan,
  getAgentRun,
  approveAgentActions,
  rejectAgentActions,
  executeApprovedActions
};
