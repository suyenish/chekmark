import Anthropic from '@anthropic-ai/sdk';
import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AI_CLIENT } from './ai-client.js';
import { AiCallLogger } from './ai-call-logger.js';
import { ClaudeAiClient } from './claude-ai-client.js';
import { DemoAiClient } from './demo-ai-client.js';

/** The Claude client, with every call logged. Used by the worker. */
@Module({
  providers: [
    AiCallLogger,
    {
      provide: AI_CLIENT,
      inject: [APP_CONFIG, AiCallLogger],
      useFactory: (config: AppConfig, logger: AiCallLogger) =>
        config.aiProvider === 'fake'
          ? new DemoAiClient({ nodeEnv: config.nodeEnv, onUsage: (usage) => logger.log(usage) })
          : // Without a key (development only) calls fail with an authentication error and the page shows FAILED.
            new ClaudeAiClient(new Anthropic({ apiKey: config.anthropicApiKey ?? 'missing' }), config.aiModel, (usage) => logger.log(usage)),
    },
  ],
  exports: [AI_CLIENT, AiCallLogger],
})
export class AiModule {}
