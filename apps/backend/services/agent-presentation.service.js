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
const TERMINAL_STATES = new Set(['completed', 'failed', 'skipped', 'not_applicable', 'inconsistent']);

function toMs(value) {
  const parsed = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function latestPhaseTime(events, phase) {
  const values = (events || [])
    .filter((event) => event.phase === phase)
    .map((event) => toMs(event.createdAt))
    .filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

function phaseActuallyReady(pipeline, run, phase) {
  if (phase === 'trigger' || phase === 'deduplication') return Boolean(run?.workflowStartedAt);
  if (phase === 'approval') {
    return ['awaiting_approval', 'executing', 'completed', 'partially_completed'].includes(run?.status);
  }
  return ['completed', 'skipped'].includes(pipeline?.[phase]?.state);
}

function activeStage({ base, visibleStartedAt, minimumVisibleUntil, now, reason }) {
  return {
    ...base,
    state: 'active',
    reason,
    durationMs: Math.max(0, now - visibleStartedAt),
    visibleStartedAt: new Date(visibleStartedAt).toISOString(),
    minimumVisibleUntil: new Date(minimumVisibleUntil).toISOString(),
    remainingMs: Math.max(0, minimumVisibleUntil - now)
  };
}

function completedStage({ base, visibleStartedAt, visibleCompletedAt }) {
  return {
    ...base,
    state: 'completed',
    reason: null,
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

function applyPreApprovalTimeline({ pipeline, trace, run, actions, events, now }) {
  const workflowStartedAt = toMs(run?.workflowStartedAt);
  if (!workflowStartedAt) return pipeline;

  let cursor = workflowStartedAt;
  let blocked = false;

  for (const phase of PRE_APPROVAL_PHASES) {
    const base = pipeline[phase] || { state: 'not_started', durationMs: null, reason: null };

    if (base.state === 'failed') {
      pipeline[phase] = base;
      blocked = true;
      continue;
    }

    if (blocked) {
      pipeline[phase] = notStartedStage(base);
      continue;
    }

    const ready = phaseActuallyReady(pipeline, run, phase);
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
      pipeline[phase] = completedStage({ base, visibleStartedAt, visibleCompletedAt });
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
    if (run?.status === 'awaiting_approval') {
      POST_APPROVAL_PHASES.forEach((phase) => {
        pipeline[phase] = notStartedStage(pipeline[phase] || {});
      });
    }
    return pipeline;
  }

  POST_APPROVAL_PHASES.forEach((phase, index) => {
    const base = pipeline[phase] || { state: 'not_started', durationMs: null, reason: null };
    if (base.state === 'failed') return;

    const visibleStartedAt = approvedAt + index * MIN_STAGE_VISIBLE_MS;
    const minimumVisibleUntil = visibleStartedAt + MIN_STAGE_VISIBLE_MS;

    if (now < visibleStartedAt) {
      pipeline[phase] = notStartedStage(base);
      return;
    }

    if (phase === 'completion') {
      const runActuallyCompleted = ['completed', 'partially_completed', 'failed'].includes(run?.status);
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
