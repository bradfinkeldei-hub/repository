"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCoach, requireProfile } from "@/lib/session";
import { AREAS, BOOKING_ENABLED, DAYS, firstName, isTeam, monthKey, TEAMS, weekKey, type Wheel } from "@/lib/coaching";

const TZ = process.env.REMINDER_TIMEZONE;
const str = (v: FormDataEntryValue | null, max: number) => String(v ?? "").trim().slice(0, max);

/** Save a profile. Members save their own; the coach can save anyone's and set their team. */
export async function saveProfile(formData: FormData) {
  const { supabase, me } = await requireProfile();
  const id = str(formData.get("id"), 64) || me.id;
  const isCoach = me.role === "coach";
  if (id !== me.id && !isCoach) redirect("/team");

  const wheel: Wheel = {};
  for (const [k] of AREAS) {
    const n = Math.round(Number(formData.get(`wheel_${k}`)));
    if (n >= 1 && n <= 10) wheel[k] = n;
  }
  const update: Record<string, unknown> = {
    name: str(formData.get("name"), 60) || me.name,
    wheel,
    creating: str(formData.get("creating"), 400),
    accountability: str(formData.get("accountability"), 400),
    mission: str(formData.get("mission"), 600),
  };
  // Your own reminder lives on the Settings page; the coach edits others' here.
  if (formData.has("reminder_day")) Object.assign(update, reminderUpdate(formData));
  if (isCoach && formData.has("team")) {
    const team = formData.get("team");
    update.team = isTeam(team) ? team : null;
  }
  const { data: before } = await supabase.from("profiles").select("accountability").eq("id", id).single();
  const { error } = await supabase.from("profiles").update(update).eq("id", id);
  if (error) redirect(`/profile?${id !== me.id ? `id=${id}&` : ""}error=save`);
  // A new commitment becomes this week's entry in the accountability tracker.
  if (update.accountability && update.accountability !== before?.accountability) {
    await supabase.from("commitment_log").upsert(
      { member_id: id, week: weekKey(new Date(), TZ), commitment: update.accountability, updated_at: new Date().toISOString() },
      { onConflict: "member_id,week" },
    );
  }
  revalidatePath("/", "layout");
  redirect(isCoach ? (id === me.id ? "/coach" : `/coach?team=${update.team ?? "none"}`) : "/team");
}

function reminderUpdate(formData: FormData) {
  const day = str(formData.get("reminder_day"), 12);
  return {
    reminder_enabled: formData.get("reminder_enabled") === "on",
    reminder_day: (DAYS as readonly string[]).includes(day) ? day : "Monday",
  };
}

/** Settings page: the signed-in person's name and weekly reminder. */
export async function saveSettings(formData: FormData) {
  const { supabase, me } = await requireProfile();
  const { error } = await supabase.from("profiles").update({
    name: str(formData.get("name"), 60) || me.name,
    ...reminderUpdate(formData),
  }).eq("id", me.id);
  if (error) redirect("/settings?error=save");
  revalidatePath("/", "layout");
  redirect("/settings?saved=1");
}

/** Starts a sign-in email change. Supabase emails a link to confirm it. */
export async function changeEmail(formData: FormData) {
  const { supabase, user } = await requireProfile();
  const email = str(formData.get("email"), 200).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) redirect("/settings?error=email");
  if (email === user.email?.toLowerCase()) redirect("/settings");
  const site = process.env.SITE_URL ?? "";
  const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: `${site}/auth/callback?next=/settings` });
  if (error) redirect(`/settings?error=${/already/i.test(error.message) ? "taken" : "email"}`);
  redirect("/settings?email=sent");
}

export async function toggleDone(memberId: string) {
  const { supabase } = await requireProfile();
  const wk = weekKey(new Date(), TZ);
  const { data } = await supabase.from("profiles").select("done_week").eq("id", memberId).single();
  await setWeekDone(memberId, wk, data?.done_week !== wk);
}

