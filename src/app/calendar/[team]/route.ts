import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { calendarDetails } from "@/lib/checkin";
import { calendarEvent, isTeam, meetingIcs, teamLabel, type TeamNames } from "@/lib/coaching";

const TZ = process.env.REMINDER_TIMEZONE;

/** A team's weekly meeting as an .ics file, for Apple Calendar and Outlook. Members get only their own team's. */
export async function GET(request: Request, { params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const { data: me } = await supabase.from("profiles").select("role, team").eq("id", user.id).single();
  if (!isTeam(team) || !me || (me.role !== "coach" && me.team !== team)) return new NextResponse("Not found", { status: 404 });

  const { data: row } = await supabase.from("team_names").select("name, meeting_time, meeting_minutes, meeting_url, meeting_tz").eq("team", team).maybeSingle();
  const label = teamLabel(team, { [team]: row?.name } as TeamNames);
  const e = row && calendarEvent(team, { time: row.meeting_time, minutes: row.meeting_minutes, url: row.meeting_url, tz: row.meeting_tz },
    { title: `${label} meeting`, details: calendarDetails(label, row.meeting_url), timeZone: TZ });
  if (!e) return new NextResponse("This team doesn't have a meeting time yet.", { status: 404 });

  return new NextResponse(meetingIcs(e), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${team.toLowerCase()}-team-meeting.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
