import { Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

export interface Mailer {
  sendSignInLink(email: string, url: string): Promise<void>;
  /** A plain-text message to the app's owner, such as the budget alert. */
  sendAlert(to: string, subject: string, text: string): Promise<void>;
}

/** Nest injection token for the Mailer. */
export const MAILER = Symbol('MAILER');

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

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async sendSignInLink(email: string, url: string): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: email,
      subject: 'Your Chekmark sign-in link',
      text: `Tap this link to sign in to Chekmark. It works once and expires in 15 minutes.\n\n${url}\n\nIf you didn't ask for this, you can ignore this email.`,
    });
  }

  async sendAlert(to: string, subject: string, text: string): Promise<void> {
    await this.transport.sendMail({ from: this.from, to, subject: `Chekmark: ${subject}`, text });
  }
}
