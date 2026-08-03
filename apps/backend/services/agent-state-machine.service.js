const TRACE_TERMINAL = new Set(['completed', 'partially_completed', 'failed', 'deduplicated', 'cancelled']);
const RUN_TERMINAL = new Set(['completed', 'partially_completed', 'failed', 'cancelled']);
const ACTION_TERMINAL = new Set(['completed', 'failed', 'rejected', 'skipped']);

const TRACE_TRANSITIONS = {
  active: new Set(['awaiting_approval', 'executing', 'completed', 'partially_completed', 'failed', 'deduplicated', 'cancelled']),
  awaiting_approval: new Set(['executing', 'completed', 'partially_completed', 'failed', 'deduplicated', 'cancelled']),
  executing: new Set(['completed', 'partially_completed', 'failed', 'cancelled']),
  completed: new Set(), partially_completed: new Set(), failed: new Set(), deduplicated: new Set(), cancelled: new Set()
};

const RUN_TRANSITIONS = {
  planned: new Set(['awaiting_approval', 'failed', 'cancelled']),
  awaiting_approval: new Set(['executing', 'completed', 'partially_completed', 'failed', 'cancelled']),
  executing: new Set(['completed', 'partially_completed', 'failed', 'cancelled']),
  completed: new Set(), partially_completed: new Set(), failed: new Set(), cancelled: new Set()
};

const ACTION_TRANSITIONS = {
  proposed: new Set(['approved', 'rejected', 'skipped']),
  approved: new Set(['executing', 'rejected', 'skipped']),
  executing: new Set(['completed', 'failed', 'skipped']),
  completed: new Set(), failed: new Set(), rejected: new Set(), skipped: new Set()
};

