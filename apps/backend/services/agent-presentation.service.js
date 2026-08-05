'use strict';

const MIN_STAGE_VISIBLE_MS = 5000;
const PRE_APPROVAL_PHASES = [
  'trigger',
  'context',
  'policy',
  'deduplication',
  'planning',
  'validation',
  'persistence',
  'approval'
];
const POST_APPROVAL_PHASES = ['execution', 'notification', 'completion'];

const PHASE_READY_EVENTS = {
  context: new Set(['context_loading_completed']),
  policy: new Set(['policy_validation_completed']),
  planning: new Set(['ai_response_received', 'deterministic_fallback_activated']),
  validation: new Set(['response_schema_validation_passed', 'localized_fallback_template_used']),
  persistence: new Set(['agent_actions_created'])
};

const RECOVERY_EVENTS = {
  planning: new Set(['deterministic_fallback_activated']),
  validation: new Set(['localized_fallback_template_used'])
};

function toMs(value) {
  const parsed = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function phaseEvents(events, phase) {
  return (events || []).filter((event) => event.phase === phase);
}

function hasEvent(events, eventTypes) {
  return (events || []).some((event) => eventTypes.has(event.eventType));
}

function latestPhaseTime(events, phase) {
  const values = phaseEvents(events, phase)
    .map((event) => toMs(event.createdAt))
    .filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

function phaseActuallyReady(run, phase, events) {
  if (phase === 'trigger' || phase === 'deduplication') return Boolean(run?.workflowStartedAt);
  if (phase === 'approval') {
    return ['awaiting_approval', 'executing', 'completed', 'partially_completed'].includes(run?.status);
  }

  const readyEvents = PHASE_READY_EVENTS[phase];
  return readyEvents ? hasEvent(phaseEvents(events, phase), readyEvents) : false;
}

function phaseFailureRecovered(phase, events) {
  const recoveryEvents = RECOVERY_EVENTS[phase];
  return recoveryEvents ? hasEvent(phaseEvents(events, phase), recoveryEvents) : false;
}

function activeStage({ base, visibleStartedAt, minimumVisibleUntil, now, reason }) {
  return {
    ...base,
    state: 'active',
    reason,
    durationMs: Math.max(0, now - visibleStartedAt),
    visibleStartedAt: new Date(visibleStartedAt).toISOString(),
    minimumVisibleUntil: new Date(minimumVisibleUntil).toISOString(),
    visibleCompletedAt: null,
    remainingMs: Math.max(0, minimumVisibleUntil - now)
  };
}

function completedStage({ base, visibleStartedAt, visibleCompletedAt, reason = null }) {
  return {
    ...base,
    state: 'completed',
    reason,
    durationMs: Math.max(MIN_STAGE_VISIBLE_MS, visibleCompletedAt - visibleStartedAt),
    visibleStartedAt: new Date(visibleStartedAt).toISOString(),
    minimumVisibleUntil: new Date(visibleStartedAt + MIN_STAGE_VISIBLE_MS).toISOString(),
    visibleCompletedAt: new Date(visibleCompletedAt).toISOString(),
    remainingMs: 0
  };
}

function notStartedStage(base) {
  return {
    ...base,
    state: 'not_started',
    reason: null,
    durationMs: null,
    visibleStartedAt: null,
    minimumVisibleUntil: null,
    visibleCompletedAt: null,
    remainingMs: null
  };
}

function failedStage(base, reason) {
  return {
    ...base,
    state: 'failed',
    reason: reason || base.reason || 'The backend stage failed',
    remainingMs: 0
  };
}

function applyPreApprovalTimeline({ pipeline, trace, run, actions, events, now }) {
  const workflowStartedAt = toMs(run?.workflowStartedAt);
  if (!workflowStartedAt) return pipeline;

  let cursor = workflowStartedAt;
  let blocked = false;

  for (const phase of PRE_APPROVAL_PHASES) {
    const originalBase = pipeline[phase] || { state: 'not_started', durationMs: null, reason: null };
    const recovered = phaseFailureRecovered(phase, events);
    const base = recovered
      ? { ...originalBase, state: 'completed', reason: 'Recovered using the safe localized fallback' }
      : originalBase;

    if (blocked) {
      pipeline[phase] = notStartedStage(base);
      continue;
    }

    if (base.state === 'failed') {
      pipeline[phase] = failedStage(base);
      blocked = true;
      continue;
    }

    const ready = phaseActuallyReady(run, phase, events);
    const actualAt = phase === 'trigger' || phase === 'deduplication'
      ? workflowStartedAt
      : latestPhaseTime(events, phase);
    const visibleStartedAt = cursor;

    if (now < visibleStartedAt) {
      pipeline[phase] = notStartedStage(base);
      blocked = true;
      continue;
    }

    if (!ready) {
      pipeline[phase] = activeStage({
        base,
        visibleStartedAt,
        minimumVisibleUntil: visibleStartedAt + MIN_STAGE_VISIBLE_MS,
        now,
        reason: 'Backend work is still in progress'
      });
      blocked = true;
      continue;
    }

    const visibleCompletedAt = Math.max(
      visibleStartedAt + MIN_STAGE_VISIBLE_MS,
      actualAt || visibleStartedAt
    );

    if (now < visibleCompletedAt) {
      const reason = phase === 'approval'
        ? 'Review window is opening; the patient has not been notified'
        : recovered
          ? 'Safe fallback completed; holding the five-second presentation window'
          : 'Minimum five-second presentation window';
      pipeline[phase] = activeStage({
        base,
        visibleStartedAt,
        minimumVisibleUntil: visibleCompletedAt,
        now,
        reason
      });
      blocked = true;
      continue;
    }

    cursor = visibleCompletedAt;

    if (phase === 'approval') {
      const approved = (actions || []).some((action) => ['approved', 'executing', 'completed', 'failed', 'skipped'].includes(action.status));
      if (!approved && run?.status === 'awaiting_approval') {
        pipeline[phase] = {
          ...completedStage({ base, visibleStartedAt, visibleCompletedAt }),
          state: 'waiting',
          reason: 'Human approval required; the patient has not been notified'
        };
      } else {
        pipeline[phase] = completedStage({ base, visibleStartedAt, visibleCompletedAt });
      }
    } else {
      pipeline[phase] = completedStage({
        base,
        visibleStartedAt,
        visibleCompletedAt,
        reason: recovered ? 'Recovered using the safe localized fallback' : null
      });
    }
  }

  if (trace?.status === 'failed') {
    const failedPhase = PRE_APPROVAL_PHASES.find((phase) => pipeline[phase]?.state === 'failed');
    if (failedPhase) {
      const failedIndex = PRE_APPROVAL_PHASES.indexOf(failedPhase);
      PRE_APPROVAL_PHASES.slice(failedIndex + 1).forEach((phase) => {
        pipeline[phase] = notStartedStage(pipeline[phase] || {});
      });
    }
  }

  return pipeline;
}

function applyPostApprovalTimeline({ pipeline, run, actions, now }) {
  const approvedAtValues = (actions || [])
    .map((action) => toMs(action.approvedAt))
    .filter(Number.isFinite);
  const approvedAt = approvedAtValues.length ? Math.min(...approvedAtValues) : null;

  if (!approvedAt) {
    POST_APPROVAL_PHASES.forEach((phase) => {
      pipeline[phase] = notStartedStage(pipeline[phase] || {});
    });
    return pipeline;
  }

  let blocked = false;

  POST_APPROVAL_PHASES.forEach((phase, index) => {
    const base = pipeline[phase] || { state: 'not_started', durationMs: null, reason: null };

    if (blocked) {
      pipeline[phase] = notStartedStage(base);
      return;
    }

    if (base.state === 'failed') {
      pipeline[phase] = failedStage(base);
      blocked = true;
      return;
    }

    const visibleStartedAt = approvedAt + index * MIN_STAGE_VISIBLE_MS;
    const minimumVisibleUntil = visibleStartedAt + MIN_STAGE_VISIBLE_MS;

    if (now < visibleStartedAt) {
      pipeline[phase] = notStartedStage(base);
      return;
    }

    if (phase === 'completion') {
      if (run?.status === 'failed') {
        pipeline[phase] = failedStage(base, 'Run failed before patient delivery completed');
        return;
      }

      const runActuallyCompleted = ['completed', 'partially_completed'].includes(run?.status);
      const actualCompletedAt = toMs(run?.completedAt);
      const visibleCompletedAt = Math.max(minimumVisibleUntil, actualCompletedAt || minimumVisibleUntil);

      if (!runActuallyCompleted || now < visibleCompletedAt) {
        pipeline[phase] = activeStage({
          base,
          visibleStartedAt,
          minimumVisibleUntil: visibleCompletedAt,
          now,
          reason: 'Finalizing the approved notification; the patient is not notified until this completes'
        });
        return;
      }

      pipeline[phase] = completedStage({ base, visibleStartedAt, visibleCompletedAt });
      return;
    }

    if (now < minimumVisibleUntil) {
      pipeline[phase] = activeStage({
        base,
        visibleStartedAt,
        minimumVisibleUntil,
        now,
        reason: phase === 'notification'
          ? 'Preparing the patient result; no notification has been created yet'
          : 'Running approved safety and delivery checks'
      });
      return;
    }

    pipeline[phase] = completedStage({
      base,
      visibleStartedAt,
      visibleCompletedAt: minimumVisibleUntil
    });
  });

  return pipeline;
}

function applyNoShowPresentationTimeline({ pipeline, trace, run, actions = [], events = [], now = Date.now() }) {
  if (!run || run.agentType !== 'no_show_recovery' || trace?.status === 'deduplicated') return pipeline;
  if (run.status === 'queued_for_start' && !run.workflowStartedAt) {
    return Object.fromEntries(
      Object.keys(pipeline).map((phase) => [phase, {
        state: 'not_started',
        durationMs: null,
        reason: 'Waiting for administrator to start',
        visibleStartedAt: null,
        minimumVisibleUntil: null,
        visibleCompletedAt: null,
        remainingMs: null
      }])
    );
  }

  applyPreApprovalTimeline({ pipeline, trace, run, actions, events, now });
  applyPostApprovalTimeline({ pipeline, run, actions, now });
  return pipeline;
}

module.exports = {
  MIN_STAGE_VISIBLE_MS,
  PRE_APPROVAL_PHASES,
  POST_APPROVAL_PHASES,
  applyNoShowPresentationTimeline
};
