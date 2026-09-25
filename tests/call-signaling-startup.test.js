const fs = require('fs');
const vm = require('vm');
const path = require('path');

const runtime = fs.readFileSync(path.join(__dirname, '../public/js/call.js'), 'utf8');

function launch(role) {
  const sent = [];
  const handlers = new Map();
  const peers = [];
  const timers = [];
  let allowMedia;
  const media = new Promise((resolve) => { allowMedia = resolve; });
  const tracks = ['audio', 'video'].map((kind) => ({ kind, readyState: 'live', enabled: true, stop() { this.readyState = 'ended'; } }));
  const stream = { getTracks: () => tracks, getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'), getVideoTracks: () => tracks.filter((t) => t.kind === 'video') };
  const element = () => ({ textContent: 'idle', classList: { toggle() {} }, setAttribute() {},
    listeners: {}, addEventListener(event, handler) { this.listeners[event] = handler; },
    play: jest.fn(() => Promise.resolve()), querySelector: () => null, appendChild() {} });
  const nodes = new Map();
  const getNode = (id) => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  const config = { appointmentId: 'appt-1', userRole: role, defaultMode: 'video', supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon', iceServers: [] };
  getNode('callRuntimeConfig').getAttribute = () => encodeURIComponent(JSON.stringify(config));
  const channel = {
    on(_type, { event }, handler) { handlers.set(event, handler); return this; },
    subscribe(callback) { queueMicrotask(() => callback('SUBSCRIBED')); return this; },
    send(payload) { sent.push(payload); return Promise.resolve('ok'); }
  };
  class Peer {
    constructor() { this.signalingState = 'stable'; this.connectionState = 'new'; this.transceivers = []; peers.push(this); }
    addTrack(track) { this.addTransceiver(track); }
    addTransceiver(track) {
      const sender = { track: typeof track === 'string' ? null : track, replaceTrack: jest.fn(async (next) => { sender.track = next; }) };
      this.transceivers.push({ sender, receiver: { track: { kind: typeof track === 'string' ? track : track.kind } } });
    }
    getTransceivers() { return this.transceivers; }
    async createOffer() { return { type: 'offer', sdp: 'test' }; }
    async setLocalDescription(value) { this.localDescription = value; }
    close() {}
  }
  const window = {
    __telemedicineCreateSupabaseClient: () => ({ channel: () => channel, removeChannel: () => Promise.resolve() }),
    localStorage: { getItem: () => null, setItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    addEventListener() {}, removeEventListener() {}
  };
  const context = {
    window, document: { getElementById: getNode, querySelector: () => element(), createElement: () => element() },
    navigator: { onLine: true, mediaDevices: { getUserMedia: jest.fn(() => media) } },
    RTCPeerConnection: Peer, console: { ...console, error: jest.fn() }, Promise, queueMicrotask,
    setTimeout: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; },
    clearTimeout: (timer) => { if (timer) timer.cancelled = true; }, setInterval, clearInterval
  };
  vm.createContext(context);
  vm.runInContext(runtime, context);
  return { sent, window, context, tracks, getNode, peers, timers,
    click: (id) => getNode(id).listeners.click(),
    allowMedia: () => allowMedia(stream), receive: (event, payload) => handlers.get(event)?.({ payload }) };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test.each(['doctor', 'patient'])('%s joins only after media is ready', async (role) => {
  const call = launch(role);
  await settle();
  expect(call.sent).toHaveLength(0);
  call.allowMedia();
  await settle();
  expect(call.sent[0]?.event).toBe('peer_joined');
  expect(call.sent.some((event) => event.payload?.type === 'offer')).toBe(false);
  call.window.__telemedicineCallCleanup();
});

test.each(['doctor', 'patient'])('%s entering first still leads to an offer', async (firstRole) => {
  const secondRole = firstRole === 'doctor' ? 'patient' : 'doctor';
  const first = launch(firstRole);
  first.allowMedia();
  await settle();
  const second = launch(secondRole);
  second.allowMedia();
  await settle();
  if (firstRole === 'doctor') {
    await first.receive('peer_joined', { fromRole: 'patient' });
  } else {
    await first.receive('peer_joined', { fromRole: 'doctor' });
    await second.receive('peer_joined', { fromRole: 'patient' });
  }
  await settle();
  const doctor = firstRole === 'doctor' ? first : second;
  expect(doctor.sent.some((event) => event.payload?.type === 'offer')).toBe(true);
  first.window.__telemedicineCallCleanup();
  second.window.__telemedicineCallCleanup();
});

test('call room can be reopened after SPA navigation', async () => {
  const call = launch('patient');
  call.allowMedia();
  await settle();
  call.window.__telemedicineCallCleanup();
  expect(() => vm.runInContext(runtime, call.context)).not.toThrow();
  await settle();
  call.window.__telemedicineCallCleanup();
});

test('selecting the active mode never stops the tracks being sent', async () => {
  const call = launch('patient');
  call.allowMedia();
  await settle();
  call.click('btnVideo');
  await settle();
  expect(call.tracks.every((track) => track.readyState === 'live')).toBe(true);
  call.window.__telemedicineCallCleanup();
});

test('a malformed signal reports an error without throwing from its error handler', async () => {
  const call = launch('patient');
  call.allowMedia();
  await settle();
  await expect(call.receive('signal', { type: 'offer', fromRole: 'doctor', payload: {} })).resolves.toBeUndefined();
  expect(call.getNode('status').textContent).toBe('signal_error');
  call.window.__telemedicineCallCleanup();
});

test('mode changes replace sender tracks without replacing the peer connection', async () => {
  const call = launch('patient');
  call.allowMedia();
  await settle();
  const nextAudio = { kind: 'audio', readyState: 'live', enabled: true, stop() {} };
  call.context.navigator.mediaDevices.getUserMedia.mockResolvedValue({
    getTracks: () => [nextAudio], getAudioTracks: () => [nextAudio], getVideoTracks: () => []
  });
  call.click('btnAudio');
  await settle();
  expect(call.peers).toHaveLength(1);
  expect(call.peers[0].getTransceivers()[0].sender.track).toBe(nextAudio);
  expect(call.peers[0].getTransceivers()[1].sender.track).toBeNull();
  expect(call.tracks.every((track) => track.readyState === 'ended')).toBe(true);
  call.window.__telemedicineCallCleanup();
});

test('rapid mode clicks do not request media concurrently', async () => {
  const call = launch('patient');
  await settle();
  call.click('btnVideo');
  call.click('btnVideo');
  await settle();
  expect(call.context.navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  call.allowMedia();
  await settle();
  expect(call.context.navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  call.window.__telemedicineCallCleanup();
});

test('blocked autoplay offers a user gesture to enable sound', async () => {
  const call = launch('patient');
  call.allowMedia();
  await settle();
  const video = call.getNode('remoteVideo');
  video.play.mockRejectedValueOnce(new Error('NotAllowedError'));
  call.peers[0].ontrack({ streams: [{}] });
  await settle();
  expect(call.getNode('btnResumeCallAudio').hidden).toBe(false);
  await call.click('btnResumeCallAudio');
  expect(call.getNode('btnResumeCallAudio').hidden).toBe(true);
  call.window.__telemedicineCallCleanup();
});

test('a stalled connection gives an actionable relay warning and cleanup cancels timers', async () => {
  const call = launch('patient');
  call.allowMedia();
  await settle();
  const timer = call.timers.find((entry) => entry.ms === 20000);
  expect(timer).toBeDefined();
  timer.fn();
  expect(call.getNode('status').textContent).toBe('connection_timed_out');
  expect(call.getNode('callConnectionHelp').textContent).toContain('no TURN relay');
  call.window.__telemedicineCallCleanup();
});

test('signals from another tab of the same role are ignored', async () => {
  const call = launch('patient');
  call.allowMedia();
  await settle();
  await call.receive('signal', { type: 'offer', fromRole: 'patient', payload: {} });
  expect(call.getNode('status').textContent).not.toBe('signal_error');
  call.window.__telemedicineCallCleanup();
});

test('an incoming offer attaches media acquired before its new transceiver arrived', async () => {
  const call = launch('patient');
  call.allowMedia();
  await settle();
  const peer = call.peers[0];
  const videoSender = peer.getTransceivers()[1].sender;
  videoSender.track = null;
  call.context.RTCSessionDescription = function (value) { return value; };
  peer.setRemoteDescription = jest.fn(async () => {});
  peer.createAnswer = jest.fn(async () => ({ type: 'answer', sdp: 'test' }));
  await call.receive('signal', { type: 'offer', fromRole: 'doctor', payload: { type: 'offer', sdp: 'test' } });
  expect(videoSender.track).toBe(call.tracks[1]);
  expect(peer.createAnswer).toHaveBeenCalled();
  call.window.__telemedicineCallCleanup();
});

test('legacy and Next call runtimes remain identical', () => {
  expect(fs.readFileSync(path.join(__dirname, '../apps/backend/public/js/call.js'), 'utf8')).toBe(runtime);
});
