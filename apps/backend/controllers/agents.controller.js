const {
  createNoShowRecoveryPlan,
  createPostVisitFollowUpPlan,
  getAgentRun,
  approveAgentActions,
  rejectAgentActions,
  executeApprovedActions
} = require('../services/agent-orchestrator.service');
const {
  createPlanSchema,
  approveActionsSchema,
  rejectActionsSchema
} = require('../models/schemas/agents.schemas');

function sendError(res, error) {
  const status = Number(error.status || 500);
  return res.status(status).json({
    ok: false,
    error: error.message || 'Agent workflow failed.',
    code: error.code || 'AGENT_WORKFLOW_FAILED'
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

const agentsController = {
  createNoShowPlan: async (req, res) => {
    try {
      const input = parseOrThrow(createPlanSchema, req.body);
      const run = await createNoShowRecoveryPlan({
        appointmentId: req.params.appointmentId,
        actor: req.user,
        input
      });
      return res.json({ ok: true, run });
    } catch (error) {
      return sendError(res, error);
    }
  },

  createPostVisitPlan: async (req, res) => {
    try {
      const input = parseOrThrow(createPlanSchema, req.body);
      const run = await createPostVisitFollowUpPlan({
        appointmentId: req.params.appointmentId,
        actor: req.user,
        input
      });
      return res.json({ ok: true, run });
    } catch (error) {
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
