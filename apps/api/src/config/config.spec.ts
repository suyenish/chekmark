import { loadConfig } from './config.js';

const DATABASE_URL = 'postgresql://chekmark:chekmark@localhost:5432/chekmark';

describe('loadConfig', () => {
  it('uses the agreed defaults when only the database is set', () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({
      nodeEnv: 'development',
      port: 3000,
      databaseUrl: DATABASE_URL,
      aiModel: 'claude-haiku-5-5',
      aiInputCostPerMtok: 0.1,
      aiOutputCostPerMtok: 0.5,
      aiMonthlyBudgetUsd: 20,
      dailyPageLimit: 5,
    });
  });

  it('reads numbers from text, because environment values are always text', () => {
    const config = loadConfig({ DATABASE_URL, PORT: '8080', DAILY_PAGE_LIMIT: '7', AI_MONTHLY_BUDGET_USD: '12.5' });
    expect(config).toMatchObject({ port: 8080, dailyPageLimit: 7, aiMonthlyBudgetUsd: 12.5 });
  });

  it('names a missing database setting', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a database setting that is not a PostgreSQL address', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/DATABASE_URL/);
  });

  it.each([
    ['DAILY_PAGE_LIMIT', 'five'],
    ['DAILY_PAGE_LIMIT', '0'],
    ['DAILY_PAGE_LIMIT', '2.5'],
    ['AI_MONTHLY_BUDGET_USD', '-1'],
    ['PORT', '70000'],
  ])('rejects %s=%s', (name, value) => {
    expect(() => loadConfig({ DATABASE_URL, [name]: value })).toThrow(new RegExp(name));
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadConfig({ DATABASE_URL, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('treats an empty value as not set', () => {
    expect(loadConfig({ DATABASE_URL, AI_MODEL: '' }).aiModel).toBe('claude-haiku-5-5');
  });
});
