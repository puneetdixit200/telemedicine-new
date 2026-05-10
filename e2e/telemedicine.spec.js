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

  test('help worker can login and inspect consent support flow', async ({ page }) => {
    await login(page, DEMO_USERS.helper);

    await page.goto('/support/consents');
    await expect(page.locator('body')).toContainText(/care support|consent|helper/i);

    await page.goto('/appointments');
    await expect(page.locator('body')).toContainText(/appointment|consent|support|visit/i);
  });
});
