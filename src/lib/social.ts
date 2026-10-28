import type { createClient } from "@/lib/supabase/server";

export type CardComment = { id: string; member_id: string; author_id: string; author_name: string; body: string; created_at: string };
export type Kudo = { member_id: string; author_id: string; author_name: string; week: string };
export type Milestone = { id: string; member_id: string; author_id: string; author_name: string; title: string; achieved_on: string };

export type CoachNote = { id: string; member_id: string; body: string; created_at: string };

/** Comments, kudos and milestones under each member's card, by member id. */
export type Social = {
  comments: Record<string, CardComment[]>;
  kudos: Record<string, Kudo[]>;
  milestones: Record<string, Milestone[]>;
};

function byMember<T extends { member_id: string }>(rows: T[] | null) {
  const out: Record<string, T[]> = {};
  for (const r of rows ?? []) (out[r.member_id] ??= []).push(r);
  return out;
}

/**
 * Loads everything under the given members' cards. Access rules limit members
 * to their own team and hide anything an archived member wrote. Returns null
 * if the tables aren't there yet, so the cards simply leave these parts out.
 */
export async function loadSocial(supabase: Awaited<ReturnType<typeof createClient>>, ids: string[]): Promise<Social | null> {
  if (!ids.length) return { comments: {}, kudos: {}, milestones: {} };
  const [c, k, m] = await Promise.all([
    supabase.from("card_comments").select("id, member_id, author_id, author_name, body, created_at").in("member_id", ids).order("created_at"),
    supabase.from("kudos").select("member_id, author_id, author_name, week").in("member_id", ids).order("created_at", { ascending: false }),
    supabase.from("milestones").select("id, member_id, author_id, author_name, title, achieved_on").in("member_id", ids).order("achieved_on", { ascending: false }),
  ]);
  if (c.error || k.error || m.error) return null;
  return { comments: byMember(c.data), kudos: byMember(k.data), milestones: byMember(m.data) };
}

/** Which commitments each member has ticked off this week. Empty if the column isn't there yet. */
export async function loadChecked(supabase: Awaited<ReturnType<typeof createClient>>, ids: string[], week: string): Promise<Record<string, string[]>> {
  if (!ids.length) return {};
  const { data, error } = await supabase.from("commitment_log").select("member_id, checked").in("member_id", ids).eq("week", week);
  if (error) return {};
  return Object.fromEntries((data ?? []).map((r: { member_id: string; checked: string[] | null }) => [r.member_id, r.checked ?? []]));
}

/** The coach's private notes, newest first, by member id. Access rules return none to members. Null if the table isn't there yet. */
export async function loadNotes(supabase: Awaited<ReturnType<typeof createClient>>, ids: string[]): Promise<Record<string, CoachNote[]> | null> {
  if (!ids.length) return {};
  const { data, error } = await supabase.from("coach_notes").select("id, member_id, body, created_at").in("member_id", ids).order("created_at", { ascending: false });
  return error ? null : byMember(data);
}
