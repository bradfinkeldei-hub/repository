import Link from "next/link";
import { AREAS, commitmentList, fmt, isVagueCommitment, MAX_COMMITMENTS, teamAverage, teamLabel, teamOptions, weekKey, type Profile, type Progress, type Team, type TeamNames, type Wheel } from "@/lib/coaching";
import { addCommitment, setTeam, startViewAs, toggleCommitment } from "@/app/actions";
import { AutoSubmitSelect } from "@/components/client";
import { Avatar } from "@/components/avatar";
import { MiniProgress } from "@/components/progress";
import { MeetingCheckin } from "@/components/attendance";
import { Milestones, Thread } from "@/components/thread";
import { CoachNotes } from "@/components/notes";
import type { Checkin } from "@/lib/checkin";
import type { CoachNote, Social } from "@/lib/social";

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
  const tools = coachTools && viewer.role === "coach" && !isMe;
  return (
    <>
      <div className="who">
        <Avatar name={m.name} url={m.avatar_url} />
        <div className="who-name">
          <h3>{m.name}</h3>
          {isMe && <div className="meta">You</div>}
        </div>
        {!tools && <div className="end"><EditLink m={m} viewer={viewer} /></div>}
      </div>
      {tools && <CoachTools m={m} viewer={viewer} names={names} />}
    </>
  );
}

function EditLink({ m, viewer }: { m: Profile; viewer: Profile }) {
  const isMe = m.id === viewer.id;
  if (!isMe && viewer.role !== "coach") return null;
  return <Link className="btn ghost small" href={isMe ? "/profile" : `/profile?id=${m.id}`}>{isMe ? "Edit my profile" : "Edit profile"}</Link>;
}

