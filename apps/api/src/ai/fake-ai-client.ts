import type { AiClient, AiRequest, UsageListener } from './ai-client.js';

export type FakeResponse = { output: unknown; inputTokens?: number; outputTokens?: number } | { error: Error };

/**
 * Stands in for Claude in tests: returns queued responses in order. It
 * refuses to start in production, so it can never answer real users.
 */
export class FakeAiClient implements AiClient {
  readonly requests: AiRequest<unknown>[] = [];
  private readonly responses: FakeResponse[] = [];
  private readonly model: string;
  private readonly onUsage?: UsageListener;

  constructor(options: { nodeEnv: string; model?: string; onUsage?: UsageListener }) {
    if (options.nodeEnv === 'production') throw new Error('FakeAiClient must not be used in production');
    this.model = options.model ?? 'fake-model';
    this.onUsage = options.onUsage;
  }

  queue(...responses: FakeResponse[]): void {
    this.responses.push(...responses);
  }

  clear(): void {
    this.responses.length = 0;
    this.requests.length = 0;
  }

  async generate<T>(req: AiRequest<T>): Promise<T> {
    this.requests.push(req as AiRequest<unknown>);
    const response = this.responses.shift();
    if (!response) throw new Error('FakeAiClient has no queued response for this call');
    if ('error' in response) throw response.error;
    await this.onUsage?.({
      purpose: req.purpose,
      model: this.model,
      inputTokens: response.inputTokens ?? 0,
      outputTokens: response.outputTokens ?? 0,
      durationMs: 0,
      userId: req.userId,
      pageId: req.pageId,
    });
    return req.schema.parse(response.output);
  }
}
