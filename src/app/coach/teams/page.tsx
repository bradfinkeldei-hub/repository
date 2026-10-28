import Link from "next/link";
import { requireCoach } from "@/lib/session";
import { Header } from "@/components/header";
import { TeamColumn } from "@/components/team-column";
import { renameTeams } from "@/app/actions";
import { teamLabel, TEAMS, type MeetingTime, type Profile, type Team } from "@/lib/coaching";

const LENGTHS: [number, string][] = [[30, "30 min"], [45, "45 min"], [60, "1 hour"], [75, "1¼ hours"], [90, "1½ hours"], [120, "2 hours"]];

/** Where the coach renames teams and sets when each one meets. The day each team meets doesn't change. */
export default async function TeamsPage({ searchParams: sp }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const searchParams = await sp;
  const { supabase, me, names } = await requireCoach();
  const [{ data }, { data: rows }] = await Promise.all([
    supabase.from("profiles").select("*").neq("role", "coach").is("archived_at", null).order("name"),
    supabase.from("team_names").select("team, meeting_time, meeting_minutes, meeting_url"),
  ]);
  const members = (data ?? []) as Profile[];
  const times = Object.fromEntries((rows ?? []).map((r) => [r.team, { time: r.meeting_time, minutes: r.meeting_minutes, url: r.meeting_url }])) as Partial<Record<Team, MeetingTime>>;

  return (
    <>
      <Header me={me} sub="Coach view" tabs={[{ key: "team", label: "Back to teams", href: "/coach" }]} current="" />
      <div className="wrap layout coach">
        <TeamColumn members={members} names={names} current="teams" />
        <main>
          <div className="intro"><div>
            <h1>Teams and meeting times</h1>
            <p>Rename a team, or set when it meets so members can add the meeting to their phone&apos;s calendar. Members see changes right away. Empty a name to go back to the day name; empty a time to turn the calendar buttons off.</p>
          </div></div>
          {searchParams.saved && <div className="notice good">Teams saved. <Link href="/coach">Back to teams</Link></div>}
          {searchParams.error === "link" && <div className="notice">A meeting link didn&apos;t look right. It needs to start with https://</div>}
          {searchParams.error && searchParams.error !== "link" && <div className="notice">The teams didn&apos;t save. Try again.</div>}
          <form action={renameTeams} className="team-settings">
            {TEAMS.map((t) => {
              const mt = times[t];
              return (
                <fieldset key={t} className="card team-set">
                  <legend>{t === "Example" ? "Example (demo) team" : `Team that meets ${t}`}</legend>
                  <label>Name
                    <input className="input" type="text" name={`name_${t}`} maxLength={40} defaultValue={teamLabel(t, names)} placeholder={`${t} team`} />
                  </label>
                  {t !== "Example" && (
                    <>
                      <div className="team-set-row">
                        <label>Starts at
                          <input className="input" type="time" name={`time_${t}`} defaultValue={mt?.time ?? ""} />
                        </label>
                        <label>Length
                          <select className="input" name={`minutes_${t}`} defaultValue={String(mt?.minutes ?? 60)}>
                            {LENGTHS.map(([n, l]) => <option key={n} value={n}>{l}</option>)}
                          </select>
                        </label>
                      </div>
                      <label>Standing meeting link (optional)
                        <input className="input" type="url" inputMode="url" name={`url_${t}`} maxLength={500} defaultValue={mt?.url ?? ""} placeholder="https://zoom.us/j/… or https://meet.google.com/…" />
                      </label>
                    </>
                  )}
                </fieldset>
              );
            })}
            <button className="btn" type="submit">Save teams</button>
          </form>
        </main>
      </div>
    </>
  );
}
