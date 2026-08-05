import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest, utcDateTime } from '../lib/api';
import { createSupabaseBrowserClient } from '../../../../src/lib/supabase/browser';

const STAGES = [
  ['trigger', 'Triggered'], ['context', 'Context loaded'], ['policy', 'Policy validated'],
  ['deduplication', 'Deduplication checked'], ['planning', 'AI model called'], ['validation', 'Output validated'],
  ['persistence', 'Plan saved'], ['approval', 'Awaiting approval'], ['execution', 'Actions executing'],
  ['notification', 'Patient result'], ['completion', 'Completed']
];

const phaseLabel = (phase) => ({ planning: 'AI', policy: 'Policy', execution: 'Execution', notification: 'Notifications', approval: 'Approval', validation: 'Safety' }[phase] || phase);
const shortId = (value) => value ? `${value.slice(0, 8)}…` : '—';
const agentLabel = (value) => value === 'no_show_recovery' ? 'No-Show Recovery' : 'Post-Visit Follow-Up';

const TERMINAL_TRACE_STATUSES = new Set(['completed', 'partially_completed', 'failed', 'deduplicated', 'cancelled']);
const TERMINAL_EVENT_TYPES = new Set(['dedupe_hit', 'dedupe_miss', 'existing_run_returned', 'ai_response_received', 'ai_request_completed', 'ai_request_failed', 'deterministic_fallback_activated', 'json_parse_completed', 'json_parse_failed', 'response_schema_validation_passed', 'response_schema_validation_failed', 'medication_fidelity_check_passed', 'medication_fidelity_check_failed', 'agent_actions_created', 'awaiting_approval', 'approval_requested', 'action_rejected', 'action_completed', 'action_failed', 'patient_message_queued', 'notification_dismissed', 'refill_reminder_scheduled', 'refill_reminder_skipped', 'run_completed', 'run_partially_completed', 'run_failed', 'trace_completed']);

function stageState(events, phase, traceStatus) {
  const found = events.filter((event) => event.phase === phase);
  if (found.some((event) => event.status === 'failed')) return 'failed';
  if (found.some((event) => event.status === 'skipped')) return 'skipped';
  if (found.some((event) => TERMINAL_EVENT_TYPES.has(event.eventType) || event.status === 'completed')) return 'completed';
  if (found.some((event) => event.status === 'started')) return TERMINAL_TRACE_STATUSES.has(traceStatus) ? 'inconsistent' : 'active';
  return 'not-started';
}

function Stage({ phase, label, events, presentation, replay, traceStatus }) {
  const derived = presentation?.pipeline?.[phase];
  const state = replay ? stageState(events, phase, traceStatus) : derived?.state || stageState(events, phase, traceStatus);
  const duration = replay ? events.filter((event) => event.phase === phase && event.durationMs).at(-1)?.durationMs : derived?.durationMs;
  return <div className={`agent-stage ${state.replaceAll('_', '-')}`} aria-label={`${label}: ${state}`}>
    <span className="agent-stage-marker" aria-hidden="true">{state === 'completed' ? '✓' : state === 'failed' ? '!' : state === 'active' ? '•' : '○'}</span>
    <strong>{label}</strong><small>{state.replaceAll('_', ' ')}{derived?.reason ? ` · ${derived.reason}` : ''}{duration ? ` · ${duration} ms` : ''}</small>
  </div>;
}

function Metric({ label, value, tone }) {
  return <article className={`agent-ops-metric ${tone || ''}`}><span>{label}</span><strong>{value}</strong></article>;
}

function masked(value) { return value ? `${value.slice(0, 4)}…${value.slice(-4)}` : '—'; }

