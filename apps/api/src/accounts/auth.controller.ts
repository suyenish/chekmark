import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AccountService } from './account.service.js';
import { AuthService, SESSION_LIFETIME_MS, type SignedInUser } from './auth.service.js';
import { CurrentUser, readCookie, SESSION_COOKIE, SessionGuard } from './session.guard.js';

const requestLinkBody = z.object({ email: z.string().trim().toLowerCase().pipe(z.email()) });
const verifyBody = z.object({ token: z.string().min(1) });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException(z.prettifyError(result.error));
  return result.data;
}

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly accounts: AccountService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private cookieOptions(): CookieOptions {
    return { httpOnly: true, sameSite: 'lax', secure: this.config.nodeEnv === 'production', path: '/' };
  }

  @Post('auth/request-link')
  @HttpCode(202)
  async requestLink(@Body() body: unknown): Promise<void> {
    await this.auth.requestLink(parse(requestLinkBody, body).email);
  }

  @Post('auth/verify')
  @HttpCode(200)
  async verify(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<SignedInUser> {
    const { user, sessionId } = await this.auth.verify(parse(verifyBody, body).token);
    res.cookie(SESSION_COOKIE, sessionId, { ...this.cookieOptions(), maxAge: SESSION_LIFETIME_MS });
    return user;
  }

  @Post('auth/logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const sessionId = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (sessionId) await this.auth.logout(sessionId);
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentUser() user: SignedInUser): SignedInUser {
    return user;
  }

  /** Deletes the account with all its books, pages, photos and word bank, and signs out. */
  @Delete('account')
  @UseGuards(SessionGuard)
  @HttpCode(204)
  async deleteAccount(@CurrentUser() user: SignedInUser, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.accounts.deleteAccount(user.id);
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }
}
