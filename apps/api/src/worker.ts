import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';

/** The worker process: the same code as the API, started without HTTP. Runs queued jobs. */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks(); // finish the current job on Ctrl+C or a container stop
}

void bootstrap();
