describe('OpenRouter provider configuration', () => {
  const original = {
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
    ollamaModel: process.env.OLLAMA_MODEL
  };

  afterEach(() => {
    process.env.OPENROUTER_API_KEY = original.apiKey;
    process.env.OPENROUTER_MODEL = original.model;
    process.env.OLLAMA_BASE_URL = original.ollamaBaseUrl;
    process.env.OLLAMA_MODEL = original.ollamaModel;
    jest.resetModules();
  });

  it('normalizes the obsolete free gpt-oss slug to the supported model', () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_MODEL = 'openai/gpt-oss-120b:free';
    jest.resetModules();
    const service = require('../apps/backend/services/ollama.service');

    expect(service.getOpenRouterModel()).toBe('openai/gpt-oss-120b');
    expect(service.getAiProviderInfo()).toMatchObject({ provider: 'openrouter', configured: true });
  });

  it('keeps OpenRouter first when configured and preserves Ollama fallback selection', () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_MODEL = 'openai/gpt-oss-120b';
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    process.env.OLLAMA_MODEL = 'llama3.1:8b';
    jest.resetModules();
    const service = require('../apps/backend/services/ollama.service');

    expect(service.getAiProviderInfo()).toMatchObject({ provider: 'openrouter', model: 'openai/gpt-oss-120b' });
    delete process.env.OPENROUTER_API_KEY;
    jest.resetModules();
    const ollamaOnly = require('../apps/backend/services/ollama.service');
    expect(ollamaOnly.getAiProviderInfo()).toMatchObject({ provider: 'ollama', model: 'llama3.1:8b' });
  });
});
