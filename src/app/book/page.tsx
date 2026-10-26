import Link from "next/link";
import { requireProfile } from "@/lib/session";
import { bookCall } from "@/app/actions";
import { monthKey, monthName } from "@/lib/coaching";

const TZ = process.env.REMINDER_TIMEZONE;

export default async function BookPage({ searchParams: sp }: { searchParams: Promise<{ error?: string }> }) {
  const searchParams = await sp;
  const { supabase, me } = await requireProfile();
  const coach = process.env.COACH_NAME || "your coach";
  const now = new Date();
  const { count } = await supabase.from("bookings").select("id", { count: "exact", head: true })
    .eq("member_id", me.id).eq("month", monthKey(now, TZ)).eq("kind", "free");
  const freeLeft = !count;
  const month = monthName(now, TZ);
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return (
    <div className="wrap" style={{ paddingBlock: "32px 64px", display: "flex", flexDirection: "column", gap: 20 }}>
      <Link href={me.role === "coach" ? "/coach" : "/team"} className="linkbtn">← Back to my team</Link>
      <div className="intro"><div>
        <h1>Book a call with {coach}</h1>
        <p>Every member gets one free one-on-one call each month. Extra sessions are $150.</p>
      </div></div>
      {searchParams.error === "used" && <div className="notice">You&apos;ve already used your free call for {month}. You can book an extra session below.</div>}
      {searchParams.error === "nolink" && <div className="notice">Booking isn&apos;t set up yet. Please contact {coach} directly.</div>}
      <div className="book">
        {freeLeft ? (
          <section className="card">
            <span className="label">Free call available</span>
            <h2>Your free {month} call is ready</h2>
            <p style={{ margin: 0 }}>Pick a time that works for you, one-on-one with {coach}, to get unstuck on what you&apos;re creating.</p>
            <form action={bookCall.bind(null, "free")}><button className="btn" type="submit" style={{ minHeight: 48 }}>Choose a time</button></form>
            <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>Choosing a time uses your free call for {month}.</p>
          </section>
        ) : (
          <section className="card">
            <span className="label">Free call used</span>
            <h2>Want another session this month?</h2>
            <p style={{ margin: 0 }}>You&apos;ve used your free call for {month}. Your next free call unlocks {monthName(next, TZ)} 1.</p>
            <div className="price"><span>Extra session</span><b>$150</b></div>
            <form action={bookCall.bind(null, "paid")}><button className="btn sun" type="submit" style={{ minHeight: 48 }}>Book and pay $150</button></form>
          </section>
        )}
      </div>
    </div>
  );
}
