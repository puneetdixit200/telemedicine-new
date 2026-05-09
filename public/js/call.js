/* global supabase, RTCPeerConnection, RTCSessionDescription, RTCIceCandidate */

const configNode = document.getElementById('callRuntimeConfig');
const encodedConfig = configNode ? configNode.getAttribute('data-call-config') : null;
const cfg = encodedConfig ? JSON.parse(decodeURIComponent(encodedConfig)) : null;

if (!cfg) {
  throw new Error('Missing call runtime config');
}

const statusEl = document.getElementById('status');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

const btnVideo = document.getElementById('btnVideo');
const btnAudio = document.getElementById('btnAudio');
const btnText = document.getElementById('btnText');
const btnDataQuality = document.getElementById('btnDataQuality');
const btnMute = document.getElementById('btnMute');
const btnCamera = document.getElementById('btnCamera');
const btnTranslateToggle = document.getElementById('btnTranslateToggle');
const chatLanguageSelect = document.getElementById('chatLanguage');

const chatLog = document.getElementById('chatLog');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');

let signaling;
let pc;
let localStream;
let currentMode = cfg.defaultMode;
let isMuted = false;
let isCameraOff = false;
let makingOffer = false;
let ignoreOffer = false;
let isSettingRemoteAnswerPending = false;
let reconnectDegradeTimer = null;
const pendingIceCandidates = [];
let hasShownDataSaverNotice = false;
const QUALITY_PREFERENCE_KEY = 'call:qualityPreference';
const CHAT_TRANSLATE_ENABLED_KEY = 'call:chatTranslateEnabled';
const CHAT_TRANSLATE_LANGUAGE_KEY = 'call:chatTranslateLanguage';
let qualityPreference = 'auto';
let chatTranslationEnabled = false;
let chatTargetLanguage = 'English';
const translationCache = new Map();

// Doctor acts as the stable offerer by default; patient is the polite peer.
const isPolitePeer = cfg.userRole === 'patient';

function logRtc(event, details = {}) {
  console.log('[CALL][RTC]', event, {
    appointmentId: cfg.appointmentId,
    mode: currentMode,
    signalingState: pc ? pc.signalingState : 'no-pc',
    connectionState: pc ? pc.connectionState : 'no-pc',
    ...details
  });
}

function setStatus(s) {
  statusEl.textContent = s;
}

function connectionInfo() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  return {
    effectiveType: connection && connection.effectiveType ? String(connection.effectiveType) : 'unknown',
    saveData: Boolean(connection && connection.saveData)
  };
}

function isDataSaverPreferred() {
  try {
    return window.localStorage.getItem('rural:dataSaver') === '1';
  } catch (_err) {
    return false;
  }
}

function sanitizeQualityPreference(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'saver') return 'saver';
  if (normalized === 'high') return 'high';
  return 'auto';
}

function readQualityPreference() {
  try {
    const stored = window.localStorage.getItem(QUALITY_PREFERENCE_KEY);
    if (stored) {
      return sanitizeQualityPreference(stored);
    }
  } catch (_err) {}

  return isDataSaverPreferred() ? 'saver' : 'auto';
}

function qualityLabel(preference) {
  if (preference === 'saver') return 'Quality: Saver';
  if (preference === 'high') return 'Quality: High';
  return 'Quality: Auto';
}

function readChatTranslateEnabled() {
  try {
    return window.localStorage.getItem(CHAT_TRANSLATE_ENABLED_KEY) === '1';
  } catch (_err) {
    return false;
  }
}

function readChatTargetLanguage() {
  try {
    const stored = String(window.localStorage.getItem(CHAT_TRANSLATE_LANGUAGE_KEY) || '').trim();
    if (stored) return stored;
  } catch (_err) {}

  if (chatLanguageSelect && chatLanguageSelect.value) {
    return String(chatLanguageSelect.value).trim();
  }

  return 'English';
}

function persistChatTranslationSettings() {
  try {
    window.localStorage.setItem(CHAT_TRANSLATE_ENABLED_KEY, chatTranslationEnabled ? '1' : '0');
    window.localStorage.setItem(CHAT_TRANSLATE_LANGUAGE_KEY, chatTargetLanguage);
  } catch (_err) {}
}

