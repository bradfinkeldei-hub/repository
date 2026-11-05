import Link from "next/link";
import { Commitments, Who } from "@/components/cards";
import { CardTabs } from "@/components/card-tabs";
import { Thread } from "@/components/thread";
import { CoachNotes } from "@/components/notes";
import { firstName, shortDate, sprintOf, weekKey, type Profile, type Progress, type TeamNames } from "@/lib/coaching";
import { focusProgress, isShared, MEASURE_KINDS, progressLabel, type Focus } from "@/lib/focus";
import type { CoachNote, Social } from "@/lib/social";

/** The Pilot group's Team tab: everyone's Focus card, your own first. */
export function FocusBoard({ members, focus, viewer, names, social, avatars, checked, notes, logs }: {
  members: Profile[]; focus: Record<string, Focus>; viewer: Profile; names?: TeamNames; social?: Social | null; logs?: Record<string, Progress>;
  avatars: Record<string, string>; checked?: Record<string, string[]>; notes?: Record<string, CoachNote[]> | null;
}) {
  const coach = viewer.role === "coach";
  return (
    <>
      {coach && (
        <div className="notice focus-try">
          <span><b>This is the Group board.</b> Members of this group answer seven questions on their first sign-in, and their answers build the card below. Try it yourself first: nothing you enter shows on the board.</span>
          <Link className="btn small" href="/focus?practice=1">Try the questions</Link>
        </div>
      )}
      {members.length ? (
        <div className="grid">
          {members.map((m) => (
            <FocusCard key={m.id} m={m} f={focus[m.id]} viewer={viewer} names={names} social={social} avatars={avatars}
              checked={checked?.[m.id]} notes={notes ? notes[m.id] ?? [] : undefined} p={logs?.[m.id]} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <h3>No one in this group yet</h3>
          <p>{coach ? "Invite people to this group, or move someone here with the group menu on their card. They'll get the questions when they sign in." : "Your group shows up here as people join."}</p>
        </div>
      )}
    </>
  );
}

export function FocusCard({ m, f, viewer, names, social, avatars, checked, notes, practice, p }: {
  m: Profile; f?: Focus; viewer: Profile; names?: TeamNames; social?: Social | null; avatars: Record<string, string>;
  checked?: string[]; notes?: CoachNote[]; p?: Progress;
  /** The coach's practice card: no weekly commitments. */
  practice?: boolean;
}) {
  const isMe = m.id === viewer.id;
  const coach = viewer.role === "coach";
  const done = !!f?.confirmed_at;
  const pct = f && done ? focusProgress(f) : null;
  const kind = MEASURE_KINDS.find(([k]) => k === f?.measure_kind)?.[1];
  const kudos = social?.kudos[m.id] ?? [];
  const focusPanel = (
    <>
      {!done ? (
        <div className="focus-pending">
          <p>{isMe ? "You haven't finished your questions yet." : `${firstName(m.name)} hasn't finished their questions yet.`}</p>
          {isMe && <Link className="btn small" href="/focus">Finish my questions</Link>}
          {coach && !isMe && <Link className="btn ghost small" href={`/focus?id=${m.id}`}>Fill in their answers</Link>}
        </div>
      ) : (
        <>
          <div className="focus-topic">
            <span className="label">Focus</span>
            <p>{isShared(f.focus) ? <Private /> : f.focus}</p>
          </div>
          <dl className="focus-rows">
            <div className="fr creating"><dt>Creating</dt><dd>{isShared(f.outcome) ? <Private /> : f.outcome}</dd></div>
            <div className="fr know">
              <dt>I&apos;ll know when</dt>
              <dd>
                {isShared(f.measure) ? <Private /> : f.measure}
                {pct !== null && (
                  <span className="focus-meter">
                    <span className="meter" role="img" aria-label={`${pct}% of the way there`}><i style={{ width: `${pct}%` }} /></span>
                    <span>{progressLabel(f)}{kind ? ` · ${kind}` : ""}</span>
                  </span>
                )}
              </dd>
            </div>
            <div className="fr why"><dt>Why it matters</dt><dd>{isShared(f.meaning) ? <Private /> : f.meaning}</dd></div>
            <div className="fr start"><dt>Starting with</dt><dd>{isShared(f.start_point) ? <Private /> : f.start_point}</dd></div>
            <div className="fr held"><dt>Accountable by</dt><dd>{isShared(f.held_by) ? <Private /> : f.held_by}</dd></div>
          </dl>
          {f.later.length > 0 && (
            <details className="fold later-list">
              <summary><h4>Also on my list</h4><span className="pill">{f.later.length}</span></summary>
              <ul>{f.later.map((t) => <li key={t}>{t}</li>)}</ul>
            </details>
          )}
          {coach && !isMe && <Link className="edit-focus" href={`/focus?id=${m.id}`}>Edit {firstName(m.name)}&apos;s answers</Link>}
        </>
      )}
    </>
  );
  return (
    <article className="card focus-card" id={`member-${m.id}`} style={{ "--tint": memberTint(m.id) } as React.CSSProperties}>
      <Who m={m} viewer={viewer} coachTools names={names} />
      {practice ? focusPanel : (
        <CardTabs tabs={[{ key: "focus", label: "Focus", dot: !done && (isMe || coach) }, { key: "mission", label: "Mission", dot: !m.mission && (isMe || coach) }, { key: "progress", label: "Progress" }]}>
          {focusPanel}
          <MissionPanel m={m} viewer={viewer} />
          <ProgressPanel m={m} viewer={viewer} checked={checked} p={p} startedAt={f?.confirmed_at ?? null} />
        </CardTabs>
      )}
      {social && <Thread m={m} viewer={viewer} comments={social.comments[m.id] ?? []} kudos={kudos} avatars={avatars} fresh={social.fresh?.memberId === m.id ? social.fresh : undefined} />}
      {notes && coach && <CoachNotes m={m} notes={notes} />}
    </article>
  );
}

/** Each member's own shade, the same on every screen: one of eight earthy colors, picked from their id. */
function memberTint(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `var(--e${(h % 8) + 1})`;
}

function Private() {
  return <span className="shared-later">Will share in the group</span>;
}

/** The Mission tab. A blank mission on your own card walks you through writing it. */
function MissionPanel({ m, viewer }: { m: Profile; viewer: Profile }) {
  const isMe = m.id === viewer.id;
  const coach = viewer.role === "coach";
  if (!m.mission?.trim()) {
    return (
      <div className="focus-pending">
        <p>{isMe ? "You haven't written your mission yet. A few short questions will help you put it into one sentence." : `${firstName(m.name)} hasn't written their mission yet.`}</p>
        {isMe && <Link className="btn small" href="/mission">Write my mission</Link>}
        {coach && !isMe && <Link className="btn ghost small" href={`/mission?id=${m.id}`}>Write it with them</Link>}
      </div>
    );
  }
  return (
    <div className="focus-mission">
      <span className="label">My mission</span>
      <blockquote>{isShared(m.mission) ? <Private /> : m.mission}</blockquote>
      {(isMe || coach) && <Link className="edit-focus" href={isMe ? "/mission" : `/mission?id=${m.id}`}>{isMe ? "Change my mission" : `Edit ${firstName(m.name)}'s mission`}</Link>}
    </div>
  );
}

const TZ = process.env.REMINDER_TIMEZONE;
const CELL: Record<string, string> = { done: "Done", missed: "Not marked done", open: "This week", ahead: "Coming up" };

/** The Progress tab: tick off this week's commitment, and see the 12 weeks ahead, week by week. */
function ProgressPanel({ m, viewer, checked, p, startedAt }: { m: Profile; viewer: Profile; checked?: string[]; p?: Progress; startedAt: string | null }) {
  const isMe = m.id === viewer.id;
  const now = weekKey(new Date(), TZ);
  // The sprint starts the week their card was built (or their first tracked week).
  const start = startedAt ? weekKey(new Date(startedAt), TZ) : p?.weeks[0]?.week ?? now;
  const s = sprintOf(start, now, p, m.team);
  return (
    <div className="focus-progress">
      <p className="muted">{isMe ? "Did you do what you said this week? Tap the box when it's done." : `What ${firstName(m.name)} said they'd do this week.`}</p>
      <Commitments m={m} viewer={viewer} checked={checked} />
      <div className="sprint">
        <div className="sprint-head">
          <span className="label">Weeks ahead · Week {s.weekNo} of 12{s.number > 1 ? ` (round ${s.number})` : ""}</span>
          <span className="sprint-count">{s.done} done</span>
        </div>
        <ol className="sprint-grid">
          {s.cells.map((c) => (
            <li key={c.week} className={c.status} title={`Week ${c.n}, ${shortDate(c.date)}: ${CELL[c.status]}`}>
              <b>{c.status === "done" ? "\u2713" : c.n}</b>
              <small>{shortDate(c.date)}</small>
              <span className="sr">Week {c.n}, {shortDate(c.date)}: {CELL[c.status]}</span>
            </li>
          ))}
        </ol>
        <p className="muted small-note">Started the week of {shortDate(s.cells[0].date)}. After week 12, the next 12 weeks begin.</p>
      </div>
    </div>
  );
}