const AGENT_EVENT_DEFINITIONS = Object.freeze({
  request_received: { phase: 'trigger', effect: 'start' },
  trace_created: { phase: 'trigger', effect: 'complete' },
  context_loading_started: { phase: 'context', effect: 'start' },
  context_loading_completed: { phase: 'context', effect: 'complete' },
  context_loading_failed: { phase: 'context', effect: 'fail' },
  appointment_loaded: { phase: 'context', effect: 'progress' },
  patient_context_loaded: { phase: 'context', effect: 'progress' },
  doctor_context_loaded: { phase: 'context', effect: 'progress' },
  available_slots_loaded: { phase: 'context', effect: 'progress' },
  prescription_loaded: { phase: 'context', effect: 'progress' },
  policy_validation_started: { phase: 'policy', effect: 'start' },
  policy_validation_completed: { phase: 'policy', effect: 'complete' },
  policy_validation_failed: { phase: 'policy', effect: 'fail' },
  actor_authorized: { phase: 'policy', effect: 'progress' },
  actor_denied: { phase: 'policy', effect: 'fail', terminalForPhase: true },
  appointment_state_validated: { phase: 'policy', effect: 'progress' },
  appointment_state_rejected: { phase: 'policy', effect: 'fail', terminalForPhase: true },
  prescription_validated: { phase: 'policy', effect: 'progress' },
  prescription_missing: { phase: 'policy', effect: 'fail', terminalForPhase: true },
  dedupe_check_started: { phase: 'deduplication', effect: 'start' },
  dedupe_hit: { phase: 'deduplication', effect: 'complete', terminalForPhase: true },
  dedupe_miss: { phase: 'deduplication', effect: 'complete', terminalForPhase: true },
  existing_run_returned: { phase: 'deduplication', effect: 'complete', terminalForPhase: true },
  ai_provider_selected: { phase: 'planning', effect: 'progress' },
  ai_request_started: { phase: 'planning', effect: 'start' },
  ai_response_received: { phase: 'planning', effect: 'complete', terminalForPhase: true },
  ai_request_completed: { phase: 'planning', effect: 'complete', terminalForPhase: true },
  ai_request_failed: { phase: 'planning', effect: 'fail', terminalForPhase: true },
  deterministic_fallback_activated: { phase: 'planning', effect: 'complete', terminalForPhase: true },
  json_parse_completed: { phase: 'validation', effect: 'complete', terminalForPhase: true },
  json_parse_failed: { phase: 'validation', effect: 'fail', terminalForPhase: true },
  response_schema_validation_passed: { phase: 'validation', effect: 'complete', terminalForPhase: true },
  response_schema_validation_failed: { phase: 'validation', effect: 'fail', terminalForPhase: true },
  medication_fidelity_check_passed: { phase: 'validation', effect: 'complete', terminalForPhase: true },
  medication_fidelity_check_failed: { phase: 'validation', effect: 'fail', terminalForPhase: true },
  agent_run_created: { phase: 'persistence', effect: 'progress', requiresRun: true },
  agent_plan_saved: { phase: 'persistence', effect: 'progress', requiresRun: true },
  agent_actions_created: { phase: 'persistence', effect: 'complete', terminalForPhase: true, requiresRun: true },
  awaiting_approval: { phase: 'approval', effect: 'waiting', terminalForPhase: true, requiresRun: true },
  approval_requested: { phase: 'approval', effect: 'waiting', terminalForPhase: true, requiresRun: true },
  action_approved: { phase: 'approval', effect: 'progress', requiresRun: true, requiresAction: true },
  approval_completed: { phase: 'approval', effect: 'complete', terminalForPhase: true, requiresRun: true },
  action_rejected: { phase: 'approval', effect: 'complete', terminalForPhase: true, requiresRun: true, requiresAction: true },
  execution_requested: { phase: 'execution', effect: 'start', requiresRun: true },
  execution_already_in_progress: { phase: 'execution', effect: 'waiting', requiresRun: true },
  run_execution_claimed: { phase: 'execution', effect: 'progress', requiresRun: true },
  action_execution_started: { phase: 'execution', effect: 'start', requiresRun: true, requiresAction: true },
  tool_execution_started: { phase: 'execution', effect: 'progress', requiresRun: true, requiresAction: true },
  tool_execution_completed: { phase: 'execution', effect: 'progress', requiresRun: true, requiresAction: true },
  tool_execution_failed: { phase: 'execution', effect: 'fail', requiresRun: true, requiresAction: true },
  action_completed: { phase: 'execution', effect: 'complete', terminalForPhase: true, requiresRun: true, requiresAction: true },
  action_skipped: { phase: 'execution', effect: 'skipped', terminalForPhase: true, requiresRun: true, requiresAction: true },
  action_failed: { phase: 'execution', effect: 'fail', terminalForPhase: true, requiresRun: true, requiresAction: true },
  patient_message_queued: { phase: 'notification', effect: 'complete', terminalForPhase: true, requiresRun: true },
  patient_message_queue_started: { phase: 'notification', effect: 'start', requiresRun: true },
  patient_message_queue_failed: { phase: 'notification', effect: 'fail', terminalForPhase: true, requiresRun: true },
  refill_reminder_started: { phase: 'notification', effect: 'start', requiresRun: true },
  refill_reminder_failed: { phase: 'notification', effect: 'fail', terminalForPhase: true, requiresRun: true },
  notification_visible_to_patient: { phase: 'notification', effect: 'progress', requiresRun: true },
  notification_dismissed: { phase: 'notification', effect: 'complete', terminalForPhase: true, requiresRun: true },
  refill_reminder_scheduled: { phase: 'notification', effect: 'complete', terminalForPhase: true, requiresRun: true },
  refill_reminder_skipped: { phase: 'notification', effect: 'skipped', terminalForPhase: true, requiresRun: true },
  patient_language_resolution_started: { phase: 'planning', effect: 'start', requiresRun: true },
  patient_language_resolved: { phase: 'planning', effect: 'complete', terminalForPhase: true, requiresRun: true },
  localized_output_validation_started: { phase: 'validation', effect: 'start', requiresRun: true },
  localized_output_validation_passed: { phase: 'validation', effect: 'complete', terminalForPhase: true, requiresRun: true },
  localized_output_validation_failed: { phase: 'validation', effect: 'fail', terminalForPhase: true, requiresRun: true },
  localized_fallback_template_used: { phase: 'validation', effect: 'complete', terminalForPhase: true, requiresRun: true },
  awaiting_admin_approval: { phase: 'approval', effect: 'waiting', terminalForPhase: true, requiresRun: true },
  admin_approval_requested: { phase: 'approval', effect: 'waiting', requiresRun: true },
  admin_approval_completed: { phase: 'approval', effect: 'complete', terminalForPhase: true, requiresRun: true },
  approved_draft_locked: { phase: 'execution', effect: 'complete', terminalForPhase: true, requiresRun: true },
  execution_started: { phase: 'execution', effect: 'start', requiresRun: true },
  patient_language_revalidation_started: { phase: 'execution', effect: 'start', requiresRun: true },
  patient_language_revalidated: { phase: 'execution', effect: 'complete', terminalForPhase: true, requiresRun: true },
  localized_message_verified: { phase: 'execution', effect: 'complete', terminalForPhase: true, requiresRun: true },
  tool_allow_list_verified: { phase: 'execution', effect: 'complete', terminalForPhase: true, requiresRun: true },
  delivery_action_prepared: { phase: 'execution', effect: 'complete', terminalForPhase: true, requiresRun: true },
  final_safety_check_completed: { phase: 'execution', effect: 'complete', terminalForPhase: true, requiresRun: true },
  delivery_gate_completed: { phase: 'execution', effect: 'complete', terminalForPhase: true, requiresRun: true },
  patient_language_revalidation_started: { phase: 'execution', effect: 'start', requiresRun: true },
  patient_language_revalidation_passed: { phase: 'execution', effect: 'complete', terminalForPhase: true, requiresRun: true },
  localized_message_verification_started: { phase: 'execution', effect: 'start', requiresRun: true },
  localized_message_verification_passed: { phase: 'execution', effect: 'complete', terminalForPhase: true, requiresRun: true },
  delivery_gate_started: { phase: 'execution', effect: 'start', requiresRun: true },
  patient_message_queue_completed: { phase: 'notification', effect: 'complete', terminalForPhase: true, requiresRun: true },
  approval_verified_started: { phase: 'execution', effect: 'start', requiresRun: true },
  approval_verified_completed: { phase: 'execution', effect: 'complete', terminalForPhase: true, requiresRun: true },
  approved_draft_locked_started: { phase: 'execution', effect: 'start', requiresRun: true },
  approved_draft_locked_completed: { phase: 'execution', effect: 'complete', terminalForPhase: true, requiresRun: true },
  patient_language_revalidated_started: { phase: 'execution', effect: 'start', requiresRun: true },
  patient_language_revalidated_completed: { phase: 'execution', effect: 'complete', terminalForPhase: true, requiresRun: true },
  localized_message_verified_started: { phase: 'execution', effect: 'start', requiresRun: true },
  localized_message_verified_completed: { phase: 'execution', effect: 'complete', terminalForPhase: true, requiresRun: true },
  tool_allow_list_verified_started: { phase: 'execution', effect: 'start', requiresRun: true },
  tool_allow_list_verified_completed: { phase: 'execution', effect: 'complete', terminalForPhase: true, requiresRun: true },
  delivery_action_prepared_started: { phase: 'execution', effect: 'start', requiresRun: true },
  delivery_action_prepared_completed: { phase: 'execution', effect: 'complete', terminalForPhase: true, requiresRun: true },
  final_safety_check_completed_started: { phase: 'execution', effect: 'start', requiresRun: true },
  final_safety_check_completed_completed: { phase: 'execution', effect: 'complete', terminalForPhase: true, requiresRun: true },
  delivery_gate_completed_started: { phase: 'execution', effect: 'start', requiresRun: true },
  delivery_gate_completed_completed: { phase: 'execution', effect: 'complete', terminalForPhase: true, requiresRun: true },
  patient_message_queue_started: { phase: 'notification', effect: 'start', requiresRun: true },
  patient_message_queued: { phase: 'notification', effect: 'complete', terminalForPhase: true, requiresRun: true },
  run_completed: { phase: 'completion', effect: 'complete', terminalForPhase: true, requiresRun: true },
  run_partially_completed: { phase: 'completion', effect: 'complete', terminalForPhase: true, requiresRun: true },
  run_failed: { phase: 'completion', effect: 'fail', terminalForPhase: true, requiresRun: true },
  trace_completed: { phase: 'completion', effect: 'complete', terminalForPhase: true },
  state_reconciled: { phase: 'system', effect: 'progress' }
});