/** Marks one meeting week done or not done in the accountability tracker. */
export async function setWeekDone(memberId: string, week: string, done: boolean) {
  const { supabase, me } = await requireProfile();
  if (memberId !== me.id && me.role !== "coach") return;
  const current = weekKey(new Date(), TZ);
  if (!/^\d{4}-W\d{2}$/.test(week) || week > current) return;
  const { data: profile } = await supabase.from("profiles").select("accountability, done_week").eq("id", memberId).single();
  if (!profile) return;
  const { data: row } = await supabase.from("commitment_log").select("week").eq("member_id", memberId).eq("week", week).maybeSingle();
  if (row) {
    await supabase.from("commitment_log").update({ done, updated_at: new Date().toISOString() }).eq("member_id", memberId).eq("week", week);
  } else {
    // A week nobody logged keeps the commitment from before it.
    const { data: prev } = await supabase.from("commitment_log").select("commitment").eq("member_id", memberId)
      .lt("week", week).neq("commitment", "").order("week", { ascending: false }).limit(1).maybeSingle();
    const commitment = week === current ? profile.accountability : prev?.commitment ?? "";
    await supabase.from("commitment_log").insert({ member_id: memberId, week, commitment, done });
  }
  // The profile's done_week still drives the coach's check-ins and the team cards.
  if (week === current) await supabase.from("profiles").update({ done_week: done ? week : "" }).eq("id", memberId);
  revalidatePath("/", "layout");
}

export async function setTeam(memberId: string, team: string) {
  const { supabase } = await requireCoach();
  await supabase.from("profiles").update({ team: isTeam(team) ? team : null }).eq("id", memberId);
  revalidatePath("/", "layout");
}

/** Saves the coach's names for the teams. A blank name goes back to "Monday team" and so on. */
export async function renameTeams(formData: FormData) {
  const { supabase } = await requireCoach();
  const rows = TEAMS.map((team) => ({ team, name: str(formData.get(`name_${team}`), 40) || `${team} team` }));
  const { error } = await supabase.from("team_names").upsert(rows);
  revalidatePath("/", "layout");
  redirect(error ? "/coach/members?error=rename#team-names" : "/coach/members?renamed=1#team-names");
}

/** Sends Supabase's invite email. The name fills {{ .Data.name }} in the Invite user template and becomes their profile name. */
function sendInvite(email: string, name: string) {
  const site = process.env.SITE_URL ?? "";
  return createAdminClient().auth.admin.inviteUserByEmail(email, {
    redirectTo: `${site}/auth/callback`,
    data: { name, first_name: name ? firstName(name) : "" },
  });
}

export async function inviteMember(formData: FormData) {
  const { supabase } = await requireCoach();
  const name = str(formData.get("name"), 60);
  const email = str(formData.get("email"), 200).toLowerCase();
  const team = formData.get("team");
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || !isTeam(team)) redirect("/coach/members?error=invite");
  await supabase.from("invites").delete().ilike("email", email).is("accepted_at", null);
  const { error } = await supabase.from("invites").insert({ email, team, name });
  if (error) redirect("/coach/members?error=invite");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) redirect("/coach/members?error=setup");
  // The invite fails when the person already has an account, so in that case
  // move them onto the team directly.
  const admin = createAdminClient();
  const { error: sendError } = await sendInvite(email, name);
  if (sendError) {
    const { data: contact } = await admin.from("member_contacts").select("id").ilike("email", email).maybeSingle();
    if (contact) {
      await admin.from("profiles").update({ team }).eq("id", contact.id);
      await admin.from("invites").update({ accepted_at: new Date().toISOString() }).ilike("email", email).is("accepted_at", null);
      revalidatePath("/", "layout");
      redirect("/coach/members?moved=1");
    }
    redirect("/coach/members?error=send");
  }
  revalidatePath("/coach/members");
  redirect("/coach/members?sent=1");
}

export async function cancelInvite(id: string) {
  const { supabase } = await requireCoach();
  await supabase.from("invites").delete().eq("id", id);
  revalidatePath("/coach/members");
}

export async function resendInvite(id: string) {
  const { supabase } = await requireCoach();
  const { data } = await supabase.from("invites").select("email, name").eq("id", id).single();
  if (data && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    await sendInvite(data.email, data.name ?? "");
    await supabase.from("invites").update({ invited_at: new Date().toISOString() }).eq("id", id);
  }
  revalidatePath("/coach/members");
}

