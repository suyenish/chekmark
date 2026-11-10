import { LogMailer, signInEmail, SmtpMailer } from './mailer.js';

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