function updateTranslateLabel() {
  if (!btnTranslateToggle) return;
  setControlLabel(btnTranslateToggle, `Translate: ${chatTranslationEnabled ? 'On' : 'Off'}`);
}

function persistQualityPreference(preference) {
  try {
    window.localStorage.setItem(QUALITY_PREFERENCE_KEY, preference);
    window.localStorage.setItem('rural:dataSaver', preference === 'saver' ? '1' : '0');
  } catch (_err) {}
}

async function applyQualityPreference(preference, options = {}) {
  const announce = options.announce !== false;
  qualityPreference = sanitizeQualityPreference(preference);
  persistQualityPreference(qualityPreference);

  if (btnDataQuality) {
    setControlLabel(btnDataQuality, qualityLabel(qualityPreference));
  }

  if (announce) {
    appendChat(`[System] ${qualityLabel(qualityPreference)} selected.`);
  }

  if (qualityPreference === 'saver' && currentMode === 'video') {
    appendChat('[System] Data Saver selected. Switching to audio to reduce data usage.');
    await startMode('audio');
  }
}

async function cycleQualityPreference() {
  const order = ['auto', 'saver', 'high'];
  const idx = Math.max(0, order.indexOf(qualityPreference));
  const next = order[(idx + 1) % order.length];
  await applyQualityPreference(next, { announce: true });
}

function isWeakNetwork() {
  const info = connectionInfo();
  if (!navigator.onLine) return true;
  return info.effectiveType === 'slow-2g' || info.effectiveType === '2g';
}

function updateConnectivityHint() {
  const info = connectionInfo();

  if (!navigator.onLine) {
    setStatus('offline');
    appendChat('[System] You are offline. Reconnecting automatically...');
    scheduleAutoDowngrade('offline');
    return;
  }

  if (isWeakNetwork()) {
    setStatus(`weak_network:${info.effectiveType}`);
    appendChat('[System] Weak connection detected. Audio or text mode is recommended.');
    scheduleAutoDowngrade('low_bandwidth');
    return;
  }

  if (info.saveData) {
    setStatus(`data_saver:${info.effectiveType}`);
    return;
  }

  if (statusEl.textContent === 'offline' || statusEl.textContent.startsWith('weak_network')) {
    setStatus('connected');
  }
}

function setControlLabel(button, label) {
  const labelNode = button ? button.querySelector('[data-label]') : null;
  if (labelNode) {
    labelNode.textContent = label;
    return;
  }
  if (button) {
    button.textContent = label;
  }
}

function stopLocalMedia() {
  if (!localStream) return;
  localStream.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch (_) {}
  });
  localStream = null;
  localVideo.srcObject = null;
}

function disposePeerConnection() {
  if (!pc) return;
  try {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    pc.onsignalingstatechange = null;
    pc.close();
  } catch (_) {}
  pc = null;
  remoteVideo.srcObject = null;
  pendingIceCandidates.length = 0;
}

function clearDegradeTimer() {
  if (!reconnectDegradeTimer) return;
  clearTimeout(reconnectDegradeTimer);
  reconnectDegradeTimer = null;
}

async function downgradeMode(reason) {
  clearDegradeTimer();
  logRtc('auto_downgrade', { reason, fromMode: currentMode });

  if (currentMode === 'video') {
    appendChat('[System] Network unstable. Switching to audio for stability.');
    await startMode('audio');
    return;
  }

  if (currentMode === 'audio') {
    appendChat('[System] Network unstable. Switching to text chat fallback.');
    await startMode('text');
  }
}

function scheduleAutoDowngrade(reason) {
  if (currentMode === 'text') return;
  if (reconnectDegradeTimer) return;
  reconnectDegradeTimer = setTimeout(() => {
    reconnectDegradeTimer = null;
    downgradeMode(reason).catch((e) => {
      console.error('[CALL][RTC] auto downgrade failed', e);
    });
  }, 6000);
}

