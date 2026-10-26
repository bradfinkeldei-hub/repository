import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/coaching";

/** The signed-in person's profile, or a redirect to sign in. */
export async function requireProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (!data) redirect("/login?error=profile");
  return { supabase, user, me: data as Profile };
}

export async function requireCoach() {
  const s = await requireProfile();
  if (s.me.role !== "coach") redirect("/team");
  return s;
}
