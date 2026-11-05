import Link from "next/link";
import { requireCoach } from "@/lib/session";
import { Header } from "@/components/header";
import { TeamColumn } from "@/components/team-column";
import { createTeam, deleteTeam, renameTeams } from "@/app/actions";
import { DAYS, meetingDay, teamKeys, teamLabel, TIME_ZONES, zoneLabel, type MeetingTime, type Profile, type Team } from "@/lib/coaching";

const TZ = process.env.REMINDER_TIMEZONE || "America/Chicago";

const LENGTHS: [number, string][] = [[30, "30 min"], [45, "45 min"], [60, "1 hour"], [75, "1¼ hours"], [90, "1½ hours"], [120, "2 hours"]];

const ERRORS: Record<string, string> = {
  link: "A meeting link didn't look right. It needs to start with https://",
  newname: "Give the new team a name.",
  create: "The new team didn't save. Try again.",
  confirm: "Tick the box to confirm before deleting a team.",
  moveto: "Pick another team for its members to move to.",
  delete: "The team wasn't deleted. Try again.",
};

function DayPicker({ name, value }: { name: string; value: string }) {
  return (
    <select className="input" name={name} defaultValue={value}>
      {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
      <option value="">No set day</option>
    </select>
  );
}

/** Where the coach adds, renames and deletes teams, and sets when each one meets. */
export default async function TeamsPage({ searchParams: sp }: { searchParams: Promise<{ saved?: string; created?: string; deleted?: string; error?: string }> }) {
  const searchParams = await sp;
  const { supabase, me, names } = await requireCoach();
  const [{ data }, { data: rows }] = await Promise.all([
    supabase.from("profiles").select("*").neq("role", "coach").order("name"),
    supabase.from("team_names").select("team, meeting_time, meeting_minutes, meeting_url, meeting_tz"),
  ]);
  const everyone = (data ?? []) as Profile[];
  const members = everyone.filter((m) => !m.archived_at);
  const times = Object.fromEntries((rows ?? []).map((r) => [r.team, { time: r.meeting_time, minutes: r.meeting_minutes, url: r.meeting_url, tz: r.meeting_tz }])) as Partial<Record<Team, MeetingTime>>;
  const teams = teamKeys();
  const count = (t: Team) => members.filter((m) => m.team === t).length;
  const error = searchParams.error ? ERRORS[searchParams.error] ?? "The teams didn't save. Try again." : "";

  return (
    <>
      <Header me={me} sub="Coach view" tabs={[{ key: "team", label: "Back to teams", href: "/coach" }]} current="" />
      <div className="wrap layout coach">
        <TeamColumn members={members} names={names} current="teams" />
        <main>
          <div className="intro"><div>
            <h1>Teams and meeting times</h1>
            <p>Add a team, rename one, or set the day and time it meets and in which time zone, so members can add the meeting to their phone&apos;s calendar. Members in other time zones also see the time in their own. Members see changes right away. Empty a time to turn the calendar buttons off.</p>
          </div></div>
          {searchParams.saved && <div className="notice good">Teams saved. <Link href="/coach">Back to teams</Link></div>}
          {searchParams.created && <div className="notice good">{teamLabel(searchParams.created, names)} is ready. <Link href={`/coach/members?team=${searchParams.created}`}>Add members to it</Link></div>}
          {searchParams.deleted && <div className="notice good">Team deleted.</div>}
          {error && <div className="notice">{error}</div>}

          <form action={createTeam} className="card team-set team-new" id="new-team">
            <h2 style={{ margin: 0 }}>Add a team</h2>
            <div className="team-set-row">
              <label>Name
                <input className="input" type="text" name="name" maxLength={40} required placeholder="Friday Night Mens Group" />
              </label>
              <label>Meets on
                <DayPicker name="day" value="Monday" />
              </label>
            </div>
            <p className="muted small-note" style={{ margin: 0 }}>New teams use the Focus cards. You can set the meeting time below once it&apos;s added.</p>
            <button className="btn" type="submit">Add team</button>
          </form>

          {teams.length > 0 && (
            <form action={renameTeams} className="team-settings">
              {teams.map((t) => {
                const mt = times[t];
                const n = count(t);
                return (
                  <fieldset key={t} className="card team-set" id={`team-${t}`}>
                    <legend>{teamLabel(t, names)} · {n} {n === 1 ? "member" : "members"}</legend>
                    <label>Name
                      <input className="input" type="text" name={`name_${t}`} maxLength={40} defaultValue={teamLabel(t, names)} />
                    </label>
                    <label>Meets on
                      <DayPicker name={`day_${t}`} value={meetingDay(t)} />
                    </label>
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
                    <label>Time zone
                      <select className="input" name={`tz_${t}`} defaultValue={mt?.tz || TZ}>
                        {TIME_ZONES.map(([z, l]) => <option key={z} value={z}>{l}</option>)}
                        {!TIME_ZONES.some(([z]) => z === (mt?.tz || TZ)) && <option value={mt?.tz || TZ}>{zoneLabel(mt?.tz || TZ)}</option>}
                      </select>
                    </label>
                    <label>Standing meeting link (optional)
                      <input className="input" type="url" inputMode="url" name={`url_${t}`} maxLength={500} defaultValue={mt?.url ?? ""} placeholder="https://zoom.us/j/… or https://meet.google.com/…" />
                    </label>
                  </fieldset>
                );
              })}
              <button className="btn" type="submit">Save teams</button>
            </form>
          )}

          {teams.length > 0 && (
            <form action={deleteTeam} className="card team-set team-delete" id="delete-team">
              <h2 style={{ margin: 0 }}>Delete a team</h2>
              <p className="muted small-note" style={{ margin: 0 }}>The team, its meeting check-ins, pending invites and group intention are removed for good. Its members keep their cards, comments and history.</p>
              <div className="team-set-row">
                <label>Team
                  <select className="input" name="team" defaultValue="">
                    <option value="" disabled>Pick a team…</option>
                    {teams.map((t) => <option key={t} value={t}>{teamLabel(t, names)} ({count(t)})</option>)}
                  </select>
                </label>
                <label>Its members
                  <select className="input" name="members" defaultValue="none">
                    {teams.map((t) => <option key={t} value={`move:${t}`}>Move to {teamLabel(t, names)}</option>)}
                    <option value="none">Leave them on no team</option>
                    <option value="archive">Archive them</option>
                  </select>
                </label>
              </div>
              <label className="check-line" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <input type="checkbox" name="confirm" value="yes" /> Yes, delete this team. This can&apos;t be undone.
              </label>
              <button className="btn danger" type="submit">Delete team</button>
            </form>
          )}
        </main>
      </div>
    </>
  );
}
