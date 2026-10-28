import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { VIEW_AS_COOKIE, viewedMember } from "@/lib/session";
import { editViewedMember, startViewAs, stopViewAs } from "@/app/actions";
import { AutoSubmitSelect } from "@/components/client";
import { firstName, teamLabel, type Profile, type TeamNames } from "@/lib/coaching";

/** Coach only: the bar shown while viewing the app as a member, with a switcher and the way out. */
export async function ViewAsBanner() {
  if (!(await cookies()).get(VIEW_AS_COOKIE)) return null;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: me } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (!me) return null;
  const member = await viewedMember(supabase, me as Profile);
  if (!member) return null;
  const [{ data }, { data: teams }] = await Promise.all([
    supabase.from("profiles").select("id, name, team").neq("role", "coach").is("archived_at", null).order("name"),
    supabase.from("team_names").select("team, name"),
  ]);
  const names = Object.fromEntries((teams ?? []).map((t) => [t.team, t.name])) as TeamNames;
  const others = (data ?? []) as Pick<Profile, "id" | "name" | "team">[];
  return (
    <>
      {/* Read-only: buttons and fields on the page look and act switched off. The server refuses saves too. */}
      <style>{`form:not(.viewas) :is(button, input, select, textarea) { pointer-events: none; opacity: 0.55; } body { padding-bottom: 96px; }`}</style>
      <div className="viewas-bar" role="status">
        <div className="wrap row">
          <span><b>Viewing as {member.name || "this member"}</b> · {teamLabel(member.team, names)} · Read-only here. Use Edit to change things for them.</span>
          <span className="spacer" />
          <form className="viewas row">
            <AutoSubmitSelect
              label="View as another member"
              value={member.id}
              action={startViewAs}
              options={others.map((o) => [o.id, `${o.name || "No name"}${o.team ? ` (${teamLabel(o.team, names)})` : ""}`])}
            />
          </form>
          <form className="viewas" action={editViewedMember}><button className="btn small" type="submit">Edit {firstName(member.name) || "this member"}</button></form>
          <form className="viewas" action={stopViewAs}><button className="btn small" type="submit">Exit member view</button></form>
        </div>
      </div>
    </>
  );
}
