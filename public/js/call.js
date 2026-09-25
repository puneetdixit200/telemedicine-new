/* global RTCPeerConnection, RTCSessionDescription, RTCIceCandidate */
(function () {

const configNode = document.getElementById('callRuntimeConfig');
const encodedConfig = configNode ? configNode.getAttribute('data-call-config') : null;
const cfg = encodedConfig ? JSON.parse(decodeURIComponent(encodedConfig)) : null;

if (!cfg) {
  throw new Error('Missing call runtime config');
}

const statusEl = document.getElementById('status');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const connectionHelp = document.getElementById('callConnectionHelp');
const btnRetryCall = document.getElementById('btnRetryCall');
const btnResumeCallAudio = document.getElementById('btnResumeCallAudio');

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
const endCallButton = document.querySelector('.call-end-btn');

let signaling;
let pc;
let localStream;
let roomReady = false;
let disposed = false;
let currentMode = cfg.defaultMode;
let isMuted = false;
let isCameraOff = false;
let makingOffer = false;
let ignoreOffer = false;
let isSettingRemoteAnswerPending = false;
let reconnectDegradeTimer = null;
let connectionWaitTimer = null;
let modeQueue = Promise.resolve();
const pendingIceCandidates = [];
let hasShownDataSaverNotice = false;
const QUALITY_PREFERENCE_KEY = 'call:qualityPreference';
const CHAT_TRANSLATE_ENABLED_KEY = 'call:chatTranslateEnabled';
const CHAT_TRANSLATE_LANGUAGE_KEY = 'call:chatTranslateLanguage';
let qualityPreference = 'auto';
let chatTranslationEnabled = false;
let chatTargetLanguage = 'English';
const translationCache = new Map();
const SIGNALING_READY_TIMEOUT_MS = 8000;
const REMOTE_DATA_TIMEOUT_MS = 15000;
const REMOTE_DATA_CHECK_INTERVAL_MS = 1000;
let remoteEndInProgress = false;
let remoteDataWatchdogTimer = null;
let lastRemoteDataAt = 0;
let lastRemotePayloadReceived = 0;

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
  if (s === 'pc:connected') {
    clearConnectionWait();
    if (connectionHelp) connectionHelp.textContent = 'Call connected. If you cannot hear the other participant, check microphone permissions and your sound output.';
  } else if (s === 'waiting_for_participant' || s === 'pc:connecting') {
    if (connectionHelp) connectionHelp.textContent = 'Connecting. Both participants must be on this appointment’s call page with microphone access allowed.';
    if (!connectionWaitTimer) connectionWaitTimer = setTimeout(() => {
      connectionWaitTimer = null;
      if (disposed || currentMode === 'text' || pc?.connectionState === 'connected') return;
      statusEl.textContent = 'connection_timed_out';
      const hasRelay = cfg.iceServers?.some((server) => [].concat(server.urls).some((url) => /^turns?:/.test(url)));
      if (connectionHelp) connectionHelp.textContent = hasRelay
        ? 'Call could not connect. Confirm both participants are here, then use Retry connection. Try another network if needed.'
        : 'Call could not connect. Use Retry connection or try another network. The site has no TURN relay configured, which is needed on some networks; contact the site administrator.';
    }, 20000);
  }
}

function clearConnectionWait() {
  if (connectionWaitTimer) clearTimeout(connectionWaitTimer);
  connectionWaitTimer = null;
}

async function playRemoteMedia() {
  if (!remoteVideo.srcObject || disposed) return;
  try {
    await remoteVideo.play();
    if (btnResumeCallAudio) btnResumeCallAudio.hidden = true;
  } catch (_error) {
    if (disposed) return;
    if (btnResumeCallAudio) btnResumeCallAudio.hidden = false;
    if (connectionHelp) connectionHelp.textContent = 'Your browser paused call playback. Select Enable call sound to hear and see the other participant.';
  }
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

  if (roomReady && qualityPreference === 'saver' && currentMode === 'video') {
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
    setStatus(pc?.connectionState === 'connected' ? 'pc:connected' : 'waiting_for_participant');
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

function setControlActive(button, active) {
  if (!button) return;
  button.classList.toggle('active', Boolean(active));
  button.setAttribute('aria-pressed', active ? 'true' : 'false');
}

function updateModeControls() {
  const modeLabel = document.getElementById('callModeLabel');
  if (modeLabel) modeLabel.textContent = `Mode: ${currentMode}`;
  setControlActive(btnVideo, currentMode === 'video');
  setControlActive(btnAudio, currentMode === 'audio');
  setControlActive(btnText, currentMode === 'text');

  const hasAudio = Boolean(localStream && localStream.getAudioTracks().length);
  const hasVideo = Boolean(localStream && localStream.getVideoTracks().length);

  if (btnMute) {
    btnMute.disabled = !hasAudio;
    setControlLabel(btnMute, isMuted ? 'Unmute' : 'Mute');
  }

  if (btnCamera) {
    btnCamera.disabled = currentMode !== 'video' || !hasVideo;
    setControlLabel(btnCamera, isCameraOff ? 'Camera on' : 'Camera');
  }
}

function leaveRoomFromRemoteEnd() {
  if (remoteEndInProgress) return;
  remoteEndInProgress = true;
  setStatus('ended');
  appendChat('[System] The consultation was ended by the other participant.');
  clearRemoteDataWatchdog();
  disposePeerConnection();
  stopLocalMedia();
  updateModeControls();
  setTimeout(() => {
    window.location.assign(`/appointments/${encodeURIComponent(cfg.appointmentId)}`);
  }, 350);
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
  updateModeControls();
}

function disposePeerConnection() {
  clearConnectionWait();
  clearRemoteDataWatchdog();
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

function recoverRemoteDataFlow() {
  if (remoteEndInProgress || !pc) return;
  logRtc('remote_data_stalled_reconnect');
  setStatus('reconnecting_media');
  lastRemoteDataAt = Date.now();
  pc.restartIce?.();
  const request = cfg.userRole === 'doctor' ? maybeMakeOffer() : ensureSocket().emit('join_room');
  request.catch((error) => console.error('[CALL][RTC] reconnect failed', error));
  scheduleAutoDowngrade('remote_data_stalled');
}

function clearRemoteDataWatchdog() {
  if (remoteDataWatchdogTimer) {
    clearInterval(remoteDataWatchdogTimer);
    remoteDataWatchdogTimer = null;
  }
  lastRemoteDataAt = 0;
  lastRemotePayloadReceived = 0;
}

function remotePayloadFromStatsReport(report) {
  const kind = report.kind || report.mediaType;
  if (report.type !== 'inbound-rtp' || (kind !== 'audio' && kind !== 'video')) {
    return 0;
  }

  const bytes = Number(report.bytesReceived || 0);
  if (bytes > 0) return bytes;
  return Number(report.packetsReceived || 0);
}

async function checkRemoteDataFlow() {
  const observedPc = pc;
  if (!observedPc || currentMode === 'text' || remoteEndInProgress) {
    clearRemoteDataWatchdog();
    return;
  }

  let remotePayloadReceived = 0;
  try {
    const stats = await observedPc.getStats();
    stats.forEach((report) => {
      remotePayloadReceived += remotePayloadFromStatsReport(report);
    });
  } catch (error) {
    logRtc('remote_data_stats_error', { message: error.message });
    return;
  }

  if (observedPc !== pc) return;

  if (remotePayloadReceived > lastRemotePayloadReceived) {
    lastRemotePayloadReceived = remotePayloadReceived;
    lastRemoteDataAt = Date.now();
    return;
  }

  if (lastRemoteDataAt && Date.now() - lastRemoteDataAt >= REMOTE_DATA_TIMEOUT_MS) {
    recoverRemoteDataFlow();
  }
}

function startRemoteDataWatchdog(reason) {
  if (currentMode === 'text' || remoteEndInProgress) return;
  lastRemoteDataAt = Date.now();

  if (!remoteDataWatchdogTimer) {
    logRtc('remote_data_watchdog_started', { reason, timeoutMs: REMOTE_DATA_TIMEOUT_MS });
    remoteDataWatchdogTimer = setInterval(() => {
      checkRemoteDataFlow().catch((error) => {
        console.error('[CALL][RTC] remote data watchdog failed', error);
      });
    }, REMOTE_DATA_CHECK_INTERVAL_MS);
  }
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
  if (!window.__telemedicineCreateSupabaseClient || !cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    setStatus('signaling_unavailable');
    throw new Error('Supabase Realtime is not configured.');
  }

  const client = window.__telemedicineCreateSupabaseClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
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
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  function sendBroadcast(event, payload = {}) {
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
          fromRole: cfg.userRole
        }
      });
    }

    if (event === 'call_ended') {
      return channel.send({
        type: 'broadcast',
        event: 'call_ended',
        payload: {
          appointmentId: cfg.appointmentId,
          fromRole: cfg.userRole
        }
      });
    }

    return Promise.resolve();
  }

  signaling = {
    ready,
    emit(event, payload = {}) {
      return ready.then(() => sendBroadcast(event, payload));
    },
    disconnect() {
      return client.removeChannel(channel);
    }
  };

  channel.on('broadcast', { event: 'peer_joined' }, async ({ payload }) => {
    if (!roomReady) return;
    if (cfg.userRole === 'patient' && payload?.fromRole === 'doctor') {
      await ensureSocket().emit('join_room');
    } else if (cfg.userRole === 'doctor' && payload?.fromRole === 'patient' && pc && (currentMode === 'video' || currentMode === 'audio')) {
      logRtc('peer_joined');
      await maybeMakeOffer();
    }
  });

  channel.on('broadcast', { event: 'signal' }, async ({ payload }) => {
    const { type, payload: signalPayload } = payload || {};
    try {
      if (payload?.fromRole === cfg.userRole) return;
      if (!roomReady || currentMode === 'text') return;
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
        // Reserve send capability even when answering in audio-only mode, so
        // replaceTrack can later enable video without rebuilding the transport.
        for (const transceiver of pc.getTransceivers()) {
          if (transceiver.stopped) continue;
          transceiver.direction = 'sendrecv';
          const track = localStream?.getTracks().find((item) => item.kind === transceiver.receiver.track.kind) || null;
          if (transceiver.sender.track !== track) await transceiver.sender.replaceTrack(track);
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ensureSocket()
          .emit('signal', { appointmentId: cfg.appointmentId, type: 'answer', payload: pc.localDescription })
          .catch((error) => console.error('[CALL][RTC] answer send failed', error));
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
    const { fromRole, message } = payload || {};
    appendChat(`${roleLabel(fromRole)}: ${message}`);

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

  channel.on('broadcast', { event: 'call_ended' }, ({ payload }) => {
    if (String(payload?.fromRole || '').toLowerCase() === String(cfg.userRole || '').toLowerCase()) return;
    leaveRoomFromRemoteEnd();
  });

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      if (!roomReady) setStatus('signaling_ready');
      resolveReady();
      if (roomReady) signaling.emit('join_room').catch((error) => console.error('[CALL][RTC] join send failed', error));
      return;
    }

    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      setStatus('disconnected');
    }
  });

  return signaling;
}

