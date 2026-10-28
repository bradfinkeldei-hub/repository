import Link from "next/link";
import { AREAS, fmt, teamAverage, teamLabel, teamOptions, weekKey, type Profile, type Progress, type Team, type TeamNames, type Wheel } from "@/lib/coaching";
import { setTeam, startViewAs, toggleDone } from "@/app/actions";
import { AutoSubmitSelect } from "@/components/client";
import { Avatar } from "@/components/avatar";
import { MiniProgress } from "@/components/progress";
import { MeetingCheckin } from "@/components/attendance";
import type { Checkin } from "@/lib/checkin";

const TZ = process.env.REMINDER_TIMEZONE;

export function WheelSvg({ wheel, size = 150, label }: { wheel: Partial<Record<string, number | null>>; size?: number; label: string }) {
  const cx = 85, cy = 85, R = 72, step = (Math.PI * 2) / AREAS.length;
  const p = (a: number, r: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  return (
    <svg className="wheel" viewBox="0 0 170 170" width={size} height={size} role="img" aria-label={label}>
      {[2, 4, 6, 8].map((r) => <circle key={r} cx={cx} cy={cy} r={(R * r) / 10} fill="none" stroke="var(--line)" />)}
      {AREAS.map(([k], i) => {
        const v = Math.max(0, Math.min(10, Number(wheel?.[k]) || 0));
        const a0 = -Math.PI / 2 + i * step + 0.02, a1 = a0 + step - 0.04, r = (R * v) / 10;
        return r > 0 ? <path key={k} d={`M${cx} ${cy} L${p(a0, r)} A${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${p(a1, r)} Z`} fill={`var(--w${i + 1})`} fillOpacity={0.85} /> : null;
      })}
      {AREAS.map(([k], i) => {
        const a = -Math.PI / 2 + i * step;
        const [x, y] = p(a, R).split(" ");
        return <line key={k} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--line)" />;
      })}
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--muted)" strokeOpacity={0.5} />
    </svg>
  );
}

export function Legend({ wheel, two = false }: { wheel: Partial<Record<string, number | null>>; two?: boolean }) {
  return (
    <ul className={`legend${two ? " two" : ""}`}>
      {AREAS.map(([k, label], i) => (
        <li key={k}><i style={{ background: `var(--w${i + 1})` }} /><span>{label}</span><b>{fmt(wheel?.[k] ?? null)}</b></li>
      ))}
    </ul>
  );
}

export function TeamWheel({ team, members, ownTeam, names }: { team: Team | null; members: Profile[]; ownTeam?: boolean; names?: TeamNames }) {
  const avg = teamAverage(members);
  const scored = AREAS.filter(([k]) => avg[k] != null).map(([k, l]) => ({ l, v: avg[k] as number })).sort((a, b) => b.v - a.v);
  const top = scored[0], bottom = scored[scored.length - 1];
  return (
    <section className="card teamwheel">
      <WheelSvg wheel={avg} size={190} label={`${teamLabel(team, names)} average life wheel`} />
      <div style={{ flex: "1 1 320px", minWidth: 0 }}>
        <h2>{ownTeam ? "Our team's life wheel" : `${teamLabel(team, names)} life wheel`}</h2>
        <p className="sub">The average of {members.length} {members.length === 1 ? "member's wheel" : "members' wheels"}.</p>
        <Legend wheel={avg} two />
        {top && bottom && (
          <div className="row" style={{ marginTop: 10 }}>
            <span className="pill done">Strongest: {top.l} {fmt(top.v)}</span>
            <span className="pill warn">Growth edge: {bottom.l} {fmt(bottom.v)}</span>
          </div>
        )}
      </div>
    </section>
  );
}

