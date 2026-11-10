import { Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

export interface Mailer {
  sendSignInLink(email: string, url: string): Promise<void>;
  /** A plain-text message to the app's owner, such as the budget alert. */
  sendAlert(to: string, subject: string, text: string): Promise<void>;
}

/** Nest injection token for the Mailer. */
export const MAILER = Symbol('MAILER');

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The sign-in message: plain text for every mail app, and a simple HTML
 * version with one button. Inline styles only, because mail apps ignore
 * style sheets. The colours match the app: paper, graphite and pencil yellow.
 */
export function signInEmail(url: string): { subject: string; text: string; html: string } {
  const href = escapeHtml(url);
  return {
    subject: 'Your Chekmark sign-in link',
    text: `Tap this link to sign in to Chekmark. It works once and expires in 15 minutes.\n\n${url}\n\nIf you didn't ask for this, you can ignore this email.`,
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#edefea;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#26292b;">
    <div style="max-width:440px;margin:0 auto;">
      <p style="font-size:22px;font-weight:700;margin:0 0 20px;">책마크 <span style="font-size:15px;font-weight:400;color:#686c70;">Chekmark</span></p>
      <p style="font-size:16px;line-height:1.5;margin:0 0 20px;">Tap the button to sign in. The link works once and expires in 15 minutes.</p>
      <p style="margin:0 0 24px;">
        <a href="${href}" style="display:inline-block;background:#f2b21b;color:#26292b;font-size:16px;font-weight:600;text-decoration:none;padding:14px 22px;border-radius:8px;">Sign in to Chekmark</a>
      </p>
      <p style="font-size:13px;line-height:1.5;color:#686c70;margin:0 0 8px;">If the button does not work, copy this address into your browser:</p>
      <p style="font-size:13px;line-height:1.5;word-break:break-all;margin:0 0 24px;"><a href="${href}" style="color:#2e5a88;">${href}</a></p>
      <p style="font-size:13px;line-height:1.5;color:#686c70;margin:0;">If you didn't ask for this, you can ignore this email. Nobody can sign in without the link.</p>
    </div>
  </body>
</html>`,
  };
}

/** Development and tests: keeps the link and logs it instead of sending email. */
export class LogMailer implements Mailer {
  readonly sent: { email: string; url: string }[] = [];
  readonly alerts: { to: string; subject: string; text: string }[] = [];
  private readonly logger = new Logger('LogMailer');

  async sendSignInLink(email: string, url: string): Promise<void> {
    this.sent.push({ email, url });
    this.logger.log(`Sign-in link for ${email}: ${url}`);
  }

  async sendAlert(to: string, subject: string, text: string): Promise<void> {
    this.alerts.push({ to, subject, text });
    this.logger.warn(`Alert for ${to}: ${subject}. ${text}`);
  }
}

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;
  private readonly logger = new Logger('SmtpMailer');

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    // Short timeouts: a sign-in request should fail with a clear message, not hang, when the email server is down.
    this.transport = nodemailer.createTransport({ url: smtpUrl, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 });
  }

  /** Nest calls this at start: a wrong SMTP_URL shows in the log right away, not at the first sign-in. */
  onModuleInit(): void {
    void this.checkConnection();
  }

  /** True when the email server accepts the connection and the login. Never throws. */
  async checkConnection(): Promise<boolean> {
    try {
      await this.transport.verify();
      this.logger.log('Email server is reachable; sign-in links will be emailed.');
      return true;
    } catch (error) {
      this.logger.error(`Cannot reach the email server, so sign-in emails will fail. Check SMTP_URL. (${String(error)})`);
      return false;
    }
  }

  async sendSignInLink(email: string, url: string): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: email, ...signInEmail(url) });
  }

  async sendAlert(to: string, subject: string, text: string): Promise<void> {
    await this.transport.sendMail({ from: this.from, to, subject: `Chekmark: ${subject}`, text });
  }
}
