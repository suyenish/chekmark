import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { APP_CONFIG, type AppConfig } from './config/config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // On a deploy or restart the platform sends SIGTERM: finish open requests and close connections first.
  app.enableShutdownHooks();
  await app.listen(app.get<AppConfig>(APP_CONFIG).port);
}
await bootstrap();
