jest.mock('../apps/backend/models/db', () => ({
  prisma: { agentExecutionEvent: { create: jest.fn() } }
}));

const { prisma } = require('../apps/backend/models/db');
const { sanitizeAgentEventMetadata, recordAgentEvent, withAgentPhase } = require('../apps/backend/services/agent-observability.service');

describe('agent observability safety', () => {
  afterEach(() => jest.clearAllMocks());

  it('allowlists operational metadata and removes secrets and raw patient content', () => {
    expect(sanitizeAgentEventMetadata({ provider: 'openrouter', model: 'openai/gpt-oss-120b', apiKey: 'secret', prompt: 'private', medicineCount: 2 }))
      .toEqual({ provider: 'openrouter', model: 'openai/gpt-oss-120b', medicineCount: 2 });
  });

  it('records event durations without changing workflow result', async () => {
    prisma.agentExecutionEvent.create.mockResolvedValue({ id: 'event-1' });
    const result = await withAgentPhase({ traceId: 'trace-1', phase: 'planning', startEventType: 'ai_request_started', completedEventType: 'ai_request_completed', failedEventType: 'ai_request_failed', title: 'AI request' }, async () => 'ok');
    expect(result).toBe('ok');
    expect(prisma.agentExecutionEvent.create).toHaveBeenCalledTimes(2);
    expect(prisma.agentExecutionEvent.create.mock.calls.at(-1)[0].data.durationMs).toEqual(expect.any(Number));
  });

  it('writes only a sanitized event payload', async () => {
    prisma.agentExecutionEvent.create.mockResolvedValue({ id: 'event-2' });
    await recordAgentEvent({ traceId: 'trace-1', phase: 'planning', eventType: 'ai_response_received', status: 'completed', title: 'Response received', metadata: { provider: 'openrouter', authorization: 'Bearer secret' } });
    expect(prisma.agentExecutionEvent.create.mock.calls[0][0].data.metadata).toEqual({ provider: 'openrouter' });
  });
});
