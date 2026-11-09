import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { REDIS } from '../jobs/queues.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Status = 'up' | 'down';

const CHECK_TIMEOUT_MS = 1500;

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))]);
}

/**
 * For the hosting platform and for people: is the API able to reach its
 * database and queue? 200 when both are up, 503 otherwise. No sign-in, and
 * nothing private in the answer.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const [postgres, redis] = await Promise.all([this.postgres(), this.redisStatus()]);
    const ok = postgres === 'up' && redis === 'up';
    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? 'ok' : 'degraded', postgres, redis };
  }

  private async postgres(): Promise<Status> {
    try {
      await within(this.prisma.$queryRaw`SELECT 1`, CHECK_TIMEOUT_MS);
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async redisStatus(): Promise<Status> {
    // The API's connection refuses commands at once while it is not connected.
    if (this.redis.status !== 'ready') return 'down';
    try {
      return (await within(this.redis.ping(), CHECK_TIMEOUT_MS)) === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }
}
