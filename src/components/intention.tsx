import { saveIntention } from "@/app/actions";
import type { Team } from "@/lib/coaching";

/** "The intention of this group is:" at the top of a team's Team tab. The coach writes it; members read it. */
export function Intention({ team, text, coach }: { team: Team; text: string; coach: boolean }) {
  const form = (
    <form className="intention-form" action={saveIntention.bind(null, team)}>
      <label htmlFor={`intention-${team}-text`} style={{ position: "absolute", left: -9999 }}>The intention of this group</label>
      <textarea id={`intention-${team}-text`} name="body" rows={3} maxLength={500} defaultValue={text}
        placeholder="e.g. To show up for each other and become who we said we'd be." />
      <div className="row"><button className="btn small" type="submit">Save</button>{text && <span className="muted" style={{ fontSize: "0.85rem" }}>Clear the box and save to remove it.</span>}</div>
    </form>
  );
  return (
    <section className="card intention" id={`intention-${team}`}>
      <h2>The intention of this group is:</h2>
      {text ? <p className="intention-text">{text}</p> : !coach && <p className="muted intention-empty">Coming soon.</p>}
      {coach && (text ? <details><summary className="linkbtn">Edit</summary>{form}</details> : form)}
    </section>
  );
}
