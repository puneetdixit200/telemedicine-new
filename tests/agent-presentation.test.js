const fs = require('fs');
const path = require('path');
const {
  MIN_STAGE_VISIBLE_MS,
  applyNoShowPresentationTimeline
} = require('../apps/backend/services/agent-presentation.service');

const PHASES = [
  'trigger',
  'context',
  'policy',
  'deduplication',
  'planning',
  'validation',
  'persistence',
  'approval',
  'execution',
  'notification',
  'completion'
];

function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function pipeline(defaultState = 'completed') {
  return Object.fromEntries(
    PHASES.map((phase) => [phase, {
      state: defaultState,
      durationMs: 100,
      reason: null
    }])
  );
}

function phaseEvents(startedAt, offsets = {}) {
  return PHASES.slice(0, 8).map((phase, index) => ({
    id: `event-${phase}`,
    phase,
    status: 'completed',
    createdAt: iso(startedAt + (offsets[phase] ?? index * 100))
  }));
}

function baseRun(startedAt, overrides = {}) {
  return {
    id: 'run-1',
    agentType: 'no_show_recovery',
    status: 'awaiting_approval',
    workflowStartedAt: iso(startedAt),
    approvalAvailableAt: iso(startedAt + 40000),
    actions: [],
    ...overrides
  };
}

