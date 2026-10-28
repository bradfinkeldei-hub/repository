import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/session";
import { coachTabs, Header, MEMBER_TABS } from "@/components/header";
import { ProgressStats, StripKey, WeekStrip } from "@/components/progress";
import { setWeekDone, toggleDone } from "@/app/actions";
import { firstName, meetingDate, progress, shortDate, teamLabel, weekKey, type LogRow, type Profile } from "@/lib/coaching";

const TZ = process.env.REMINDER_TIMEZONE;

/** The accountability tracker: what someone committed to at each meeting, and whether they followed through. */
export default async function ProgressPage({ searchParams: sp }: { searchParams: Promise<{ id?: string }> }) {
  const searchParams = await sp;
  const { supabase, me } = await requireProfile();
  const isCoach = me.role === "coach";
  let m: Profile = me;
  if (searchParams.id && searchParams.id !== me.id) {
    if (!isCoach) redirect("/progress");
    const { data } = await supabase.from("profiles").select("*").eq("id", searchParams.id).single();
    if (!data) redirect("/coach?tab=progress");
    m = data as Profile;
  } else if (isCoach) {
    redirect("/coach?team=all&tab=progress");
  }
  const own = m.id === me.id;
  const name = own ? "you" : firstName(m.name);
  const current = weekKey(new Date(), TZ);
  const { data } = await supabase.from("commitment_log").select("member_id, week, commitment, done").eq("member_id", m.id);
  const p = progress((data ?? []) as LogRow[], current);
  const doneNow = m.done_week === current;

  return (
    <>
      {isCoach
        ? <Header me={me} sub="Coach view" tabs={coachTabs(m.team ?? "none")} current="progress" />
        : <Header me={me} sub={teamLabel(me.team)} tabs={MEMBER_TABS} current="progress" />}
      <div className="wrap layout"><main>
        {!own && <Link href={`/coach?team=${m.team ?? "none"}&tab=progress`} className="linkbtn">← Back to {teamLabel(m.team)}</Link>}
        <div className="intro"><div>
          <h1>{own ? "My progress" : `${m.name}'s progress`}</h1>
          <p>What {name} committed to at each meeting, and whether {own ? "you" : "they"} followed through. {own ? "Your team sees your streak on the Accountability tab." : ""}</p>
        </div></div>

        <section className="card thisweek">
          <span className="label">This week · {teamLabel(m.team)} meets {shortDate(meetingDate(current, m.team))}</span>
          {m.accountability
            ? <blockquote>{m.accountability}</blockquote>
            : <p className="muted" style={{ margin: 0 }}>{own ? "You haven't set a commitment yet." : `${firstName(m.name)} hasn't set a commitment yet.`}</p>}
          <div className="row">
            {m.accountability && (
              <form action={toggleDone.bind(null, m.id)}>
                <button className={`btn${doneNow ? " ghost" : ""}`} type="submit">{doneNow ? "Undo: not done yet" : own ? "I followed through this week" : "Mark this week done"}</button>
              </form>
            )}
            {doneNow && <span className="pill done">Done this week</span>}
            <Link className="btn ghost" href={own ? "/profile" : `/profile?id=${m.id}`}>{m.accountability ? "Change commitment" : "Set a commitment"}</Link>
          </div>
        </section>

        {p.weeks.length > 0 ? (
          <>
            <ProgressStats p={p} />
            <section className="card">
              <h2 style={{ margin: 0, fontFamily: "var(--display)", fontWeight: 400, fontSize: "1.35rem" }}>Meeting by meeting</h2>
              <WeekStrip p={p} team={m.team} last={16} />
              <StripKey />
            </section>
            <section className="team-block">
              <h2>Every commitment</h2>
              <ol className="timeline">
                {[...p.weeks].reverse().map((w) => (
                  <li key={w.week} className={`tl ${w.status}`}>
                    <div className="when">{shortDate(meetingDate(w.week, m.team))}<small>{w.week === current ? "This week" : w.status === "done" ? "Done" : "Not done"}</small></div>
                    <p className={w.commitment ? "" : "muted"}>{w.commitment || "No commitment recorded"}</p>
                    <div className="end">
                      {w.status === "done" ? <span className="pill done">Followed through</span>
                        : w.status === "missed" ? <span className="pill warn">Not marked done</span>
                        : <span className="pill on">Open</span>}
                      {w.week !== current && (
                        <form action={setWeekDone.bind(null, m.id, w.week, w.status !== "done")}>
                          <button className="linkbtn" style={{ fontSize: "0.85rem" }} type="submit">{w.status === "done" ? "Undo" : "Mark done"}</button>
                        </form>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </>
        ) : (
          <div className="empty">
            <h3>{own ? "Your tracker starts with your first commitment" : "No weeks tracked yet"}</h3>
            <p>{own ? "Set a commitment, then come back after each meeting and mark it done when you've followed through. Each week adds a square here." : "Once they set a commitment, each meeting adds a square here."}</p>
          </div>
        )}
      </main></div>
    </>
  );
}
