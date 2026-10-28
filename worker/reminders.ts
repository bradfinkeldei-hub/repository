// Weekly reminder emails. Runs from the Worker's daily schedule (custom-worker.ts),
// outside Next.js, because sending through Gmail uses Cloudflare's TCP sockets.
import { createClient } from "@supabase/supabase-js";
import { connectMailer } from "./mail";
import { BOOKING_ENABLED, commitmentList, firstName, weekdayName, weekKey, type Profile } from "../src/lib/coaching";

export type ReminderEnv = {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER: string;
  SMTP_PASS: string;
  REMINDER_FROM_NAME?: string;
  REMINDER_TIMEZONE?: string;
  SITE_URL?: string;
  COACH_NAME?: string;
};

export function reminderText(p: Profile, site: string, coach: string) {
  const list = commitmentList(p.accountability);
  const commitment = list.length > 1 ? list.map((c) => `  - ${c}`).join("\n") : list.length ? `  "${list[0]}"` : "";
  return [
    `Hi ${firstName(p.name)},`,
    "",
    commitment ? `This is your weekly reminder of what you're being held accountable to:\n\n${commitment}` : "This is your weekly reminder to set the commitment your team will hold you to.",
    p.becoming?.trim() ? `\nWho you're going to be: ${p.becoming.trim()}` : "",
    p.creating?.trim() ? `\nWhat you're creating: ${p.creating.trim()}` : "",
    "",
    `When you've done your part this week, mark it done: ${site}/team?tab=accountability`,
    ...(BOOKING_ENABLED ? [`Feeling stuck? Book a call with ${coach}: ${site}/book`] : []),
    "",
    `You can change or turn off this reminder in Settings: ${site}/settings`,
  ].join("\n");
}

/** Emails everyone whose reminder day is today, at most once per week. */
export async function sendReminders(env: ReminderEnv, now = new Date()) {
  const tz = env.REMINDER_TIMEZONE;
  const today = weekdayName(now, tz);
  const week = weekKey(now, tz);
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase settings are missing");
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: due, error } = await admin.from("profiles").select("*")
    .eq("reminder_enabled", true).is("archived_at", null).eq("reminder_day", today).neq("last_reminder_week", week);
  if (error) throw new Error(error.message);
  const people = (due ?? []) as Profile[];
  if (!people.length) return { sent: 0, failed: 0, today, week };

  const { data: contacts } = await admin.from("member_contacts").select("id, email").in("id", people.map((p) => p.id));
  const email = new Map((contacts ?? []).map((c) => [c.id as string, c.email as string]));
  // @example.com is the made-up Example team; those addresses can't receive mail.
  const real = people.filter((p) => !!email.get(p.id) && !email.get(p.id)!.toLowerCase().endsWith("@example.com"));
  if (!real.length) return { sent: 0, failed: 0, today, week };

  const mailer = await connectMailer(env);
  const site = (env.SITE_URL || "").replace(/\/$/, "");
  const coach = env.COACH_NAME || "your coach";

  let sent = 0, failed = 0;
  for (const p of real) {
    const to = email.get(p.id)!;
    try {
      await mailer.send({ to, subject: "Your weekly accountability reminder", text: reminderText(p, site, coach) });
      await admin.from("profiles").update({ last_reminder_week: week }).eq("id", p.id);
      sent++;
    } catch (e) {
      failed++;
      console.error("reminder failed", p.id, e);
    }
  }
  await mailer.close();
  return { sent, failed, today, week };
}
