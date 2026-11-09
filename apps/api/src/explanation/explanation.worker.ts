import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { createRedisConnection, EXPLANATION_QUEUE, type PageJob, redisErrorWarner } from '../jobs/queues.js';
import { ExplanationProcessor } from './explanation.processor.js';

/** Runs in the worker process: takes explanation jobs off the queue. */
@Injectable()
export class ExplanationWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ExplanationWorker.name);
  private connection?: Redis;
  private worker?: Worker<PageJob>;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly processor: ExplanationProcessor,
  ) {}

  onApplicationBootstrap(): void {
    this.connection = createRedisConnection(this.config.redisUrl, { forWorker: true });
    const warn = redisErrorWarner(this.logger, 'Redis is not reachable, explanations wait until it returns');
    this.connection.on('error', warn);
    // Two pages at a time: enough for a few users, and gentle on the AI rate limit.
    this.worker = new Worker<PageJob>(EXPLANATION_QUEUE, (job) => this.processor.process(job), { connection: this.connection, concurrency: 2 });
    this.worker.on('error', warn);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    this.connection?.disconnect();
  }
}
