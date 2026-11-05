import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/session";
import { Header, MEMBER_TABS } from "@/components/header";
import { TeamViews, type Tab } from "@/components/cards";
import { loadCheckins } from "@/lib/checkin";
import { loadChecked, loadFocus, loadIntentions, loadSocial, loadThreadSeen, unseen } from "@/lib/social";
import { BOOKING_ENABLED, isPilot, listJoin, missingDetails, monthKey, monthName, progressByMember, teamLabel, weekKey, type LogRow, type Profile } from "@/lib/coaching";

const TZ = process.env.REMINDER_TIMEZONE;

export default async function TeamPage({ searchParams: sp }: { searchParams: Promise<{ tab?: string; readonly?: string; focus?: string }> }) {
  const searchParams = await sp;
  const { supabase, me, names, viewing } = await requireProfile();
  if (me.role === "coach") redirect("/coach");
  const pilot = isPilot(me.team);
  const tab = ((pilot ? ["team"] : ["team", "accountability", "missions"]).includes(searchParams.tab ?? "") ? searchParams.tab : "team") as Tab;
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

  // The Pilot group answers the Focus questions before anything else. (Not while the coach is just looking.)
  if (pilot && !viewing) {
    const { data: mine, error: focusError } = await supabase.from("focus_cards").select("confirmed_at").eq("member_id", me.id).maybeSingle();
    if (!focusError && !mine?.confirmed_at) redirect("/focus");
  }

  // The database only returns profiles on this person's team.
  const { data, error } = await supabase.from("profiles").select("*").eq("team", me.team).neq("role", "coach").is("archived_at", null).order("name");
  if (error) throw new Error(`Couldn't load the team: ${error.message}`);
  // Your own card first, so it's not lost among your teammates.
  const members = ((data ?? []) as Profile[]).sort((a, b) => Number(b.id === me.id) - Number(a.id === me.id));
  const { data: log } = await supabase.from("commitment_log").select("member_id, week, commitment, done")
    .in("member_id", members.map((m) => m.id));
  const logs = progressByMember((log ?? []) as LogRow[], weekKey(new Date(), TZ));
  const { count } = await supabase.from("bookings").select("id", { count: "exact", head: true })
    .eq("member_id", me.id).eq("month", monthKey(new Date(), TZ)).eq("kind", "free");
  const freeLeft = !count;
  const checkins = tab === "team" ? await loadCheckins(supabase, [me.team], TZ) : undefined;
  const intentions = tab === "team" ? await loadIntentions(supabase, [me.team]) : undefined;
  const social = tab === "team" ? await loadSocial(supabase, members.map((m) => m.id)) : undefined;
  // In-app only: a signal for comments and kudos on your own card since you last opened them.
  const seenAt = social ? await loadThreadSeen(supabase, me.id) : undefined;
  if (social && seenAt !== undefined) social.fresh = { memberId: me.id, ...unseen(social, me.id, seenAt) };
  const missing = pilot ? [] : missingDetails(me);
  const focusCards = pilot && tab === "team" ? await loadFocus(supabase, members.map((m) => m.id)) : undefined;
  const checked = tab !== "missions" ? await loadChecked(supabase, members.map((m) => m.id), weekKey(new Date(), TZ)) : undefined;

  return (
    <>
      <Header me={me}
        sub={teamLabel(me.team, names)}
        tabs={pilot ? [] : MEMBER_TABS}
        current={tab}
        right={BOOKING_ENABLED ? <Link className="btn sun ghost" href="/book">Feeling stuck? Book a call</Link> : undefined}
      />
      <div className="wrap layout"><main>
        <div className="intro"><div>
          <h1>{tab === "team" ? teamLabel(me.team, names) : tab === "accountability" ? "What we're holding each other to" : "The missions we're living into"}</h1>
          <p>{tab === "team" ? (pilot ? "Everyone's focus in this group, and what they're working toward." : "You and your teammates.") : tab === "accountability" ? "Everyone's commitment this week. Mark yours done when you've shown up for it." : "The bigger why behind each person's work."}</p>
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
        {pilot && searchParams.focus === "done" && (
          <div className="notice good">Your card is on the Group board. Where you&apos;re starting is now your first commitment for this week. Tick it off in the Progress tab on your card.</div>
        )}
        {social?.fresh && social.fresh.comments + social.fresh.kudos > 0 && (
          <div className="notice good new-note" data-new-for={`thread-${me.id}`}>
            <span aria-hidden="true">{"\u{1F514}"}</span> Your {pilot ? "group" : "team"} left you {newSummary(social.fresh)} on your card. <a href={`#thread-${me.id}`}>See them</a>
          </div>
        )}
        {missing.length > 0 && (
          <div className="notice details-nudge">
            <div>
              <b>Finish your details so your team can get to know you.</b>
              <span> Still blank: {listJoin(missing)}.</span>
            </div>
            <Link className="btn small" href="/profile">Fill them in</Link>
          </div>
        )}
        <TeamViews tab={tab} groups={[{ team: me.team, members }]} viewer={me} logs={logs} names={names} checkins={checkins} social={social} checked={checked} intentions={intentions} focus={focusCards} ownTeam />
      </main></div>
    </>
  );
}


function newSummary({ comments, kudos }: { comments: number; kudos: number }) {
  const parts = [
    comments ? `${comments} new ${comments === 1 ? "comment" : "comments"}` : "",
    kudos ? `${kudos} new kudos` : "",
  ].filter(Boolean);
  return parts.join(" and ");
}