function transitionStatus(kind, from, to) {
  const table = kind === 'trace' ? TRACE_TRANSITIONS : kind === 'run' ? RUN_TRANSITIONS : ACTION_TRANSITIONS;
  if (!table[from]) throw new Error(`Unknown ${kind} status: ${from}`);
  if (from === to) return true;
  if (!table[from].has(to)) {
    const error = new Error(`Invalid ${kind} transition: ${from} -> ${to}`);
    error.code = 'INVALID_AGENT_STATE_TRANSITION';
    throw error;
  }
  return true;
}

const transitionTraceStatus = ({ from, to }) => transitionStatus('trace', from, to);
const transitionRunStatus = ({ from, to }) => transitionStatus('run', from, to);
const transitionActionStatus = ({ from, to }) => transitionStatus('action', from, to);
const isTerminalTraceStatus = (status) => TRACE_TERMINAL.has(status);
const isTerminalRunStatus = (status) => RUN_TERMINAL.has(status);
const isTerminalActionStatus = (status) => ACTION_TERMINAL.has(status);

function validateTraceInvariants(trace, run = trace?.run, events = trace?.events || []) {
  const errors = [];
  if (isTerminalTraceStatus(trace?.status) && !trace.completedAt) errors.push('terminal_trace_missing_completedAt');
  if (trace?.status === 'deduplicated') {
    if (!trace.runId) errors.push('deduplicated_trace_missing_run');
    if (trace.traceKind && trace.traceKind !== 'deduplicated_request') errors.push('deduplicated_trace_kind_mismatch');
    if (trace.runId && !trace.sourceTraceId) errors.push('deduplicated_trace_missing_source_trace');
    if (!events.some((event) => event.eventType === 'dedupe_hit')) errors.push('deduplicated_trace_missing_dedupe_hit');
    if (events.some((event) => ['ai_request_started', 'ai_response_received', 'agent_run_created'].includes(event.eventType))) errors.push('deduplicated_trace_has_execution_events');
  }
  if (['awaiting_approval', 'executing'].includes(trace?.status) && !run) errors.push('active_trace_missing_run');
  if (trace?.status === 'awaiting_approval' && run && !(run.actions || []).some((action) => ['proposed', 'approved'].includes(action.status))) errors.push('awaiting_trace_without_pending_action');
  if (trace?.status === 'executing' && run && !(run.actions || []).some((action) => ['approved', 'executing'].includes(action.status))) errors.push('executing_trace_without_active_action');
  return errors;
}

