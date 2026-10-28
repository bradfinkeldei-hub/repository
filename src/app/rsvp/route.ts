import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dateKey } from "@/lib/coaching";
import { rsvpValid } from "@/lib/rsvp";

const TZ = process.env.REMINDER_TIMEZONE;

/** The "I'm in" / "I'm out" links in the meeting check-in email. Works without signing in. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const member = searchParams.get("m") ?? "";
  const meeting = searchParams.get("d") ?? "";
  const answer = searchParams.get("a");
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ok = secret && /^[0-9a-f-]{36}$/.test(member) && /^\d{4}-\d{2}-\d{2}$/.test(meeting)
    && (answer === "in" || answer === "out") && (await rsvpValid(secret, member, meeting, searchParams.get("k") ?? ""));
  if (!ok) return NextResponse.redirect(`${origin}/rsvp/thanks?error=link`);
  if (meeting < dateKey(new Date(), TZ)) return NextResponse.redirect(`${origin}/rsvp/thanks?error=past`);
  const { error } = await createAdminClient().from("attendance")
    .upsert({ member_id: member, meeting, going: answer === "in", updated_at: new Date().toISOString() });
  return NextResponse.redirect(`${origin}/rsvp/thanks?${error ? "error=save" : `a=${answer}&d=${meeting}`}`);
}
