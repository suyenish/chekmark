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
      signUp: 'allowlist',
      demo: false,
      appUrl: 'http://localhost:5173',
      smtpUrl: null,
      resendApiKey: null,
      mailFrom: 'Chekmark <no-reply@localhost>',
      s3Endpoint: null,
      s3Region: 'us-east-1',
      s3Bucket: 'chekmark-photos',
      s3AccessKeyId: null,
      s3SecretAccessKey: null,
      redisUrl: 'redis://localhost:6379',
      ownerEmail: null,
      anthropicApiKey: null,
      aiProvider: 'anthropic',
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
    expect(() => loadConfig({ DATABASE_URL, NODE_ENV: 'production', ALLOWED_EMAILS: 'me@example.com' })).toThrow(/SMTP_URL or RESEND_API_KEY/);
    expect(loadConfig({ DATABASE_URL, NODE_ENV: 'production', ALLOWED_EMAILS: 'me@example.com', SMTP_URL: 'smtps://u:p@smtp.example:465', ANTHROPIC_API_KEY: 'k', AI_MODEL: 'm' }).smtpUrl).toBe(
      'smtps://u:p@smtp.example:465',
    );
  });

  it('requires AI_MODEL in production, so the model always matches the price settings', () => {
    const production = { DATABASE_URL, NODE_ENV: 'production', ALLOWED_EMAILS: 'me@example.com', RESEND_API_KEY: 're_x', ANTHROPIC_API_KEY: 'k' };
    expect(() => loadConfig(production)).toThrow(/AI_MODEL/);
    expect(loadConfig({ ...production, AI_MODEL: 'claude-haiku-5-5' }).aiModel).toBe('claude-haiku-5-5');
  });

  it('accepts RESEND_API_KEY instead of SMTP_URL in production, for hosts that block SMTP', () => {
    const config = loadConfig({ DATABASE_URL, NODE_ENV: 'production', ALLOWED_EMAILS: 'me@example.com', RESEND_API_KEY: 're_x', ANTHROPIC_API_KEY: 'k', AI_MODEL: 'm' });
    expect(config.resendApiKey).toBe('re_x');
    expect(config.smtpUrl).toBeNull();
  });

  it('reads the photo storage settings', () => {
    const config = loadConfig({
      DATABASE_URL,
      S3_ENDPOINT: 'http://localhost:8333',
      S3_REGION: 'ap-northeast-2',
      S3_BUCKET: 'my-photos',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
    });
    expect(config).toMatchObject({
      s3Endpoint: 'http://localhost:8333',
      s3Region: 'ap-northeast-2',
      s3Bucket: 'my-photos',
      s3AccessKeyId: 'key',
      s3SecretAccessKey: 'secret',
    });
  });

  it('rejects an S3_ENDPOINT that is not a web address', () => {
    expect(() => loadConfig({ DATABASE_URL, S3_ENDPOINT: 'localhost:8333' })).toThrow(/S3_ENDPOINT/);
  });

  it('needs both S3 keys or neither', () => {
    expect(() => loadConfig({ DATABASE_URL, S3_ACCESS_KEY_ID: 'key' })).toThrow(/S3_SECRET_ACCESS_KEY/);
    expect(() => loadConfig({ DATABASE_URL, S3_SECRET_ACCESS_KEY: 'secret' })).toThrow(/S3_ACCESS_KEY_ID/);
  });

  it('reads REDIS_URL and rejects one that is not a redis:// address', () => {
    expect(loadConfig({ DATABASE_URL, REDIS_URL: 'rediss://cache.example:6380' }).redisUrl).toBe('rediss://cache.example:6380');
    expect(() => loadConfig({ DATABASE_URL, REDIS_URL: 'http://localhost:6379' })).toThrow(/REDIS_URL/);
  });

  it('reads OWNER_EMAIL in lower case and rejects one that is not an email', () => {
    expect(loadConfig({ DATABASE_URL, OWNER_EMAIL: 'Me@Example.com' }).ownerEmail).toBe('me@example.com');
    expect(() => loadConfig({ DATABASE_URL, OWNER_EMAIL: 'me' })).toThrow(/OWNER_EMAIL/);
  });

  it('requires ANTHROPIC_API_KEY in production, because the worker cannot read pages without it', () => {
    const production = { DATABASE_URL, NODE_ENV: 'production', ALLOWED_EMAILS: 'me@example.com', SMTP_URL: 'smtps://u:p@smtp.example:465', AI_MODEL: 'm' };
    expect(() => loadConfig(production)).toThrow(/ANTHROPIC_API_KEY/);
    expect(loadConfig({ ...production, ANTHROPIC_API_KEY: 'k' }).anthropicApiKey).toBe('k');
  });

  it('reads AI_PROVIDER and refuses the fake AI in production', () => {
    expect(loadConfig({ DATABASE_URL, AI_PROVIDER: 'fake' }).aiProvider).toBe('fake');
    expect(() => loadConfig({ DATABASE_URL, AI_PROVIDER: 'openai' })).toThrow(/AI_PROVIDER/);
    const production = { DATABASE_URL, NODE_ENV: 'production', ALLOWED_EMAILS: 'me@example.com', SMTP_URL: 'smtps://u:p@smtp.example:465', ANTHROPIC_API_KEY: 'k' };
    expect(() => loadConfig({ ...production, AI_PROVIDER: 'fake' })).toThrow(/AI_PROVIDER/);
  });

  it('reads SIGN_UP, and in production refuses an allowlist with nobody on it', () => {
    expect(loadConfig({ DATABASE_URL, SIGN_UP: 'open' }).signUp).toBe('open');
    expect(() => loadConfig({ DATABASE_URL, SIGN_UP: 'everyone' })).toThrow(/SIGN_UP/);
    const production = { DATABASE_URL, NODE_ENV: 'production', SMTP_URL: 'smtps://u:p@smtp.example:465', ANTHROPIC_API_KEY: 'k', AI_MODEL: 'm' };
    expect(() => loadConfig(production)).toThrow(/ALLOWED_EMAILS/);
    expect(loadConfig({ ...production, SIGN_UP: 'open' }).signUp).toBe('open');
  });
});
