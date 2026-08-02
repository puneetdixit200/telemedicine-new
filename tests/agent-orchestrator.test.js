jest.mock('../apps/backend/models/db', () => ({
  prisma: {
    agentRun: { findUnique: jest.fn(), updateMany: jest.fn() },
    agentAction: { updateMany: jest.fn(), findUnique: jest.fn() }
  }
}));
jest.mock('../apps/backend/services/agent-policy.service', () => ({
  assertCanApproveAgentRun: jest.fn(),
  assertCanGenerateNoShowPlan: jest.fn(),
  assertCanGeneratePostVisitPlan: jest.fn(),
  assertAllowedTool: jest.fn()
}));
jest.mock('../apps/backend/services/agent-actions.service', () => ({ executeAllowedTool: jest.fn() }));
jest.mock('../apps/backend/services/reminder.service', () => ({ cancelScheduledRemindersForAppointment: jest.fn() }));
jest.mock('../apps/backend/services/agent-context.service', () => ({
  loadNoShowContext: jest.fn(),
  loadPostVisitContext: jest.fn()
}));
jest.mock('../apps/backend/services/agent-planner.service', () => ({
  planNoShowRecovery: jest.fn(),
  planPostVisitFollowUp: jest.fn()
}));

const { prisma } = require('../apps/backend/models/db');
const { executeApprovedActions } = require('../apps/backend/services/agent-orchestrator.service');

describe('agent execution concurrency response', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns an explicit in-progress result for an already executing run', async () => {
    const run = {
      id: 'run-1',
      status: 'executing',
      appointmentId: 'appt-1',
      appointment: { id: 'appt-1', doctorId: 'doctor-1' },
      actions: [{ id: 'action-1', status: 'executing' }]
    };
    prisma.agentRun.findUnique.mockResolvedValue(run);

    await expect(executeApprovedActions({ runId: run.id, actor: { id: 'doctor-1', role: 'doctor' } })).rejects.toMatchObject({
      status: 202,
      code: 'AGENT_EXECUTION_IN_PROGRESS',
      run: { id: 'run-1', status: 'executing' }
    });
    expect(prisma.agentRun.updateMany).not.toHaveBeenCalled();
  });

  it('returns in-progress when the atomic run claim is lost to another request', async () => {
    const pending = {
      id: 'run-2',
      status: 'awaiting_approval',
      appointmentId: 'appt-2',
      appointment: { id: 'appt-2', doctorId: 'doctor-1' },
      actions: [{ id: 'action-2', status: 'approved' }]
    };
    const executing = { ...pending, status: 'executing', actions: [{ id: 'action-2', status: 'executing' }] };
    prisma.agentRun.findUnique.mockResolvedValueOnce(pending).mockResolvedValueOnce(executing);
    prisma.agentRun.updateMany.mockResolvedValue({ count: 0 });

    await expect(executeApprovedActions({ runId: pending.id, actor: { id: 'doctor-1', role: 'doctor' } })).rejects.toMatchObject({
      status: 202,
      code: 'AGENT_EXECUTION_IN_PROGRESS',
      run: { id: 'run-2', status: 'executing' }
    });
  });
});
