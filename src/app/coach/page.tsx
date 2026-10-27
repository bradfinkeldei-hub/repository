import Link from "next/link";
import { requireCoach } from "@/lib/session";
import { Header } from "@/components/header";
import { TeamViews, type Tab } from "@/components/cards";
import { TeamColumn } from "@/components/team-column";
import { AutoSubmitCheckbox } from "@/components/client";
import { addAction, deleteAction, setActionDone } from "@/app/actions";
import {
  coachActions, isTeam, teamLabel, TEAMS,
  type Booking, type CoachActionRow, type Profile, type Suggestion, type Team,
} from "@/lib/coaching";

const TZ = process.env.REMINDER_TIMEZONE;
type CoachTab = Tab | "actions";
const KIND: Record<Suggestion["kind"], string> = {
  checkin: "Check in", commit: "Commitment", wheel: "Life wheel", team: "Team",
  remind: "Reminder", refresh: "Refresh", call: "Call", custom: "Your action",
};

export default async function CoachPage({ searchParams: sp }: { searchParams: Promise<{ team?: string; tab?: string }> }) {
  const searchParams = await sp;
  const { supabase, me } = await requireCoach();
  const sel = searchParams.team === "all" || searchParams.team === "none" || isTeam(searchParams.team) ? searchParams.team : "Monday";
  const tab = (["team", "accountability", "missions", "actions"].includes(searchParams.tab ?? "") ? searchParams.tab : "team") as CoachTab;

  const [{ data: profiles }, { data: rows }, { data: bookings }] = await Promise.all([
    supabase.from("profiles").select("*").neq("role", "coach").order("name"),
    supabase.from("coach_actions").select("*"),
    supabase.from("bookings").select("*").gte("created_at", new Date(Date.now() - 7 * 864e5).toISOString()),
  ]);
  const members = (profiles ?? []) as Profile[];
  const actions = coachActions(members, (rows ?? []) as CoachActionRow[], (bookings ?? []) as Booking[], new Date(), TZ);
  const openCount = actions.filter((a) => !a.done).length;

  const teamsShown: (Team | null)[] = sel === "all"
    ? [...TEAMS, ...(members.some((m) => !m.team) ? [null] : [])]
    : [sel === "none" ? null : (sel as Team)];
  const groups = teamsShown.map((team) => ({ team, members: members.filter((m) => m.team === team) }));
  const selLabel = sel === "all" ? "All teams" : teamLabel(sel === "none" ? null : (sel as Team));
  const href = (t: string) => `/coach?team=${sel}&tab=${t}`;

  return (
    <>
      <Header
        sub="Coach view"
        tabs={[
          { key: "team", label: "Team", href: href("team") },
          { key: "accountability", label: "Accountability", href: href("accountability") },
          { key: "missions", label: "Missions", href: href("missions") },
          { key: "actions", label: "Coaches actions", href: href("actions"), count: openCount },
        ]}
        current={tab}
        right={<><Link className="btn small" href="/coach/members">+ Add member</Link><Link className="btn ghost small" href="/profile">My profile</Link></>}
      />
      <div className="wrap layout coach">
        <TeamColumn members={members} selected={sel} tab={tab} actions={tab === "actions" ? actions : undefined} />
        <main>
          {tab === "actions" ? (
            <ActionsView actions={actions} teams={teamsShown} members={members} title={sel === "all" ? "Coaches actions" : `Coaches actions: ${selLabel}`} showGeneral={sel === "all"} />
          ) : (
            <>
              <div className="intro">
                <div>
                  <h1>{tab === "team" ? selLabel : tab === "accountability" ? `${selLabel}: commitments` : `${selLabel}: missions`}</h1>
                  <p>{sel === "all" ? `${members.length} members across all teams.` : `${groups[0].members.length} ${groups[0].members.length === 1 ? "member" : "members"}.`} Only you can see other teams.</p>
                </div>
                <Link className="btn" href={isTeam(sel) ? `/coach/members?team=${sel}` : "/coach/members"}>{isTeam(sel) ? `Add a member to ${sel} team` : "Add a member"}</Link>
              </div>
              <TeamViews tab={tab} groups={groups} viewer={me} />
            </>
          )}
        </main>
      </div>
    </>
  );
}

function ActionsView({ actions, teams, members, title, showGeneral }: {
  actions: Suggestion[]; teams: (Team | null)[]; members: Profile[]; title: string; showGeneral: boolean;
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
        <div className="stat"><b>{scoped.filter((a) => a.kind === "call").length}</b><span>calls booked</span></div>
        <div className="stat"><b>{done.length}</b><span>done this week</span></div>
      </div>
      <form className="addact" action={addAction}>
        <label htmlFor="new-action" style={{ position: "absolute", left: -9999 }}>New action</label>
        <input id="new-action" name="text" maxLength={200} placeholder="Add your own action, e.g. Text Sam congrats on the new job" required />
        <select name="member_id" aria-label="Member">
          <option value="">No specific member</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.team ?? "no team"})</option>)}
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
            {teams.length > 1 && <h2>{teamLabel(t)}</h2>}
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
