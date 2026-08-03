import React, { useMemo, useState } from 'react';
import { apiRequest } from '../lib/api';

function statusLabel(status) {
  return String(status || '').replace(/_/g, ' ');
}

function actionDone(action) {
  return ['completed', 'failed', 'rejected', 'skipped'].includes(action.status);
}

export default function AgentPlanPanel({ appointment, agentType = 'no-show', user }) {
  const [run, setRun] = useState(null);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState('error');

  const config = useMemo(() => {
    if (agentType === 'post-visit') {
      return {
        title: 'Post-Consultation Follow-Up Plan',
        generateLabel: 'Generate post-visit plan',
        endpoint: `/api/agents/post-visit/${appointment.id}/plan`
      };
    }
    return {
      title: 'No-Show Recovery Plan',
      generateLabel: 'Generate recovery plan',
      endpoint: `/api/agents/no-show/${appointment.id}/plan`
    };
  }, [agentType, appointment.id]);

  const proposedActions = (run?.actions || []).filter((action) => action.status === 'proposed');
  const approvedActions = (run?.actions || []).filter((action) => action.status === 'approved');
  const executableCount = approvedActions.length;
  const adminApproval = agentType !== 'no-show' || user?.role === 'admin';

  const setRunAndSelection = (nextRun) => {
    setRun(nextRun);
    setSelected((nextRun?.actions || []).filter((action) => action.status === 'proposed').map((action) => action.id));
  };

  const postRunAction = async (path, body, busyLabel) => {
    setBusy(busyLabel);
    setMessage('');
    setMessageTone('error');
    const res = await apiRequest(path, { method: 'POST', body });
    setBusy('');
    if (!res.ok) {
      setMessage(res.data?.error || 'Agent request failed.');
      return;
    }
    if (res.status === 202 && res.data?.code === 'AGENT_EXECUTION_IN_PROGRESS') {
      setMessage('Execution is already in progress. The latest status is shown below.');
      setMessageTone('muted');
    }
    setRunAndSelection(res.data.run);
  };

  const generatePlan = async () => {
    await postRunAction(config.endpoint, { preferredLanguage: appointment.patient?.language || '' }, 'generate');
  };

  const approveSelected = async () => {
    if (!run?.id || selected.length === 0) return;
    await postRunAction(`/api/agents/runs/${run.id}/approve`, { actionIds: selected }, 'approve');
  };

  const rejectSelected = async () => {
    if (!run?.id || selected.length === 0) return;
    await postRunAction(`/api/agents/runs/${run.id}/reject`, { actionIds: selected, reason: 'Rejected in approval panel.' }, 'reject');
  };

  const executeApproved = async () => {
    if (!run?.id || executableCount === 0) return;
    await postRunAction(`/api/agents/runs/${run.id}/execute`, {}, 'execute');
  };

  const approveAndRun = async () => {
    if (!run?.id || selected.length === 0) return;
    await postRunAction(`/api/admin/agents/runs/${run.id}/approve-and-run`, { actionIds: selected }, 'approve-run');
  };

  const toggleAction = (actionId) => {
    setSelected((prev) => (prev.includes(actionId) ? prev.filter((id) => id !== actionId) : [...prev, actionId]));
  };

  return (
    <section className="agent-plan-panel" aria-label={config.title}>
      <div className="agent-plan-panel-head">
        <div>
          <p className="agent-plan-kicker">Approval required</p>
          <h2>{config.title}</h2>
        </div>
        <button type="button" className="agent-plan-primary" onClick={generatePlan} disabled={Boolean(busy)}>
          <span className="material-symbols-outlined" aria-hidden="true">psychology_alt</span>
          {busy === 'generate' ? 'Generating...' : config.generateLabel}
        </button>
      </div>

      {message ? <p className={messageTone}>{message}</p> : null}

      {run ? (
        <div className="agent-plan-body">
          <div className="agent-plan-summary">
            <span className="agent-plan-status">{statusLabel(run.status)}</span>
            <p>{run.summary || run.plan?.summary}</p>
            {run.plan?.patientMessage ? <blockquote>{run.plan.patientMessage}</blockquote> : null}
            {run.plan?.notificationTitle ? <p><strong>Patient notification title:</strong> {run.plan.notificationTitle}</p> : null}
            {run.plan?.languageName ? <p className="muted">Patient language: {run.plan.languageName} ({run.plan.languageCode}) · {run.plan.languageSource || 'profile'}{run.plan.languageFallbackUsed ? ' · Hindi fallback' : ''}</p> : null}
            {run.plan?.patientFriendlySummary ? <blockquote>{run.plan.patientFriendlySummary}</blockquote> : null}
            {run.plan?.fallbackUsed ? <p className="muted">Deterministic fallback was used for this draft.</p> : null}
            {run.plan?.model ? <p className="muted">Planner: {run.plan.model}</p> : null}
          </div>

          {Array.isArray(run.plan?.medicationExplanation) && run.plan.medicationExplanation.length ? (
            <div className="agent-plan-medicines">
              {run.plan.medicationExplanation.map((item, index) => (
                <article key={`${item.name}-${index}`}>
                  <strong>{item.name}</strong>
                  <p>{item.dosage} | {item.frequency} | {item.duration}</p>
                  <p>{item.plainInstruction}</p>
                </article>
              ))}
            </div>
          ) : null}

          <div className="agent-plan-actions">
            {(run.actions || []).map((action) => (
              <label className={`agent-plan-action ${action.status}`} key={action.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(action.id)}
                  disabled={action.status !== 'proposed' || actionDone(action)}
                  onChange={() => toggleAction(action.id)}
                />
                <span>
                  <strong>{action.title}</strong>
                  <small>{action.description}</small>
                  <small>
                    {statusLabel(action.status)} | Risk: {statusLabel(action.riskLevel)} | Delivery state:{' '}
                    {action.result?.deliveryStatus || 'not sent'}
                  </small>
                  {action.result?.messageId ? <small>External message ID: {action.result.messageId}</small> : null}
                  {action.error ? <small className="error">{action.error}</small> : null}
                </span>
              </label>
            ))}
          </div>

          <div className="agent-plan-controls">
            {adminApproval ? <>
              {agentType === 'no-show' ? (
                <button type="button" onClick={approveAndRun} disabled={Boolean(busy) || selected.length === 0 || proposedActions.length === 0}>
                  {busy === 'approve-run' ? 'Approving and running...' : 'Approve and Run'}
                </button>
              ) : <button type="button" onClick={approveSelected} disabled={Boolean(busy) || selected.length === 0 || proposedActions.length === 0}>
                {busy === 'approve' ? 'Approving...' : 'Approve selected'}
              </button>}
              <button type="button" className="ghost" onClick={rejectSelected} disabled={Boolean(busy) || selected.length === 0}>Reject</button>
              {agentType !== 'no-show' ? <button type="button" onClick={executeApproved} disabled={Boolean(busy) || executableCount === 0}>{busy === 'execute' ? 'Executing...' : 'Execute approved'}</button> : null}
            </> : <p className="muted">Only an administrator can approve or execute this no-show action. The patient has not been notified.</p>}
          </div>
        </div>
      ) : (
        <p className="muted">Generate a draft plan, review every action, then approve before anything is written for the patient.</p>
      )}
    </section>
  );
}
