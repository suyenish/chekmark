import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { REDIS } from '../jobs/queues.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MAILER, type Mailer } from './mailer.js';

/** The user has used today's pages. `resetAt` is the next UTC midnight. */
export class DailyLimitReachedError extends Error {
  constructor(
    readonly limit: number,
    readonly resetAt: Date,
  ) {
    super(`Daily limit of ${limit} pages reached`);
    this.name = 'DailyLimitReachedError';
  }
}

const USAGE_TTL_SECONDS = 48 * 60 * 60;
const ALERT_TTL_SECONDS = 40 * 24 * 60 * 60;

const utcDay = (now: Date) => now.toISOString().slice(0, 10);
const utcMonth = (now: Date) => now.toISOString().slice(0, 7);
const usageKey = (userId: string, now: Date) => `usage:${userId}:${utcDay(now)}`;

/** Pages per user per UTC day (counted in Redis) and AI spending per UTC month (summed from ai_calls). */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  /**
   * Counts one page for the user's day, or throws DailyLimitReachedError.
   * If Redis is down the page is allowed: a missed count costs less than
   * refusing every upload.
   */
  async reserve(userId: string, now: Date): Promise<void> {
    const key = usageKey(userId, now);
    let count: number;
    try {
      const results = await this.redis.multi().incr(key).expire(key, USAGE_TTL_SECONDS).exec();
      count = Number(results?.[0]?.[1]);
    } catch (error) {
      this.logger.warn(`Could not count usage for user ${userId}, allowing the page: ${String(error)}`);
      return;
    }
    if (count > this.config.dailyPageLimit) {
      await this.redis.decr(key).catch(() => undefined); // a refused page is not counted
      const resetAt = new Date(now);
      resetAt.setUTCHours(24, 0, 0, 0);
      throw new DailyLimitReachedError(this.config.dailyPageLimit, resetAt);
    }
  }

  /** Gives back a page counted on `now`'s day, such as an unusable photo. Never goes below zero. */
  async release(userId: string, now: Date): Promise<void> {
    const key = usageKey(userId, now);
    try {
      const count = await this.redis.decr(key);
      if (count < 0) await this.redis.set(key, 0, 'KEEPTTL');
    } catch (error) {
      this.logger.warn(`Could not give back usage for user ${userId}: ${String(error)}`);
    }
  }

  /** Pages counted for the user on `now`'s UTC day. */
  async used(userId: string, now: Date): Promise<number> {
    return Math.max(0, Number((await this.redis.get(usageKey(userId, now))) ?? 0));
  }

  /** True when AI spending in `now`'s UTC month has reached AI_MONTHLY_BUDGET_USD. */
  async isBudgetReached(now: Date): Promise<boolean> {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const { _sum } = await this.prisma.aiCall.aggregate({
      _sum: { cost: true },
      where: { createdAt: { gte: monthStart, lt: nextMonthStart } },
    });
    return Number(_sum.cost ?? 0) >= this.config.aiMonthlyBudgetUsd;
  }

  /** Emails the owner the first time the budget is reached in `now`'s UTC month. */
  async alertBudgetReached(now: Date): Promise<void> {
    const month = utcMonth(now);
    const message = `AI spending for ${month} has reached the monthly budget of $${this.config.aiMonthlyBudgetUsd}. New pages are paused until next month or until AI_MONTHLY_BUDGET_USD is raised. Review and the word bank keep working.`;
    let first: boolean;
    try {
      first = (await this.redis.set(`budget-alert:${month}`, '1', 'EX', ALERT_TTL_SECONDS, 'NX')) === 'OK';
    } catch (error) {
      // Without Redis we cannot tell whether the owner was already told; log rather than send on every upload.
      this.logger.error(`${message} (Could not check whether the owner was alerted: ${String(error)})`);
      return;
    }
    if (!first) return;
    if (!this.config.ownerEmail) {
      this.logger.error(`${message} Set OWNER_EMAIL to get this by email.`);
      return;
    }
    await this.mailer.sendAlert(this.config.ownerEmail, 'Monthly AI budget reached', message).catch((error: unknown) => {
      this.logger.error(`${message} (The alert email failed: ${String(error)})`);
    });
  }
}