function CoachTools({ m, viewer, names }: { m: Profile; viewer: Profile; names?: TeamNames }) {
  return (
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
        <EditLink m={m} viewer={viewer} />
      </div>
    </div>
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

/** A member's commitments for the week, each ticked off on its own, plus a way to add up to three. */
function Commitments({ m, viewer, checked = [] }: { m: Profile; viewer: Profile; checked?: string[] }) {
  const items = commitmentList(m.accountability);
  const isMe = m.id === viewer.id;
  const canEdit = isMe || viewer.role === "coach";
  const weekDone = m.done_week === weekKey(new Date(), TZ);
  const ticked = items.filter((t) => weekDone || checked.includes(t)).length;
  return (
    <div className="acct">
      <span className="label">Held accountable to{items.length > 1 ? ` · ${items.length} commitments` : ""}</span>
      {items.length ? (
        <ul className="commits">
          {items.map((t, i) => {
            const on = weekDone || checked.includes(t);
            return (
              <li key={i} className={on ? "on" : ""}>
                {canEdit ? (
                  <form action={toggleCommitment.bind(null, m.id, i)}>
                    <button className="tick" type="submit" aria-pressed={on} aria-label={on ? `Not done yet: ${t}` : `Done: ${t}`} title={on ? "Tap to undo" : "Tap when it's done"} />
                  </form>
                ) : <span className="tick" role="img" aria-label={on ? "Done" : "Not done yet"} />}
                <span className="commit-text">{t}</span>
              </li>
            );
          })}
        </ul>
      ) : <p className="empty">Not shared yet</p>}
      {isMe && items.some(isVagueCommitment) && (
        <p className="acct-tip">Tip: make each one something you can check off by the next meeting, like &ldquo;Work out 4 mornings.&rdquo; <Link href="/profile">Edit</Link></p>
      )}
      <div className="commit-foot">
        {items.length > 0 && (weekDone ? <span className="pill done">Done this week</span>
          : <span className="pill warn">{ticked ? `${ticked} of ${items.length} done` : "Not marked done yet"}</span>)}
        {canEdit && items.length > 0 && items.length < MAX_COMMITMENTS && (
          <details className="add-commit">
            <summary>+ Add a commitment</summary>
            <form className="inline-form" action={addCommitment.bind(null, m.id)}>
              <input className="input" name="commitment" maxLength={200} required aria-label="Another commitment" placeholder="e.g. Read 20 pages a night" />
              <button className="btn small" type="submit">Add</button>
            </form>
          </details>
        )}
        {canEdit && !items.length && <Link className="btn small" href={isMe ? "/profile" : `/profile?id=${m.id}`}>Set a commitment</Link>}
      </div>
    </div>
  );
}

export function MemberCard({ m, viewer, names, p, social, avatars, checked, notes }: {
  m: Profile; viewer: Profile; names?: TeamNames; p?: Progress; social?: Social | null; avatars?: Record<string, string>; checked?: string[];
  notes?: CoachNote[];
}) {
  const kudos = social?.kudos[m.id] ?? [];
  return (
    <article className="card">
      <Who m={m} viewer={viewer} coachTools names={names} />
      <div className="wheelrow">
        <WheelSvg wheel={m.wheel as Wheel} label={`${m.name}'s life wheel`} />
        <Legend wheel={m.wheel as Wheel} />
      </div>
      <Field label="Actively creating" value={m.creating} className="creating" />
      <Commitments m={m} viewer={viewer} checked={checked} />
      {social && <Milestones m={m} viewer={viewer} p={p} items={social.milestones[m.id] ?? []} kudos={kudos.length} />}
      {social && <Thread m={m} viewer={viewer} comments={social.comments[m.id] ?? []} kudos={kudos} avatars={avatars ?? {}} fresh={social.fresh?.memberId === m.id ? social.fresh : undefined} />}
      {notes && viewer.role === "coach" && <CoachNotes m={m} notes={notes} />}
    </article>
  );
}

export function AcctCard({ m, viewer, p, checked }: { m: Profile; viewer: Profile; p?: Progress; checked?: string[] }) {
  return (
    <article className="card">
      <Who m={m} viewer={viewer} />
      <Commitments m={m} viewer={viewer} checked={checked} />
      {p && <MiniProgress p={p} team={m.team} />}
      <div className="row">
        {m.reminder_enabled ? <span className="pill on">Weekly email · {m.reminder_day}</span> : <span className="pill">No reminder</span>}
      </div>
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
export function TeamViews({ tab, groups, viewer, ownTeam, logs, names, checkins, social, checked, notes }: {
  tab: Tab; groups: { team: Team | null; members: Profile[] }[]; viewer: Profile; ownTeam?: boolean; logs?: Record<string, Progress>; names?: TeamNames;
  checkins?: Partial<Record<Team, Checkin>>; social?: Social | null; checked?: Record<string, string[]>;
  /** The coach's private notes by member id. Only the coach page passes these. */
  notes?: Record<string, CoachNote[]> | null;
}) {
  const multi = groups.length > 1;
  const avatars = Object.fromEntries(groups.flatMap((g) => g.members).filter((m) => m.avatar_url).map((m) => [m.id, m.avatar_url]));
  if (viewer.avatar_url) avatars[viewer.id] = viewer.avatar_url;
  return (
    <>
      {groups.map(({ team, members }) => {
        const key = team ?? "none";
        let body: React.ReactNode;
        if (tab === "team") {
          body = members.length ? (
            <>
              {team && checkins?.[team] && <MeetingCheckin team={team} label={teamLabel(team, names)} members={members} viewer={viewer} c={checkins[team]} />}
              {team && <TeamWheel team={team} members={members} ownTeam={ownTeam} names={names} />}
              <div className="grid">{members.map((m) => <MemberCard key={m.id} m={m} viewer={viewer} names={names} p={logs?.[m.id]} social={social} avatars={avatars} checked={checked?.[m.id]} notes={notes ? notes[m.id] ?? [] : undefined} />)}</div>
            </>
          ) : <EmptyTeam label={teamLabel(team, names)} coach={viewer.role === "coach"} />;
        } else if (tab === "accountability") {
          const list = members.filter((m) => m.accountability);
          body = list.length ? <div className="grid">{list.map((m) => <AcctCard key={m.id} m={m} viewer={viewer} p={logs?.[m.id]} checked={checked?.[m.id]} />)}</div>
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
