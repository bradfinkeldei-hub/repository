import { addNote, deleteNote, editNote } from "@/app/actions";
import { EditFold } from "@/components/client";
import { firstName, type Profile } from "@/lib/coaching";
import type { CoachNote } from "@/lib/social";

const TZ = process.env.REMINDER_TIMEZONE;

function when(iso: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: TZ }).format(new Date(iso));
}

/** The coach's private notes on a member, newest first, folded away until tapped open. Never shown to members. */
export function CoachNotes({ m, notes }: { m: Profile; notes: CoachNote[] }) {
  return (
    <details className="fold notes" id={`notes-${m.id}`}>
      <summary aria-label={`Your private notes on ${m.name}`}>
        <h4>Private notes</h4>
        <span className="fold-counts">
          <span className="lock-tag">Only you</span>
          <span><span aria-hidden="true">{"\u{1F4DD}"}</span> {notes.length}<span className="sr"> {notes.length === 1 ? "note" : "notes"}</span></span>
        </span>
        <span className="chev" aria-hidden="true" />
      </summary>
      <div className="fold-body">
        <form className="inline-form comment-form" action={addNote.bind(null, m.id)}>
          <textarea className="input" name="body" rows={2} maxLength={2000} required aria-label={`New note on ${m.name}`}
            placeholder={`Something to remember about ${firstName(m.name)}`} />
          <button className="btn small" type="submit">Save</button>
        </form>
        {notes.length > 0 ? (
          <ul className="note-list">
            {notes.map((n) => (
              <li key={n.id}>
                <div>
                  <time dateTime={n.created_at}>{when(n.created_at)}</time>
                  {n.edited_at && <span className="edited" title={`Edited ${when(n.edited_at)}`}> · edited</span>}
                  <p>{n.body}</p>
                  <EditFold title="Edit note">
                    <form className="edit-form" action={editNote.bind(null, n.id)}>
                      <textarea className="input" name="body" rows={3} maxLength={2000} required defaultValue={n.body} aria-label="Edit note" />
                      <button className="btn small" type="submit">Save</button>
                    </form>
                  </EditFold>
                </div>
                <form action={deleteNote.bind(null, n.id)}>
                  <button className="xbtn" type="submit" aria-label="Delete note" title="Delete">×</button>
                </form>
              </li>
            ))}
          </ul>
        ) : <p className="quiet">No notes yet. {firstName(m.name)} and the team never see these.</p>}
      </div>
    </details>
  );
}
