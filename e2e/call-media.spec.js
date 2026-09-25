const { test, expect } = require('@playwright/test');
const path = require('path');
const { randomUUID } = require('crypto');

async function login(page, role) {
  await page.goto('/auth/login');
  await page.locator('#loginEmail').fill(`${role}.asha@example.com`);
  await page.locator('#loginPassword').fill('Demo@12345');
  await page.getByRole('button', { name: /login/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function mediaStats(page) {
  return page.evaluate(async () => {
    const pc = window.__testPeers?.filter((peer) => peer.connectionState !== 'closed').at(-1);
    const result = { connected: pc?.connectionState === 'connected', state: pc?.connectionState,
      signaling: pc?.signalingState, ice: pc?.iceConnectionState,
      status: document.querySelector('#status')?.textContent, audio: 0, video: 0, frames: 0,
      playing: !document.querySelector('#remoteVideo')?.paused };
    if (pc) for (const report of (await pc.getStats()).values()) {
      if (report.type === 'inbound-rtp' && !report.isRemote) {
        result[report.kind] += report.bytesReceived || 0;
        result.frames += report.framesDecoded || 0;
      }
    }
    return result;
  });
}

async function assertFlow(pages, video = true) {
  for (const page of pages) {
    await expect.poll(async () => (await mediaStats(page)).connected).toBe(true);
    const before = await mediaStats(page);
    await expect.poll(async () => {
      const after = await mediaStats(page);
      return after.audio > before.audio && (!video || after.frames > before.frames) && after.playing;
    }, { message: 'remote audio packets, decoded video frames and active playback', timeout: 15_000 }).toBe(true);
  }
}

for (const initialMode of ['video', 'audio']) {
test(`live demo ${initialMode} call survives mode changes and participant refresh`, async ({ browser }) => {
  test.skip(process.env.TELEMEDICINE_LIVE_CALL_TEST !== '1', 'Opt-in demo-only live call test');
  test.setTimeout(180_000);
  const contexts = [];
  const pages = [];
  const browserErrors = [];
  const testRoom = `media-check-${randomUUID()}`;
  let appointmentId;
  try {
    for (const role of ['patient', 'doctor']) {
      const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
      contexts.push(context);
      // Keep automated peers out of any consultation someone is demonstrating.
      // Authorization, production signaling and ICE configuration are unchanged.
      await context.route('**/api/calls/*', async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch();
        const body = await response.json();
        if (body.callConfigEncoded) {
          const config = JSON.parse(decodeURIComponent(body.callConfigEncoded));
          config.realtimeTopic = testRoom;
          body.callConfigEncoded = encodeURIComponent(JSON.stringify(config));
        }
        await route.fulfill({ response, json: body });
      });
      await context.addInitScript(() => {
        const NativePeer = window.RTCPeerConnection;
        window.__testPeers = [];
        window.RTCPeerConnection = class extends NativePeer {
          constructor(config) {
            super(config);
            window.__testPeers.push(this);
          }
        };
      });
      if (process.env.TELEMEDICINE_LOCAL_CALL_SCRIPT === '1') {
        await context.route('**/js/call.js*', (route) => route.fulfill({
          path: path.resolve(__dirname, '../public/js/call.js'), contentType: 'application/javascript'
        }));
      }
      const page = await context.newPage();
      pages.push(page);
      page.on('pageerror', (error) => browserErrors.push(error.message));
      await login(page, role);
    }
    const lists = await Promise.all(pages.map(async (page) => {
      const response = await page.request.get('/api/appointments');
      expect(response.ok()).toBe(true);
      const data = await response.json();
      return [...data.upcomingAppointments, ...data.doneAppointments].filter((item) => item.status === 'booked');
    }));
    appointmentId = lists[0].filter((item) => item.mode === initialMode && lists[1].some((other) => other.id === item.id)).at(-1)?.id;
    expect(appointmentId).toBeTruthy();
    await Promise.all(pages.map((page) => page.goto(`/calls/${appointmentId}`)));
    await expect(pages[0].locator('#callRuntimeConfig')).toBeAttached();
    const hasTurn = await pages[0].locator('#callRuntimeConfig').evaluate((node) => {
      const config = JSON.parse(decodeURIComponent(node.dataset.callConfig));
      return config.iceServers.some((server) => [].concat(server.urls).some((url) => /^turns?:/.test(url)));
    });
    console.log('Production TURN relay configured:', hasTurn);
    await test.step('initial two-way media', () => assertFlow(pages, initialMode === 'video'));
    if (initialMode === 'audio') await test.step('audio-only start upgrades to two-way video', async () => {
      for (const page of pages) await page.locator('#btnVideo').click();
      await assertFlow(pages);
    });
    await test.step('selecting the active video mode keeps media flowing', async () => {
      await pages[0].locator('#btnVideo').click();
      await assertFlow(pages);
    });
    for (const page of pages) await test.step('one participant switches to audio and back independently', async () => {
      await page.locator('#btnAudio').click();
      await assertFlow(pages, false);
      await page.locator('#btnVideo').click();
      await assertFlow(pages);
    });
    await test.step('both participants switch to audio', async () => {
      for (const page of pages) await page.locator('#btnAudio').click();
      await assertFlow(pages, false);
    });
    await test.step('selecting the active audio mode keeps audio flowing', async () => {
      await pages[1].locator('#btnAudio').click();
      await assertFlow(pages, false);
    });
    await test.step('both participants upgrade to video', async () => {
      for (const page of pages) await page.locator('#btnVideo').click();
      await assertFlow(pages);
    });
    for (const page of pages) await test.step('participant refresh restores media', async () => {
      await page.reload();
      if (initialMode === 'audio') await page.locator('#btnVideo').click();
      await assertFlow(pages);
    });
    if (process.env.TELEMEDICINE_LOCAL_CALL_SCRIPT !== '1') {
      for (const page of pages) await test.step('retry button restores media', async () => {
        await page.locator('#btnRetryCall').click();
        await assertFlow(pages);
        await expect(page.locator('#callModeLabel')).toHaveText('Mode: video');
      });
    }
    expect(browserErrors, 'uncaught browser errors').toEqual([]);
  } finally {
    for (const page of pages) console.log('Final media stats:', await mediaStats(page).catch(() => ({})));
    if (appointmentId) await pages[0].request.post(`/api/calls/${appointmentId}/end`, { timeout: 10_000 }).catch(() => {});
    await Promise.all(contexts.map((context) => context.close()));
  }
});
}
