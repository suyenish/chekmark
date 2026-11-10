import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { SmtpMailer } from '../src/accounts/mailer.js';

/** Sends real email over SMTP to a throwaway mail server (Mailpit) and reads its inbox. */
describe('SmtpMailer against a real mail server', () => {
  let mailServer: StartedTestContainer;
  let mailer: SmtpMailer;
  let inbox: string;

  beforeAll(async () => {
    mailServer = await new GenericContainer('axllent/mailpit:v1.33.1')
      .withExposedPorts(1025, 8025)
      .withWaitStrategy(Wait.forHttp('/readyz', 8025))
      .start();
    inbox = `http://${mailServer.getHost()}:${mailServer.getMappedPort(8025)}/api/v1`;
    mailer = new SmtpMailer(`smtp://${mailServer.getHost()}:${mailServer.getMappedPort(1025)}`, 'Chekmark <no-reply@chekmark.example>');
  });

  afterAll(async () => {
    await mailServer?.stop();
  });

  it('connects', async () => {
    await expect(mailer.checkConnection()).resolves.toBe(true);
  });

  it('delivers the sign-in link as text and as an HTML button', async () => {
    const url = 'https://chekmark.example/sign-in?token=abc_DEF-123';
    await mailer.sendSignInLink('reader@example.com', url);

    const list = (await (await fetch(`${inbox}/messages`)).json()) as { messages: { ID: string; Subject: string; To: { Address: string }[]; From: { Address: string; Name: string } }[] };
    const message = list.messages.find((m) => m.Subject === 'Your Chekmark sign-in link')!;
    expect(message.To.map((to) => to.Address)).toEqual(['reader@example.com']);
    expect(message.From).toMatchObject({ Address: 'no-reply@chekmark.example', Name: 'Chekmark' });

    const full = (await (await fetch(`${inbox}/message/${message.ID}`)).json()) as { Text: string; HTML: string };
    expect(full.Text).toContain(url);
    expect(full.HTML).toContain(`href="${url}"`);
    expect(full.HTML).toContain('Sign in to Chekmark');
  });

  it('delivers the owner alert', async () => {
    await mailer.sendAlert('owner@example.com', 'Monthly AI budget reached', 'New pages are paused.');
    const list = (await (await fetch(`${inbox}/search?query=${encodeURIComponent('to:owner@example.com')}`)).json()) as { messages: { Subject: string }[] };
    expect(list.messages.map((m) => m.Subject)).toEqual(['Chekmark: Monthly AI budget reached']);
  });
});
