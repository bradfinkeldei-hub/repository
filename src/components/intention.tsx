import { saveIntention } from "@/app/actions";
import type { Team } from "@/lib/coaching";

/** "The intention of this group is:" as a slim strip at the top of a team's Team tab. The coach writes it; members read it. */
export function Intention({ team, text, coach }: { team: Team; text: string; coach: boolean }) {
  const form = (
    <form className="intention-form" action={saveIntention.bind(null, team)}>
      <label htmlFor={`intention-${team}-text`} style={{ position: "absolute", left: -9999 }}>The intention of this group</label>
      <input id={`intention-${team}-text`} name="body" maxLength={500} defaultValue={text}
        placeholder="e.g. To show up for each other" />
      <button className="btn small" type="submit">Save</button>
    </form>
  );
  return (
    <section className="intention" id={`intention-${team}`}>
      <span className="intention-label">The intention of this group is:</span>
      {text ? <p className="intention-text">{text}</p> : !coach && <p className="intention-text muted">Coming soon.</p>}
      {coach && (text ? <details><summary className="linkbtn">Edit</summary>{form}</details> : form)}
    </section>
  );
}