export default function AdminAgentOperationsPage({ user }) {
  const [overview, setOverview] = useState({});
  const [traces, setTraces] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [connection, setConnection] = useState('Connecting');
  const [lastSync, setLastSync] = useState(null);
  const [filter, setFilter] = useState('all');
  const [eventFilter, setEventFilter] = useState('all');
  const [paused, setPaused] = useState(false);
  const [presentation, setPresentation] = useState(false);
  const [replay, setReplay] = useState(false);
  const [replayIndex, setReplayIndex] = useState(null);
  const [controlBusy, setControlBusy] = useState(false);
  const [presentationPaced, setPresentationPaced] = useState(false);
  const manualSelectionRef = useRef(false);
  const pausedRef = useRef(paused);
  const eventIds = useRef(new Set());
  const lastCursor = useRef(null);
  const selectedIdRef = useRef(selectedId);
  const activeRunsRef = useRef(0);
  selectedIdRef.current = selectedId;
  activeRunsRef.current = overview.activeRuns || 0;
  pausedRef.current = paused;

  const sync = useCallback(async ({ incremental = false } = {}) => {
    const [summaryResponse, tracesResponse] = await Promise.all([
      apiRequest('/api/admin/agents/overview'),
      apiRequest('/api/admin/agents/traces?limit=50')
    ]);
    if (summaryResponse.ok) setOverview(summaryResponse.data.overview || {});
    if (tracesResponse.ok) {
      const rows = tracesResponse.data.rows || [];
      setTraces(rows);
      const newestActive = rows.find((row) => row.traceKind !== 'deduplicated_request' && ['active', 'awaiting_approval', 'executing'].includes(row.status));
      const preferred = newestActive || rows[0];
      if (!pausedRef.current && !manualSelectionRef.current && preferred && preferred.id !== selectedIdRef.current) setSelectedId(preferred.id);
    }
    if (incremental && lastCursor.current) {
      const eventsResponse = await apiRequest(`/api/admin/agents/events?after=${encodeURIComponent(lastCursor.current)}`);
      if (eventsResponse.ok && eventsResponse.data.events?.length) {
        const latest = eventsResponse.data.events.at(-1);
        lastCursor.current = eventsResponse.data.nextCursor || `${new Date(latest.createdAt).toISOString()}|${latest.id}`;
        if (selectedIdRef.current) {
          const current = await apiRequest(`/api/admin/agents/traces/${selectedIdRef.current}`);
          if (current.ok) setDetail(current.data.trace);
        }
      }
    }
    setLastSync(new Date().toISOString());
  }, []);

  useEffect(() => { sync(); }, [sync]);

  useEffect(() => {
    if (!selectedId) return undefined;
    let cancelled = false;
    apiRequest(`/api/admin/agents/traces/${selectedId}`).then((response) => {
      if (!cancelled && response.ok) {
        setDetail(response.data.trace);
        const latest = response.data.trace.events?.at(-1);
        if (latest) lastCursor.current = `${new Date(latest.createdAt).toISOString()}|${latest.id}`;
      }
    });
    return () => { cancelled = true; };
  }, [selectedId]);

  useEffect(() => {
    let channel;
    let disposed = false;
    let timer;
    const logRealtime = (message, details = {}) => {
      console.info(`[agent-realtime] ${message}`, details);
    };
    const beginPolling = () => {
      logRealtime('polling fallback started');
      setConnection('Polling fallback');
      clearInterval(timer);
      timer = setInterval(() => sync({ incremental: true }), activeRunsRef.current ? 2000 : 10000);
    };
    const connect = async () => {
      try {
      logRealtime('setup', {
        hasClient: true,
        userId: user?.id || null,
        role: user?.role || null,
        eventTable: 'AgentExecutionEvent',
        traceTable: 'AgentExecutionTrace'
      });
      const tokenResponse = await apiRequest('/api/admin/agents/realtime-token');
      logRealtime('token response', { ok: tokenResponse.ok, hasAccessToken: Boolean(tokenResponse.data?.accessToken) });
      if (!tokenResponse.ok || !tokenResponse.data?.accessToken || !tokenResponse.data?.url || !tokenResponse.data?.anonKey) {
        throw new Error('Realtime public configuration unavailable.');
      }
      const supabase = createSupabaseBrowserClient({ url: tokenResponse.data.url, anonKey: tokenResponse.data.anonKey });
      if (tokenResponse.ok && tokenResponse.data?.accessToken) {
        await supabase.realtime.setAuth(tokenResponse.data.accessToken);
      }
      if (disposed) {
        logRealtime('connection cancelled before channel creation');
        return;
      }
      logRealtime('channel creation', { topic: 'admin-agent-operations' });
      channel = supabase.channel('admin-agent-operations')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'AgentExecutionTrace' }, () => { sync(); })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'AgentExecutionEvent' }, (payload) => {
          const id = payload.new?.id;
          if (id && eventIds.current.has(id)) return;
          if (id) eventIds.current.add(id);
          const eventCreatedAt = payload.new?.createdAt ? new Date(payload.new.createdAt).getTime() : null;
          const receivedAt = Date.now();
          logRealtime('event received', {
            eventId: id || null,
            eventType: payload.new?.eventType || null,
            eventCreatedAt: payload.new?.createdAt || null,
            receivedAt: new Date(receivedAt).toISOString(),
            transportLatencyMs: eventCreatedAt ? Math.max(0, receivedAt - eventCreatedAt) : null
          });
          sync({ incremental: true });
        })
        .subscribe((status, error) => {
          logRealtime('channel status', {
            status,
            errorName: error?.name || null,
            errorMessage: error?.message || null
          });
          if (status === 'SUBSCRIBED') { setConnection('Live'); sync(); clearInterval(timer); }
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') beginPolling();
          else if (status === 'RECONNECTING') setConnection('Reconnecting');
        });
      } catch (error) {
        logRealtime('setup failed', { errorName: error?.name || null, errorMessage: error?.message || null });
        beginPolling();
      }
    };
    connect();
    const onFocus = () => sync({ incremental: true });
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      disposed = true;
      logRealtime('cleanup', { hasChannel: Boolean(channel) });
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      if (channel) channel.unsubscribe();
    };
  }, [sync, user?.id, user?.role]);

  const selected = detail || traces.find((trace) => trace.id === selectedId);
  const filteredTraces = useMemo(() => traces.filter((trace) => filter === 'all' || trace.status === filter || (filter === 'real-ai' && trace.run?.plan?.fallbackUsed === false) || (filter === 'fallback' && trace.run?.plan?.fallbackUsed === true)), [filter, traces]);
  const events = selected?.events || [];
  const visibleEvents = events.filter((event) => eventFilter === 'all' || event.phase === eventFilter);
  const replayEvents = replay && replayIndex !== null ? events.slice(0, replayIndex + 1) : events;

  const approveAndRun = async () => {
    if (!selected?.run?.id || controlBusy) return;
    setControlBusy(true);
    const actionIds = (selected.run.actions || []).filter((action) => action.status === 'proposed').map((action) => action.id);
    const response = await apiRequest(`/api/admin/agents/runs/${selected.run.id}/approve-and-continue`, { method: 'POST', body: { actionIds, executionMode: presentationPaced ? 'presentation_paced' : 'live' } });
    setControlBusy(false);
    if (response.ok || response.status === 202) {
      const refreshed = await apiRequest(`/api/admin/agents/traces/${selected.id}`);
      if (refreshed.ok) setDetail(refreshed.data.trace);
    }
  };

  const startWorkflow = async () => {
    if (!selected?.run?.id || controlBusy) return;
    setControlBusy(true);
    const response = await apiRequest(`/api/admin/agents/runs/${selected.run.id}/start`, { method: 'POST' });
    setControlBusy(false);
    if (response.ok || response.status === 202) {
      const refreshed = await apiRequest(`/api/admin/agents/traces/${selected.id}`);
      if (refreshed.ok) setDetail(refreshed.data.trace);
    }
  };

  const rejectRun = async () => {
    if (!selected?.run?.id || controlBusy) return;
    setControlBusy(true);
    const actionIds = (selected.run.actions || []).filter((action) => ['proposed', 'approved'].includes(action.status)).map((action) => action.id);
    const response = await apiRequest(`/api/agents/runs/${selected.run.id}/reject`, { method: 'POST', body: { actionIds, reason: 'Rejected by administrator.' } });
    setControlBusy(false);
    if (response.ok) {
      const refreshed = await apiRequest(`/api/admin/agents/traces/${selected.id}`);
      if (refreshed.ok) setDetail(refreshed.data.trace);
    }
  };

  useEffect(() => {
    if (!replay || !events.length) return undefined;
    setReplayIndex(0);
    const timer = setInterval(() => setReplayIndex((index) => index === null || index >= events.length - 1 ? index : index + 1), 600);
    return () => clearInterval(timer);
  }, [replay, selectedId, events.length]);

  if (user?.role !== 'admin') return <section className="page-shell"><article className="card"><h1>Forbidden</h1><p>Administrator access is required.</p></article></section>;

  return <section className={`page-shell agent-ops-page ${presentation ? 'agent-presentation-mode' : ''}`}>
    <header className="agent-ops-header">
      <div><p className="kicker">Restricted operations view</p><h1>AI Agent Operations Center</h1><p className="muted">Persisted workflow telemetry for No-Show Recovery and Post-Visit Follow-Up.</p></div>
      <div className="agent-ops-header-actions"><span className={`agent-connection ${connection.toLowerCase().replaceAll(' ', '-')}`}>{connection}</span><span className="agent-env-badge">Production</span><button type="button" onClick={() => setPaused((value) => !value)}>{paused ? 'Resume view' : 'Pause view'}</button><button type="button" onClick={() => setPresentation((value) => !value)}>{presentation ? 'Exit presentation' : 'Presentation'}</button><button type="button" onClick={() => sync()}>Refresh</button></div>
    </header>
    <div className="agent-ops-sync" aria-live="polite">Last synchronized: {lastSync ? utcDateTime(lastSync) : 'waiting'} · Visual updates only: {paused ? 'paused' : 'running'} {replay ? '· Historical replay' : ''}</div>
    <div className="agent-ops-metrics"><Metric label="Active agents" value={overview.activeRuns || 0} tone="blue"/><Metric label="Awaiting approval" value={overview.awaitingApproval || 0}/><Metric label="Executing" value={overview.executing || 0}/><Metric label="Completed today" value={overview.completedToday || 0} tone="green"/><Metric label="Failed today" value={overview.failedToday || 0} tone="red"/><Metric label="Real-AI success" value={`${overview.realAiSuccessRate || 0}%`} tone="purple"/><Metric label="Fallback rate" value={`${overview.fallbackRate || 0}%`} tone="amber"/><Metric label="Avg total duration" value={`${overview.averageTotalRunDurationMs || 0} ms`}/></div>
    <div className="agent-ops-layout">
      <aside className="agent-run-list card"><div className="agent-panel-heading"><h2>Runs</h2><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter traces"><option value="all">All</option><option value="active">Active</option><option value="awaiting_approval">Awaiting approval</option><option value="executing">Executing</option><option value="completed">Completed</option><option value="failed">Failed</option><option value="real-ai">Real AI</option><option value="fallback">Fallback</option></select></div>{filteredTraces.length ? filteredTraces.map((trace) => <button type="button" className={`agent-run-card ${trace.id === selectedId ? 'selected' : ''}`} key={trace.id} onClick={() => { manualSelectionRef.current = true; setSelectedId(trace.id); setReplay(false); }}><span className="agent-run-card-top"><strong>{agentLabel(trace.agentType)}</strong><span className={`agent-status ${trace.status}`}>{trace.status.replaceAll('_', ' ')}</span></span><span>Trace {shortId(trace.id)} · Appt {shortId(trace.appointmentId)}</span><span>{trace.integrity?.status === 'historical_unresolved' ? 'Historical record · original relationship unavailable' : `${trace.run?.plan?.model || 'Provider pending'} · ${trace.run?.plan?.fallbackUsed ? 'Deterministic fallback' : trace.run?.plan ? 'Real AI' : 'Planning'}`}</span><small>{utcDateTime(trace.updatedAt)}</small></button>) : <p className="muted">No persisted traces yet. Trigger an agent to begin.</p>}</aside>
      <main className="agent-ops-main">{selected ? <>
        <article className="card agent-selected-summary"><div><p className="kicker">{replay ? 'Historical replay' : 'Selected trace'}</p><h2>{agentLabel(selected.agentType)}</h2><p className="muted">Trace {presentation ? masked(selected.id) : selected.id} · Run {presentation ? masked(selected.run?.id) : selected.run?.id || (selected.status === 'deduplicated' ? 'existing run reused' : 'not linked yet')}</p>{selected.run?.status === 'queued_for_start' ? <p className="muted">The doctor created this recovery ticket. The workflow has not started, and the patient has not been notified.</p> : null}{selected.integrity?.status === 'historical_unresolved' ? <p className="muted">Historical record · original relationship unavailable · terminal · no action required</p> : null}</div><div className="agent-selected-badges"><span className={`agent-status ${selected.status}`}>{selected.status.replaceAll('_', ' ')}</span><span>{selected.presentation?.outcome === 'existing_run_reused' ? 'Existing run reused' : selected.run?.plan?.model || (selected.presentation?.isTerminal ? 'No model call' : 'Model pending')}</span><span>{selected.run?.plan?.fallbackUsed ? 'Fallback used' : selected.run?.plan ? 'Real AI' : selected.run?.status === 'queued_for_start' ? 'Waiting for admin start' : selected.status === 'awaiting_approval' ? 'Human approval required' : selected.presentation?.outcome === 'existing_run_reused' ? 'No duplicate AI request' : '—'}</span></div>{user?.role === 'admin' && selected.agentType === 'no_show_recovery' && selected.run?.status === 'queued_for_start' && !replay ? <div className="agent-plan-controls"><button type="button" onClick={startWorkflow} disabled={controlBusy}>{controlBusy ? 'Starting…' : 'Start Workflow'}</button><button type="button" className="ghost" onClick={rejectRun} disabled={controlBusy}>Reject Ticket</button></div> : null}{user?.role === 'admin' && selected.agentType === 'no_show_recovery' && selected.run?.status === 'awaiting_approval' && !replay ? <div className="agent-plan-controls"><label><input type="checkbox" checked={presentationPaced} onChange={(event) => setPresentationPaced(event.target.checked)} /> Run in presentation mode</label><button type="button" onClick={approveAndRun} disabled={controlBusy}>{controlBusy ? 'Continuing…' : 'Approve and Continue'}</button><button type="button" className="ghost" onClick={rejectRun} disabled={controlBusy}>Reject</button></div> : null}</article>
        <article className="card"><div className="agent-panel-heading"><h2>Live workflow pipeline</h2><span className="muted">Stages are driven by persisted backend state and events</span></div><div className="agent-pipeline">{STAGES.map(([phase, label]) => <Stage key={phase} phase={phase} label={label} events={replayEvents} presentation={selected.presentation} replay={replay} traceStatus={replay ? null : selected.status}/>)}</div></article>
        {selected.run?.plan?.languageName ? <article className="card agent-language-card"><div className="agent-panel-heading"><h2>Patient language and exact draft</h2><span className="muted">Approval locks this content version</span></div><p><strong>Language:</strong> {selected.run.plan.languageName} ({selected.run.plan.languageCode}) · {selected.run.plan.languageScript} · {selected.run.plan.languageDirection?.toUpperCase()} · {selected.run.plan.languageSource || 'profile'} · {selected.run.plan.languageFallbackUsed ? 'Hindi fallback' : 'No fallback'}</p><div dir={selected.run.plan.languageDirection === 'rtl' ? 'rtl' : 'ltr'}><strong>{selected.run.plan.notificationTitle || 'Patient notification'}</strong><p>{selected.run.plan.patientMessage}</p></div><small>Generation: {selected.run.plan.generationSource || (selected.run.plan.fallbackUsed ? 'deterministic_localized_template' : 'AI')} · {selected.run.messageDrafts?.[0]?.status || 'draft'} · hash {selected.run.messageDrafts?.[0]?.contentHash || 'pending'} · Execution mode: {selected.run.executionMode || 'live'}</small></article> : null}
        {selected.run?.executionSteps?.length ? <article className="card"><div className="agent-panel-heading"><h2>Server-owned delivery steps</h2><span className="muted">The browser cannot authorize delivery</span></div><div className="agent-pipeline">{selected.run.executionSteps.map((step) => <div className={`agent-stage ${step.status}`} key={step.id}><span className="agent-stage-marker" aria-hidden="true">{step.status === 'completed' ? '✓' : step.status === 'failed' ? '!' : '○'}</span><strong>{step.sequence}. {step.title}</strong><small>{step.status}{step.durationMs ? ` · ${step.durationMs} ms` : ''}</small></div>)}</div></article> : null}
        <div className="agent-ops-two-column"><article className="card"><div className="agent-panel-heading"><h2>Action branches</h2><span className="muted">Approval-gated server tools</span></div>{selected.run?.actions?.length ? selected.run.actions.map((action) => <div className="agent-action-branch" key={action.id}><div><strong>{action.title}</strong><span>{action.toolName} · {action.riskLevel} risk</span></div><span className={`agent-status ${action.status}`}>{action.status}</span><small>Approver: {action.approvedById ? shortId(action.approvedById) : 'pending'}{action.result?.reason ? ` · ${action.result.reason}` : ''}</small></div>) : <p className="muted">Actions appear after plan persistence.</p>}</article><article className="card"><div className="agent-panel-heading"><h2>Operational console</h2><button type="button" onClick={() => { setReplay(!replay); setReplayIndex(null); }}>{replay ? 'Stop replay' : 'Replay audit timeline'}</button></div><div className="agent-console">{replayEvents.slice(-12).map((event) => <div key={event.id}>[{phaseLabel(event.phase).toUpperCase()}] {event.title}{event.durationMs ? ` · ${event.durationMs}ms` : ''}</div>)}</div></article></div>
        <article className="card"><div className="agent-panel-heading"><h2>Activity timeline</h2><select value={eventFilter} onChange={(event) => setEventFilter(event.target.value)} aria-label="Filter activity events"><option value="all">All events</option>{['trigger','context','policy','deduplication','planning','validation','persistence','approval','execution','notification','completion'].map((phase) => <option key={phase} value={phase}>{phaseLabel(phase)}</option>)}</select></div><div className="agent-timeline">{visibleEvents.map((event) => <div className={`agent-event ${event.status}`} key={event.id}><time>{new Date(event.createdAt).toLocaleTimeString('en-IN', { hour12: false })}</time><span className="agent-event-phase">{phaseLabel(event.phase)}</span><div><strong>{event.title}</strong><p>{event.message || event.eventType}{event.durationMs ? ` · ${event.durationMs} ms` : ''}</p></div></div>)}</div></article>
        <article className="card agent-inspector"><h2>Run inspector</h2><div className="agent-inspector-grid"><div><span>Appointment status</span><strong>{selected.appointment?.status || '—'}</strong></div><div><span>Trigger</span><strong>{selected.run?.triggeredBy || 'request'}</strong></div><div><span>Actor</span><strong>{selected.actor?.role || '—'}</strong></div><div><span>Context</span><strong>{selected.run?.context ? 'Loaded (sanitized)' : 'Pending'}</strong></div><div><span>Patient result</span><strong>{selected.run?.actions?.some((action) => action.result?.messageId) ? 'Queued' : 'Pending'}</strong></div><div><span>Safety</span><strong>{events.some((event) => event.eventType === 'medication_fidelity_check_failed') ? 'Failed' : 'Server validated'}</strong></div></div><details><summary>AI-generated draft requiring human approval</summary><pre>{JSON.stringify(selected.run?.plan || {}, null, 2)}</pre></details><details><summary>Sanitized raw JSON</summary><pre>{JSON.stringify({ trace: selected, events: selected.events }, null, 2)}</pre></details></article>
      </> : <article className="card agent-empty-state"><h2>Waiting for an agent trace</h2><p>Open a doctor session in another browser and trigger a demo agent. The persisted trace will appear here automatically.</p></article>}</main>
    </div>
  </section>;
}
