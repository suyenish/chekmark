import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AiUsage } from './ai-client.js';

/** Saves every AI call with its cost. The monthly budget is the sum of these rows. */
@Injectable()
export class AiCallLogger {
  private readonly logger = new Logger(AiCallLogger.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Cost in US dollars, from the per-million-token prices in the settings. */
  cost(inputTokens: number, outputTokens: number): number {
    return (inputTokens * this.config.aiInputCostPerMtok + outputTokens * this.config.aiOutputCostPerMtok) / 1_000_000;
  }

  async log(usage: AiUsage): Promise<void> {
    const cost = this.cost(usage.inputTokens, usage.outputTokens);
    this.logger.log(
      `${usage.purpose} ${usage.model}: ${usage.inputTokens} in / ${usage.outputTokens} out, $${cost.toFixed(6)}, ${usage.durationMs} ms`,
    );
    try {
      await this.prisma.aiCall.create({
        data: {
          userId: usage.userId ?? null,
          pageId: usage.pageId ?? null,
          purpose: usage.purpose,
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cost,
          durationMs: usage.durationMs,
        },
      });
    } catch (error) {
      // The user or page may have been deleted during the call. The spend still happened.
      this.logger.error(`Could not save the AI call (cost $${cost.toFixed(6)}): ${String(error)}`);
    }
  }
}
