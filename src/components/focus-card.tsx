import Link from "next/link";
import { Commitments, Who } from "@/components/cards";
import { CardTabs } from "@/components/card-tabs";
import { MiniProgress, StripKey } from "@/components/progress";
import { Thread } from "@/components/thread";
import { CoachNotes } from "@/components/notes";
import { firstName, type Profile, type Progress, type TeamNames } from "@/lib/coaching";
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
          <span><b>This is the test Group board.</b> New members of this group answer seven questions on their first sign-in, and their answers build the card below. Try it yourself first: nothing you enter shows on the board.</span>
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
          <ProgressPanel m={m} viewer={viewer} checked={checked} p={p} />
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

/** The Progress tab: tick off this week's commitment, and see the weeks so far. */
function ProgressPanel({ m, viewer, checked, p }: { m: Profile; viewer: Profile; checked?: string[]; p?: Progress }) {
  const isMe = m.id === viewer.id;
  return (
    <div className="focus-progress">
      <p className="muted">{isMe ? "Did you do what you said this week? Tap the circle when it's done." : `What ${firstName(m.name)} said they'd do this week.`}</p>
      <Commitments m={m} viewer={viewer} checked={checked} />
      {p && p.weeks.length > 0 ? (
        <div className="focus-weeks">
          <span className="label">Week by week</span>
          <MiniProgress p={p} team={m.team} />
          <StripKey />
        </div>
      ) : <p className="muted small-note">Each week you mark it done shows up here as a streak.</p>}
    </div>
  );
}
