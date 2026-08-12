describe('Twilio SMS adapter', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    global.fetch = jest.fn();
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_API_KEY;
    delete process.env.TWILIO_API_KEY_SECRET;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
  });

  afterAll(() => {
    process.env = originalEnv;
    delete global.fetch;
  });

  test('normalizes Indian mobile numbers to E.164', () => {
    const { normalizeIndianPhone } = require('../apps/backend/services/sms.service');
    expect(normalizeIndianPhone('98765 43210')).toBe('+919876543210');
    expect(normalizeIndianPhone('91-9876543210')).toBe('+919876543210');
    expect(normalizeIndianPhone('+919876543210')).toBe('+919876543210');
    expect(normalizeIndianPhone('123')).toBeNull();
  });

  test('fails truthfully when provider credentials are absent', async () => {
    const { sendSms } = require('../apps/backend/services/sms.service');
    await expect(sendSms({ to: '9876543210', body: 'Reminder' })).rejects.toMatchObject({
      code: 'SMS_PROVIDER_NOT_CONFIGURED'
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('submits a form-encoded message and returns provider metadata', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'test-account';
    process.env.TWILIO_AUTH_TOKEN = 'test-token';
    process.env.TWILIO_FROM_NUMBER = '+15551234567';
    global.fetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ sid: 'test-message-id', status: 'queued' })
    });

    const { sendSms } = require('../apps/backend/services/sms.service');
    const result = await sendSms({ to: '9876543210', body: 'Appointment reminder' });

    expect(result).toEqual({
      ok: true,
      provider: 'twilio',
      messageId: 'test-message-id',
      providerStatus: 'queued'
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, request] = global.fetch.mock.calls[0];
    const body = new URLSearchParams(request.body);
    expect(body.get('To')).toBe('+919876543210');
    expect(body.get('From')).toBe('+15551234567');
    expect(body.get('Body')).toBe('Appointment reminder');
    expect(request.headers.Authorization).toMatch(/^Basic /);
  });

  test('does not expose provider response content in a rejected-request error', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'test-account';
    process.env.TWILIO_AUTH_TOKEN = 'test-token';
    process.env.TWILIO_FROM_NUMBER = '+15551234567';
    global.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'sensitive provider details' })
    });

    const { sendSms } = require('../apps/backend/services/sms.service');
    await expect(sendSms({ to: '9876543210', body: 'Reminder' })).rejects.toMatchObject({
      code: 'SMS_PROVIDER_REJECTED',
      message: 'SMS provider rejected the request with HTTP 400.'
    });
  });
});

describe('reminder dispatch claims', () => {
  beforeEach(() => jest.resetModules());

  test('claims a due job before provider delivery and marks provider acceptance as sent', async () => {
    const prisma = {
      reminderJob: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'reminder-1',
            status: 'scheduled',
            payload: { message: 'Reminder text' },
            patient: { fullName: 'Patient', phone: '9876543210' },
            appointment: { id: 'appt-1', startAt: new Date(), doctor: { fullName: 'Doctor' } }
          }
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({})
      }
    };
    const sendSms = jest.fn().mockResolvedValue({
      ok: true,
      provider: 'twilio',
      messageId: 'provider-message-1',
      providerStatus: 'queued'
    });

    jest.doMock('../apps/backend/models/db', () => ({ prisma }));
    jest.doMock('../apps/backend/services/sms.service', () => ({ sendSms }));
    const { dispatchDueReminderJobs } = require('../apps/backend/services/reminder.service');

    const result = await dispatchDueReminderJobs({ limit: 1 });

    expect(prisma.reminderJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'reminder-1', status: 'scheduled' },
      data: expect.objectContaining({ status: 'failed', lastError: 'SMS_DISPATCH_IN_PROGRESS' })
    }));
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(prisma.reminderJob.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'reminder-1' },
      data: expect.objectContaining({ status: 'sent', lastError: null })
    }));
    expect(result).toEqual({ ok: true, processed: 1, sent: 1, failed: 0, skipped: 0 });
  });

  test('does not call the provider when another dispatcher already claimed the job', async () => {
    const prisma = {
      reminderJob: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'reminder-1',
            status: 'scheduled',
            payload: { message: 'Reminder text' },
            patient: { fullName: 'Patient', phone: '9876543210' },
            appointment: { id: 'appt-1', startAt: new Date(), doctor: { fullName: 'Doctor' } }
          }
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn()
      }
    };
    const sendSms = jest.fn();

    jest.doMock('../apps/backend/models/db', () => ({ prisma }));
    jest.doMock('../apps/backend/services/sms.service', () => ({ sendSms }));
    const { dispatchDueReminderJobs } = require('../apps/backend/services/reminder.service');

    const result = await dispatchDueReminderJobs({ limit: 1 });

    expect(sendSms).not.toHaveBeenCalled();
    expect(prisma.reminderJob.update).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, processed: 0, sent: 0, failed: 0, skipped: 1 });
  });

  test('keeps a claimed reminder failed when provider delivery fails', async () => {
    const prisma = {
      reminderJob: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'reminder-1',
            status: 'scheduled',
            payload: { message: 'Reminder text' },
            patient: { fullName: 'Patient', phone: '9876543210' },
            appointment: { id: 'appt-1', startAt: new Date(), doctor: { fullName: 'Doctor' } }
          }
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({})
      }
    };
    const error = Object.assign(new Error('not configured'), { code: 'SMS_PROVIDER_NOT_CONFIGURED' });
    const sendSms = jest.fn().mockRejectedValue(error);

    jest.doMock('../apps/backend/models/db', () => ({ prisma }));
    jest.doMock('../apps/backend/services/sms.service', () => ({ sendSms }));
    const { dispatchDueReminderJobs } = require('../apps/backend/services/reminder.service');

    const result = await dispatchDueReminderJobs({ limit: 1 });

    expect(prisma.reminderJob.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed', lastError: 'SMS_PROVIDER_NOT_CONFIGURED' })
    }));
    expect(result).toEqual({ ok: true, processed: 1, sent: 0, failed: 1, skipped: 0 });
  });
});
