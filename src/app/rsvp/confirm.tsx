import { redirect } from "next/navigation";
import { meetingWhen } from "@/lib/coaching";
import { answerFromEmail } from "./actions";
import { linkProblem } from "./check";

const TZ = process.env.REMINDER_TIMEZONE;

/**
 * Where the email's I'm in / I'm out links open. Nothing saves until the
 * button is tapped: email security filters open every link to scan it, and a
 * scan must not answer for anyone.
 */
export async function ConfirmRsvp({ m, d, a, k }: { m: string; d: string; a?: string; k: string }) {
  m = m.toLowerCase();
  const problem = await linkProblem(m, d, k);
  if (problem) redirect(`/rsvp/thanks?error=${problem}`);
  const going = a?.toLowerCase() !== "out";
  const when = meetingWhen(d, new Date(), TZ);
  const hidden = <><input type="hidden" name="m" value={m} /><input type="hidden" name="d" value={d} /><input type="hidden" name="k" value={k} /></>;
  return (
    <div className="wrap" style={{ maxWidth: 520, paddingTop: 64 }}>
      <div className="card" style={{ textAlign: "center", alignItems: "center" }}>
        <h1 style={{ margin: 0, fontFamily: "var(--display)" }}>Will you be there {when}?</h1>
        <form action={answerFromEmail} style={{ width: "100%" }}>
          {hidden}
          <input type="hidden" name="a" value={going ? "in" : "out"} />
          <button className={`btn rsvp ${going ? "in" : "out"} picked`} type="submit" style={{ width: "100%", minHeight: 56, fontSize: "1.1rem" }}>
            {going ? "✓ Yes, I'm in" : "✕ I'm out this time"}
          </button>
        </form>
        <form action={answerFromEmail}>
          {hidden}
          <input type="hidden" name="a" value={going ? "out" : "in"} />
          <button className="linkbtn" type="submit">{going ? "Actually, I can't make it" : "Actually, I'll be there"}</button>
        </form>
      </div>
    </div>
  );
}
