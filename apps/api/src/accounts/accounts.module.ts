import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LogMailer, MAILER, SmtpMailer } from './mailer.js';
import { SessionGuard } from './session.guard.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionGuard,
    {
      provide: MAILER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => (config.smtpUrl ? new SmtpMailer(config.smtpUrl, config.mailFrom) : new LogMailer()),
    },
  ],
  exports: [AuthService, SessionGuard],
})
export class AccountsModule {}