describe('no-show workflow presentation timeline', () => {
  it('keeps every stage white until an administrator starts the workflow', () => {
    const result = applyNoShowPresentationTimeline({
      pipeline: pipeline(),
      trace: { status: 'active' },
      run: {
        id: 'run-1',
        agentType: 'no_show_recovery',
        status: 'queued_for_start',
        workflowStartedAt: null
      },
      actions: [],
      events: [],
      now: 100000
    });

    for (const phase of PHASES) {
      expect(result[phase]).toMatchObject({
        state: 'not_started',
        reason: 'Waiting for administrator to start'
      });
    }
  });

  it('shows only Triggered during the first five seconds', () => {
    const startedAt = 100000;
    const result = applyNoShowPresentationTimeline({
      pipeline: pipeline(),
      trace: { status: 'awaiting_approval' },
      run: baseRun(startedAt),
      actions: [],
      events: phaseEvents(startedAt),
      now: startedAt + 2000
    });

    expect(result.trigger.state).toBe('active');
    expect(result.trigger.remainingMs).toBe(3000);
    expect(result.context.state).toBe('not_started');
    expect(result.approval.state).toBe('not_started');
  });

  it('moves to Context loaded only after Triggered has been visible for five seconds', () => {
    const startedAt = 200000;
    const result = applyNoShowPresentationTimeline({
      pipeline: pipeline(),
      trace: { status: 'awaiting_approval' },
      run: baseRun(startedAt),
      actions: [],
      events: phaseEvents(startedAt),
      now: startedAt + 6000
    });

    expect(result.trigger.state).toBe('completed');
    expect(result.trigger.durationMs).toBe(MIN_STAGE_VISIBLE_MS);
    expect(result.context.state).toBe('active');
    expect(result.context.remainingMs).toBe(4000);
    expect(result.policy.state).toBe('not_started');
  });

  it('shows the approval stage only after seven earlier five-second stages', () => {
    const startedAt = 300000;
    const events = phaseEvents(startedAt);
    const result = applyNoShowPresentationTimeline({
      pipeline: pipeline(),
      trace: { status: 'awaiting_approval' },
      run: baseRun(startedAt),
      actions: [],
      events,
      now: startedAt + 37000
    });

    for (const phase of PHASES.slice(0, 7)) {
      expect(result[phase].state).toBe('completed');
      expect(result[phase].durationMs).toBeGreaterThanOrEqual(5000);
    }
    expect(result.approval.state).toBe('active');
    expect(result.approval.remainingMs).toBe(3000);
    expect(result.execution.state).toBe('not_started');
  });

  it('waits for human approval after the full forty-second pre-approval window', () => {
    const startedAt = 400000;
    const result = applyNoShowPresentationTimeline({
      pipeline: pipeline(),
      trace: { status: 'awaiting_approval' },
      run: baseRun(startedAt),
      actions: [],
      events: phaseEvents(startedAt),
      now: startedAt + 41000
    });

    expect(result.approval.state).toBe('waiting');
    expect(result.approval.reason).toContain('Human approval required');
    expect(result.execution.state).toBe('not_started');
    expect(result.notification.state).toBe('not_started');
  });

  it('does not visually finish a slow backend stage before the real work completes', () => {
    const startedAt = 500000;
    const events = phaseEvents(startedAt, { context: 12000 });
    const result = applyNoShowPresentationTimeline({
      pipeline: pipeline(),
      trace: { status: 'awaiting_approval' },
      run: baseRun(startedAt),
      actions: [],
      events,
      now: startedAt + 8000
    });

    expect(result.trigger.state).toBe('completed');
    expect(result.context.state).toBe('active');
    expect(result.context.minimumVisibleUntil).toBe(iso(startedAt + 12000));
    expect(result.policy.state).toBe('not_started');
  });

  it('shows the three post-approval stages in separate five-second windows', () => {
    const workflowStartedAt = 600000;
    const approvedAt = workflowStartedAt + 50000;
    const actions = [{ status: 'executing', approvedAt: iso(approvedAt) }];
    const run = baseRun(workflowStartedAt, {
      status: 'executing',
      actions
    });

    const execution = applyNoShowPresentationTimeline({
      pipeline: pipeline(),
      trace: { status: 'executing' },
      run,
      actions,
      events: phaseEvents(workflowStartedAt),
      now: approvedAt + 2000
    });
    expect(execution.execution.state).toBe('active');
    expect(execution.notification.state).toBe('not_started');

    const patientResult = applyNoShowPresentationTimeline({
      pipeline: pipeline(),
      trace: { status: 'executing' },
      run,
      actions,
      events: phaseEvents(workflowStartedAt),
      now: approvedAt + 7000
    });
    expect(patientResult.execution.state).toBe('completed');
    expect(patientResult.notification.state).toBe('active');
    expect(patientResult.completion.state).toBe('not_started');

    const finalizing = applyNoShowPresentationTimeline({
      pipeline: pipeline(),
      trace: { status: 'executing' },
      run,
      actions,
      events: phaseEvents(workflowStartedAt),
      now: approvedAt + 12000
    });
    expect(finalizing.notification.state).toBe('completed');
    expect(finalizing.completion.state).toBe('active');
    expect(finalizing.completion.reason).toContain('patient is not notified until this completes');
  });

  it('marks completion green only after the final window and actual run completion', () => {
    const workflowStartedAt = 700000;
    const approvedAt = workflowStartedAt + 50000;
    const completedAt = approvedAt + 15100;
    const actions = [{ status: 'completed', approvedAt: iso(approvedAt) }];
    const run = baseRun(workflowStartedAt, {
      status: 'completed',
      completedAt: iso(completedAt),
      actions
    });

    const before = applyNoShowPresentationTimeline({
      pipeline: pipeline(),
      trace: { status: 'completed' },
      run,
      actions,
      events: phaseEvents(workflowStartedAt),
      now: approvedAt + 14999
    });
    expect(before.completion.state).toBe('active');

    const after = applyNoShowPresentationTimeline({
      pipeline: pipeline(),
      trace: { status: 'completed' },
      run,
      actions,
      events: phaseEvents(workflowStartedAt),
      now: completedAt + 1
    });
    expect(after.completion.state).toBe('completed');
    expect(after.completion.durationMs).toBeGreaterThanOrEqual(5000);
  });

  it('ships a database trigger that prevents approval before forty seconds', () => {
    const migration = fs.readFileSync(
      path.join(__dirname, '..', 'prisma', 'migrations', '20260805000200_enforce_agent_presentation_timing', 'migration.sql'),
      'utf8'
    );

    expect(migration).toContain("INTERVAL '40 seconds'");
    expect(migration).toContain('AgentRun_enforce_approval_window');
    expect(migration).toContain('BEFORE INSERT OR UPDATE');
  });
});
