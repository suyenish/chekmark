import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MAILER, type Mailer } from './mailer.js';
import { SignInLimiter } from './sign-in-limiter.js';

export const LINK_LIFETIME_MS = 15 * 60 * 1000;
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export interface SignedInUser {
  id: string;
  email: string;
  /** Only on temporary demo accounts. */
  demo?: true;
}

/** Only hashes reach the database, so a leaked table cannot be used to sign in. */
export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');
export const newSecret = () => randomBytes(32).toString('base64url');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly limiter: SignInLimiter,
  ) {}

  /** With SIGN_UP=open anyone may sign in; otherwise only the addresses in ALLOWED_EMAILS. */
  private mayHaveLink(email: string): boolean {
    return this.config.signUp === 'open' || this.config.allowedEmails.includes(email);
  }

  /**
   * Sends a one-time link if the address may sign in. The outcome is for the
   * server only: the public answer is the same either way, so nobody can find
   * out who has an account (see AuthController for the development exception).
   */
  async requestLink(email: string): Promise<{ link: string } | { notAllowed: true }> {
    const createdAt = new Date();
    await this.limiter.count(email, createdAt);
    if (!this.mayHaveLink(email)) return { notAllowed: true };
    const token = newSecret();
    await this.prisma.loginToken.create({
      data: { email, tokenHash: hashSecret(token), createdAt, expiresAt: new Date(createdAt.getTime() + LINK_LIFETIME_MS) },
    });
    const link = `${this.config.appUrl}/sign-in?token=${encodeURIComponent(token)}`;
    try {
      await this.mailer.sendSignInLink(email, link);
    } catch (error) {
      // The details stay in the log. The reader is told plainly, so they do not wait for an email that is not coming.
      this.logger.error(`Could not send a sign-in email: ${String(error)}`);
      throw new ServiceUnavailableException('We could not send the sign-in email right now. Please try again in a few minutes.');
    }
    return { link };
  }

  /** Uses up the token and starts a session. Returns the session ID for the cookie. */
  async verify(token: string): Promise<{ user: SignedInUser; sessionId: string }> {
    const now = new Date();
    // One conditional update, so two simultaneous requests cannot both use the same token.
    const [used] = await this.prisma.loginToken.updateManyAndReturn({
      where: { tokenHash: hashSecret(token), usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (!used) throw new UnauthorizedException('This sign-in link is invalid, used or expired. Ask for a new one.');

    const sessionId = newSecret();
    const user = await this.prisma.$transaction(async (tx) => {
      const found = await tx.user.upsert({ where: { email: used.email }, create: { email: used.email }, update: {} });
      await tx.session.create({
        data: { userId: found.id, tokenHash: hashSecret(sessionId), expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS) },
      });
      return found;
    });
    return { user: { id: user.id, email: user.email }, sessionId };
  }

  async findSessionUser(sessionId: string): Promise<SignedInUser | null> {
    const session = await this.prisma.session.findFirst({
      where: { tokenHash: hashSecret(sessionId), expiresAt: { gt: new Date() } },
      include: { user: true },
    });
    if (!session) return null;
    const { id, email, demoExpiresAt } = session.user;
    return { id, email, ...(demoExpiresAt ? { demo: true as const } : {}) };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenHash: hashSecret(sessionId) } });
  }
}
