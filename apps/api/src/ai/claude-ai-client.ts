import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import {
  AiOutputInvalidError,
  AiTransientError,
  type AiClient,
  type AiRequest,
  type UsageListener,
} from './ai-client.js';

const MAX_TOKENS = 16000;

type Parsed<T> = { ok: true; value: T } | { ok: false; problem: string };

export class ClaudeAiClient implements AiClient {
  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
    private readonly onUsage?: UsageListener,
  ) {}

  async generate<T>(req: AiRequest<T>): Promise<T> {
    const first = await this.attempt(req, req.prompt);
    if (first.ok) return first.value;

    const retryPrompt = `${req.prompt}\n\nYour previous response was rejected for this reason. Return corrected output.\n${first.problem}`;
    const second = await this.attempt(req, retryPrompt);
    if (second.ok) return second.value;

    throw new AiOutputInvalidError(`Model output was invalid after a retry: ${second.problem}`);
  }

  private async attempt<T>(req: AiRequest<T>, prompt: string): Promise<Parsed<T>> {
    const startedAt = Date.now();
    const response = await this.send(req, prompt);
    await this.onUsage?.({
      purpose: req.purpose,
      model: this.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      durationMs: Date.now() - startedAt,
      userId: req.userId,
      pageId: req.pageId,
    });

    if (response.stop_reason === 'refusal') {
      throw new AiOutputInvalidError('The model refused this request');
    }
    const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
    return parseOutput(text, req.schema);
  }

  private async send<T>(req: AiRequest<T>, prompt: string): Promise<Anthropic.Message> {
    const content: Anthropic.ContentBlockParam[] = [{ type: 'text', text: prompt }];
    if (req.imageJpeg) {
      content.unshift({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: req.imageJpeg.toString('base64') },
      });
    }
    try {
      return await this.client.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        system: req.system,
        messages: [{ role: 'user', content }],
        output_config: { effort: 'medium', format: zodOutputFormat(req.schema) },
      } as Anthropic.MessageCreateParamsNonStreaming);
    } catch (error) {
      if (
        error instanceof Anthropic.RateLimitError ||
        error instanceof Anthropic.InternalServerError ||
        error instanceof Anthropic.APIConnectionError
      ) {
        throw new AiTransientError(error.message, { cause: error });
      }
      throw error;
    }
  }
}

function parseOutput<T>(text: string, schema: z.ZodType<T>): Parsed<T> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'The response was not valid JSON.' };
  }
  const result = schema.safeParse(json);
  return result.success ? { ok: true, value: result.data } : { ok: false, problem: z.prettifyError(result.error) };
}
