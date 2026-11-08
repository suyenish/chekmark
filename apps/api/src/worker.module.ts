import { Module } from '@nestjs/common';
import { AccountsModule } from './accounts/accounts.module.js';
import { AiModule } from './ai/ai.module.js';
import { ConfigModule } from './config/config.module.js';
import { DetectionProcessor } from './detection/detection.processor.js';
import { DetectionWorker } from './detection/detection.worker.js';
import { JobsModule } from './jobs/jobs.module.js';
import { MaintenanceWorker } from './jobs/maintenance.worker.js';
import { PhotosModule } from './photos/photos.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

/** Everything the worker process runs. It has no HTTP routes. Task 9 adds the explanation worker. */
@Module({
  imports: [ConfigModule, PrismaModule, JobsModule, PhotosModule, AccountsModule, AiModule],
  providers: [MaintenanceWorker, DetectionProcessor, DetectionWorker],
})
export class WorkerModule {}
