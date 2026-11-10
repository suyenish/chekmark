import { createHash } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../jobs/queues.js';

/** At most this many links to one address in one window. */
export const LINKS_PER_ADDRESS = 5;
export const ADDRESS_WINDOW_SECONDS = 15 * 60;
/** At most this many links from the whole app in an hour: protects the email quota and reputation. */
export const LINKS_PER_HOUR = 300;

/**
 * Stops the sign-in form being used to flood an inbox. Every request counts,
 * allowed address or not, so the limit says nothing about who has an account.
 * If Redis cannot count, the link is still sent: a missed count costs less
 * than locking everyone out.
 */
@Injectable()
export class SignInLimiter {
  private readonly logger = new Logger(SignInLimiter.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async count(email: string, now: Date): Promise<void> {
    // The address is hashed, so Redis holds no email addresses.
    const addressKey = `signin:address:${createHash('sha256').update(email).digest('hex')}`;
    const hourKey = `signin:all:${now.toISOString().slice(0, 13)}`;
    let forAddress: number;
    let forEveryone: number;
    try {
      const results = await this.redis
        .multi()
        .incr(addressKey)
        .expire(addressKey, ADDRESS_WINDOW_SECONDS, 'NX') // the window starts at the first request
        .incr(hourKey)
        .expire(hourKey, 2 * 60 * 60)
        .exec();
      forAddress = Number(results?.[0]?.[1]);
      forEveryone = Number(results?.[2]?.[1]);
    } catch (error) {
      this.logger.warn(`Could not count sign-in links, sending anyway: ${String(error)}`);
      return;
    }
    if (forAddress > LINKS_PER_ADDRESS) {
      throw new HttpException('Too many sign-in links were requested for this address. Use the latest one, or try again in 15 minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (forEveryone > LINKS_PER_HOUR) {
      this.logger.error(`More than ${LINKS_PER_HOUR} sign-in links were requested this hour; refusing more until the next hour.`);
      throw new HttpException('Sign-in is busy right now. Please try again in a little while.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
