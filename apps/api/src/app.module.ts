import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SameOriginGuard } from './accounts/same-origin.guard.js';
import { AccountsModule } from './accounts/accounts.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConfigModule } from './config/config.module.js';
import { DemoModule } from './demo/demo.module.js';
import { HealthModule } from './health/health.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { LibraryModule } from './library/library.module.js';
import { MarksModule } from './marks/marks.module.js';
import { ReviewModule } from './review/review.module.js';
import { WordbankModule } from './wordbank/wordbank.module.js';
import { PhotosModule } from './photos/photos.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [ConfigModule, PrismaModule, PhotosModule, JobsModule, AccountsModule, LibraryModule, MarksModule, WordbankModule, ReviewModule, DemoModule, HealthModule],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: SameOriginGuard }],
})
export class AppModule {}
