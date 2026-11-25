import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AccountService } from './account.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LogMailer, MAILER, ResendMailer, SmtpMailer, type Mailer } from './mailer.js';
import { SessionGuard } from './session.guard.js';
import { SignInLimiter } from './sign-in-limiter.js';
import { UsageService } from './usage.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SignInLimiter,
    AccountService,
    SessionGuard,
    UsageService,
    {
      provide: MAILER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Mailer => {
        if (config.resendApiKey) return new ResendMailer(config.resendApiKey, config.mailFrom);
        if (config.smtpUrl) return new SmtpMailer(config.smtpUrl, config.mailFrom);
        return new LogMailer();
      },
    },
  ],
  exports: [AuthService, AccountService, SessionGuard, UsageService, MAILER],
})
export class AccountsModule {}
