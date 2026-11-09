import { z } from 'zod';
import { AiTransientError } from './ai-client.js';
import { FakeAiClient } from './fake-ai-client.js';

const schema = z.object({ answer: z.string() });
const request = { purpose: 'detect' as const, system: 'sys', prompt: 'hello', schema, userId: 'u1', pageId: 'p1' };

describe('FakeAiClient', () => {
  it('refuses to start when NODE_ENV=production', () => {
    expect(() => new FakeAiClient({ nodeEnv: 'production' })).toThrow(/production/);
  });

  it('returns queued responses in order and records the requests', async () => {
    const fake = new FakeAiClient({ nodeEnv: 'test' });
    fake.queue({ output: { answer: 'one' } }, { output: { answer: 'two' } });
    await expect(fake.generate(request)).resolves.toEqual({ answer: 'one' });
    await expect(fake.generate(request)).resolves.toEqual({ answer: 'two' });
    expect(fake.requests).toHaveLength(2);
  });

  it('throws a queued error', async () => {
    const fake = new FakeAiClient({ nodeEnv: 'test' });
    fake.queue({ error: new AiTransientError('timeout') });
    await expect(fake.generate(request)).rejects.toBeInstanceOf(AiTransientError);
  });

  it('throws a clear error when nothing is queued', async () => {
    await expect(new FakeAiClient({ nodeEnv: 'test' }).generate(request)).rejects.toThrow(/no queued response/);
  });

  it('checks queued output against the schema, like the real client', async () => {
    const fake = new FakeAiClient({ nodeEnv: 'test' });
    fake.queue({ output: { answer: 1 } });
    await expect(fake.generate(request)).rejects.toThrow();
  });

  it('reports usage for each successful call, with the given token counts', async () => {
    const onUsage = vi.fn();
    const fake = new FakeAiClient({ nodeEnv: 'test', model: 'fake-model', onUsage });
    fake.queue({ output: { answer: 'x' }, inputTokens: 1000, outputTokens: 200 });
    await fake.generate(request);
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'detect', model: 'fake-model', inputTokens: 1000, outputTokens: 200, userId: 'u1', pageId: 'p1' }),
    );
  });
});
