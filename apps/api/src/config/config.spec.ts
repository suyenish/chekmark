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
      allowedEmails: [],
      appUrl: 'http://localhost:5173',
      smtpUrl: null,
      mailFrom: 'Chekmark <no-reply@localhost>',
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

  it('reads ALLOWED_EMAILS as a lower-case list, ignoring spaces and empty entries', () => {
    const config = loadConfig({ DATABASE_URL, ALLOWED_EMAILS: ' Me@Example.com, friend@example.com ,, ' });
    expect(config.allowedEmails).toEqual(['me@example.com', 'friend@example.com']);
  });

  it('rejects an address in ALLOWED_EMAILS that is not an email', () => {
    expect(() => loadConfig({ DATABASE_URL, ALLOWED_EMAILS: 'me@example.com,nobody' })).toThrow(/ALLOWED_EMAILS/);
  });

  it('drops a trailing slash from APP_URL, so links do not get a double slash', () => {
    expect(loadConfig({ DATABASE_URL, APP_URL: 'https://chekmark.example/' }).appUrl).toBe('https://chekmark.example');
  });

  it('requires SMTP_URL in production, because a sign-in link that is only logged reaches nobody', () => {
    expect(() => loadConfig({ DATABASE_URL, NODE_ENV: 'production' })).toThrow(/SMTP_URL/);
    expect(loadConfig({ DATABASE_URL, NODE_ENV: 'production', SMTP_URL: 'smtps://u:p@smtp.example:465' }).smtpUrl).toBe(
      'smtps://u:p@smtp.example:465',
    );
  });
});
