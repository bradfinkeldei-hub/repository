import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/session";
import { Header, MEMBER_TABS } from "@/components/header";
import { TeamViews, type Tab } from "@/components/cards";
import { BOOKING_ENABLED, monthKey, monthName, progressByMember, teamLabel, weekKey, type LogRow, type Profile } from "@/lib/coaching";

const TZ = process.env.REMINDER_TIMEZONE;

export default async function TeamPage({ searchParams: sp }: { searchParams: Promise<{ tab?: string; as?: string }> }) {
  const searchParams = await sp;
  const session = await requireProfile();
  const { supabase, names } = session;
  let me = session.me;
  // The coach can preview the page as any member (?as=<id>), read only.
  let preview = false;
  if (me.role === "coach") {
    if (!searchParams.as) redirect("/coach");
    const { data: member } = await supabase.from("profiles").select("*").eq("id", searchParams.as).single();
    if (!member) redirect("/coach/members");
    me = member as Profile;
    preview = true;
  }
  const tab = (["team", "accountability", "missions"].includes(searchParams.tab ?? "") ? searchParams.tab : "team") as Tab;
  const coach = process.env.COACH_NAME || "your coach";
  const banner = preview && <PreviewBanner member={me} label={teamLabel(me.team, names)} tab={tab} />;

  if (!me.team) {
    return (
      <>
        {banner}
        <div inert={preview}>
        <Header me={me} sub="Group life coaching" tabs={[]} current="" />
        <div className="wrap layout"><main>
          <div className="empty">
            <h2>You&apos;re signed in, but not on a team yet</h2>
            <p>Ask {coach} to add you to your team. Once you&apos;re on a team, you&apos;ll see your teammates here.</p>
          </div>
        </main></div>
        </div>
      </>
    );
  }

  // The database only returns profiles on this person's team.
  const { data } = await supabase.from("profiles").select("*").eq("team", me.team).neq("role", "coach").order("name");
  const members = (data ?? []) as Profile[];
  const { data: log } = await supabase.from("commitment_log").select("member_id, week, commitment, done")
    .in("member_id", members.map((m) => m.id));
  const logs = progressByMember((log ?? []) as LogRow[], weekKey(new Date(), TZ));
  const { count } = await supabase.from("bookings").select("id", { count: "exact", head: true })
    .eq("member_id", me.id).eq("month", monthKey(new Date(), TZ)).eq("kind", "free");
  const freeLeft = !count;

  return (
    <>
      {banner}
      <div inert={preview}>
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
        {Object.keys(me.wheel ?? {}).length === 0 && (
          <div className="notice">Your profile is almost empty. <Link href="/profile">Fill in your life wheel</Link> so your team can see where you are.</div>
        )}
        <TeamViews tab={tab} groups={[{ team: me.team, members }]} viewer={me} logs={logs} names={names} ownTeam />
      </main></div>
      </div>
    </>
  );
}

/** Shown to the coach above a member preview. The page below it can't be clicked. */
function PreviewBanner({ member, label, tab }: { member: Profile; label: string; tab: Tab }) {
  const href = (t: Tab) => `/team?as=${member.id}&tab=${t}`;
  return (
    <div className="preview-bar">
      <div className="wrap row">
        <span><b>Viewing as {member.name}</b> · {label}. This is exactly what they see; nothing here can be changed.</span>
        <span className="spacer" />
        <nav className="row" aria-label="Preview sections">
          {(["team", "accountability", "missions"] as Tab[]).map((t) => (
            <Link key={t} href={href(t)} aria-current={t === tab ? "page" : undefined}>{t[0].toUpperCase() + t.slice(1)}</Link>
          ))}
        </nav>
        <Link className="btn small" href={member.team ? `/coach?team=${member.team}` : "/coach/members"}>Back to coach view</Link>
      </div>
    </div>
  );
}
