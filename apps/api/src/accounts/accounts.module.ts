import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AccountService } from './account.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LogMailer, MAILER, SmtpMailer } from './mailer.js';
import { SessionGuard } from './session.guard.js';
import { UsageService } from './usage.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AccountService,
    SessionGuard,
    UsageService,
    {
      provide: MAILER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => (config.smtpUrl ? new SmtpMailer(config.smtpUrl, config.mailFrom) : new LogMailer()),
    },
  ],
  exports: [AuthService, SessionGuard, UsageService, MAILER],
})
export class AccountsModule {}
