import { LogMailer, ResendMailer, signInEmail, SmtpMailer } from './mailer.js';

describe('LogMailer', () => {
  it('keeps alerts apart from sign-in links', async () => {
    const mailer = new LogMailer();
    await mailer.sendAlert('owner@example.com', 'Budget reached', 'New pages are paused.');
    expect(mailer.alerts).toEqual([{ to: 'owner@example.com', subject: 'Budget reached', text: 'New pages are paused.' }]);
    expect(mailer.sent).toEqual([]);
  });
});

describe('signInEmail', () => {
  const url = 'https://chekmark.example/sign-in?token=abc_DEF-123&x=1';

  it('puts the link in the plain text and in the HTML button', () => {
    const email = signInEmail(url);
    expect(email.subject).toBe('Your Chekmark sign-in link');
    expect(email.text).toContain(url);
    expect(email.text).toMatch(/15 minutes/);
    // In HTML the & of the address must be written as &amp; or some mail apps break the link.
    expect(email.html).toContain('href="https://chekmark.example/sign-in?token=abc_DEF-123&amp;x=1"');
    expect(email.html).toMatch(/Sign in to Chekmark/);
    expect(email.html).toMatch(/15 minutes/);
  });

  it('tells someone who did not ask that they can ignore it', () => {
    const email = signInEmail(url);
    expect(email.text).toMatch(/ignore this email/i);
    expect(email.html).toMatch(/ignore this email/i);
  });
});

describe('SmtpMailer', () => {
  it('reports an unreachable email server without throwing, so the app still starts', async () => {
    const mailer = new SmtpMailer('smtp://127.0.0.1:1', 'Chekmark <no-reply@example.com>');
    await expect(mailer.checkConnection()).resolves.toBe(false);
  });
});

describe('ResendMailer', () => {
  const okFetch = () => vi.fn(async (_url: string, _init: RequestInit) => new Response('{"id":"1"}', { status: 200 }));

  it('sends the sign-in email over HTTPS to the Resend API', async () => {
    const fetchFn = okFetch();
    const mailer = new ResendMailer('re_test', 'Chekmark <onboarding@resend.dev>', fetchFn);
    await mailer.sendSignInLink('me@example.com', 'https://chekmark.example/sign-in?token=t');

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ from: 'Chekmark <onboarding@resend.dev>', to: ['me@example.com'], subject: 'Your Chekmark sign-in link' });
    expect(body.text).toContain('https://chekmark.example/sign-in?token=t');
    expect(body.html).toContain('Sign in to Chekmark');
  });

  it('sends alerts as plain text', async () => {
    const fetchFn = okFetch();
    await new ResendMailer('re_test', 'Chekmark <a@b.c>', fetchFn).sendAlert('owner@example.com', 'Budget reached', 'Paused.');
    const body = JSON.parse(fetchFn.mock.calls[0]![1].body as string);
    expect(body).toEqual({ from: 'Chekmark <a@b.c>', to: ['owner@example.com'], subject: 'Chekmark: Budget reached', text: 'Paused.' });
  });

  it('throws when Resend refuses the email, so the caller sees the failure', async () => {
    const fetchFn = vi.fn(async () => new Response('{"message":"invalid key"}', { status: 401 }));
    await expect(new ResendMailer('re_bad', 'x <a@b.c>', fetchFn).sendSignInLink('me@example.com', 'https://x')).rejects.toThrow(/401/);
  });
});