function waitForSignalingReady(socket) {
  return Promise.race([
    socket.ready,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Signaling channel timed out.')), SIGNALING_READY_TIMEOUT_MS);
    })
  ]);
}

async function setupLocalMedia(mode) {
  if (mode === 'text') {
    stopLocalMedia();
    localVideo.srcObject = null;
    updateModeControls();
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

  const nextStream = await navigator.mediaDevices.getUserMedia(constraints);
  if (disposed) {
    nextStream.getTracks().forEach((track) => track.stop());
    return;
  }
  // Preserve the negotiated transport when changing modes. Rebuilding only one
  // participant's peer connection strands the other participant's ICE/SDP state.
  try {
    if (pc) {
      for (const transceiver of pc.getTransceivers()) {
        const kind = transceiver.receiver.track.kind;
        await transceiver.sender.replaceTrack(nextStream.getTracks().find((track) => track.kind === kind) || null);
      }
    }
  } catch (error) {
    nextStream.getTracks().forEach((track) => track.stop());
    throw error;
  }
  stopLocalMedia();
  localStream = nextStream;
  localVideo.srcObject = localStream;
  isMuted = false;
  isCameraOff = false;
  updateModeControls();
}

async function setupPeerConnection() {
  if (pc) return pc;

  pc = new RTCPeerConnection({ iceServers: cfg.iceServers });
  logRtc('pc_created', { isPolitePeer, iceServerCount: cfg.iceServers?.length || 0 });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      logRtc('local_ice_candidate');
      ensureSocket()
        .emit('signal', { appointmentId: cfg.appointmentId, type: 'ice_candidate', payload: event.candidate })
        .catch((error) => console.error('[CALL][RTC] ice send failed', error));
    }
  };

  pc.ontrack = (event) => {
    logRtc('remote_track_received', { streams: event.streams ? event.streams.length : 0 });
    if (event.streams?.[0]) remoteVideo.srcObject = event.streams[0];
    else {
      if (!remoteVideo.srcObject) remoteVideo.srcObject = new MediaStream();
      remoteVideo.srcObject.addTrack(event.track);
    }
    playRemoteMedia();
  };

  pc.onconnectionstatechange = () => {
    logRtc('connection_state_change');
    setStatus(`pc:${pc.connectionState}`);

    if (pc.connectionState === 'connected') {
      clearDegradeTimer();
      startRemoteDataWatchdog('peer_connected');
      playRemoteMedia();
      return;
    }

    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      clearRemoteDataWatchdog();
      pc.restartIce?.();
      if (cfg.userRole === 'doctor') maybeMakeOffer().catch((error) => console.error('[CALL][RTC] ICE restart failed', error));
      else ensureSocket().emit('join_room').catch((error) => console.error('[CALL][RTC] reconnect request failed', error));
      scheduleAutoDowngrade(`connection_${pc.connectionState}`);
    }
  };

  pc.oniceconnectionstatechange = () => {
    logRtc('ice_connection_state_change', { iceConnectionState: pc.iceConnectionState });
  };

  pc.onsignalingstatechange = () => {
    logRtc('signaling_state_change', { signalingState: pc.signalingState, isSettingRemoteAnswerPending });
  };

  // Negotiate both kinds up front so upgrading an audio call does not require
  // replacing the connection or racing a new offer against the remote peer.
  for (const kind of ['audio', 'video']) {
    const track = localStream?.getTracks().find((item) => item.kind === kind);
    if (cfg.userRole === 'doctor') {
      pc.addTransceiver(track || kind, { direction: 'sendrecv', streams: localStream ? [localStream] : [] });
    } else if (track) {
      // addTrack allows the answerer's sender to be matched to the incoming
      // offer. Pre-creating answerer transceivers would leave duplicate m-lines.
      pc.addTrack(track, localStream);
    }
  }

  return pc;
}

