import "server-only";
import type { Email } from "../../worker/mail";

/**
 * Sends email through the Worker's Gmail sender (custom-worker.ts). Returns the
 * addresses that went out, or null where there's no Worker, as in `next dev`.
 */
export async function sendEmails(emails: Email[]) {
  const send = (globalThis as { __sendEmails?: (env: unknown, emails: Email[]) => Promise<string[]> }).__sendEmails;
  if (!send) return null;
  return send(process.env, emails);
}
