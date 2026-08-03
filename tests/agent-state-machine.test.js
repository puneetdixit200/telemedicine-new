const {
  derivePipelineState,
  transitionTraceStatus,
  transitionRunStatus,
  transitionActionStatus,
  validateTraceInvariants,
  validateRunInvariants,
  validateActionInvariants
} = require('../apps/backend/services/agent-state-machine.service');

const event = (eventType, phase, status, id) => ({ id, eventType, phase, status, createdAt: `2026-08-03T00:00:0${id}.000Z` });

describe('agent state machine', () => {
  it('allows valid transitions and rejects impossible transitions', () => {
    expect(() => transitionTraceStatus({ from: 'active', to: 'awaiting_approval' })).not.toThrow();
    expect(() => transitionRunStatus({ from: 'executing', to: 'completed' })).not.toThrow();
    expect(() => transitionActionStatus({ from: 'approved', to: 'executing' })).not.toThrow();
    expect(() => transitionTraceStatus({ from: 'completed', to: 'executing' })).toThrow(/Invalid trace transition/);
    expect(() => transitionRunStatus({ from: 'failed', to: 'awaiting_approval' })).toThrow(/Invalid run transition/);
    expect(() => transitionActionStatus({ from: 'rejected', to: 'executing' })).toThrow(/Invalid action transition/);
  });

  it('derives completion instead of active from a started and terminal event', () => {
    const trace = { status: 'completed' };
    const pipeline = derivePipelineState({
      trace,
      events: [event('ai_request_started', 'planning', 'started', 1), event('ai_response_received', 'planning', 'info', 2)]
    });
    expect(pipeline.planning.state).toBe('completed');
  });

  it('marks deduplicated phases as skipped and explains reused work', () => {
    const pipeline = derivePipelineState({
      trace: { status: 'deduplicated' },
      events: [event('dedupe_check_started', 'deduplication', 'started', 1), event('dedupe_hit', 'deduplication', 'info', 2)]
    });
    expect(pipeline.deduplication).toMatchObject({ state: 'completed', reason: 'Existing run reused' });
    expect(pipeline.planning).toMatchObject({ state: 'skipped', reason: 'Duplicate request reused an existing run' });
  });

  it('reports trace, run, and action invariant violations', () => {
    expect(validateTraceInvariants({ status: 'deduplicated', completedAt: null, runId: null, events: [] })).toEqual(expect.arrayContaining(['terminal_trace_missing_completedAt', 'deduplicated_trace_missing_run', 'deduplicated_trace_missing_dedupe_hit']));
    expect(validateRunInvariants({ status: 'completed', completedAt: null, actions: [{ status: 'approved' }] })).toEqual(expect.arrayContaining(['completed_run_has_unfinished_actions', 'terminal_run_missing_completedAt']));
    expect(validateActionInvariants({ status: 'approved', approvedAt: null, approvedById: null })).toContain('approved_action_missing_approval_audit');
  });
});
