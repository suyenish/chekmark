import type { PageQueue } from '../../src/jobs/queues.js';

/** Records queued pages instead of using Redis. */
export class FakePageQueue implements PageQueue {
  readonly detection: string[] = [];
  readonly explanation: string[] = [];
  /** Page IDs queued with { retry: true }. */
  readonly retries: string[] = [];

  async enqueueDetection(pageId: string, options?: { retry?: boolean }): Promise<void> {
    this.detection.push(pageId);
    if (options?.retry) this.retries.push(pageId);
  }

  async enqueueExplanation(pageId: string, options?: { retry?: boolean }): Promise<void> {
    this.explanation.push(pageId);
    if (options?.retry) this.retries.push(pageId);
  }

  clear(): void {
    this.detection.length = 0;
    this.explanation.length = 0;
    this.retries.length = 0;
  }
}
