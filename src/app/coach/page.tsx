import Link from "next/link";
import { requireCoach } from "@/lib/session";
import { coachTabs, Header } from "@/components/header";
import { StripKey, WeekStrip } from "@/components/progress";
import { Avatar } from "@/components/avatar";
import { TeamViews, type Tab } from "@/components/cards";
import { TeamColumn } from "@/components/team-column";
import { AutoSubmitCheckbox } from "@/components/client";
import { addAction, deleteAction, setActionDone } from "@/app/actions";
import { loadCheckins } from "@/lib/checkin";
import { loadChecked, loadNotes, loadSocial } from "@/lib/social";
import {
  BOOKING_ENABLED, coachActions, isTeam, progressByMember, teamLabel, TEAMS, weekKey,
  type Booking, type CoachActionRow, type LogRow, type Profile, type Progress, type Suggestion, type Team, type TeamNames,
} from "@/lib/coaching";

const TZ = process.env.REMINDER_TIMEZONE;
type CoachTab = Tab | "progress" | "actions";
const KIND: Record<Suggestion["kind"], string> = {
  checkin: "Check in", commit: "Commitment", wheel: "Life wheel", team: "Team",
  remind: "Reminder", refresh: "Refresh", call: "Call", custom: "Your action",
};

export default async function CoachPage({ searchParams: sp }: { searchParams: Promise<{ team?: string; tab?: string; asked?: string }> }) {
  const searchParams = await sp;
  const { supabase, me, names } = await requireCoach();
  const sel = searchParams.team === "all" || searchParams.team === "none" || isTeam(searchParams.team) ? searchParams.team : "Monday";
  const tab = (["team", "accountability", "missions", "progress", "actions"].includes(searchParams.tab ?? "") ? searchParams.tab : "team") as CoachTab;

  const [{ data: profiles, error }, { data: rows }, { data: bookings }, { data: log }] = await Promise.all([
    supabase.from("profiles").select("*").neq("role", "coach").is("archived_at", null).order("name"),
    supabase.from("coach_actions").select("*"),
    supabase.from("bookings").select("*").gte("created_at", new Date(Date.now() - 7 * 864e5).toISOString()),
    supabase.from("commitment_log").select("member_id, week, commitment, done"),
  ]);
  // An empty list here would look like everyone vanished; show the error page instead.
  if (error) throw new Error(`Couldn't load members: ${error.message}`);
  const logs = progressByMember((log ?? []) as LogRow[], weekKey(new Date(), TZ));
  const members = (profiles ?? []) as Profile[];
  const actions = coachActions(members, (rows ?? []) as CoachActionRow[], (bookings ?? []) as Booking[], new Date(), TZ, names);
  const openCount = actions.filter((a) => !a.done).length;

  const teamsShown: (Team | null)[] = sel === "all"
    ? [...TEAMS, ...(members.some((m) => !m.team) ? [null] : [])]
    : [sel === "none" ? null : (sel as Team)];
  const groups = teamsShown.map((team) => ({ team, members: members.filter((m) => m.team === team) }));
  const shownIds = groups.flatMap((g) => g.members.map((m) => m.id));
  const [checkins, social, notes] = tab === "team"
    ? await Promise.all([loadCheckins(supabase, teamsShown.filter(isTeam), TZ), loadSocial(supabase, shownIds), loadNotes(supabase, shownIds)])
    : [undefined, undefined, undefined];
  const checked = tab === "team" || tab === "accountability"
    ? await loadChecked(supabase, groups.flatMap((g) => g.members.map((m) => m.id)), weekKey(new Date(), TZ)) : undefined;
  const selLabel = sel === "all" ? "All teams" : teamLabel(sel === "none" ? null : (sel as Team), names);

  return (
    <>
      <Header me={me}
        sub="Coach view"
        tabs={coachTabs(sel, openCount)}
        current={tab}
        right={<Link className="btn small" href="/coach/members">+ Add member</Link>}
      />
      <div className="wrap layout coach">
        <TeamColumn members={members} names={names} selected={sel} tab={tab} actions={tab === "actions" ? actions : undefined} />
        <main>
          {tab === "actions" ? (
            <ActionsView actions={actions} teams={teamsShown} members={members} names={names} title={sel === "all" ? "Coaches actions" : `Coaches actions: ${selLabel}`} showGeneral={sel === "all"} />
          ) : tab === "progress" ? (
            <ProgressView groups={groups} logs={logs} names={names} title={sel === "all" ? "Progress: all teams" : `${selLabel}: progress`} />
          ) : (
            <>
              <div className="intro">
                <div>
                  <h1>{tab === "team" ? selLabel : tab === "accountability" ? `${selLabel}: commitments` : `${selLabel}: missions`}</h1>
                  <p>{sel === "all" ? `${members.length} members across all teams.` : `${groups[0].members.length} ${groups[0].members.length === 1 ? "member" : "members"}.`} Only you can see other teams.</p>
                </div>
                <div className="row intro-actions">
                  <Link className="btn ghost" href="/coach/teams">Team settings</Link>
                  <Link className="btn" href={isTeam(sel) ? `/coach/members?team=${sel}` : "/coach/members"}>{isTeam(sel) ? `Add a member to ${selLabel}` : "Add a member"}</Link>
                </div>
              </div>
              {searchParams.asked && <AskedNotice asked={searchParams.asked} />}
              <TeamViews tab={tab} groups={groups} viewer={me} logs={logs} names={names} checkins={checkins} social={social} checked={checked} notes={notes} />
            </>
          )}
        </main>
      </div>
    </>
  );
}

