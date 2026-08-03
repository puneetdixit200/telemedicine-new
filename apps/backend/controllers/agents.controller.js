const {
  createNoShowRecoveryPlan,
  createPostVisitFollowUpPlan,
  getAgentRun,
  approveAgentActions,
  rejectAgentActions,
  executeApprovedActions
} = require('../services/agent-orchestrator.service');
const { createAgentTrace, safeRecordAgentEvent, failAgentTrace } = require('../services/agent-observability.service');
const {
  createPlanSchema,
  approveActionsSchema,
  rejectActionsSchema
} = require('../models/schemas/agents.schemas');

function sendError(res, error) {
  const status = Number(error.status || 500);
  return res.status(status).json({
    ok: status >= 200 && status < 300,
    error: error.message || 'Agent workflow failed.',
    code: error.code || 'AGENT_WORKFLOW_FAILED',
    ...(error.run ? { run: error.run } : {})
  });
}

function parseOrThrow(schema, body) {
  const parsed = schema.safeParse(body || {});
  if (!parsed.success) {
    const error = new Error('Invalid agent request payload.');
    error.status = 400;
    error.code = 'INVALID_AGENT_REQUEST';
    throw error;
  }
  return parsed.data;
}

async function beginTrace(req, agentType) {
  try {
    const trace = await createAgentTrace({
      agentType,
      appointmentId: req.params.appointmentId,
      requestedById: req.user.id,
      requestId: req.requestId
    });
    await safeRecordAgentEvent({ traceId: trace.traceId, phase: 'trigger', eventType: 'trace_created', status: 'completed', title: 'Execution trace created' });
    await safeRecordAgentEvent({ traceId: trace.traceId, phase: 'trigger', eventType: 'request_received', status: 'info', title: 'Agent request received', metadata: { agentType, status: 'accepted' } });
    await safeRecordAgentEvent({ traceId: trace.traceId, phase: 'trigger', eventType: 'actor_identified', status: 'completed', title: 'Authorized actor identified', metadata: { status: req.user.role } });
    await safeRecordAgentEvent({ traceId: trace.traceId, phase: 'trigger', eventType: 'agent_type_selected', status: 'completed', title: 'Agent type selected', metadata: { status: agentType } });
    return trace;
  } catch (error) {
    console.warn('[agent-observability] trace creation failed', { error: String(error?.message || error).slice(0, 200) });
    return null;
  }
}

const agentsController = {
  createNoShowPlan: async (req, res) => {
    const trace = await beginTrace(req, 'no_show_recovery');
    try {
      const input = parseOrThrow(createPlanSchema, req.body);
      const run = await createNoShowRecoveryPlan({
        appointmentId: req.params.appointmentId,
        actor: req.user,
        input,
        traceContext: trace
      });
      return res.json({ ok: true, run });
    } catch (error) {
      await safeRecordAgentEvent({ traceId: trace?.traceId, phase: 'policy', eventType: error.code === 'INVALID_AGENT_STATE' ? 'appointment_state_rejected' : error.code === 'PRESCRIPTION_REQUIRED' ? 'prescription_missing' : 'policy_validation_failed', status: 'failed', title: error.message || 'Agent request failed', metadata: { errorCode: error.code || 'AGENT_WORKFLOW_FAILED' } });
      await failAgentTrace(trace?.traceId, error).catch(() => {});
      return sendError(res, error);
    }
  },

  createPostVisitPlan: async (req, res) => {
    const trace = await beginTrace(req, 'post_visit_follow_up');
    try {
      const input = parseOrThrow(createPlanSchema, req.body);
      const run = await createPostVisitFollowUpPlan({
        appointmentId: req.params.appointmentId,
        actor: req.user,
        input,
        traceContext: trace
      });
      return res.json({ ok: true, run });
    } catch (error) {
      await safeRecordAgentEvent({ traceId: trace?.traceId, phase: 'policy', eventType: error.code === 'INVALID_AGENT_STATE' ? 'appointment_state_rejected' : error.code === 'PRESCRIPTION_REQUIRED' ? 'prescription_missing' : 'policy_validation_failed', status: 'failed', title: error.message || 'Agent request failed', metadata: { errorCode: error.code || 'AGENT_WORKFLOW_FAILED' } });
      await failAgentTrace(trace?.traceId, error).catch(() => {});
      return sendError(res, error);
    }
  },

  getRun: async (req, res) => {
    try {
      const run = await getAgentRun({ runId: req.params.runId, actor: req.user });
      return res.json({ ok: true, run });
    } catch (error) {
      return sendError(res, error);
    }
  },

  approve: async (req, res) => {
    try {
      const payload = parseOrThrow(approveActionsSchema, req.body);
      const run = await approveAgentActions({
        runId: req.params.runId,
        actionIds: payload.actionIds,
        actor: req.user
      });
      return res.json({ ok: true, run });
    } catch (error) {
      return sendError(res, error);
    }
  },

  reject: async (req, res) => {
    try {
      const payload = parseOrThrow(rejectActionsSchema, req.body);
      const run = await rejectAgentActions({
        runId: req.params.runId,
        actionIds: payload.actionIds,
        actor: req.user,
        reason: payload.reason || ''
      });
      return res.json({ ok: true, run });
    } catch (error) {
      return sendError(res, error);
    }
  },

  execute: async (req, res) => {
    try {
      const run = await executeApprovedActions({ runId: req.params.runId, actor: req.user });
      return res.json({ ok: true, run });
    } catch (error) {
      return sendError(res, error);
    }
  }
};

module.exports = { agentsController };
