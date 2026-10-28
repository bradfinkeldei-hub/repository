import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/session";
import { Header, MEMBER_TABS } from "@/components/header";
import { TeamViews, type Tab } from "@/components/cards";
import { loadCheckins } from "@/lib/checkin";
import { BOOKING_ENABLED, monthKey, monthName, progressByMember, teamLabel, weekKey, type LogRow, type Profile } from "@/lib/coaching";

const TZ = process.env.REMINDER_TIMEZONE;

export default async function TeamPage({ searchParams: sp }: { searchParams: Promise<{ tab?: string; readonly?: string }> }) {
  const searchParams = await sp;
  const { supabase, me, names, viewing } = await requireProfile();
  if (me.role === "coach") redirect("/coach");
  const tab = (["team", "accountability", "missions"].includes(searchParams.tab ?? "") ? searchParams.tab : "team") as Tab;
  const coach = process.env.COACH_NAME || "your coach";

  if (!me.team) {
    return (
      <>
        <Header me={me} sub="Group life coaching" tabs={[]} current="" />
        <div className="wrap layout"><main>
          <div className="empty">
            <h2>You&apos;re signed in, but not on a team yet</h2>
            <p>Ask {coach} to add you to your team. Once you&apos;re on a team, you&apos;ll see your teammates here.</p>
          </div>
        </main></div>
      </>
    );
  }

  // The database only returns profiles on this person's team.
  const { data } = await supabase.from("profiles").select("*").eq("team", me.team).neq("role", "coach").is("archived_at", null).order("name");
  const members = (data ?? []) as Profile[];
  const { data: log } = await supabase.from("commitment_log").select("member_id, week, commitment, done")
    .in("member_id", members.map((m) => m.id));
  const logs = progressByMember((log ?? []) as LogRow[], weekKey(new Date(), TZ));
  const { count } = await supabase.from("bookings").select("id", { count: "exact", head: true })
    .eq("member_id", me.id).eq("month", monthKey(new Date(), TZ)).eq("kind", "free");
  const freeLeft = !count;
  const checkins = tab === "team" ? await loadCheckins(supabase, [me.team], TZ) : undefined;

  return (
    <>
      <Header me={me}
        sub={teamLabel(me.team, names)}
        tabs={MEMBER_TABS}
        current={tab}
        right={BOOKING_ENABLED ? <Link className="btn sun ghost" href="/book">Feeling stuck? Book a call</Link> : undefined}
      />
      <div className="wrap layout"><main>
        <div className="intro"><div>
          <h1>{tab === "team" ? teamLabel(me.team, names) : tab === "accountability" ? "What we're holding each other to" : "The missions we're living into"}</h1>
          <p>{tab === "team" ? "You and your teammates." : tab === "accountability" ? "Everyone's commitment this week. Mark yours done when you've shown up for it." : "The bigger why behind each person's work."}</p>
        </div></div>
        {BOOKING_ENABLED && tab === "team" && (
          <section className="stuck">
            <div>
              <h2>Feeling stuck this week?</h2>
              <p>Book a one-on-one call with {coach}. {freeLeft ? <>You have <b>1 free call</b> left in {monthName(new Date(), TZ)}.</> : <>You&apos;ve used your free call for {monthName(new Date(), TZ)}.</>} Extra sessions are $150.</p>
            </div>
            <Link className="btn sun" href="/book">{freeLeft ? "Book my free call" : "Book a session"}</Link>
          </section>
        )}
        {viewing && searchParams.readonly && <div className="notice">You&apos;re viewing as {me.name || "this member"}, so nothing saves. Use Exit member view at the bottom to make changes.</div>}
        {Object.keys(me.wheel ?? {}).length === 0 && (
          <div className="notice">Your profile is almost empty. <Link href="/profile">Fill in your life wheel</Link> so your team can see where you are.</div>
        )}
        <TeamViews tab={tab} groups={[{ team: me.team, members }]} viewer={me} logs={logs} names={names} checkins={checkins} ownTeam />
      </main></div>
    </>
  );
}

