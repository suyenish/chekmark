import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { AiOutputInvalidError, AiTransientError } from './ai-client.js';
import { ClaudeAiClient } from './claude-ai-client.js';
import { detectionResultSchema } from '../detection/detection.schema.js';

const schema = z.object({ answer: z.string() });
const request = { purpose: 'detect' as const, system: 'sys', prompt: 'hello', schema };

const reply = (text: string, stop_reason = 'end_turn') => ({
  stop_reason,
  content: [{ type: 'text', text }],
  usage: { input_tokens: 100, output_tokens: 20 },
});

function setup(...responses: unknown[]) {
  const create = vi.fn();
  for (const response of responses) {
    if (response instanceof Error) create.mockRejectedValueOnce(response);
    else create.mockResolvedValueOnce(response);
  }
  const usage = vi.fn();
  const client = new ClaudeAiClient({ messages: { create } } as unknown as Anthropic, 'test-model', usage);
  return { client, create, usage };
}

type ApiErrorClass = new (status: never, error: undefined, message: string, headers: Headers) => Error;
const apiError = (Type: ApiErrorClass, status: number) =>
  new Type(status as never, undefined, 'failed', new Headers());

describe('ClaudeAiClient', () => {
  it('returns the parsed output using the configured model', async () => {
    const { client, create } = setup(reply('{"answer":"yes"}'));
    await expect(client.generate(request)).resolves.toEqual({ answer: 'yes' });
    expect(create.mock.calls[0][0].model).toBe('test-model');
    expect(create.mock.calls[0][0].system).toBe('sys');
  });

  it('sends the image as JPEG when imageJpeg is present', async () => {
    const { client, create } = setup(reply('{"answer":"yes"}'));
    await client.generate({ ...request, imageJpeg: Buffer.from('photo') });
    const [image, text] = create.mock.calls[0][0].messages[0].content;
    expect(image).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from('photo').toString('base64') },
    });
    expect(text).toEqual({ type: 'text', text: 'hello' });
  });

  it('sends no image block when imageJpeg is absent', async () => {
    const { client, create } = setup(reply('{"answer":"yes"}'));
    await client.generate(request);
    expect(create.mock.calls[0][0].messages[0].content).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('asks for structured output that matches the detection schema', async () => {
    const { client, create } = setup(reply('{"photo_usable":true,"problem":null,"marks":[]}'));
    await client.generate({ ...request, schema: detectionResultSchema });
    const format = create.mock.calls[0][0].output_config.format;
    expect(format.type).toBe('json_schema');
    expect(Object.keys(format.schema.properties)).toEqual(['photo_usable', 'problem', 'marks']);
  });

  it('retries once with the validation error when output fails the schema', async () => {
    const { client, create } = setup(reply('{"answer":1}'), reply('{"answer":"fixed"}'));
    await expect(client.generate(request)).resolves.toEqual({ answer: 'fixed' });
    expect(create).toHaveBeenCalledTimes(2);
    const retryText = create.mock.calls[1][0].messages[0].content.at(-1).text;
    expect(retryText).toContain('hello');
    expect(retryText).toContain('answer');
  });

  it('retries once when the output is not JSON', async () => {
    const { client, create } = setup(reply('not json'), reply('{"answer":"fixed"}'));
    await expect(client.generate(request)).resolves.toEqual({ answer: 'fixed' });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('throws AiOutputInvalidError when the retry is also invalid', async () => {
    const { client, create } = setup(reply('bad'), reply('still bad'));
    await expect(client.generate(request)).rejects.toBeInstanceOf(AiOutputInvalidError);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('throws AiOutputInvalidError without retrying when the model refuses', async () => {
    const { client, create } = setup(reply('', 'refusal'));
    await expect(client.generate(request)).rejects.toBeInstanceOf(AiOutputInvalidError);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a timeout', () => new Anthropic.APIConnectionTimeoutError()],
    ['a connection failure', () => new Anthropic.APIConnectionError({ message: 'down' })],
    ['a 429', () => apiError(Anthropic.RateLimitError, 429)],
    ['a 5xx', () => apiError(Anthropic.InternalServerError, 503)],
  ])('throws AiTransientError on %s', async (_name, makeError) => {
    const { client } = setup(makeError());
    await expect(client.generate(request)).rejects.toBeInstanceOf(AiTransientError);
  });

  it('passes on a request error unchanged', async () => {
    const error = apiError(Anthropic.BadRequestError, 400);
    const { client } = setup(error);
    await expect(client.generate(request)).rejects.toBe(error);
  });

  it('reports usage for every call, including a retried call', async () => {
    const { client, usage } = setup(reply('bad'), reply('{"answer":"fixed"}'));
    await client.generate({ ...request, userId: 'u1', pageId: 'p1' });
    expect(usage).toHaveBeenCalledTimes(2);
    expect(usage.mock.calls[0][0]).toMatchObject({
      purpose: 'detect',
      model: 'test-model',
      inputTokens: 100,
      outputTokens: 20,
      userId: 'u1',
      pageId: 'p1',
    });
    expect(usage.mock.calls[0][0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('waits for the usage callback, so the call is logged before the result is used', async () => {
    const create = vi.fn().mockResolvedValue(reply('{"answer":"yes"}'));
    const order: string[] = [];
    const client = new ClaudeAiClient({ messages: { create } } as unknown as Anthropic, 'test-model', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push('logged');
    });
    await client.generate(request);
    order.push('returned');
    expect(order).toEqual(['logged', 'returned']);
  });
});
