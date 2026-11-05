import Link from "next/link";
import { redirect } from "next/navigation";
import { requireEditor } from "@/lib/session";
import { Header } from "@/components/header";
import { MissionWalkthrough } from "@/components/mission-walkthrough";
import { firstName, PILOT, type Profile } from "@/lib/coaching";

/** Guided mission questions. A member writes their own; the coach can write one for a member (?id=). */
export default async function MissionPage({ searchParams: sp }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await sp;
  const { supabase, me } = await requireEditor();
  const coach = me.role === "coach";
  const board = coach ? `/coach?team=${PILOT}` : "/team";

  let who: Profile = me;
  if (coach) {
    if (!id) redirect(board);
    const { data } = await supabase.from("profiles").select("*").eq("id", id).single();
    if (!data) redirect(board);
    who = data as Profile;
  }
  const back = coach ? `/coach?team=${who.team ?? PILOT}#member-${who.id}` : `/team#member-${who.id}`;

  return (
    <>
      <Header me={me} sub={coach ? `${who.name}'s mission` : "My mission"} tabs={[]} current="" />
      <div className="wrap walk-wrap">
        <MissionWalkthrough memberId={who.id === me.id ? "" : who.id} firstName={firstName(who.name)} initial={who.mission ?? ""}
          doneHref={back} forCoach={coach} />
        <p className="walk-leave"><Link href={back}>Leave without changing anything</Link></p>
      </div>
    </>
  );
}