async function maybeMakeOffer() {
  if (!pc) return;
  await ensureSocket().ready;
  if (!pc || makingOffer || pc.signalingState !== 'stable') {
    logRtc('skip_offer_non_stable');
    return;
  }

  try {
    makingOffer = true;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    logRtc('local_offer_created');
    await ensureSocket().emit('signal', { appointmentId: cfg.appointmentId, type: 'offer', payload: pc.localDescription });
  } catch (e) {
    console.error('[CALL][RTC] offer creation failed', e);
  } finally {
    makingOffer = false;
  }
}

function startMode(mode) {
  const next = modeQueue.then(() => applyMode(mode));
  modeQueue = next.catch(() => {});
  return next;
}

async function applyMode(mode) {
  if (disposed) return;
  if (roomReady && currentMode === mode && pc && localStream &&
      localStream.getTracks().every((track) => track.readyState === 'live')) {
    return;
  }
  // An established peer must still receive signaling while camera permission
  // or replacement tracks are pending during a mode change.
  if (!pc) roomReady = false;
  clearDegradeTimer();
  clearRemoteDataWatchdog();

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

  currentMode = mode;
  updateModeControls();

  let socket;
  try {
    socket = ensureSocket();
    await waitForSignalingReady(socket);
  } catch (error) {
    console.error('[CALL][RTC] signaling unavailable', error);
    setStatus('signaling_error');
    appendChat('[System] Realtime connection is unavailable. Text chat may not sync until the network reconnects.');
    if (mode !== 'text') {
      currentMode = 'text';
      disposePeerConnection();
      stopLocalMedia();
      updateModeControls();
    }
    return;
  }

  if (mode === 'text') {
    disposePeerConnection();
    stopLocalMedia();
    roomReady = true;
    await socket.emit('join_room');
    setStatus('text');
    updateModeControls();
    return;
  }

  try {
    setStatus('starting_media');
    await setupLocalMedia(mode);
    if (disposed) {
      stopLocalMedia();
      return;
    }
    await setupPeerConnection();
    if (disposed) return;
    roomReady = true;
    if (pc.connectionState === 'connected') {
      setStatus('pc:connected');
      startRemoteDataWatchdog('mode_changed');
    } else {
      setStatus('waiting_for_participant');
      await socket.emit('join_room');
    }
    if (disposed) return;
    updateModeControls();
  } catch (e) {
    console.error(e);
    if (mode === 'video') {
      setStatus('video_error_fallback_audio');
      appendChat('[System] Video unavailable. Switched to audio mode.');
      await applyMode('audio');
      return;
    }
    if (mode === 'audio') {
      setStatus('audio_error_fallback_text');
      appendChat('[System] Audio unavailable. Switched to text mode.');
      await applyMode('text');
      return;
    }
    setStatus('media_error');
    appendChat('[System] Media error. Switching to text chat.');
  }
}