function appendChat(msg) {
  const div = document.createElement('div');
  div.textContent = msg;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function roleLabel(role) {
  const normalized = String(role || '').toLowerCase();
  if (normalized === 'doctor') return 'Doctor';
  if (normalized === 'patient') return 'Patient';
  if (normalized === 'admin') return 'Admin';
  if (normalized === 'help_worker') return 'Helper';
  if (normalized === 'helper') return 'Helper';
  return 'Participant';
}

async function translateTextForChat(text, targetLanguage) {
  const sourceText = String(text || '').trim();
  const target = String(targetLanguage || '').trim();

  if (!sourceText || !target) return sourceText;

  const cacheKey = `${target.toLowerCase()}::${sourceText}`;
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  const res = await fetch('/api/ai/translate-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      appointmentId: cfg.appointmentId,
      text: sourceText,
      targetLanguage: target,
      sourceLanguage: 'auto'
    })
  });

  if (!res.ok) {
    throw new Error('translation_request_failed');
  }

  const payload = await res.json();
  const translated = String(payload?.result?.translatedText || sourceText).trim() || sourceText;
  translationCache.set(cacheKey, translated);
  return translated;
}

function ensureSocket() {
  if (signaling) return signaling;
  if (!window.supabase || !cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    setStatus('signaling_unavailable');
    throw new Error('Supabase Realtime is not configured.');
  }

  const client = supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
  const channel = client.channel(cfg.realtimeTopic || `call:${cfg.appointmentId}`, {
    config: {
      broadcast: {
        self: false
      }
    }
  });

  signaling = {
    emit(event, payload = {}) {
      if (event === 'join_room') {
        return channel.send({
          type: 'broadcast',
          event: 'peer_joined',
          payload: {
            appointmentId: cfg.appointmentId,
            fromRole: cfg.userRole
          }
        });
      }

      if (event === 'signal') {
        return channel.send({
          type: 'broadcast',
          event: 'signal',
          payload: {
            ...payload,
            appointmentId: cfg.appointmentId,
            fromRole: cfg.userRole
          }
        });
      }

      if (event === 'chat') {
        return channel.send({
          type: 'broadcast',
          event: 'chat',
          payload: {
            message: payload.message,
            appointmentId: cfg.appointmentId,
            fromRole: cfg.userRole,
            at: new Date().toISOString()
          }
        });
      }

      return Promise.resolve();
    },
    disconnect() {
      return client.removeChannel(channel);
    }
  };

  channel.on('broadcast', { event: 'peer_joined' }, async () => {
    if (pc && (currentMode === 'video' || currentMode === 'audio')) {
      logRtc('peer_joined');
      await maybeMakeOffer();
    }
  });

  channel.on('broadcast', { event: 'signal' }, async ({ payload }) => {
    try {
      const { type, payload: signalPayload } = payload || {};
      if (!pc) await setupPeerConnection();

      if (type === 'offer') {
        const offerCollision = makingOffer || pc.signalingState !== 'stable';
        ignoreOffer = !isPolitePeer && offerCollision;

        if (ignoreOffer) {
          logRtc('ignore_offer_collision', { isPolitePeer, offerCollision });
          return;
        }

        if (offerCollision && isPolitePeer) {
          logRtc('rollback_for_offer_collision', { isPolitePeer, offerCollision });
          await Promise.all([
            pc.setLocalDescription({ type: 'rollback' }),
            pc.setRemoteDescription(new RTCSessionDescription(signalPayload))
          ]);
        } else {
          await pc.setRemoteDescription(new RTCSessionDescription(signalPayload));
        }

        while (pendingIceCandidates.length) {
          const candidate = pendingIceCandidates.shift();
          if (!candidate) continue;
          await pc.addIceCandidate(candidate);
        }

        logRtc('remote_offer_applied');
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ensureSocket().emit('signal', { appointmentId: cfg.appointmentId, type: 'answer', payload: pc.localDescription });
      } else if (type === 'answer') {
        if (pc.signalingState !== 'have-local-offer') {
          logRtc('ignore_unexpected_answer', { receivedType: type });
          return;
        }

        isSettingRemoteAnswerPending = true;
        await pc.setRemoteDescription(new RTCSessionDescription(signalPayload));
        isSettingRemoteAnswerPending = false;

        while (pendingIceCandidates.length) {
          const candidate = pendingIceCandidates.shift();
          if (!candidate) continue;
          await pc.addIceCandidate(candidate);
        }

        logRtc('remote_answer_applied');
      } else if (type === 'ice_candidate') {
        if (!signalPayload) return;
        const candidate = new RTCIceCandidate(signalPayload);
        if (pc.remoteDescription) {
          await pc.addIceCandidate(candidate);
        } else {
          pendingIceCandidates.push(candidate);
          logRtc('queue_remote_ice', { queued: pendingIceCandidates.length });
        }
      }
    } catch (e) {
      isSettingRemoteAnswerPending = false;
      console.error('[CALL][RTC] signal handling error', e, {
        type,
        signalingState: pc ? pc.signalingState : 'no-pc',
        connectionState: pc ? pc.connectionState : 'no-pc'
      });
      setStatus('signal_error');
    }
  });

  channel.on('broadcast', { event: 'chat' }, async ({ payload }) => {
    const { fromRole, message, at } = payload || {};
    appendChat(`[${new Date(at).toLocaleTimeString()}] ${roleLabel(fromRole)}: ${message}`);

    const incomingFromPeer = String(fromRole || '').toLowerCase() !== String(cfg.userRole || '').toLowerCase();
    if (!chatTranslationEnabled || !incomingFromPeer) return;

    try {
      const translated = await translateTextForChat(message, chatTargetLanguage);
      if (translated && translated !== message) {
        appendChat(`[Translated ${chatTargetLanguage}] ${translated}`);
      }
    } catch (_err) {
      appendChat('[System] Translation unavailable. Showing original message only.');
    }
  });

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      setStatus('connected');
      signaling.emit('join_room', { appointmentId: cfg.appointmentId });
      return;
    }

    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      setStatus('disconnected');
    }
  });

  return signaling;
}

