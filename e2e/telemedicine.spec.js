const { expect, test } = require('@playwright/test');

const DEMO_PASSWORD = 'Demo@12345';

const DEMO_USERS = {
  patient: 'patient.asha@example.com',
  doctor: 'doctor.asha@example.com',
  admin: 'admin.demo@example.com',
  helper: 'helper.meena@example.com'
};

async function login(page, email) {
  await page.goto('/auth/login');
  await page.locator('#loginEmail').fill(email);
  await page.locator('#loginPassword').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: /login/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.locator('body')).toContainText(/find the care|how can we help|logged in|consent/i);
}

test.describe('production demo smoke flows', () => {
  test('health readiness endpoint responds with structured status', async ({ request }) => {
    const res = await request.get('/api/health/ready');
    expect([200, 503]).toContain(res.status());
    const body = await res.json();
    expect(body).toHaveProperty('requestId');
    expect(body).toHaveProperty('checks');
  });

  test('patient can login and inspect booking, medicines, labs, workspace, and profile', async ({ page }) => {
    await login(page, DEMO_USERS.patient);

    await page.goto('/book');
    await expect(page.locator('body')).toContainText(/booking wizard|choose your doctor|who needs help/i);

    await page.goto('/doctors');
    await expect(page.locator('body')).toContainText(/all doctors|doctor/i);

    await page.goto('/appointments');
    await expect(page.locator('body')).toContainText(/appointment|visit|consultation/i);

    await page.goto('/medicines');
    await expect(page.locator('body')).toContainText(/medicine|search/i);

    await page.goto('/labs/tests');
    await expect(page.locator('body')).toContainText(/lab|test/i);

    await page.goto('/patients/workspace');
    await expect(page.locator('body')).toContainText(/patient workspace|health card|medicines/i);

    await page.goto('/profile');
    await expect(page.locator('body')).toContainText(/profile|account|asha/i);
  });

  test('patient workspace and prescription preview fit mobile screens', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, DEMO_USERS.patient);

    await page.goto('/patients/workspace');
    await expect(page.locator('body')).toContainText(/patient workspace|health card|family care/i);
    await page.getByRole('button', { name: /medicines/i }).click();
    await expect(page.locator('body')).toContainText(/search any medicine/i);

    const workspaceOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(workspaceOverflow).toBeLessThanOrEqual(1);

    const appointmentsRes = await page.request.get('/api/appointments');
    expect(appointmentsRes.ok()).toBeTruthy();
    const appointmentsBody = await appointmentsRes.json();
    const appointmentWithPrescription = [
      ...(appointmentsBody.upcomingAppointments || []),
      ...(appointmentsBody.doneAppointments || [])
    ].find((appointment) => appointment.prescription?.id);

    expect(appointmentWithPrescription?.id).toBeTruthy();
    const appointmentId = appointmentWithPrescription.id;
    await page.goto(
      `/pdf-preview?src=${encodeURIComponent(`/api/prescriptions/${appointmentId}/pdf`)}` +
        `&download=${encodeURIComponent(`/api/prescriptions/${appointmentId}/pdf?download=1`)}` +
        `&title=${encodeURIComponent(`Prescription ${appointmentId}`)}` +
        `&appointmentId=${encodeURIComponent(appointmentId)}`
    );

    await expect(page.locator('body')).toContainText(/in-app preview|listen prescription|download/i);
    const pdfOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(pdfOverflow).toBeLessThanOrEqual(1);
  });

  test('doctor can login and inspect appointments, slots, analytics, and patient access', async ({ page }) => {
    await login(page, DEMO_USERS.doctor);

    await page.goto('/appointments');
    await expect(page.locator('body')).toContainText(/appointment|patient|visit/i);

    await page.goto('/doctors/me/slots');
    await expect(page.locator('body')).toContainText(/slot|availability|booked/i);

    await page.goto('/doctors/me/analytics');
    await expect(page.locator('body')).toContainText(/analytics|booked|rating/i);

    await page.goto('/doctor/patient-access');
    await expect(page.locator('body')).toContainText(/patient access|token|lookup|delegated/i);
  });

  test('admin can login and inspect operational pages', async ({ page }) => {
    await login(page, DEMO_USERS.admin);

    await page.goto('/appointments');
    await expect(page.locator('body')).toContainText(/appointment|doctor|patient/i);

    await page.goto('/labs/tests');
    await expect(page.locator('body')).toContainText(/lab|test|catalog/i);

    await page.goto('/pharmacy/orders');
    await expect(page.locator('body')).toContainText(/pharmacy|order|patient/i);

    await page.goto('/innovations');
    await expect(page.locator('body')).toContainText(/impact|triage|emergency|innovation/i);
  });

  test('admin workflow page renders persisted traces and pipeline stages', async ({ page }) => {
    await login(page, DEMO_USERS.admin);
    await page.goto('/admin/ai-agents');
    await expect(page.getByRole('heading', { name: 'AI Agent Operations Center' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Runs' })).toBeVisible();
    await expect(page.locator('.agent-run-card').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Live workflow pipeline' })).toBeVisible();
    await expect(page.locator('.agent-pipeline').first().locator('.agent-stage')).toHaveCount(11);
    await expect(page.locator('.agent-ops-sync')).toContainText('Visual updates only: running');
  });

  test('admin can start a demo no-show workflow and see its approval gate', async ({ browser }) => {
    test.skip(process.env.TELEMEDICINE_LIVE_WORKFLOW_TEST !== '1', 'Opt-in production workflow mutation');
    const adminContext = await browser.newContext();
    const patientContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const patientPage = await patientContext.newPage();
    try {
      await login(adminPage, DEMO_USERS.admin);
      await login(patientPage, DEMO_USERS.patient);
      const patientMe = await (await patientPage.request.get('/api/users/me')).json();
      const patientId = patientMe.user?.id;
      expect(patientId).toBeTruthy();

      const traces = await (await adminPage.request.get('/api/admin/agents/traces?limit=50')).json();
      const queued = (traces.rows || []).find((trace) =>
        trace.agentType === 'no_show_recovery' &&
        trace.run?.status === 'queued_for_start' &&
        trace.patient?.id === patientId
      );
      expect(queued, 'a queued no-show ticket for the demo patient').toBeTruthy();

      await adminPage.goto('/admin/ai-agents');
      await adminPage.locator('.agent-run-card').filter({ hasText: queued.id.slice(0, 8) }).click();
      await adminPage.getByRole('button', { name: 'Start Workflow' }).click();
      await expect(adminPage.locator('.agent-selected-summary')).toContainText('awaiting approval', { timeout: 120_000 });
      await expect(adminPage.locator('.agent-pipeline').first()).toContainText('AI Reasoning & Plan Generation');
      await expect(adminPage.getByRole('button', { name: /Approve and Continue|Approval available in/i })).toBeVisible();
    } finally {
      await adminContext.close();
      await patientContext.close();
    }
  });

  test('help worker can login and inspect consent support flow', async ({ page }) => {
    await login(page, DEMO_USERS.helper);

    await page.goto('/support/consents');
    await expect(page.locator('body')).toContainText(/care support|consent|helper/i);

    await page.goto('/appointments');
    await expect(page.locator('body')).toContainText(/appointment|consent|support|visit/i);
  });

  test('booked demo patient sees Join Session and can connect video with the doctor', async ({ browser }) => {
    test.skip(process.env.TELEMEDICINE_LIVE_CALL_TEST !== '1', 'Opt-in production call session');
    const patientContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const doctorContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const patientPage = await patientContext.newPage();
    const doctorPage = await doctorContext.newPage();
    let appointmentId;

    try {
      await login(patientPage, DEMO_USERS.patient);
      await login(doctorPage, DEMO_USERS.doctor);

      const patientAppointments = await (await patientPage.request.get('/api/appointments')).json();
      const doctorAppointments = await (await doctorPage.request.get('/api/appointments')).json();
      const doctorBookedIds = new Set([
        ...(doctorAppointments.upcomingAppointments || []),
        ...(doctorAppointments.doneAppointments || [])
      ].filter((item) => item.status === 'booked').map((item) => item.id));
      const appointment = [
        ...(patientAppointments.upcomingAppointments || []),
        ...(patientAppointments.doneAppointments || [])
      ].find(
        (item) => item.status === 'booked' && item.mode === 'video' && doctorBookedIds.has(item.id)
      );
      expect(appointment, 'a booked demo video appointment shared by the patient and doctor').toBeTruthy();
      appointmentId = appointment.id;

      await patientPage.goto(`/appointments/${appointmentId}`);
      await expect(patientPage.getByRole('link', { name: /Join Session/i })).toBeVisible();
      await doctorPage.goto(`/appointments/${appointmentId}`);
      await expect(doctorPage.getByRole('link', { name: /Join Call/i })).toBeVisible();

      await Promise.all([
        patientPage.goto(`/calls/${appointmentId}`),
        doctorPage.goto(`/calls/${appointmentId}`)
      ]);
      await expect(patientPage.locator('#status')).toHaveText('pc:connected', { timeout: 45_000 });
      await expect(doctorPage.locator('#status')).toHaveText('pc:connected', { timeout: 45_000 });
      for (const page of [patientPage, doctorPage]) {
        await expect.poll(() => page.locator('#remoteVideo').evaluate(
          (video) => video.srcObject?.getVideoTracks().some((track) => track.readyState === 'live') || false
        )).toBe(true);
      }
    } finally {
      if (appointmentId) await patientPage.request.post(`/api/calls/${appointmentId}/end`).catch(() => {});
      await patientContext.close();
      await doctorContext.close();
    }
  });
});
