import "server-only";
import { dateKey } from "@/lib/coaching";
import { rsvpValid } from "@/lib/rsvp";

const TZ = process.env.REMINDER_TIMEZONE;

/** Checks an email link's member, meeting and signature. Returns why it's no good, or "" when it is. */
export async function linkProblem(member: string, meeting: string, sig: string) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bad = !secret ? "no key" : !/^[0-9a-f-]{36}$/i.test(member) ? "member" : !/^\d{4}-\d{2}-\d{2}$/.test(meeting) ? "date"
    : !(await rsvpValid(secret, member, meeting, sig)) ? "signature" : "";
  if (bad) {
    // Shows in the Worker's Logs, to tell a mangled link from a missing setting.
    console.warn("rsvp link refused:", bad, { member, meeting, sigLength: sig.length });
    return "link";
  }
  if (meeting < dateKey(new Date(), TZ)) return "past";
  return "";
}
