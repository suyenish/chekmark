import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { AccountService } from '../accounts/account.service.js';
import { deleteExpiredSignIns } from '../accounts/sign-in-cleanup.js';
import { UsageService } from '../accounts/usage.service.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { deleteExpiredDemos } from '../demo/demo-cleanup.js';
import { PHOTO_STORE, type PhotoStore } from '../photos/photo-store.js';
import { deleteExpiredPhotos } from '../photos/photo-retention.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  createRedisConnection,
  EXPIRED_PHOTO_CHECK,
  MAINTENANCE_QUEUE,
  PAGE_QUEUE,
  type PageQueue,
  redisErrorWarner,
  scheduleExpiredPhotoCheck,
  scheduleStuckPageCheck,
  STUCK_PAGE_CHECK,
} from './queues.js';
import { requeueStuckPages } from './stuck-pages.js';

/** Runs in the worker process: schedules and runs the stuck-page check with demo clean-up (every 5 minutes) and photo retention (daily). */
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
    @Inject(PHOTO_STORE) private readonly photos: PhotoStore,
    private readonly usage: UsageService,
    private readonly accounts: AccountService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.connection = createRedisConnection(this.config.redisUrl, { forWorker: true });
    const warn = redisErrorWarner(this.logger, 'Redis is not reachable, jobs wait until it returns');
    this.connection.on('error', warn);
    this.queue = new Queue(MAINTENANCE_QUEUE, { connection: this.connection });
    this.queue.on('error', warn);
    await scheduleStuckPageCheck(this.queue);
    await scheduleExpiredPhotoCheck(this.queue);
    this.worker = new Worker(
      MAINTENANCE_QUEUE,
      async (job) => {
        if (job.name === STUCK_PAGE_CHECK) {
          const count = await requeueStuckPages(this.prisma, this.pageQueue, new Date(), this.usage);
          if (count > 0) this.logger.log(`Re-queued ${count} stuck page(s)`);
          const demos = await deleteExpiredDemos(this.prisma, this.accounts, new Date());
          if (demos > 0) this.logger.log(`Deleted ${demos} expired demo account(s)`);
        } else if (job.name === EXPIRED_PHOTO_CHECK) {
          const count = await deleteExpiredPhotos(this.prisma, this.photos, new Date());
          if (count > 0) this.logger.log(`Deleted ${count} photo(s) older than 30 days`);
          // The same daily run tidies sign-in data that can no longer be used.
          const removed = await deleteExpiredSignIns(this.prisma, new Date());
          if (removed.sessions + removed.links > 0) this.logger.log(`Removed ${removed.sessions} expired session(s) and ${removed.links} old sign-in link(s)`);
        }
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