function runMode(mode) {
  startMode(mode).catch((error) => {
    console.error('[CALL][RTC] mode switch failed', error);
    setStatus('call_error');
    appendChat('[System] Could not switch call mode. Please try again.');
    updateModeControls();
  });
}

btnVideo.addEventListener('click', () => runMode('video'));
btnAudio.addEventListener('click', () => runMode('audio'));
btnText.addEventListener('click', () => runMode('text'));
btnRetryCall?.addEventListener('click', () => {
  // Queue retries with mode changes so two getUserMedia requests cannot race.
  modeQueue = modeQueue.then(async () => {
    if (disposed) return;
    disposePeerConnection();
    roomReady = false;
    await applyMode(currentMode === 'text' ? cfg.defaultMode : currentMode);
  }).catch((error) => {
    console.error('[CALL][RTC] retry failed', error);
    setStatus('call_error');
  });
});
btnResumeCallAudio?.addEventListener('click', playRemoteMedia);
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
  updateModeControls();
});

btnCamera.addEventListener('click', () => {
  if (!localStream) return;
  isCameraOff = !isCameraOff;
  localStream.getVideoTracks().forEach((t) => {
    t.enabled = !isCameraOff;
  });
  updateModeControls();
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

  ensureSocket()
    .emit('chat', { appointmentId: cfg.appointmentId, message: outgoingMessage })
    .catch((error) => {
      console.error('[CALL][RTC] chat send failed', error);
      appendChat('[System] Message could not be sent. Please try again.');
    });
  appendChat(`${roleLabel(cfg.userRole)}: ${outgoingMessage}`);

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

if (endCallButton) {
  endCallButton.addEventListener('click', () => {
    disposed = true;
    roomReady = false;
    clearDegradeTimer();
    setStatus('ending');
    ensureSocket()
      .emit('call_ended', { appointmentId: cfg.appointmentId })
      .catch((error) => console.error('[CALL][RTC] call-ended send failed', error));
    disposePeerConnection();
    stopLocalMedia();
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
updateModeControls();
runMode(cfg.defaultMode);

window.addEventListener('online', updateConnectivityHint);
window.addEventListener('offline', updateConnectivityHint);

const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
connection?.addEventListener?.('change', updateConnectivityHint);

updateConnectivityHint();

window.__telemedicineCallReady = true;
window.__telemedicineCallCleanup = () => {
  disposed = true;
  roomReady = false;
  clearDegradeTimer();
  clearRemoteDataWatchdog();
  disposePeerConnection();
  stopLocalMedia();
  signaling?.disconnect();
  signaling = null;
  window.removeEventListener('online', updateConnectivityHint);
  window.removeEventListener('offline', updateConnectivityHint);
  connection?.removeEventListener?.('change', updateConnectivityHint);
  delete window.__telemedicineCallReady;
  delete window.__telemedicineCallCleanup;
};
})();
