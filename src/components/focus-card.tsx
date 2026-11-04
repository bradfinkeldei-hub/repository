import Link from "next/link";
import { Who } from "@/components/cards";
import { Thread } from "@/components/thread";
import { CoachNotes } from "@/components/notes";
import { firstName, type Profile, type TeamNames } from "@/lib/coaching";
import { focusProgress, MEASURE_KINDS, progressLabel, type Focus } from "@/lib/focus";
import type { CoachNote, Social } from "@/lib/social";

/** The Pilot group's Team tab: everyone's Focus card, your own first. */
export function FocusBoard({ members, focus, viewer, names, social, avatars, checked, notes }: {
  members: Profile[]; focus: Record<string, Focus>; viewer: Profile; names?: TeamNames; social?: Social | null;
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
              checked={checked?.[m.id]} notes={notes ? notes[m.id] ?? [] : undefined} />
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

export function FocusCard({ m, f, viewer, names, social, avatars, checked, notes, practice }: {
  m: Profile; f?: Focus; viewer: Profile; names?: TeamNames; social?: Social | null; avatars: Record<string, string>;
  checked?: string[]; notes?: CoachNote[];
  /** The coach's practice card: no weekly commitments. */
  practice?: boolean;
}) {
  const isMe = m.id === viewer.id;
  const coach = viewer.role === "coach";
  const done = !!f?.confirmed_at;
  const pct = f && done ? focusProgress(f) : null;
  const kind = MEASURE_KINDS.find(([k]) => k === f?.measure_kind)?.[1];
  const kudos = social?.kudos[m.id] ?? [];
  return (
    <article className="card focus-card" id={`member-${m.id}`} style={{ "--tint": memberTint(m.id) } as React.CSSProperties}>
      <Who m={m} viewer={viewer} coachTools names={names} />
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
            <p>{f.focus}</p>
          </div>
          <dl className="focus-rows">
            <div className="fr creating"><dt>Creating</dt><dd>{f.outcome}</dd></div>
            <div className="fr know">
              <dt>I&apos;ll know when</dt>
              <dd>
                {f.measure}
                {pct !== null && (
                  <span className="focus-meter">
                    <span className="meter" role="img" aria-label={`${pct}% of the way there`}><i style={{ width: `${pct}%` }} /></span>
                    <span>{progressLabel(f)}{kind ? ` · ${kind}` : ""}</span>
                  </span>
                )}
              </dd>
            </div>
            <div className="fr why"><dt>Why it matters</dt><dd>{f.meaning}</dd></div>
            <div className="fr start"><dt>Starting with</dt><dd>{f.start_point}</dd></div>
            <div className="fr held"><dt>Accountable by</dt><dd>{f.held_by}</dd></div>
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
      {social && <Thread m={m} viewer={viewer} comments={social.comments[m.id] ?? []} kudos={kudos} avatars={avatars} fresh={social.fresh?.memberId === m.id ? social.fresh : undefined} />}
      {notes && coach && <CoachNotes m={m} notes={notes} />}
    </article>
  );
}

/** Each member's own shade, the same on every screen: one of the app's eight colors, picked from their id. */
function memberTint(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `var(--w${(h % 8) + 1})`;
}