async function setupLocalMedia(mode) {
  stopLocalMedia();

  if (mode === 'text') {
    localVideo.srcObject = null;
    return;
  }

  const constraints =
    mode === 'audio'
      ? { audio: true, video: false }
      : qualityPreference === 'high'
        ? {
            audio: true,
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30, max: 30 }
            }
          }
        : {
            audio: true,
            video: {
              width: { ideal: 640 },
              height: { ideal: 360 },
              frameRate: { ideal: 15, max: 24 }
            }
          };

  localStream = await navigator.mediaDevices.getUserMedia(constraints);
  localVideo.srcObject = localStream;
}

async function setupPeerConnection() {
  if (pc) return pc;

  pc = new RTCPeerConnection({ iceServers: cfg.iceServers });
  logRtc('pc_created', { isPolitePeer, iceServers: cfg.iceServers });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      logRtc('local_ice_candidate');
      ensureSocket().emit('signal', { appointmentId: cfg.appointmentId, type: 'ice_candidate', payload: event.candidate });
    }
  };

  pc.ontrack = (event) => {
    logRtc('remote_track_received', { streams: event.streams ? event.streams.length : 0 });
    remoteVideo.srcObject = event.streams[0];
  };

  pc.onconnectionstatechange = () => {
    logRtc('connection_state_change');
    setStatus(`pc:${pc.connectionState}`);

    if (pc.connectionState === 'connected') {
      clearDegradeTimer();
      return;
    }

    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      scheduleAutoDowngrade(`connection_${pc.connectionState}`);
    }
  };

  pc.oniceconnectionstatechange = () => {
    logRtc('ice_connection_state_change', { iceConnectionState: pc.iceConnectionState });
  };

  pc.onsignalingstatechange = () => {
    logRtc('signaling_state_change', { signalingState: pc.signalingState, isSettingRemoteAnswerPending });
  };

  if (localStream) {
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }
  }

  return pc;
}

async function maybeMakeOffer() {
  if (!pc) return;
  if (pc.signalingState !== 'stable') {
    logRtc('skip_offer_non_stable');
    return;
  }

  try {
    makingOffer = true;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    logRtc('local_offer_created');
    ensureSocket().emit('signal', { appointmentId: cfg.appointmentId, type: 'offer', payload: pc.localDescription });
  } catch (e) {
    console.error('[CALL][RTC] offer creation failed', e);
  } finally {
    makingOffer = false;
  }
}

