// Sends email through Gmail SMTP. Lives outside Next.js because it uses
// Cloudflare's TCP sockets; custom-worker.ts hands sendEmails to the app.
import { WorkerMailer } from "worker-mailer";

export type MailEnv = {
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER: string;
  SMTP_PASS: string;
  REMINDER_FROM_NAME?: string;
};

export type Email = { to: string; subject: string; text: string; html?: string };

export async function connectMailer(env: MailEnv) {
  const port = Number(env.SMTP_PORT || 465);
  const mailer = await WorkerMailer.connect({
    host: env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure: port === 465,
    credentials: { username: env.SMTP_USER, password: env.SMTP_PASS },
    authType: "plain",
  });
  const from = { name: env.REMINDER_FROM_NAME || "The Coaching Circle", email: env.SMTP_USER };
  return {
    send: (e: Email) => mailer.send({ from, to: { email: e.to }, subject: e.subject, text: e.text, html: e.html }),
    close: () => mailer.close().catch(() => {}),
  };
}

/** Sends each email over one connection. Returns the addresses that went out. */
export async function sendEmails(env: MailEnv, emails: Email[]) {
  if (!emails.length) return [];
  if (!env.SMTP_USER || !env.SMTP_PASS) throw new Error("SMTP_USER and SMTP_PASS aren't set");
  const mailer = await connectMailer(env);
  const sent: string[] = [];
  for (const e of emails) {
    try {
      await mailer.send(e);
      sent.push(e.to);
    } catch (err) {
      console.error("email failed", e.to, err);
    }
  }
  await mailer.close();
  return sent;
}
