import Link from "next/link";
import { meetingWhen } from "@/lib/coaching";

const TZ = process.env.REMINDER_TIMEZONE;
const ERRORS: Record<string, string> = {
  link: "That link didn't work. Open the app to answer instead.",
  past: "That meeting has already happened.",
  save: "Your answer didn't save. Try the link again, or answer in the app.",
};

/** Where the email's In and Out links land. Public, since the link itself proves who it's for. */
export default async function RsvpThanks({ searchParams }: { searchParams: Promise<{ a?: string; d?: string; error?: string }> }) {
  const { a, d, error } = await searchParams;
  const when = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? meetingWhen(d, new Date(), TZ) : "";
  return (
    <div className="wrap" style={{ maxWidth: 520, paddingTop: 64 }}>
      <div className="card" style={{ textAlign: "center", alignItems: "center" }}>
        {error ? (
          <><h1 style={{ margin: 0, fontFamily: "var(--display)" }}>Hmm.</h1><p>{ERRORS[error] ?? ERRORS.link}</p></>
        ) : (
          <>
            <div className={`rsvp-big ${a === "in" ? "in" : "out"}`} aria-hidden="true">{a === "in" ? "✓" : "✕"}</div>
            <h1 style={{ margin: 0, fontFamily: "var(--display)" }}>{a === "in" ? "You're in" : "Got it, you're out"}</h1>
            <p className="muted" style={{ margin: 0 }}>
              {a === "in" ? `See you ${when}.` : `Thanks for letting the team know. We'll miss you ${when}.`} You can change your answer in the app.
            </p>
          </>
        )}
        <Link className="btn" href="/team">See who&apos;s coming</Link>
      </div>
    </div>
  );
}
