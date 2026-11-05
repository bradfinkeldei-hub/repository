import Link from "next/link";
import { redirect } from "next/navigation";
import { requireEditor } from "@/lib/session";
import { Header } from "@/components/header";
import { FocusWalkthrough } from "@/components/focus-walkthrough";
import { FocusCard } from "@/components/focus-card";
import { firstName, PILOT, usesFocusCards, type Profile } from "@/lib/coaching";
import { EMPTY_FOCUS, FOCUS_STEPS, type Focus, type FocusAnswers } from "@/lib/focus";

/**
 * The Focus walkthrough (Pilot group). A member answers their own questions; the coach
 * can try it on a practice card (?practice=1) or fill in a member's answers (?id=).
 * ?edit=1 opens at the summary so a finished card can be changed.
 */
export default async function FocusPage({ searchParams: sp }: { searchParams: Promise<{ id?: string; practice?: string; edit?: string; done?: string; restart?: string }> }) {
  const searchParams = await sp;
  // Starting over is only for the coach's practice run.
  if (searchParams.restart && !searchParams.practice) delete searchParams.restart;
  const { supabase, me } = await requireEditor();
  const coach = me.role === "coach";
  const coachName = process.env.COACH_NAME || "your coach";

  let who: Profile = me;
  if (coach && searchParams.id && searchParams.id !== me.id) {
    const { data } = await supabase.from("profiles").select("*").eq("id", searchParams.id).single();
    if (!data) redirect(`/coach?team=${PILOT}`);
    who = data as Profile;
  } else if (coach && !searchParams.practice) {
    redirect(`/focus?practice=1`);
  } else if (!coach && !usesFocusCards(me.team)) {
    redirect("/team");
  }
  const practice = coach && who.id === me.id;
  const board = coach ? `/coach?team=${who.team ?? PILOT}` : "/team";

  const { data } = await supabase.from("focus_cards").select("*").eq("member_id", who.id).maybeSingle();
  const saved = data as Focus | null;

  // The coach's practice run, finished: show the card it built.
  if (practice && searchParams.done && saved?.confirmed_at) {
    return (
      <>
        <Header me={me} sub="Practice run" tabs={[]} current="" />
        <div className="wrap walk-wrap">
          <div className="intro"><div>
            <h1>Here&apos;s the card your answers built</h1>
            <p>This is how a member&apos;s card looks on the Group board. Yours stays off the board.</p>
          </div></div>
          <FocusCard m={me} f={saved} viewer={me} avatars={{}} practice />
          <div className="row walk-after">
            <Link className="btn" href={board}>Back to the Group board</Link>
            <Link className="btn ghost" href="/focus?practice=1&restart=1">Start over</Link>
          </div>
        </div>
      </>
    );
  }

  const initial: FocusAnswers = saved && !searchParams.restart ? { ...EMPTY_FOCUS, ...saved } : EMPTY_FOCUS;
  // Pick up where they left off. A finished card being edited opens at the summary.
  const startAt = searchParams.restart ? "welcome"
    : saved?.confirmed_at ? "summary"
    : FOCUS_STEPS[Math.max(0, Math.min(FOCUS_STEPS.length - 1, saved?.step ?? 0))];
  const doneHref = practice ? "/focus?practice=1&done=1" : coach ? `${board}#member-${who.id}` : "/team?focus=done";

  return (
    <>
      <Header me={me} sub={practice ? "Practice run" : coach ? `${who.name}'s answers` : "Getting started"} tabs={[]} current="" />
      <div className="wrap walk-wrap">
        <FocusWalkthrough key={searchParams.restart ? "restart" : "walk"} memberId={who.id === me.id ? "" : who.id} firstName={firstName(who.name)} coachName={coachName}
          initial={initial} startAt={startAt} doneHref={doneHref} practice={practice} forCoach={coach && !practice} />
        {(saved?.confirmed_at || coach) && <p className="walk-leave"><Link href={board}>Leave without changing anything</Link></p>}
      </div>
    </>
  );
}
