import { Global, Inject, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { BullMqPageQueue, createRedisConnection, PAGE_QUEUE, redisErrorWarner } from './queues.js';

const REDIS = Symbol('REDIS');

/** Gives every module the PageQueue. The connection fails fast when Redis is down. */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const redis = createRedisConnection(config.redisUrl, { forWorker: false });
        redis.on('error', redisErrorWarner(new Logger('Redis'), 'Redis is not reachable, new pages will wait in UPLOADED'));
        return redis;
      },
    },
    { provide: PAGE_QUEUE, inject: [REDIS], useFactory: (redis: Redis) => new BullMqPageQueue(redis) },
  ],
  exports: [PAGE_QUEUE],
})
export class JobsModule implements OnModuleDestroy {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PAGE_QUEUE) private readonly queue: BullMqPageQueue,
  ) {}

  async onModuleDestroy(): Promise<void> {
    // A test may replace the queue with a fake that has no close().
    if (this.queue instanceof BullMqPageQueue) await this.queue.close().catch(() => undefined);
    this.redis.disconnect();
  }
}
