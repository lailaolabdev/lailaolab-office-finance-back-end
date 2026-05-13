import nodemailer, { Transporter } from 'nodemailer';
import logger from '../utils/logger';
import { settingsService } from './settings.service';

let transporter: Transporter | null = null;

function buildTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    logger.warn('SMTP not configured — email notifications disabled');
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

function getTransporter() {
  if (!transporter) transporter = buildTransporter();
  return transporter;
}

async function isEmailEnabled() {
  const s = await settingsService.get('notification.emailEnabled');
  return s?.value === true;
}

export const emailService = {
  /**
   * Send mail through SMTP. Silently no-ops when SMTP env vars are missing or
   * when the user disabled email notifications in settings.
   */
  async send(opts: { to: string; subject: string; html: string; text?: string }) {
    if (!(await isEmailEnabled())) {
      logger.debug(`Email skipped (disabled in settings): ${opts.subject}`);
      return null;
    }

    const t = getTransporter();
    if (!t) return null;

    const from = process.env.SMTP_FROM ?? process.env.SMTP_USER!;
    try {
      const info = await t.sendMail({
        from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text ?? opts.html.replace(/<[^>]+>/g, ''),
      });
      logger.info(`Email sent to ${opts.to}: ${info.messageId}`);
      return info;
    } catch (err) {
      logger.error(`Failed to send email to ${opts.to}: ${(err as Error).message}`);
      return null;
    }
  },
};