function AskedNotice({ asked }: { asked: string }) {
  const n = Number(asked);
  const text: Record<string, string> = {
    badlink: "That meeting link didn't look right. It needs to start with https://",
    setup: "Email isn't set up yet: SUPABASE_SERVICE_ROLE_KEY is missing in Cloudflare.",
    nomail: "Email only sends from the live app, not from a local preview.",
  };
  if (Number.isInteger(n)) {
    return <div className="notice good">{n ? `Asked ${n} ${n === 1 ? "person" : "people"} by email. Answers show up below as they come in.` : "Saved. No one needed an email (everyone's answered, or they're Example members)."}</div>;
  }
  return <div className="notice">{text[asked] ?? "That didn't send. Try again."}</div>;
}

function ActionsView({ actions, teams, members, names, title, showGeneral }: {
  actions: Suggestion[]; teams: (Team | null)[]; members: Profile[]; names: TeamNames; title: string; showGeneral: boolean;
}) {
  const scoped = actions.filter((a) => teams.includes(a.team) || (showGeneral && a.custom && !a.memberId));
  const open = scoped.filter((a) => !a.done);
  const done = scoped.filter((a) => a.done);
  const general = showGeneral ? open.filter((a) => a.custom && !a.memberId) : [];
  return (
    <>
      <div className="intro">
        <div>
          <h1>{title}</h1>
          <p>What to do this week to keep every member accountable. Suggestions come from members&apos; profiles and reset each Monday.</p>
        </div>
        <span className="muted" style={{ fontSize: "0.85rem" }}>Only you can see this tab.</span>
      </div>
      <div className="stats">
        <div className="stat"><b>{open.length}</b><span>open this week</span></div>
        <div className="stat"><b>{open.filter((a) => a.kind === "checkin").length}</b><span>need a check-in</span></div>
        {BOOKING_ENABLED && <div className="stat"><b>{scoped.filter((a) => a.kind === "call").length}</b><span>calls booked</span></div>}
        <div className="stat"><b>{done.length}</b><span>done this week</span></div>
      </div>
      <form className="addact" action={addAction}>
        <label htmlFor="new-action" style={{ position: "absolute", left: -9999 }}>New action</label>
        <input id="new-action" name="text" maxLength={200} placeholder="Add your own action, e.g. Text Sam congrats on the new job" required />
        <select name="member_id" aria-label="Member">
          <option value="">No specific member</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.team ? teamLabel(m.team, names) : "no team"})</option>)}
        </select>
        <button className="btn" type="submit">Add action</button>
      </form>
      {teams.map((t) => {
        const list = open.filter((a) => a.team === t && !(a.custom && !a.memberId));
        if (!list.length) return teams.length > 1 ? null : (
          <div key={t ?? "none"} className="empty"><h3>Nothing open for this team</h3><p>Check-ins appear after the team&apos;s meeting day for anyone who hasn&apos;t marked their week done.</p></div>
        );
        return (
          <section key={t ?? "none"} className="team-block">
            {teams.length > 1 && <h2>{teamLabel(t, names)}</h2>}
            <ul className="actlist">{list.map((a) => <ActionRow key={a.id} a={a} />)}</ul>
          </section>
        );
      })}
      {general.length > 0 && (
        <section className="team-block"><h2>General</h2><ul className="actlist">{general.map((a) => <ActionRow key={a.id} a={a} />)}</ul></section>
      )}
      {teams.length > 1 && open.length === 0 && (
        <div className="empty"><h3>Nothing open right now</h3><p>Everyone is on track this week.</p></div>
      )}
      {done.length > 0 && (
        <details>
          <summary className="muted" style={{ cursor: "pointer", fontWeight: 600 }}>Done this week ({done.length})</summary>
          <ul className="actlist" style={{ marginTop: 10 }}>{done.map((a) => <ActionRow key={a.id} a={a} />)}</ul>
        </details>
      )}
    </>
  );
}

