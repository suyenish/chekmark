import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { createRedisConnection, DETECTION_QUEUE, type PageJob, redisErrorWarner } from '../jobs/queues.js';
import { DetectionProcessor } from './detection.processor.js';

/** Runs in the worker process: takes detection jobs off the queue. */
@Injectable()
export class DetectionWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DetectionWorker.name);
  private connection?: Redis;
  private worker?: Worker<PageJob>;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly processor: DetectionProcessor,
  ) {}

  onApplicationBootstrap(): void {
    this.connection = createRedisConnection(this.config.redisUrl, { forWorker: true });
    const warn = redisErrorWarner(this.logger, 'Redis is not reachable, detection waits until it returns');
    this.connection.on('error', warn);
    // Two pages at a time: enough for a few users, and gentle on the AI rate limit.
    this.worker = new Worker<PageJob>(DETECTION_QUEUE, (job) => this.processor.process(job), { connection: this.connection, concurrency: 2 });
    this.worker.on('error', warn);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    this.connection?.disconnect();
  }
}
