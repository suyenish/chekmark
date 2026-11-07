import { z } from 'zod';

// Environment values are always text, and an empty value means "not set".
const text = <T extends z.ZodType>(schema: T) => z.preprocess((value) => (value === '' ? undefined : value), schema);
const positive = (fallback: number) => text(z.coerce.number().positive().default(fallback));
const wholeNumber = (fallback: number, max = Number.MAX_SAFE_INTEGER) =>
  text(z.coerce.number().int().positive().max(max).default(fallback));

const envSchema = z.object({
  NODE_ENV: text(z.enum(['development', 'test', 'production']).default('development')),
  PORT: wholeNumber(3000, 65_535),
  DATABASE_URL: text(z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgresql:// address')),
  AI_MODEL: text(z.string().default('claude-haiku-5-5')),
  AI_INPUT_COST_PER_MTOK: positive(0.1),
  AI_OUTPUT_COST_PER_MTOK: positive(0.5),
  AI_MONTHLY_BUDGET_USD: positive(20),
  DAILY_PAGE_LIMIT: wholeNumber(5),
});

export type AppConfig = ReturnType<typeof toConfig>;

/** Nest injection token for the validated settings. */
export const APP_CONFIG = Symbol('APP_CONFIG');

/** Validates settings once at start-up, so a bad value stops the app with a clear message. */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid settings:\n${problems.join('\n')}`);
  }
  return toConfig(result.data);
}

function toConfig(env: z.infer<typeof envSchema>) {
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    aiModel: env.AI_MODEL,
    aiInputCostPerMtok: env.AI_INPUT_COST_PER_MTOK,
    aiOutputCostPerMtok: env.AI_OUTPUT_COST_PER_MTOK,
    aiMonthlyBudgetUsd: env.AI_MONTHLY_BUDGET_USD,
    dailyPageLimit: env.DAILY_PAGE_LIMIT,
  };
}
