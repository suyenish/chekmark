import type { Logger } from '@nestjs/common';
import { type JobsOptions, Queue } from 'bullmq';
import { Redis } from 'ioredis';

/** Queue names. Each queue holds one kind of work. */
export const DETECTION_QUEUE = 'detection';
export const EXPLANATION_QUEUE = 'explanation';
export const MAINTENANCE_QUEUE = 'maintenance';

/** The repeatable job that re-queues stuck pages. */
export const STUCK_PAGE_CHECK = 'requeue-stuck-pages';
export const STUCK_PAGE_CHECK_EVERY_MS = 5 * 60 * 1000;

export type PageJob = { pageId: string };

/** Puts page work on the queue. Adding a page that is already waiting does nothing. */
export interface PageQueue {
  enqueueDetection(pageId: string): Promise<void>;
  enqueueExplanation(pageId: string): Promise<void>;
}

/** Nest injection token for the PageQueue. */
export const PAGE_QUEUE = Symbol('PAGE_QUEUE');

/**
 * Up to 3 attempts, waiting 5 s and then 10 s between them. Finished jobs are
 * removed, so the page's job ID is free again for a later retry.
 */
export const PAGE_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: true,
  removeOnFail: true,
} as const satisfies JobsOptions;

/**
 * The API's connection fails fast when Redis is down, so an upload is not
 * held up: the page waits in UPLOADED and the stuck-page check queues it later.
 * Workers wait for Redis instead, as BullMQ requires.
 */
export function createRedisConnection(url: string, { forWorker }: { forWorker: boolean }): Redis {
  return forWorker
    ? new Redis(url, { maxRetriesPerRequest: null })
    : new Redis(url, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
}

/**
 * Returns an error listener that warns at most once a minute. ioredis keeps
 * reconnecting while Redis is down and reports every failed attempt.
 * Without a listener, those errors are printed as unhandled.
 */
export function redisErrorWarner(logger: Pick<Logger, 'warn'>, message: string): (error: Error) => void {
  let lastWarning = 0;
  return (error) => {
    if (Date.now() - lastWarning < 60_000) return;
    lastWarning = Date.now();
    // A refused connection arrives as an AggregateError with an empty message.
    const reason = error.message || (error as NodeJS.ErrnoException).code || error.name;
    logger.warn(`${message}: ${reason}`);
  };
}

export class RedisUnavailableError extends Error {
  constructor() {
    super('Redis is not connected');
    this.name = 'RedisUnavailableError';
  }
}

export class BullMqPageQueue implements PageQueue {
  private readonly detection: Queue<PageJob>;
  private readonly explanation: Queue<PageJob>;

  constructor(private readonly connection: Redis) {
    this.detection = new Queue<PageJob>(DETECTION_QUEUE, { connection });
    this.explanation = new Queue<PageJob>(EXPLANATION_QUEUE, { connection });
    // The connection's own error listener already warns. Without a listener
    // here, BullMQ prints every reconnect failure as a stack trace.
    for (const queue of [this.detection, this.explanation]) queue.on('error', () => undefined);
  }

  /** Resolves once Redis is connected and the queues are set up. */
  async waitUntilReady(): Promise<void> {
    await Promise.all([this.detection.waitUntilReady(), this.explanation.waitUntilReady()]);
  }

  async enqueueDetection(pageId: string): Promise<void> {
    this.assertConnected();
    await this.detection.add('detect', { pageId }, { ...PAGE_JOB_OPTIONS, jobId: `detect-${pageId}` });
  }

  async enqueueExplanation(pageId: string): Promise<void> {
    this.assertConnected();
    await this.explanation.add('explain', { pageId }, { ...PAGE_JOB_OPTIONS, jobId: `explain-${pageId}` });
  }

  /**
   * BullMQ waits for Redis before running a command, which would hold an
   * upload until Redis comes back. Failing here instead keeps uploads fast.
   */
  private assertConnected(): void {
    if (this.connection.status !== 'ready') throw new RedisUnavailableError();
  }

  async close(): Promise<void> {
    await Promise.all([this.detection.close(), this.explanation.close()]);
  }
}

/** Runs the stuck-page check every 5 minutes. Safe to call on every worker start. */
export async function scheduleStuckPageCheck(maintenance: Queue): Promise<void> {
  await maintenance.upsertJobScheduler(STUCK_PAGE_CHECK, { every: STUCK_PAGE_CHECK_EVERY_MS }, { name: STUCK_PAGE_CHECK });
}
