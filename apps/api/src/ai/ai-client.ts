import type { z } from 'zod';

export type AiPurpose = 'detect' | 'resolve' | 'explain';

export interface AiRequest<T> {
  purpose: AiPurpose;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  imageJpeg?: Buffer;
  userId?: string;
  pageId?: string;
}

/** Nest injection token for the AiClient. */
export const AI_CLIENT = Symbol('AI_CLIENT');

/** Called after every model call, including retries. The client waits for it. */
export type UsageListener = (usage: AiUsage) => void | Promise<void>;

export interface AiClient {
  generate<T>(req: AiRequest<T>): Promise<T>;
}

export interface AiUsage {
  purpose: AiPurpose;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  userId?: string;
  pageId?: string;
}

/** The model's output was still unusable after one retry, or the model refused. */
export class AiOutputInvalidError extends Error {
  override name = 'AiOutputInvalidError';
}

/** A temporary failure such as a timeout, 429 or 5xx. Safe to try again later. */
export class AiTransientError extends Error {
  override name = 'AiTransientError';
}