async function startMode(mode) {
  clearDegradeTimer();

  if (
    mode === 'video' &&
    (qualityPreference === 'saver' || (qualityPreference !== 'high' && (isDataSaverPreferred() || connectionInfo().saveData)))
  ) {
    if (!hasShownDataSaverNotice) {
      appendChat('[System] Data saver enabled. Starting in audio mode to reduce data usage.');
      hasShownDataSaverNotice = true;
    }
    mode = 'audio';
  }

  if (currentMode !== mode) {
    disposePeerConnection();
    stopLocalMedia();
  }

  currentMode = mode;
  ensureSocket();

  if (mode === 'text') {
    disposePeerConnection();
    stopLocalMedia();
    setStatus('text');
    return;
  }

  try {
    setStatus('starting_media');
    await setupLocalMedia(mode);
    await setupPeerConnection();
    await maybeMakeOffer();
    setStatus('in_call');
  } catch (e) {
    console.error(e);
    if (mode === 'video') {
      setStatus('video_error_fallback_audio');
      appendChat('[System] Video unavailable. Switched to audio mode.');
      await startMode('audio');
      return;
    }
    if (mode === 'audio') {
      setStatus('audio_error_fallback_text');
      appendChat('[System] Audio unavailable. Switched to text mode.');
      await startMode('text');
      return;
    }
    setStatus('media_error');
    alert('Media error. Switching to text chat.');
  }
}

btnVideo.addEventListener('click', () => startMode('video'));
btnAudio.addEventListener('click', () => startMode('audio'));
btnText.addEventListener('click', () => startMode('text'));
if (btnDataQuality) {
  btnDataQuality.addEventListener('click', () => {
    cycleQualityPreference().catch((e) => {
      console.error('[CALL][RTC] quality toggle failed', e);
    });
  });
}

btnMute.addEventListener('click', () => {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach((t) => {
    t.enabled = !isMuted;
  });
  setControlLabel(btnMute, isMuted ? 'Unmute' : 'Mute');
});

btnCamera.addEventListener('click', () => {
  if (!localStream) return;
  isCameraOff = !isCameraOff;
  localStream.getVideoTracks().forEach((t) => {
    t.enabled = !isCameraOff;
  });
  setControlLabel(btnCamera, isCameraOff ? 'Camera on' : 'Camera');
});

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = String(chatInput.value || '').trim();
  if (!message) return;

  let outgoingMessage = message;
  if (chatTranslationEnabled) {
    try {
      outgoingMessage = await translateTextForChat(message, chatTargetLanguage);
    } catch (_err) {
      appendChat('[System] Could not translate outgoing message. Sending original text.');
      outgoingMessage = message;
    }
  }

  ensureSocket().emit('chat', { appointmentId: cfg.appointmentId, message: outgoingMessage });
  appendChat(`[${new Date().toLocaleTimeString()}] ${roleLabel(cfg.userRole)}: ${outgoingMessage}`);

  if (chatTranslationEnabled && outgoingMessage !== message) {
    appendChat(`[System] Sent in ${chatTargetLanguage}: ${outgoingMessage}`);
  }

  chatInput.value = '';
});

if (btnTranslateToggle) {
  btnTranslateToggle.addEventListener('click', () => {
    chatTranslationEnabled = !chatTranslationEnabled;
    persistChatTranslationSettings();
    updateTranslateLabel();
    appendChat(`[System] Chat translation ${chatTranslationEnabled ? 'enabled' : 'disabled'}.`);
  });
}

if (chatLanguageSelect) {
  chatLanguageSelect.addEventListener('change', () => {
    chatTargetLanguage = String(chatLanguageSelect.value || 'English').trim() || 'English';
    persistChatTranslationSettings();
    appendChat(`[System] Target chat language set to ${chatTargetLanguage}.`);
  });
}

// Auto-start the configured mode.
qualityPreference = readQualityPreference();
applyQualityPreference(qualityPreference, { announce: false }).catch(() => {});
chatTranslationEnabled = readChatTranslateEnabled();
chatTargetLanguage = readChatTargetLanguage();
if (chatLanguageSelect && chatTargetLanguage) {
  chatLanguageSelect.value = chatTargetLanguage;
}
updateTranslateLabel();
startMode(cfg.defaultMode);

window.addEventListener('online', updateConnectivityHint);
window.addEventListener('offline', updateConnectivityHint);

const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
connection?.addEventListener?.('change', updateConnectivityHint);

updateConnectivityHint();
