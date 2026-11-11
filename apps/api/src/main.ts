import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { APP_CONFIG, type AppConfig } from './config/config.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.disable('x-powered-by'); // no need to tell visitors which framework this is
  // On a deploy or restart the platform sends SIGTERM: finish open requests and close connections first.
  app.enableShutdownHooks();
  await app.listen(app.get<AppConfig>(APP_CONFIG).port);
}
await bootstrap();
