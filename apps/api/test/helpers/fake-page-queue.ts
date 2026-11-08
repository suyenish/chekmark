import type { PageQueue } from '../../src/jobs/queues.js';

/** Records queued pages instead of using Redis. */
export class FakePageQueue implements PageQueue {
  readonly detection: string[] = [];
  readonly explanation: string[] = [];

  async enqueueDetection(pageId: string): Promise<void> {
    this.detection.push(pageId);
  }

  async enqueueExplanation(pageId: string): Promise<void> {
    this.explanation.push(pageId);
  }

  clear(): void {
    this.detection.length = 0;
    this.explanation.length = 0;
  }
}
