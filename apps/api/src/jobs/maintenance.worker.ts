import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { createRedisConnection, MAINTENANCE_QUEUE, PAGE_QUEUE, type PageQueue, redisErrorWarner, scheduleStuckPageCheck, STUCK_PAGE_CHECK } from './queues.js';
import { requeueStuckPages } from './stuck-pages.js';

/** Runs in the worker process: schedules and runs the stuck-page check. */
@Injectable()
export class MaintenanceWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MaintenanceWorker.name);
  private connection?: Redis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    @Inject(PAGE_QUEUE) private readonly pageQueue: PageQueue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.connection = createRedisConnection(this.config.redisUrl, { forWorker: true });
    const warn = redisErrorWarner(this.logger, 'Redis is not reachable, jobs wait until it returns');
    this.connection.on('error', warn);
    this.queue = new Queue(MAINTENANCE_QUEUE, { connection: this.connection });
    this.queue.on('error', warn);
    await scheduleStuckPageCheck(this.queue);
    this.worker = new Worker(
      MAINTENANCE_QUEUE,
      async (job) => {
        if (job.name !== STUCK_PAGE_CHECK) return;
        const count = await requeueStuckPages(this.prisma, this.pageQueue, new Date());
        if (count > 0) this.logger.log(`Re-queued ${count} stuck page(s)`);
      },
      { connection: this.connection },
    );
    this.worker.on('error', warn);
    this.worker.on('failed', (job, error) => this.logger.error(`${job?.name} failed: ${error.message}`));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }
}