function ActionRow({ a }: { a: Suggestion }) {
  return (
    <li className={`act ${a.level}${a.done ? " isdone" : ""}`}>
      <AutoSubmitCheckbox id={`act-${a.id}`} label={`Done: ${a.text}`} checked={a.done} action={setActionDone.bind(null, a.id)} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <label htmlFor={`act-${a.id}`}><p className="act-text">{a.text}</p></label>
        {a.why && <p className="act-why">{a.why}</p>}
      </div>
      <div style={{ display: "grid", gap: 4, justifyItems: "end" }}>
        <span className={`kind ${a.level}`}>{KIND[a.kind]}</span>
        {a.custom && <form action={deleteAction.bind(null, a.id)}><button className="linkbtn" style={{ fontSize: "0.8rem" }} type="submit">Delete</button></form>}
      </div>
    </li>
  );
}

function ProgressView({ groups, logs, names, title }: { groups: { team: Team | null; members: Profile[] }[]; logs: Record<string, Progress>; names: TeamNames; title: string }) {
  const all = groups.flatMap((g) => g.members);
  const tracked = all.map((m) => logs[m.id]).filter((p): p is Progress => !!p && p.weeks.length > 0);
  const done = tracked.reduce((n, p) => n + p.done, 0), total = tracked.reduce((n, p) => n + p.total, 0);
  return (
    <>
      <div className="intro"><div>
        <h1>{title}</h1>
        <p>Each member&apos;s commitments meeting by meeting. Open someone to see every commitment or fix a week they forgot to mark.</p>
      </div></div>
      <div className="stats">
        <div className="stat"><b>{total ? `${Math.round((done / total) * 100)}%` : "–"}</b><span>follow-through rate</span></div>
        <div className="stat"><b>{tracked.filter((p) => p.streak >= 3).length}</b><span>on a 3+ week streak</span></div>
        <div className="stat"><b>{tracked.filter((p) => p.weeks.length > 1 && p.weeks.at(-2)?.status === "missed").length}</b><span>missed last week</span></div>
      </div>
      <StripKey />
      {groups.map(({ team, members }) => (
        <section key={team ?? "none"} className="team-block">
          {groups.length > 1 && <h2>{teamLabel(team, names)}</h2>}
          {members.length ? (
            <div className="tablebox">
              <table className="progtable">
                <thead><tr><th>Member</th><th>Committed to</th><th>Last 8 meetings</th><th>Streak</th><th>Done</th></tr></thead>
                <tbody>
                  {members.map((m) => {
                    const p = logs[m.id];
                    return (
                      <tr key={m.id}>
                        <td><Link href={`/progress?id=${m.id}`} className="row" style={{ flexWrap: "nowrap" }}><Avatar name={m.name} url={m.avatar_url} size={30} />{m.name}</Link></td>
                        <td style={{ maxWidth: 280 }}>{m.accountability || <span className="muted">Not set</span>}</td>
                        <td>{p ? <WeekStrip p={p} team={m.team} last={8} small /> : <span className="muted">No weeks yet</span>}</td>
                        <td>{p ? `${p.streak} wk` : "–"}</td>
                        <td>{p?.total ? `${p.done} of ${p.total}` : "–"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <div className="empty"><h3>No one on {teamLabel(team, names)} yet</h3></div>}
        </section>
      ))}
    </>
  );
}
