import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, TeamNames } from "@/lib/coaching";

/** Set while the coach looks at the app the way one member sees it. Holds that member's id. */
export const VIEW_AS_COOKIE = "view_as";

async function signedIn() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const [{ data }, { data: teams }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase.from("team_names").select("team, name"),
  ]);
  if (!data) redirect("/login?error=profile");
  if (data.archived_at && data.role !== "coach") redirect("/login?error=archived");
  const names = Object.fromEntries((teams ?? []).map((t) => [t.team, t.name])) as TeamNames;
  return { supabase, user, me: data as Profile, names };
}

/** The member the coach is viewing the app as, if any. Always null for members. */
export async function viewedMember(supabase: Awaited<ReturnType<typeof createClient>>, me: Pick<Profile, "id" | "role">) {
  if (me.role !== "coach") return null;
  const id = (await cookies()).get(VIEW_AS_COOKIE)?.value;
  if (!id || id === me.id) return null;
  const { data } = await supabase.from("profiles").select("*").eq("id", id).neq("role", "coach").maybeSingle();
  return (data as Profile | null) ?? null;
}

/**
 * The signed-in person's profile, or a redirect to sign in.
 * While the coach views the app as a member, `me` is that member and `viewing` is true.
 */
export async function requireProfile() {
  const s = await signedIn();
  const member = await viewedMember(s.supabase, s.me);
  return member ? { ...s, me: member, viewing: true } : { ...s, viewing: false };
}

/** For anything that saves. Viewing as a member is read-only, so this sends the coach back instead. */
export async function requireEditor() {
  const s = await requireProfile();
  if (s.viewing) redirect("/team?readonly=1");
  return s;
}

export async function requireCoach() {
  const s = await signedIn();
  if (s.me.role !== "coach") redirect("/team");
  // Coach pages stay hidden while viewing as a member; the bar at the bottom is the way out.
  if (await viewedMember(s.supabase, s.me)) redirect("/team");
  return s;
}

/** The real coach, even mid-view. For starting, switching and leaving "view as". */
export async function requireRealCoach() {
  const s = await signedIn();
  if (s.me.role !== "coach") redirect("/team");
  return s;
}
