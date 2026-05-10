import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api';

const ASYNC_REPLY_QUEUE_KEY = 'async:reply-queue:v1';
const IST_TIME_ZONE = 'Asia/Kolkata';

function getErrorMessage(response, fallback) {
  return response?.data?.error || response?.data?.message || fallback;
}

function compactDate(value) {
  if (!value) return 'N/A';
  try {
    return `${new Date(value).toLocaleString('en-IN', { timeZone: IST_TIME_ZONE })} IST`;
  } catch (_error) {
    return String(value);
  }
}

function parseNumber(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export default function InnovationHubPage({ user }) {
  const navigate = useNavigate();

  const defaultPatientId = user?.role === 'patient' ? user.id : '';
  const defaultDoctorId = user?.role === 'doctor' ? user.id : '';

  const [voiceCommand, setVoiceCommand] = useState('Book urgent appointment');
  const [voiceMessage, setVoiceMessage] = useState('');
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [listening, setListening] = useState(false);

  const [triageText, setTriageText] = useState('');
  const [triageResult, setTriageResult] = useState(null);
  const [triageMessage, setTriageMessage] = useState('');

  const [vitalsForm, setVitalsForm] = useState({
    appointmentId: '',
    bpSystolic: '',
    bpDiastolic: '',
    spo2Percent: '',
    pulseBpm: '',
    glucoseMgDl: '',
    temperatureC: ''
  });
  const [vitalsMessage, setVitalsMessage] = useState('');

  const [carePlanForm, setCarePlanForm] = useState({
    patientId: defaultPatientId,
    condition: '',
    checkInIntervalDays: '30',
    milestones: ''
  });
  const [carePlanMessage, setCarePlanMessage] = useState('');

  const [emergencyMessage, setEmergencyMessage] = useState('');
  const [emergencyBusy, setEmergencyBusy] = useState(false);

  const [threadForm, setThreadForm] = useState({ appointmentId: '', channel: 'whatsapp', contactPhone: '' });
  const [threadData, setThreadData] = useState(null);
  const [threadMessage, setThreadMessage] = useState('');
  const [externalMessageBody, setExternalMessageBody] = useState('');
  const [pendingReplies, setPendingReplies] = useState(() => {
    try {
      const raw = window.localStorage.getItem(ASYNC_REPLY_QUEUE_KEY);
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (_err) {
      return [];
    }
  });

  const [voiceNoteForm, setVoiceNoteForm] = useState({ appointmentId: '', transcriptText: '', summaryText: '' });
  const [voiceNoteMessage, setVoiceNoteMessage] = useState('');

  const [trendPatientId, setTrendPatientId] = useState(defaultPatientId);
  const [trendData, setTrendData] = useState(null);
  const [trendMessage, setTrendMessage] = useState('');

  const [refillPatientId, setRefillPatientId] = useState(defaultPatientId);
  const [refillData, setRefillData] = useState([]);
  const [refillMessage, setRefillMessage] = useState('');

  const [secondOpinionForm, setSecondOpinionForm] = useState({ appointmentId: '', secondDoctorId: '', consentNote: '' });
  const [secondOpinionData, setSecondOpinionData] = useState([]);
  const [secondOpinionMessage, setSecondOpinionMessage] = useState('');

  const [trustDoctorId, setTrustDoctorId] = useState(defaultDoctorId);
  const [trustData, setTrustData] = useState(null);
  const [trustMessage, setTrustMessage] = useState('');

  const [offlineMessage, setOfflineMessage] = useState('');

  const speechSupported = useMemo(
    () => typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
    []
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(ASYNC_REPLY_QUEUE_KEY, JSON.stringify(pendingReplies.slice(0, 200)));
    } catch (_err) {}
  }, [pendingReplies]);

  useEffect(() => {
    const flushQueue = async () => {
      if (!navigator.onLine || pendingReplies.length === 0) return;
      const remaining = [];
      for (const item of pendingReplies) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const res = await apiRequest(`/api/innovations/external-threads/${item.threadId}/messages`, {
            method: 'POST',
            body: {
              direction: 'outbound',
              body: item.body,
              deliveryStatus: 'queued'
            }
          });
          if (!res.ok) {
            remaining.push(item);
          }
        } catch (_err) {
          remaining.push(item);
        }
      }
      setPendingReplies(remaining);
    };

    window.addEventListener('online', flushQueue);
    return () => window.removeEventListener('online', flushQueue);
  }, [pendingReplies]);

  const captureVoice = () => {
    if (!speechSupported) {
      setVoiceMessage('Speech input is not available in this browser. Type your command manually.');
      return;
    }

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new Recognition();
    recognition.lang = user?.language || 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    setListening(true);
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      setVoiceCommand(transcript);
      setListening(false);
    };
    recognition.onerror = () => {
      setVoiceMessage('Unable to capture voice right now. You can still type commands.');
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
    };

    recognition.start();
  };

  const submitVoiceIntent = async (event) => {
    event.preventDefault();
    setVoiceBusy(true);
    setVoiceMessage('');

    const res = await apiRequest('/api/innovations/voice/intent', {
      method: 'POST',
      body: {
        transcript: voiceCommand,
        language: user?.language || 'en'
      }
    });

    setVoiceBusy(false);

    if (!res.ok) {
      setVoiceMessage(getErrorMessage(res, 'Could not process voice command.'));
      return;
    }

    const actionLabel = res.data?.actionLabel || 'Voice command processed';
    const route = res.data?.route || '/dashboard';
    setVoiceMessage(`${actionLabel}. Redirecting...`);
    window.setTimeout(() => navigate(route), 450);
  };

  const runTriage = async (event) => {
    event.preventDefault();
    setTriageMessage('');

    const res = await apiRequest('/api/innovations/triage/preview', {
      method: 'POST',
      body: { problemDescription: triageText }
    });

    if (!res.ok) {
      setTriageMessage(getErrorMessage(res, 'Could not run triage.'));
      return;
    }

    setTriageResult(res.data?.triage || null);
    setTriageMessage(res.data?.shouldEscalate ? 'Critical symptoms detected. Escalation advised.' : 'Triage guidance ready.');
  };

  const submitVitals = async (event) => {
    event.preventDefault();
    setVitalsMessage('');

    const appointmentId = vitalsForm.appointmentId.trim();
    if (!appointmentId) {
      setVitalsMessage('Appointment ID is required.');
      return;
    }

    const res = await apiRequest(`/api/innovations/appointments/${appointmentId}/vitals`, {
      method: 'POST',
      body: {
        bpSystolic: parseNumber(vitalsForm.bpSystolic),
        bpDiastolic: parseNumber(vitalsForm.bpDiastolic),
        spo2Percent: parseNumber(vitalsForm.spo2Percent),
        pulseBpm: parseNumber(vitalsForm.pulseBpm),
        glucoseMgDl: parseNumber(vitalsForm.glucoseMgDl),
        temperatureC: parseNumber(vitalsForm.temperatureC)
      }
    });

    if (!res.ok) {
      setVitalsMessage(getErrorMessage(res, 'Could not save vitals.'));
      return;
    }

    setVitalsMessage(`Vitals saved. Risk: ${res.data?.risk?.severity || 'unknown'}.`);
  };

  const submitCarePlan = async (event) => {
    event.preventDefault();
    setCarePlanMessage('');

    const patientId = carePlanForm.patientId.trim();
    if (!patientId) {
      setCarePlanMessage('Patient ID is required.');
      return;
    }

    const milestones = carePlanForm.milestones
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    const res = await apiRequest(`/api/innovations/patients/${patientId}/care-plans`, {
      method: 'POST',
      body: {
        patientId,
        condition: carePlanForm.condition,
        checkInIntervalDays: Number(carePlanForm.checkInIntervalDays || 30),
        milestones
      }
    });

    if (!res.ok) {
      setCarePlanMessage(getErrorMessage(res, 'Could not create care plan.'));
      return;
    }

    setCarePlanMessage('Chronic pathway created with auto check-in schedule.');
  };

  const getCurrentCoords = () =>
    new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            locationLat: position.coords.latitude,
            locationLng: position.coords.longitude,
            locationText: 'Captured from browser location.'
          });
        },
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 }
      );
    });

  const triggerAmbulanceCall = async () => {
    setEmergencyMessage('');
    setEmergencyBusy(true);

    const coordsPayload = await getCurrentCoords();
    const res = await apiRequest('/api/innovations/emergency/ambulance', {
      method: 'POST',
      body: coordsPayload || {}
    });

    setEmergencyBusy(false);

    if (!res.ok) {
      setEmergencyMessage(getErrorMessage(res, 'Could not initiate ambulance escalation.'));
      return;
    }

    const ambulanceNumber = String(res.data?.ambulanceNumber || '108');
    setEmergencyMessage('Ambulance escalation created. Calling emergency number now...');
    window.location.href = `tel:${ambulanceNumber}`;
  };

  const createExternalThread = async (event) => {
    event.preventDefault();
    setThreadMessage('');

    const appointmentId = threadForm.appointmentId.trim();
    if (!appointmentId) {
      setThreadMessage('Appointment ID is required.');
      return;
    }

    const res = await apiRequest(`/api/innovations/appointments/${appointmentId}/external-thread`, {
      method: 'POST',
      body: {
        channel: threadForm.channel,
        contactPhone: threadForm.contactPhone
      }
    });

    if (!res.ok) {
      setThreadMessage(getErrorMessage(res, 'Could not create external thread.'));
      return;
    }

    setThreadData({ thread: res.data?.thread, messages: [] });
    setThreadMessage('External channel linked for follow-up.');
  };

  const postExternalMessage = async (event) => {
    event.preventDefault();
    setThreadMessage('');

    const threadId = threadData?.thread?.id;
    if (!threadId) {
      setThreadMessage('Create or load a thread first.');
      return;
    }

    const draftBody = String(externalMessageBody || '').trim();
    if (!draftBody) {
      setThreadMessage('Message body is required.');
      return;
    }

    if (!navigator.onLine) {
      const queuedItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        threadId,
        body: draftBody,
        createdAt: new Date().toISOString()
      };
      setPendingReplies((prev) => [queuedItem, ...prev].slice(0, 200));
      setExternalMessageBody('');
      setThreadMessage('No signal. Reply queued and will send automatically when connected.');
      return;
    }

    const res = await apiRequest(`/api/innovations/external-threads/${threadId}/messages`, {
      method: 'POST',
      body: {
        direction: 'outbound',
        body: draftBody,
        deliveryStatus: 'queued'
      }
    });

    if (!res.ok) {
      setThreadMessage(getErrorMessage(res, 'Could not append thread message.'));
      return;
    }

    const nextMessages = [...(threadData.messages || []), res.data?.message].filter(Boolean);
    setThreadData((prev) => ({ ...(prev || {}), messages: nextMessages }));
    setExternalMessageBody('');
    setThreadMessage('Follow-up message synced to thread.');
  };

  const saveVoiceNote = async (event) => {
    event.preventDefault();
    setVoiceNoteMessage('');

    const appointmentId = voiceNoteForm.appointmentId.trim();
    if (!appointmentId) {
      setVoiceNoteMessage('Appointment ID is required.');
      return;
    }

    const res = await apiRequest(`/api/innovations/appointments/${appointmentId}/voice-notes`, {
      method: 'POST',
      body: {
        transcriptText: voiceNoteForm.transcriptText,
        summaryText: voiceNoteForm.summaryText,
        language: user?.language || 'en'
      }
    });

    if (!res.ok) {
      setVoiceNoteMessage(getErrorMessage(res, 'Could not save voice note.'));
      return;
    }

    setVoiceNoteMessage('Voice note saved for low-literacy follow-up.');
  };

  const loadTrend = async (event) => {
    event.preventDefault();
    setTrendMessage('');

    const patientId = trendPatientId.trim();
    if (!patientId) {
      setTrendMessage('Patient ID is required.');
      return;
    }

    const res = await apiRequest(`/api/innovations/patients/${patientId}/trends`);
    if (!res.ok) {
      setTrendMessage(getErrorMessage(res, 'Could not fetch trend data.'));
      return;
    }

    setTrendData(res.data || null);
    setTrendMessage(`Loaded ${res.data?.count || 0} trend points.`);
  };

  const loadRefill = async (event) => {
    event.preventDefault();
    setRefillMessage('');

    const patientId = refillPatientId.trim();
    if (!patientId) {
      setRefillMessage('Patient ID is required.');
      return;
    }

    const res = await apiRequest(`/api/innovations/patients/${patientId}/refill-reminders`);
    if (!res.ok) {
      setRefillMessage(getErrorMessage(res, 'Could not load refill reminders.'));
      return;
    }

    setRefillData(res.data?.reminders || []);
    setRefillMessage('Refill plan loaded.');
  };

  const requestSecondOpinion = async (event) => {
    event.preventDefault();
    setSecondOpinionMessage('');

    const appointmentId = secondOpinionForm.appointmentId.trim();
    if (!appointmentId) {
      setSecondOpinionMessage('Appointment ID is required.');
      return;
    }

    const createRes = await apiRequest(`/api/innovations/appointments/${appointmentId}/second-opinions`, {
      method: 'POST',
      body: {
        secondDoctorId: secondOpinionForm.secondDoctorId,
        consentNote: secondOpinionForm.consentNote
      }
    });

    if (!createRes.ok) {
      setSecondOpinionMessage(getErrorMessage(createRes, 'Could not request second opinion.'));
      return;
    }

    const listRes = await apiRequest(`/api/innovations/appointments/${appointmentId}/second-opinions`);
    if (listRes.ok) {
      setSecondOpinionData(listRes.data?.requests || []);
    }

    setSecondOpinionMessage('Second-opinion request submitted with consent trail.');
  };

  const loadTrustScore = async (event) => {
    event.preventDefault();
    setTrustMessage('');

    const doctorId = trustDoctorId.trim();
    if (!doctorId) {
      setTrustMessage('Doctor ID is required.');
      return;
    }

    const res = await apiRequest(`/api/innovations/doctors/${doctorId}/trust-score`);
    if (!res.ok) {
      setTrustMessage(getErrorMessage(res, 'Could not load trust score.'));
      return;
    }

    setTrustData(res.data?.trust || null);
    setTrustMessage('Trust score computed from outcomes, rating, and response time.');
  };

  const syncOfflineQueue = async () => {
    setOfflineMessage('');

    const raw = window.localStorage.getItem('innovation-offline-queue:v1');
    const queue = raw
      ? JSON.parse(raw)
      : [
          {
            type: 'book_appointment',
            payload: { mode: 'audio' },
            createdAt: new Date().toISOString()
          }
        ];

    const res = await apiRequest('/api/innovations/offline/sync', {
      method: 'POST',
      body: { queue }
    });

    if (!res.ok) {
      setOfflineMessage(getErrorMessage(res, 'Could not sync offline queue.'));
      return;
    }

    setOfflineMessage(`Synced ${res.data?.accepted?.length || 0} offline events.`);
    window.localStorage.setItem('innovation-offline-queue:v1', JSON.stringify([]));
  };

  return (
    <>
      <section className="journey-hero">
        <h2 className="journey-title">Innovation Hub</h2>
        <p className="journey-sub">
          Voice-first navigation, emergency support, chronic pathways, and async care operations.
        </p>
        <div className="row-inline">
          <Link className="journey-cta subtle" to="/appointments">
            Back to Appointments
          </Link>
          <Link className="journey-cta subtle" to="/book">
            Open Booking
          </Link>
        </div>
      </section>

      <section className="journey-workspace-grid">
        <article className="card">
          <h3>Voice-First Navigation</h3>
          <form className="stack" onSubmit={submitVoiceIntent}>
            <label>
              Command transcript
              <input value={voiceCommand} onChange={(event) => setVoiceCommand(event.target.value)} required />
            </label>
            <div className="row-inline">
              <button type="button" onClick={captureVoice} disabled={listening}>
                {listening ? 'Listening...' : speechSupported ? 'Capture Voice' : 'Voice Unsupported'}
              </button>
              <button type="submit" disabled={voiceBusy}>
                {voiceBusy ? 'Processing...' : 'Run Command'}
              </button>
            </div>
          </form>
          {voiceMessage ? <p className="muted">{voiceMessage}</p> : null}
        </article>

        <article className="card">
          <h3>Booking Triage Ownership</h3>
          <p className="muted">
            Pre-consult triage now lives in Booking Flow so routing happens before appointment confirmation.
          </p>
          <Link className="btn subtle" to="/book">
            Open Booking Triage
          </Link>
        </article>
      </section>

      <section className="journey-workspace-grid">
        <article className="card">
          <h3>Consultation Vitals Capture</h3>
          <form className="stack" onSubmit={submitVitals}>
            <input
              placeholder="Appointment ID"
              value={vitalsForm.appointmentId}
              onChange={(event) => setVitalsForm((prev) => ({ ...prev, appointmentId: event.target.value }))}
              required
            />
            <div className="grid four">
              <input placeholder="BP Sys" value={vitalsForm.bpSystolic} onChange={(event) => setVitalsForm((prev) => ({ ...prev, bpSystolic: event.target.value }))} />
              <input placeholder="BP Dia" value={vitalsForm.bpDiastolic} onChange={(event) => setVitalsForm((prev) => ({ ...prev, bpDiastolic: event.target.value }))} />
              <input placeholder="SpO2" value={vitalsForm.spo2Percent} onChange={(event) => setVitalsForm((prev) => ({ ...prev, spo2Percent: event.target.value }))} />
              <input placeholder="Pulse" value={vitalsForm.pulseBpm} onChange={(event) => setVitalsForm((prev) => ({ ...prev, pulseBpm: event.target.value }))} />
              <input placeholder="Glucose" value={vitalsForm.glucoseMgDl} onChange={(event) => setVitalsForm((prev) => ({ ...prev, glucoseMgDl: event.target.value }))} />
              <input placeholder="Temp C" value={vitalsForm.temperatureC} onChange={(event) => setVitalsForm((prev) => ({ ...prev, temperatureC: event.target.value }))} />
            </div>
            <button type="submit">Save Vitals</button>
          </form>
          {vitalsMessage ? <p className="muted">{vitalsMessage}</p> : null}
        </article>

        <article className="card">
          <h3>Emergency Escalation</h3>
          <p className="muted">Direct ambulance flow for patient emergencies. Patient details are attached automatically.</p>
          <button type="button" onClick={triggerAmbulanceCall} disabled={emergencyBusy}>
            {emergencyBusy ? 'Contacting Ambulance...' : 'Call Ambulance (108)'}
          </button>
          {emergencyMessage ? <p className="muted">{emergencyMessage}</p> : null}
        </article>
      </section>

      <section className="journey-workspace-grid">
        <article className="card">
          <h3>Chronic Care Pathways</h3>
          <form className="stack" onSubmit={submitCarePlan}>
            <input placeholder="Patient ID" value={carePlanForm.patientId} onChange={(event) => setCarePlanForm((prev) => ({ ...prev, patientId: event.target.value }))} required />
            <input placeholder="Condition" value={carePlanForm.condition} onChange={(event) => setCarePlanForm((prev) => ({ ...prev, condition: event.target.value }))} required />
            <input placeholder="Check-in interval (days)" type="number" min="1" value={carePlanForm.checkInIntervalDays} onChange={(event) => setCarePlanForm((prev) => ({ ...prev, checkInIntervalDays: event.target.value }))} />
            <input placeholder="Milestones (comma separated)" value={carePlanForm.milestones} onChange={(event) => setCarePlanForm((prev) => ({ ...prev, milestones: event.target.value }))} />
            <button type="submit">Create Care Pathway</button>
          </form>
          {carePlanMessage ? <p className="muted">{carePlanMessage}</p> : null}
        </article>

        <article className="card">
          <h3>WhatsApp/SMS Follow-up Thread</h3>
          <form className="stack" onSubmit={createExternalThread}>
            <input placeholder="Appointment ID" value={threadForm.appointmentId} onChange={(event) => setThreadForm((prev) => ({ ...prev, appointmentId: event.target.value }))} required />
            <select value={threadForm.channel} onChange={(event) => setThreadForm((prev) => ({ ...prev, channel: event.target.value }))}>
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
            </select>
            <input placeholder="Contact phone" value={threadForm.contactPhone} onChange={(event) => setThreadForm((prev) => ({ ...prev, contactPhone: event.target.value }))} />
            <button type="submit">Link Channel</button>
          </form>

          <form className="stack" onSubmit={postExternalMessage}>
            <textarea placeholder="Message body" value={externalMessageBody} onChange={(event) => setExternalMessageBody(event.target.value)} rows={3} />
            <button type="submit">Send Follow-up Message</button>
          </form>

          {threadMessage ? <p className="muted">{threadMessage}</p> : null}
          {pendingReplies.length > 0 ? <p className="muted">⏳ {pendingReplies.length} queued repl{pendingReplies.length === 1 ? 'y' : 'ies'} waiting for network.</p> : null}
          {(threadData?.messages || []).slice(-3).map((message) => (
            <p className="muted" key={message.id}>{message.body}</p>
          ))}
        </article>
      </section>

      <section className="journey-workspace-grid">
        <article className="card">
          <h3>Voice Notes for Low Literacy</h3>
          <p className="muted">Moved to the live consultation flow so doctors can attach voice summaries during an actual appointment.</p>
          <Link className="btn subtle" to="/appointments">
            Open Consultation Flow
          </Link>
        </article>
      </section>

      <section className="journey-workspace-grid">
        <article className="card">
          <h3>Refill Reminder Engine</h3>
          <form className="row-inline" onSubmit={loadRefill}>
            <input placeholder="Patient ID" value={refillPatientId} onChange={(event) => setRefillPatientId(event.target.value)} required />
            <button type="submit">Load Refill Reminders</button>
          </form>
          {refillMessage ? <p className="muted">{refillMessage}</p> : null}
          {refillData.slice(0, 3).map((item) => (
            <article className="list-item" key={item.appointmentId}>
              <div>
                <strong>{item.diagnosis || 'Follow-up reminder'}</strong>
                <p className="muted">{item.daysUntilFollowUp} day(s) until follow-up</p>
              </div>
            </article>
          ))}
        </article>

        <article className="card">
          <h3>Consented Second Opinion</h3>
          <form className="stack" onSubmit={requestSecondOpinion}>
            <input placeholder="Appointment ID" value={secondOpinionForm.appointmentId} onChange={(event) => setSecondOpinionForm((prev) => ({ ...prev, appointmentId: event.target.value }))} required />
            <input placeholder="Second doctor ID (optional)" value={secondOpinionForm.secondDoctorId} onChange={(event) => setSecondOpinionForm((prev) => ({ ...prev, secondDoctorId: event.target.value }))} />
            <textarea placeholder="Consent note" value={secondOpinionForm.consentNote} onChange={(event) => setSecondOpinionForm((prev) => ({ ...prev, consentNote: event.target.value }))} rows={2} />
            <button type="submit">Request Second Opinion</button>
          </form>
          {secondOpinionMessage ? <p className="muted">{secondOpinionMessage}</p> : null}
          {secondOpinionData.slice(0, 3).map((item) => (
            <p className="muted" key={item.id}>
              {item.status} - {compactDate(item.createdAt)}
            </p>
          ))}
        </article>
      </section>

      <section className="journey-workspace-grid">
        <article className="card">
          <h3>Offline Sync for PWA</h3>
          <p className="muted">Sync delayed actions captured while connectivity was unavailable.</p>
          <button type="button" onClick={syncOfflineQueue}>Sync Offline Queue</button>
          {offlineMessage ? <p className="muted">{offlineMessage}</p> : null}
        </article>
      </section>
    </>
  );
}
