import { Controller, Get, Inject, NotFoundException, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { SignedInUser } from '../accounts/auth.service.js';
import { SESSION_COOKIE, sessionCookieOptions } from '../accounts/session.guard.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DEMO_LIFETIME_MS, DemoService } from './demo.service.js';

@Controller('demo')
export class DemoController {
  constructor(
    private readonly demos: DemoService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** So the sign-in screen knows whether to offer the demo. */
  @Get()
  status(): { enabled: boolean } {
    return { enabled: this.config.demo };
  }

  @Post()
  async start(@Res({ passthrough: true }) res: Response): Promise<SignedInUser> {
    if (!this.config.demo) throw new NotFoundException('The demo is switched off.');
    const { user, sessionId } = await this.demos.start();
    res.cookie(SESSION_COOKIE, sessionId, { ...sessionCookieOptions(this.config), maxAge: DEMO_LIFETIME_MS });
    return user;
  }
}
