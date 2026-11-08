import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { MaintenanceWorker } from './jobs/maintenance.worker.js';
import { PrismaModule } from './prisma/prisma.module.js';

/** Everything the worker process runs. It has no HTTP routes. Later tasks add detection and explanation workers. */
@Module({
  imports: [ConfigModule, PrismaModule, JobsModule],
  providers: [MaintenanceWorker],
})
export class WorkerModule {}
