function safeText(value) {
  return String(value || '').trim();
}

function normalizeIndianPhone(value) {
  const raw = safeText(value);
  if (!raw) return null;

  if (/^\+[1-9]\d{7,14}$/.test(raw)) return raw;

  const digits = raw.replace(/\D/g, '');
  if (/^91\d{10}$/.test(digits)) return `+${digits}`;
  if (/^\d{10}$/.test(digits)) return `+91${digits}`;
  if (/^[1-9]\d{7,14}$/.test(digits)) return `+${digits}`;
  return null;
}

function smsProviderConfig() {
  const accountSid = safeText(process.env.TWILIO_ACCOUNT_SID);
  const apiKey = safeText(process.env.TWILIO_API_KEY);
  const apiKeySecret = safeText(process.env.TWILIO_API_KEY_SECRET);
  const authToken = safeText(process.env.TWILIO_AUTH_TOKEN);
  const fromNumber = safeText(process.env.TWILIO_FROM_NUMBER);
  const messagingServiceSid = safeText(process.env.TWILIO_MESSAGING_SERVICE_SID);

  const username = apiKey || accountSid;
  const password = apiKey ? apiKeySecret : authToken;

  return {
    provider: 'twilio',
    configured: Boolean(accountSid && username && password && (fromNumber || messagingServiceSid)),
    accountSid,
    username,
    password,
    fromNumber,
    messagingServiceSid
  };
}

function providerError(message, code, statusCode) {
  const error = new Error(message);
  error.code = code;
  if (statusCode) error.statusCode = statusCode;
  return error;
}

async function sendSms({ to, body }) {
  const config = smsProviderConfig();
  if (!config.configured) {
    throw providerError('SMS provider is not configured.', 'SMS_PROVIDER_NOT_CONFIGURED');
  }

  const normalizedTo = normalizeIndianPhone(to);
  if (!normalizedTo) {
    throw providerError('Patient phone number is invalid for SMS delivery.', 'SMS_INVALID_DESTINATION');
  }

  const messageBody = safeText(body);
  if (!messageBody) {
    throw providerError('SMS body is empty.', 'SMS_EMPTY_BODY');
  }

  const form = new URLSearchParams();
  form.set('To', normalizedTo);
  form.set('Body', messageBody);
  if (config.messagingServiceSid) form.set('MessagingServiceSid', config.messagingServiceSid);
  else form.set('From', config.fromNumber);

  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Number(process.env.SMS_PROVIDER_TIMEOUT_MS || 10000));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: form.toString(),
        signal: controller.signal
      }
    );
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw providerError('SMS provider request timed out.', 'SMS_PROVIDER_TIMEOUT');
    }
    throw providerError('SMS provider request failed.', 'SMS_PROVIDER_NETWORK_ERROR');
  } finally {
    clearTimeout(timeout);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }

  if (!response.ok) {
    const statusCode = Number(response.status) || 502;
    throw providerError(
      `SMS provider rejected the request with HTTP ${statusCode}.`,
      'SMS_PROVIDER_REJECTED',
      statusCode
    );
  }

  const sid = safeText(payload?.sid);
  if (!sid) {
    throw providerError('SMS provider returned an invalid response.', 'SMS_PROVIDER_INVALID_RESPONSE');
  }

  return {
    ok: true,
    provider: 'twilio',
    messageId: sid,
    providerStatus: safeText(payload?.status) || 'accepted'
  };
}

module.exports = {
  normalizeIndianPhone,
  smsProviderConfig,
  sendSms
};
