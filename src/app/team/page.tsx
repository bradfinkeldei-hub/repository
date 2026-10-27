import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/session";
import { Header } from "@/components/header";
import { TeamViews, type Tab } from "@/components/cards";
import { BOOKING_ENABLED, monthKey, monthName, teamLabel, type Profile } from "@/lib/coaching";

const TZ = process.env.REMINDER_TIMEZONE;
const TABS: { key: Tab; label: string }[] = [
  { key: "team", label: "Team" }, { key: "accountability", label: "Accountability" }, { key: "missions", label: "Missions" },
];

export default async function TeamPage({ searchParams: sp }: { searchParams: Promise<{ tab?: string }> }) {
  const searchParams = await sp;
  const { supabase, me } = await requireProfile();
  if (me.role === "coach") redirect("/coach");
  const tab = (TABS.find((t) => t.key === searchParams.tab)?.key ?? "team") as Tab;
  const coach = process.env.COACH_NAME || "your coach";

  if (!me.team) {
    return (
      <>
        <Header sub="Group life coaching" tabs={[]} current="" />
        <div className="wrap layout"><main>
          <div className="empty">
            <h2>You&apos;re signed in, but not on a team yet</h2>
            <p>Ask {coach} to add you to your Monday, Tuesday, Wednesday or Thursday team. Once you&apos;re on a team, you&apos;ll see your teammates here.</p>
          </div>
        </main></div>
      </>
    );
  }

  // The database only returns profiles on this person's team.
  const { data } = await supabase.from("profiles").select("*").eq("team", me.team).neq("role", "coach").order("name");
  const members = (data ?? []) as Profile[];
  const { count } = await supabase.from("bookings").select("id", { count: "exact", head: true })
    .eq("member_id", me.id).eq("month", monthKey(new Date(), TZ)).eq("kind", "free");
  const freeLeft = !count;

  return (
    <>
      <Header
        sub={teamLabel(me.team)}
        tabs={TABS.map((t) => ({ ...t, href: `/team?tab=${t.key}` }))}
        current={tab}
        right={BOOKING_ENABLED ? <Link className="btn sun ghost" href="/book">Feeling stuck? Book a call</Link> : undefined}
      />
      <div className="wrap layout"><main>
        <div className="intro"><div>
          <h1>{tab === "team" ? teamLabel(me.team) : tab === "accountability" ? "What we're holding each other to" : "The missions we're living into"}</h1>
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
        {Object.keys(me.wheel ?? {}).length === 0 && (
          <div className="notice">Your profile is almost empty. <Link href="/profile">Fill in your life wheel</Link> so your team can see where you are.</div>
        )}
        <TeamViews tab={tab} groups={[{ team: me.team, members }]} viewer={me} ownTeam />
      </main></div>
    </>
  );
}
