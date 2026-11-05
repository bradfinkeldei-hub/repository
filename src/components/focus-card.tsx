import Link from "next/link";
import { Fragment } from "react";
import { Commitments, Who } from "@/components/cards";
import { CardTabs } from "@/components/card-tabs";
import { Thread } from "@/components/thread";
import { CoachNotes } from "@/components/notes";
import { dateKey, firstName, meetingDate, shortDate, sprintOf, TRACK_CHOICES, weekKey, type Profile, type Progress, type TeamNames } from "@/lib/coaching";
import { addProudMoment, deleteProudMoment, setTrackWeeks } from "@/app/actions";
import { focusProgress, isShared, MEASURE_KINDS, progressLabel, type Focus } from "@/lib/focus";
import type { CoachNote, ProudMoment, Social } from "@/lib/social";

/** The Pilot group's Team tab: everyone's Focus card, your own first. */
export function FocusBoard({ members, focus, viewer, names, social, avatars, checked, notes, logs, proud }: {
  members: Profile[]; focus: Record<string, Focus>; viewer: Profile; names?: TeamNames; social?: Social | null; logs?: Record<string, Progress>;
  proud?: Record<string, ProudMoment[]> | null;
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
              checked={checked?.[m.id]} notes={notes ? notes[m.id] ?? [] : undefined} p={logs?.[m.id]} proud={proud ? proud[m.id] ?? [] : undefined} />
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

export function FocusCard({ m, f, viewer, names, social, avatars, checked, notes, practice, p, proud }: {
  m: Profile; f?: Focus; viewer: Profile; names?: TeamNames; social?: Social | null; avatars: Record<string, string>;
  checked?: string[]; notes?: CoachNote[]; p?: Progress;
  /** Their proud moments. Undefined hides the tab (e.g. before the table exists). */
  proud?: ProudMoment[];
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
        <CardTabs tabs={[{ key: "focus", label: "Focus", dot: !done && (isMe || coach) }, { key: "mission", label: "Mission", dot: !m.mission && (isMe || coach) }, { key: "progress", label: "Accountability tracker", dot: done && !f?.track_weeks && (isMe || coach) },
          ...(proud ? [{ key: "proud", label: "Proud moments" }] : [])]}>
          {[<Fragment key="focus">{focusPanel}</Fragment>,
            <MissionPanel key="mission" m={m} viewer={viewer} />,
            <ProgressPanel key="progress" m={m} viewer={viewer} checked={checked} p={p} startedAt={f?.confirmed_at ?? null} trackWeeks={f?.track_weeks ?? null} hasCard={done} />,
            ...(proud ? [<ProudPanel key="proud" m={m} viewer={viewer} moments={proud} />] : [])]}
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

/** The Accountability tracker tab: tick off this week's commitment, and see the weeks they chose, week by week. */
function ProgressPanel({ m, viewer, checked, p, startedAt, trackWeeks, hasCard }: {
  m: Profile; viewer: Profile; checked?: string[]; p?: Progress; startedAt: string | null; trackWeeks: number | null; hasCard: boolean;
}) {
  const isMe = m.id === viewer.id;
  const canEdit = isMe || viewer.role === "coach";
  const now = weekKey(new Date(), TZ);
  // The weeks start the week their card was built (or their first tracked week).
  const start = startedAt ? weekKey(new Date(startedAt), TZ) : p?.weeks[0]?.week ?? now;
  const s = trackWeeks ? sprintOf(start, now, p, m.team, trackWeeks) : null;
  return (
    <div className="focus-progress">
      <p className="muted">{isMe ? "Did you do what you said this week? Tap the box when it's done." : `What ${firstName(m.name)} said they'd do this week.`}</p>
      <Commitments m={m} viewer={viewer} checked={checked} />
      {hasCard && !s && (canEdit ? (
        <div className="track-pick">
          <span className="label">{isMe ? "How long do you want to be held accountable?" : `How long does ${firstName(m.name)} want to be held accountable?`}</span>
          <p className="muted small-note">Pick a number of weeks. {isMe ? "Your" : "Their"} tracker is built around it, starting the week of {shortDate(meetingDate(start, m.team))}.</p>
          <TrackChoices m={m} />
        </div>
      ) : <p className="muted small-note">{firstName(m.name)} hasn&apos;t picked how many weeks to track yet.</p>)}
      {s && (
        <div className="sprint">
          <div className="sprint-head">
            <span className="label">Weeks Progress · Week {s.weekNo} of {s.length}{s.number > 1 ? ` (round ${s.number})` : ""}</span>
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
          <p className="muted small-note">{s.length} weeks, starting the week of {shortDate(meetingDate(start, m.team))}. After week {s.length}, the next {s.length} weeks begin.</p>
          {canEdit && (
            <details className="track-change">
              <summary>Change how many weeks</summary>
              <TrackChoices m={m} current={s.length} />
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function TrackChoices({ m, current }: { m: Profile; current?: number }) {
  return (
    <div className="track-choices">
      {TRACK_CHOICES.map((n) => (
        <form key={n} action={setTrackWeeks.bind(null, m.id, n)}>
          <button type="submit" className={n === current ? "on" : ""} aria-pressed={n === current}>{n} weeks</button>
        </form>
      ))}
    </div>
  );
}

/** The Proud moments tab: things they're proud of, big or small, to look back on and build confidence. */
function ProudPanel({ m, viewer, moments }: { m: Profile; viewer: Profile; moments: ProudMoment[] }) {
  const isMe = m.id === viewer.id;
  const coach = viewer.role === "coach";
  const canEdit = isMe || coach;
  const coachName = process.env.COACH_NAME || "your coach";
  return (
    <div className="proud">
      <p className="muted">{isMe ? "Write down the moments you're proud of, big or small. Looking back at them builds your confidence." : `Moments ${firstName(m.name)} is proud of.`}</p>
      {canEdit && (
        <form className="proud-form" action={addProudMoment.bind(null, m.id)}>
          <textarea className="input" name="body" rows={2} maxLength={600} required aria-label="A moment you're proud of"
            placeholder={isMe ? "e.g. I spoke up in the meeting even though I was nervous" : `A moment ${firstName(m.name)} is proud of`} />
          <div className="proud-row">
            <label className="proud-date">When <input className="input" type="date" name="happened_on" defaultValue={dateKey(new Date(), TZ)} max={dateKey(new Date(), TZ)} /></label>
            <label className="proud-private"><input type="checkbox" name="private" /> Just for {isMe ? "me" : firstName(m.name)} and {coach ? "you" : coachName}</label>
          </div>
          <button className="btn small" type="submit">Add proud moment</button>
        </form>
      )}
      {moments.length ? (
        <ul className="proud-list">
          {moments.map((pm) => (
            <li key={pm.id}>
              <span className="proud-star" aria-hidden="true">{"\u2605"}</span>
              <div>
                <p>{pm.body}</p>
                <small className="muted">{shortDate(new Date(`${pm.happened_on}T00:00:00Z`))}{pm.private ? " · Private" : ""}</small>
              </div>
              {canEdit && (
                <form action={deleteProudMoment.bind(null, pm.id)}>
                  <button type="submit" className="proud-del" aria-label="Remove this proud moment" title="Remove">×</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="muted small-note">{isMe ? "Your first one can be small. What went well this week?" : "None shared yet."}</p>}
    </div>
  );
}