function validateRunInvariants(run) {
  const errors = [];
  const actions = run?.actions || [];
  if (run?.status === 'completed' && actions.some((action) => ['proposed', 'approved', 'executing'].includes(action.status))) errors.push('completed_run_has_unfinished_actions');
  if (run?.status === 'awaiting_approval' && !actions.some((action) => ['proposed', 'approved'].includes(action.status))) errors.push('awaiting_run_without_pending_action');
  if (isTerminalRunStatus(run?.status) && run.status !== 'cancelled' && !run.completedAt) errors.push('terminal_run_missing_completedAt');
  return errors;
}

function validateActionInvariants(action) {
  const errors = [];
  if (action?.status === 'approved' && (!action.approvedAt || !action.approvedById)) errors.push('approved_action_missing_approval_audit');
  if (isTerminalActionStatus(action?.status) && ['completed', 'failed'].includes(action.status) && !action.executedAt) errors.push('executed_action_missing_executedAt');
  return errors;
}

const PIPELINE_PHASES = ['trigger', 'context', 'policy', 'deduplication', 'planning', 'validation', 'persistence', 'approval', 'execution', 'notification', 'completion'];

function derivePipelineState({ trace, run, actions = run?.actions || [], events = trace?.events || [] } = {}) {
  const ordered = [...events].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || String(a.id).localeCompare(String(b.id)));
  const pipeline = {};
  for (const phase of PIPELINE_PHASES) {
    const phaseEvents = ordered.filter((event) => event.phase === phase);
    const definitions = phaseEvents.map((event) => AGENT_EVENT_DEFINITIONS[event.eventType]).filter(Boolean);
    const failed = phaseEvents.some((event) => event.status === 'failed' || definitions.some((definition) => definition.effect === 'fail'));
    const skipped = phaseEvents.some((event) => event.status === 'skipped' || definitions.some((definition) => definition.effect === 'skipped'));
    const completed = phaseEvents.some((event) => definitions.some((definition) => definition.terminalForPhase || definition.effect === 'complete') || event.status === 'completed');
    const waiting = phaseEvents.some((event) => definitions.some((definition) => definition.effect === 'waiting'));
    const started = phaseEvents.some((event) => event.status === 'started' || definitions.some((definition) => definition.effect === 'start'));
    let state = 'not_started';
    let reason = null;
    if (failed) state = 'failed';
    else if (skipped) state = 'skipped';
    else if (completed) state = 'completed';
    else if (waiting) state = 'waiting';
    else if (started) state = 'active';
    const first = phaseEvents.find((event) => event.status === 'started');
    const last = phaseEvents.at(-1);
    const durationMs = last?.durationMs ?? (first && last && state === 'completed' ? Math.max(0, new Date(last.createdAt) - new Date(first.createdAt)) : null);
    if (trace?.status === 'deduplicated' && phase !== 'trigger' && phase !== 'deduplication' && phase !== 'completion') {
      state = 'skipped';
      reason = 'Duplicate request reused an existing run';
    }
    if (['completed', 'partially_completed', 'failed', 'cancelled', 'deduplicated'].includes(trace?.status) && state === 'active') {
      state = 'inconsistent';
      reason = 'Terminal trace has an unmatched phase start';
    }
    pipeline[phase] = { state, durationMs, reason };
  }
  if (trace?.status === 'awaiting_approval') pipeline.approval = { ...pipeline.approval, state: 'waiting', reason: 'Human approval required' };
  if (trace?.status === 'executing') pipeline.execution = { ...pipeline.execution, state: 'active', reason: 'Backend action execution is active' };
  if (trace?.status === 'deduplicated') pipeline.deduplication = { ...pipeline.deduplication, state: 'completed', reason: 'Existing run reused' };
  if (run && actions.length) {
    const allTerminal = actions.every((action) => ACTION_TERMINAL.has(action.status));
    if (run.status === 'completed' && allTerminal) pipeline.completion = { ...pipeline.completion, state: 'completed' };
  }
  return pipeline;
}

module.exports = {
  AGENT_EVENT_DEFINITIONS,
  transitionTraceStatus,
  transitionRunStatus,
  transitionActionStatus,
  isTerminalTraceStatus,
  isTerminalRunStatus,
  isTerminalActionStatus,
  validateTraceInvariants,
  validateRunInvariants,
  validateActionInvariants,
  derivePipelineState
};
