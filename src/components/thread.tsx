import { addComment, addMilestone, deleteComment, deleteMilestone, markThreadSeen, setThreadOpen, toggleKudos } from "@/app/actions";
import { SeenOnOpen } from "@/components/client";
import { Avatar } from "@/components/avatar";
import { autoMilestones, firstName, weekKey, type Profile, type Progress } from "@/lib/coaching";
import type { CardComment, Kudo, Milestone } from "@/lib/social";

const TZ = process.env.REMINDER_TIMEZONE;

function when(iso: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ }).format(new Date(iso));
}

function day(date: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

function list(names: string[]) {
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** Wins on a member's card, folded away until tapped open: the ones the app works out, then the ones they or the coach added. */
export function Milestones({ m, viewer, p, items, kudos }: { m: Profile; viewer: Profile; p?: Progress; items: Milestone[]; kudos: number }) {
  const { earned, next } = autoMilestones(p, kudos);
  const isMe = m.id === viewer.id;
  const canEdit = isMe || viewer.role === "coach";
  const count = earned.length + items.length;
  return (
    <details className="fold milestones" id={`milestones-${m.id}`}>
      <summary aria-label={`Milestones for ${m.name}`}>
        <h4>Milestones</h4>
        <span className="fold-counts">
          <span><span aria-hidden="true">{"\u{1F3C6}"}</span> {count}<span className="sr"> {count === 1 ? "milestone" : "milestones"}</span></span>
        </span>
        <span className="chev" aria-hidden="true" />
      </summary>
      <div className="fold-body">
      {earned.length > 0 && (
        <ul className="badges">
          {earned.map((e) => <li key={e.key} className="badge"><span aria-hidden="true">{e.icon}</span>{e.label}</li>)}
        </ul>
      )}
      {items.length > 0 && (
        <ul className="wins">
          {items.map((w) => (
            <li key={w.id}>
              <span className="trophy" aria-hidden="true">{"\u{1F3C6}"}</span>
              <div>
                <p>{w.title}</p>
                <small>{day(w.achieved_on)}{w.author_id !== m.id && w.author_name ? ` · added by ${firstName(w.author_name)}` : ""}</small>
              </div>
              {canEdit && (
                <form action={deleteMilestone.bind(null, w.id)}>
                  <button className="xbtn" type="submit" aria-label={`Remove milestone: ${w.title}`} title="Remove">×</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {!earned.length && !items.length && <p className="quiet">No milestones yet.</p>}
      {next && <p className="next-up">Next up: {next}</p>}
      {canEdit && (
        <form className="inline-form" action={addMilestone.bind(null, m.id)}>
          <input className="input" name="title" maxLength={120} required aria-label="New milestone"
            placeholder={isMe ? "Add a win, e.g. Ran my first 5k" : `Add a milestone for ${firstName(m.name)}`} />
          <button className="btn ghost small" type="submit">Add</button>
        </form>
      )}
      </div>
    </details>
  );
}

/**
 * Kudos and comments under a member's card, folded away until tapped open.
 * Teammates post while it's open; the member and the coach always can.
 */
export function Thread({ m, viewer, comments, kudos, avatars, fresh }: {
  m: Profile; viewer: Profile; comments: CardComment[]; kudos: Kudo[]; avatars: Record<string, string>;
  fresh?: { comments: number; kudos: number };
}) {
  const isMe = m.id === viewer.id;
  const isCoach = viewer.role === "coach";
  const open = m.thread_open !== false;
  const first = firstName(m.name);
  const week = weekKey(new Date(), TZ);
  const thisWeek = kudos.filter((k) => k.week === week);
  const gave = thisWeek.some((k) => k.author_id === viewer.id);
  const canPost = open || isMe || isCoach;
  const newCount = (fresh?.comments ?? 0) + (fresh?.kudos ?? 0);
  const fromNames = [...new Set(thisWeek.map((k) => (k.author_id === viewer.id ? "you" : firstName(k.author_name))))];

  return (
    <details className="fold thread" id={`thread-${m.id}`}>
      <summary aria-label={`Kudos and comments for ${m.name}`}>
        <h4>Kudos &amp; comments</h4>
        {newCount > 0 && <span className="new-badge" data-new-for={`thread-${m.id}`}>{newCount} new</span>}
        <span className="fold-counts">
          <span><span aria-hidden="true">{"\u{1F44F}"}</span> {kudos.length}<span className="sr"> kudos</span></span>
          <span><span aria-hidden="true">{"\u{1F4AC}"}</span> {comments.length}<span className="sr"> {comments.length === 1 ? "comment" : "comments"}</span></span>
          {!open && <span className="closed-tag">Closed</span>}
        </span>
        <span className="chev" aria-hidden="true" />
      </summary>
      {isMe && fresh && <SeenOnOpen id={`thread-${m.id}`} unseen={newCount > 0} mark={markThreadSeen} />}
      <div className="fold-body">
      {(isMe || isCoach) && (
        <form action={setThreadOpen.bind(null, m.id, !open)} className="thread-toggle">
          <button className="linkbtn" type="submit">{open ? "Close comments" : "Open comments"}</button>
        </form>
      )}

      <div className="kudos-row">
        {!isMe && (
          <form action={toggleKudos.bind(null, m.id)}>
            <button className={`btn small kudos${gave ? " given" : ""}`} type="submit" aria-pressed={gave}
              title={gave ? "Tap to take it back" : undefined}>
              <span aria-hidden="true">{"\u{1F44F}"}</span> {gave ? "Kudos given" : `Give ${first} kudos`}
            </button>
          </form>
        )}
        <span className="kudos-count">
          {kudos.length ? <><b>{kudos.length}</b> kudos{fromNames.length > 0 && <> · this week from {list(fromNames)}</>}</>
            : isMe ? "Kudos from your team show up here." : "No kudos yet."}
        </span>
      </div>

      {comments.length > 0 && (
        <ul className="comments">
          {comments.map((c) => (
            <li key={c.id}>
              <Avatar name={c.author_name} url={avatars[c.author_id]} size={30} />
              <div className="bubble">
                <div className="by"><b>{c.author_id === viewer.id ? "You" : c.author_name || "Someone"}</b><time dateTime={c.created_at}>{when(c.created_at)}</time></div>
                <p>{c.body}</p>
              </div>
              {(c.author_id === viewer.id || isMe || isCoach) && (
                <form action={deleteComment.bind(null, c.id)}>
                  <button className="xbtn" type="submit" aria-label="Delete comment" title="Delete">×</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {!open && (
        <p className="closed-note">
          {isMe ? "You've closed comments. Teammates can still give kudos, and only you and your coach can post."
            : isCoach ? `${first} closed comments. You can still post as coach.`
            : `${first} has closed comments for now. You can still give kudos.`}
        </p>
      )}
      {canPost && (
        <form className="inline-form comment-form" action={addComment.bind(null, m.id)}>
          <textarea className="input" name="body" rows={2} maxLength={1000} required aria-label={`Comment for ${m.name}`}
            placeholder={isMe ? "Reply to your team" : `Cheer ${first} on…`} />
          <button className="btn small" type="submit">Post</button>
        </form>
      )}
      </div>
    </details>
  );
}
