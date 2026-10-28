import type { createClient } from "@/lib/supabase/server";
import { nextMeeting, type Rsvp, type Team } from "@/lib/coaching";

/** One team's check-in for its next meeting. */
export type Checkin = {
  meeting: string;
  rsvps: Rsvp[];
  /** When the coach emailed the team about this meeting, if they have. */
  askedAt: string | null;
  /** The meeting link the coach shared for this meeting. */
  url: string;
  /** The last link the coach shared with this team, to fill in the next ask. */
  lastUrl: string;
};

/** The next meeting's answers and roll call for each team. Access rules limit members to their own team. */
export async function loadCheckins(
  supabase: Awaited<ReturnType<typeof createClient>>, teams: Team[], timeZone?: string,
): Promise<Partial<Record<Team, Checkin>>> {
  if (!teams.length) return {};
  const meetings = Object.fromEntries(teams.map((t) => [t, nextMeeting(t, new Date(), timeZone)])) as Record<Team, string>;
  const dates = [...new Set(Object.values(meetings))];
  const [{ data: rsvps }, { data: calls }] = await Promise.all([
    supabase.from("attendance").select("member_id, meeting, going").in("meeting", dates),
    supabase.from("roll_calls").select("team, meeting, sent_at, meeting_url").in("team", teams).order("meeting", { ascending: false }).limit(200),
  ]);
  const out: Partial<Record<Team, Checkin>> = {};
  for (const t of teams) {
    const mine = (calls ?? []).filter((c) => c.team === t);
    const now = mine.find((c) => c.meeting === meetings[t]);
    out[t] = {
      meeting: meetings[t],
      rsvps: ((rsvps ?? []) as Rsvp[]).filter((r) => r.meeting === meetings[t]),
      askedAt: now?.sent_at ?? null,
      url: now?.meeting_url ?? "",
      lastUrl: mine.find((c) => c.meeting_url)?.meeting_url ?? "",
    };
  }
  return out;
}