/** Removes a member and their sign-in. Coach only. */
export async function removeMember(memberId: string) {
  const { me } = await requireCoach();
  if (memberId === me.id) return;
  await createAdminClient().auth.admin.deleteUser(memberId);
  revalidatePath("/", "layout");
}

export async function setActionDone(id: string, done: boolean) {
  const { supabase } = await requireCoach();
  if (id.startsWith("g_")) {
    await supabase.from("coach_actions").upsert({ id, custom: false, done, week: weekKey(new Date(), TZ) });
  } else {
    await supabase.from("coach_actions").update({ done }).eq("id", id);
  }
  revalidatePath("/coach");
}

export async function addAction(formData: FormData) {
  const { supabase } = await requireCoach();
  const text = str(formData.get("text"), 200);
  const memberId = str(formData.get("member_id"), 64) || null;
  if (text) await supabase.from("coach_actions").insert({ custom: true, text, member_id: memberId, week: weekKey(new Date(), TZ) });
  revalidatePath("/coach");
}

export async function deleteAction(id: string) {
  const { supabase } = await requireCoach();
  await supabase.from("coach_actions").delete().eq("id", id).eq("custom", true);
  revalidatePath("/coach");
}

/** Records the booking, then sends the member to the scheduling page. */
export async function bookCall(kind: "free" | "paid") {
  if (!BOOKING_ENABLED) redirect("/");
  const { supabase, me } = await requireProfile();
  const url = kind === "free" ? process.env.FREE_CALL_URL : process.env.PAID_CALL_URL;
  if (!url) redirect("/book?error=nolink");
  const { error } = await supabase.from("bookings").insert({ member_id: me.id, month: monthKey(new Date(), TZ), kind });
  if (error && kind === "free") redirect("/book?error=used");
  redirect(url);
}

export async function resetFreeCall(memberId: string) {
  const { supabase } = await requireCoach();
  await supabase.from("bookings").delete().eq("member_id", memberId).eq("month", monthKey(new Date(), TZ)).eq("kind", "free");
  revalidatePath("/coach/members");
}

/** Sets or changes the signed-in person's password. */
export async function setPassword(formData: FormData) {
  const { supabase } = await requireProfile();
  const password = String(formData.get("password") ?? "");
  const back = formData.get("welcome") === "1" ? "/set-password?welcome=1&" : "/set-password?";
  if (password.length < 8) redirect(`${back}error=short`);
  if (password !== formData.get("confirm")) redirect(`${back}error=match`);
  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect(`${back}error=save`);
  redirect(formData.get("welcome") === "1" ? "/" : "/settings?password=1");
}

export async function signOut() {
  await (await createClient()).auth.signOut();
  redirect("/login");
}

/** Saves a photo the browser already uploaded to avatars/<my id>/, and clears out older ones. */
export async function setAvatar(path: string) {
  const { supabase, me } = await requireProfile();
  if (!new RegExp(`^${me.id}/[\\w-]+\\.jpg$`).test(path)) return { error: "That photo didn't upload. Try again." };
  const bucket = supabase.storage.from("avatars");
  const { error } = await supabase.from("profiles").update({ avatar_url: bucket.getPublicUrl(path).data.publicUrl }).eq("id", me.id);
  if (error) return { error: "That photo didn't save. Try again." };
  await removeAvatarFiles(me.id, path);
  revalidatePath("/", "layout");
  return {};
}

export async function removeAvatar() {
  const { supabase, me } = await requireProfile();
  await supabase.from("profiles").update({ avatar_url: "" }).eq("id", me.id);
  await removeAvatarFiles(me.id);
  revalidatePath("/", "layout");
}

async function removeAvatarFiles(id: string, keep?: string) {
  const bucket = (await createClient()).storage.from("avatars");
  const { data } = await bucket.list(id);
  const old = (data ?? []).map((f) => `${id}/${f.name}`).filter((p) => p !== keep);
  if (old.length) await bucket.remove(old);
}
