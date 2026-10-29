import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { ApiError, logger } from "./core.js";

/** Sends an email, or logs it (MAIL_TRANSPORT=log, the default in development). */
export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  if (env.MAIL_TRANSPORT === "log") {
    logger.info({ to, subject, text }, "mail (log transport — not sent)");
    lastMail = { to, subject, text };
    return;
  }
  const transport = nodemailer.createTransport(env.SMTP_URL);
  await transport.sendMail({ from: env.MAIL_FROM, to, subject, text });
}

/** Last mail of the log transport — read by tests and local development only. */
export let lastMail: { to: string; subject: string; text: string } | null = null;

/**
 * SMS infrastructure. Disabled unless SMS_ENABLED=true; while disabled nothing is
 * sent and the SMS sign-in endpoints answer 404. The only provider so far logs.
 */
export const smsEnabled = () => env.SMS_ENABLED;

export async function sendSms(to: string, text: string): Promise<void> {
  if (!env.SMS_ENABLED) throw new ApiError(404, "sms_disabled", "SMS sign-in is not enabled");
  logger.info({ to, text }, "sms (log provider — not sent)");
  lastSms = { to, text };
}
export let lastSms: { to: string; text: string } | null = null;
