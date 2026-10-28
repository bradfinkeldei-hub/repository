import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, TeamNames } from "@/lib/coaching";

/** The signed-in person's profile, or a redirect to sign in. */
export async function requireProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const [{ data }, { data: teams }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase.from("team_names").select("team, name"),
  ]);
  if (!data) redirect("/login?error=profile");
  const names = Object.fromEntries((teams ?? []).map((t) => [t.team, t.name])) as TeamNames;
  return { supabase, user, me: data as Profile, names };
}

export async function requireCoach() {
  const s = await requireProfile();
  if (s.me.role !== "coach") redirect("/team");
  return s;
}
