const fs = require('fs');
const vm = require('vm');
const path = require('path');

const runtime = fs.readFileSync(path.join(__dirname, '../public/js/call.js'), 'utf8');

function launch(role) {
  const sent = [];
  const handlers = new Map();
  let allowMedia;
  const media = new Promise((resolve) => { allowMedia = resolve; });
  const stream = { getTracks: () => [{ stop() {}, enabled: true }], getAudioTracks: () => [{}], getVideoTracks: () => [{}] };
  const element = () => ({ textContent: 'idle', classList: { toggle() {} }, setAttribute() {}, addEventListener() {}, querySelector: () => null, appendChild() {} });
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
    constructor() { this.signalingState = 'stable'; this.connectionState = 'new'; }
    addTrack() {}
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
    navigator: { onLine: true, mediaDevices: { getUserMedia: () => media } },
    RTCPeerConnection: Peer, console, Promise, queueMicrotask,
    setTimeout: (fn, ms) => ms === 8000 ? 0 : setTimeout(fn, ms), clearTimeout, setInterval, clearInterval
  };
  vm.createContext(context);
  vm.runInContext(runtime, context);
  return { sent, window, context, allowMedia: () => allowMedia(stream), receive: (event, payload) => handlers.get(event)?.({ payload }) };
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
