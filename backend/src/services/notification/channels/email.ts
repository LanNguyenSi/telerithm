import { createChildLogger } from "../../../logger.js";

const log = createChildLogger("notify-email");

export interface EmailPayload {
  to: string;
  subject: string;
  body: string;
}

/**
 * Sends an email notification.
 * Currently logs the email — replace with nodemailer/SES when SMTP is configured.
 */
export async function sendEmail(payload: EmailPayload): Promise<void> {
  // TODO: Replace with real SMTP transport (nodemailer)
  // For now, log the notification so it's visible in the system
  log.info(
    { to: payload.to, subject: payload.subject },
    "Email notification (SMTP not configured, logging only)",
  );
}