function Who({ m, viewer, coachTools, names }: { m: Profile; viewer: Profile; coachTools?: boolean; names?: TeamNames }) {
  const isMe = m.id === viewer.id;
  const canEdit = isMe || viewer.role === "coach";
  const tools = coachTools && viewer.role === "coach" && !isMe;
  const edit = canEdit && <Link className="btn ghost small" href={isMe ? "/profile" : `/profile?id=${m.id}`}>{isMe ? "Edit my profile" : "Edit profile"}</Link>;
  return (
    <>
      <div className="who">
        <Avatar name={m.name} url={m.avatar_url} />
        <div className="who-name">
          <h3>{m.name}</h3>
          {isMe && <div className="meta">You</div>}
        </div>
        {!tools && edit && <div className="end">{edit}</div>}
      </div>
      {tools && (
        <div className="coach-tools">
          <label className="team-pick">
            <span>Team</span>
            <AutoSubmitSelect
              label={`Move ${m.name} to another team`}
              value={m.team ?? ""}
              action={setTeam.bind(null, m.id)}
              options={[...teamOptions(names), ["", "No team"]]}
            />
          </label>
          <div className="coach-btns">
            <form action={startViewAs.bind(null, m.id)}><button className="btn ghost small" type="submit" title={`See the app the way ${m.name} sees it`}><span className="clip">View as {m.name.split(" ")[0]}</span></button></form>
            {edit}
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={`field ${className}`}>
      <span className="label">{label}</span>
      <p className={value ? "" : "empty"}>{value || "Not shared yet"}</p>
    </div>
  );
}

function DoneState({ m, viewer }: { m: Profile; viewer: Profile }) {
  const done = m.done_week === weekKey(new Date(), TZ);
  if (m.id === viewer.id || viewer.role === "coach") {
    return (
      <form action={toggleDone.bind(null, m.id)} className="row">
        {done && <span className="pill done">Done this week</span>}
        <button className={`btn small${done ? " ghost" : ""}`} type="submit">{done ? "Undo this week" : "Mark this week done"}</button>
      </form>
    );
  }
  return done ? <span className="pill done" style={{ alignSelf: "flex-start" }}>Done this week</span> : <span className="pill warn" style={{ alignSelf: "flex-start" }}>Not marked done yet</span>;
}

export function MemberCard({ m, viewer, names }: { m: Profile; viewer: Profile; names?: TeamNames }) {
  return (
    <article className="card">
      <Who m={m} viewer={viewer} coachTools names={names} />
      <div className="wheelrow">
        <WheelSvg wheel={m.wheel as Wheel} label={`${m.name}'s life wheel`} />
        <Legend wheel={m.wheel as Wheel} />
      </div>
      <Field label="Actively creating" value={m.creating} className="creating" />
      <div className="acct"><Field label="Held accountable to" value={m.accountability} /></div>
      <DoneState m={m} viewer={viewer} />
    </article>
  );
}

export function AcctCard({ m, viewer, p }: { m: Profile; viewer: Profile; p?: Progress }) {
  return (
    <article className="card">
      <Who m={m} viewer={viewer} />
      <div className="acct"><Field label="Held accountable to" value={m.accountability} /></div>
      {p && <MiniProgress p={p} team={m.team} />}
      <div className="row">
        {m.reminder_enabled ? <span className="pill on">Weekly email · {m.reminder_day}</span> : <span className="pill">No reminder</span>}
      </div>
      <DoneState m={m} viewer={viewer} />
    </article>
  );
}

export function MissionCard({ m, viewer }: { m: Profile; viewer: Profile }) {
  return (
    <article className="card mission">
      <blockquote>{m.mission}</blockquote>
      <Who m={m} viewer={viewer} />
    </article>
  );
}

export type Tab = "team" | "accountability" | "missions";

/** The Team, Accountability and Missions views for one or more teams. */
export function TeamViews({ tab, groups, viewer, ownTeam, logs, names, checkins }: {
  tab: Tab; groups: { team: Team | null; members: Profile[] }[]; viewer: Profile; ownTeam?: boolean; logs?: Record<string, Progress>; names?: TeamNames;
  checkins?: Partial<Record<Team, Checkin>>;
}) {
  const multi = groups.length > 1;
  return (
    <>
      {groups.map(({ team, members }) => {
        const key = team ?? "none";
        let body: React.ReactNode;
        if (tab === "team") {
          body = members.length ? (
            <>
              {team && checkins?.[team] && <MeetingCheckin team={team} members={members} viewer={viewer} c={checkins[team]} />}
              {team && <TeamWheel team={team} members={members} ownTeam={ownTeam} names={names} />}
              <div className="grid">{members.map((m) => <MemberCard key={m.id} m={m} viewer={viewer} names={names} />)}</div>
            </>
          ) : <EmptyTeam label={teamLabel(team, names)} coach={viewer.role === "coach"} />;
        } else if (tab === "accountability") {
          const list = members.filter((m) => m.accountability);
          body = list.length ? <div className="grid">{list.map((m) => <AcctCard key={m.id} m={m} viewer={viewer} p={logs?.[m.id]} />)}</div>
            : <div className="empty"><h3>No commitments yet</h3><p>Once someone on this team adds what they're accountable to, it shows up here.</p></div>;
        } else {
          const list = members.filter((m) => m.mission);
          body = list.length ? <div className="grid">{list.map((m) => <MissionCard key={m.id} m={m} viewer={viewer} />)}</div>
            : <div className="empty"><h3>No missions shared yet</h3><p>Members add their mission from their profile.</p></div>;
        }
        return (
          <section key={key} className="team-block">
            {multi && <h2>{teamLabel(team, names)}</h2>}
            {body}
          </section>
        );
      })}
    </>
  );
}

function EmptyTeam({ label, coach }: { label: string; coach: boolean }) {
  return (
    <div className="empty">
      <h3>No one on {label} yet</h3>
      <p>{coach ? "Use + Add member at the top to invite people, or move someone here with the team menu on their card." : "Your teammates show up here as they join."}</p>
    </div>
  );
}
