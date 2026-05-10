const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 45000);
const OPENROUTER_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS || process.env.OLLAMA_TIMEOUT_MS || 45000);
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-oss-120b:free';
const isProd = process.env.NODE_ENV === 'production';

function getOllamaBaseUrl() {
  const defaultBaseUrl = isProd ? '' : 'http://127.0.0.1:11434';
  return String(process.env.OLLAMA_BASE_URL || defaultBaseUrl).trim().replace(/\/$/, '');
}

function getOllamaModel() {
  return String(process.env.OLLAMA_MODEL || 'llama3.1:8b').trim();
}

function isOllamaConfigured() {
  return Boolean(getOllamaBaseUrl() && getOllamaModel());
}

function getOpenRouterApiKey() {
  return String(process.env.OPENROUTER_API_KEY || '').trim();
}

function getOpenRouterModel() {
  return String(process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL).trim();
}

function isOpenRouterConfigured() {
  return Boolean(getOpenRouterApiKey() && getOpenRouterModel());
}

function getAiProviderInfo() {
  if (isOpenRouterConfigured()) {
    return {
      configured: true,
      provider: 'openrouter',
      model: getOpenRouterModel(),
      baseUrl: OPENROUTER_BASE_URL
    };
  }

  return {
    configured: isOllamaConfigured(),
    provider: 'ollama',
    model: getOllamaModel(),
    baseUrl: getOllamaBaseUrl()
  };
}

function isAiConfigured() {
  return getAiProviderInfo().configured;
}

function getAiModel() {
  return getAiProviderInfo().model;
}

function extractResponseText(payload) {
  if (!payload) return '';
  if (typeof payload.response === 'string') return payload.response.trim();
  if (typeof payload.message?.content === 'string') return payload.message.content.trim();
  return '';
}

async function ollamaGenerate({ systemPrompt, userPrompt, temperature = 0.2, maxTokens = 900 }) {
  if (!isOllamaConfigured()) {
    const error = new Error('Ollama is not configured. Set OLLAMA_BASE_URL and OLLAMA_MODEL.');
    error.status = 503;
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    const res = await fetch(`${getOllamaBaseUrl()}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: getOllamaModel(),
        system: String(systemPrompt || ''),
        prompt: String(userPrompt || ''),
        stream: false,
        options: {
          temperature,
          num_predict: maxTokens
        }
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const error = new Error(`Ollama request failed (${res.status}). ${text || 'No additional details.'}`);
      error.status = 502;
      throw error;
    }

    const payload = await res.json();
    const text = extractResponseText(payload);
    if (!text) {
      const error = new Error('Ollama returned an empty response.');
      error.status = 502;
      throw error;
    }

    return text;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('Ollama request timed out. Try a shorter prompt or increase OLLAMA_TIMEOUT_MS.');
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function openRouterGenerate({ systemPrompt, userPrompt, temperature = 0.2, maxTokens = 900 }) {
  if (!isOpenRouterConfigured()) {
    const error = new Error('OpenRouter is not configured. Set OPENROUTER_API_KEY and OPENROUTER_MODEL.');
    error.status = 503;
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

  try {
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getOpenRouterApiKey()}`,
        'HTTP-Referer': process.env.APP_BASE_URL || 'http://localhost:3000',
        'X-Title': 'Telemedicine Rural Health'
      },
      body: JSON.stringify({
        model: getOpenRouterModel(),
        messages: [
          { role: 'system', content: String(systemPrompt || '') },
          { role: 'user', content: String(userPrompt || '') }
        ],
        temperature,
        max_tokens: maxTokens
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const error = new Error(`OpenRouter request failed (${res.status}). ${text || 'No additional details.'}`);
      error.status = 502;
      throw error;
    }

    const payload = await res.json();
    const text = String(payload?.choices?.[0]?.message?.content || '').trim();
    if (!text) {
      const error = new Error('OpenRouter returned an empty response.');
      error.status = 502;
      throw error;
    }

    return text;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('OpenRouter request timed out. Try a shorter prompt or increase OPENROUTER_TIMEOUT_MS.');
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function aiGenerate(options) {
  if (isOpenRouterConfigured()) {
    return openRouterGenerate(options);
  }

  return ollamaGenerate(options);
}

function tryParseJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (_err) {
    // Continue and try block extraction.
  }

  const jsonBlock = raw.match(/\{[\s\S]*\}/);
  if (!jsonBlock) return null;

  try {
    return JSON.parse(jsonBlock[0]);
  } catch (_err) {
    return null;
  }
}

module.exports = {
  getOllamaBaseUrl,
  getOllamaModel,
  getOpenRouterModel,
  getAiModel,
  getAiProviderInfo,
  isAiConfigured,
  isOllamaConfigured,
  isOpenRouterConfigured,
  aiGenerate,
  ollamaGenerate,
  openRouterGenerate,
  tryParseJson
};
