import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from './config.js';

/** Validates the environment once and shares the settings with every module. */
@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig(process.env) }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
