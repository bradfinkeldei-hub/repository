"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCoach, requireEditor, requireRealCoach, VIEW_AS_COOKIE } from "@/lib/session";
import { AREAS, BOOKING_ENABLED, DAYS, firstName, isTeam, meetingWhen, monthKey, nextMeeting, TEAMS, teamLabel, weekKey, type Profile, type Wheel } from "@/lib/coaching";
import { sendEmails } from "@/lib/mail";
import { rsvpLink } from "@/lib/rsvp";

const TZ = process.env.REMINDER_TIMEZONE;
const str = (v: FormDataEntryValue | null, max: number) => String(v ?? "").trim().slice(0, max);

/** Save a profile. Members save their own; the coach can save anyone's and set their team. */
export async function saveProfile(formData: FormData) {
  const { supabase, me } = await requireEditor();
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
  const { supabase, me } = await requireEditor();
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
  const { supabase, user } = await requireEditor();
  const email = str(formData.get("email"), 200).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) redirect("/settings?error=email");
  if (email === user.email?.toLowerCase()) redirect("/settings");
  const site = process.env.SITE_URL ?? "";
  const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: `${site}/auth/callback?next=/settings` });
  if (error) redirect(`/settings?error=${/already/i.test(error.message) ? "taken" : "email"}`);
  redirect("/settings?email=sent");
}

export async function toggleDone(memberId: string) {
  const { supabase } = await requireEditor();
  const wk = weekKey(new Date(), TZ);
  const { data } = await supabase.from("profiles").select("done_week").eq("id", memberId).single();
  await setWeekDone(memberId, wk, data?.done_week !== wk);
}

/** Marks one meeting week done or not done in the accountability tracker. */
export async function setWeekDone(memberId: string, week: string, done: boolean) {
  const { supabase, me } = await requireEditor();
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

/** A member's answer for their team's next meeting. The coach can answer for anyone. */
export async function setAttendance(memberId: string, going: boolean) {
  const { supabase, me } = await requireEditor();
  if (memberId !== me.id && me.role !== "coach") return;
  const { data: m } = await supabase.from("profiles").select("team").eq("id", memberId).single();
  if (!isTeam(m?.team)) return;
  const meeting = nextMeeting(m.team, new Date(), TZ);
  await supabase.from("attendance").upsert({ member_id: memberId, meeting, going, updated_at: new Date().toISOString() });
  revalidatePath("/", "layout");
}

/**
 * Coach only: emails everyone on the team who hasn't answered yet, asking if
 * they'll be at the next meeting, with one-tap In and Out links and the meeting link.
 */
export async function askAttendance(team: string, formData: FormData) {
  const { supabase, names } = await requireCoach();
  if (!isTeam(team)) redirect("/coach");
  const back: (q: string) => never = (q) => redirect(`/coach?team=${team}&${q}#meeting-${team}`);
  const url = str(formData.get("meeting_url"), 500);
  if (url && !/^https?:\/\/\S+$/.test(url)) back("asked=badlink");
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) back("asked=setup");
  const meeting = nextMeeting(team, new Date(), TZ);

  const [{ data: members }, { data: answers }] = await Promise.all([
    supabase.from("profiles").select("*").eq("team", team).neq("role", "coach"),
    supabase.from("attendance").select("member_id").eq("meeting", meeting),
  ]);
  const answered = new Set((answers ?? []).map((a) => a.member_id as string));
  const waiting = ((members ?? []) as Profile[]).filter((m) => !answered.has(m.id));
  const { data: contacts } = waiting.length
    ? await supabase.from("member_contacts").select("id, email").in("id", waiting.map((m) => m.id))
    : { data: [] };
  const email = new Map((contacts ?? []).map((c) => [c.id as string, c.email as string]));
  const site = (process.env.SITE_URL ?? "").replace(/\/$/, "");
  const coach = process.env.COACH_NAME || "your coach";
  const when = meetingWhen(meeting, new Date(), TZ);

  const emails = [];
  for (const m of waiting) {
    const to = email.get(m.id);
    // @example.com is the made-up Example team; those addresses can't receive mail.
    if (!to || to.toLowerCase().endsWith("@example.com")) continue;
    emails.push(attendanceEmail(m, to, {
      when, team: teamLabel(team, names), coach, site, url,
      yes: await rsvpLink(site, secret, m.id, meeting, true),
      no: await rsvpLink(site, secret, m.id, meeting, false),
    }));
  }
  let sent: string[] | null = [];
  try {
    sent = await sendEmails(emails);
  } catch (e) {
    console.error("attendance email failed", e);
    back("asked=fail");
  }
  if (sent === null) back("asked=nomail");
  if (emails.length && !sent.length) back("asked=fail");
  await supabase.from("roll_calls").upsert({ team, meeting, sent_at: new Date().toISOString(), meeting_url: url });
  revalidatePath("/", "layout");
  back(`asked=${sent.length}`);
}

function attendanceEmail(m: Profile, to: string, o: { when: string; team: string; coach: string; site: string; url: string; yes: string; no: string }) {
  const q = `Will you be at ${o.team}'s meeting ${o.when}?`;
  const text = [
    `Hi ${firstName(m.name)},`,
    "",
    q,
    "",
    `I'll be there: ${o.yes}`,
    `Can't make it: ${o.no}`,
    o.url ? `\nJoin the meeting: ${o.url}` : "",
    "",
    `See who's coming: ${o.site}/team`,
    "",
    o.coach,
  ].join("\n");
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const button = (href: string, label: string, bg: string) =>
    `<a href="${esc(href)}" style="display:inline-block;padding:12px 22px;margin:0 8px 8px 0;border-radius:10px;background:${bg};color:#fff;font-weight:700;text-decoration:none">${label}</a>`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:16px;line-height:1.5;color:#15302b">
<p>Hi ${esc(firstName(m.name))},</p>
<p style="font-size:18px;font-weight:700">${esc(q)}</p>
<p>${button(o.yes, "I'm in", "#16803c")}${button(o.no, "I'm out", "#c23b25")}</p>
${o.url ? `<p><a href="${esc(o.url)}" style="color:#0b7d6e;font-weight:700">Join the meeting</a><br><span style="color:#5a6b66;font-size:14px">${esc(o.url)}</span></p>` : ""}
<p><a href="${esc(o.site)}/team" style="color:#0b7d6e">See who's coming</a></p>
<p>${esc(o.coach)}</p>
</div>`;
  return { to, subject: `${o.when === "tonight" ? "Tonight" : o.when}: are you coming?`, text, html };
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
  redirect(error ? "/coach/teams?error=1" : "/coach/teams?saved=1");
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
  const { supabase, me } = await requireEditor();
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
  const { supabase } = await requireEditor();
  const password = String(formData.get("password") ?? "");
  const back = formData.get("welcome") === "1" ? "/set-password?welcome=1&" : "/set-password?";
  if (password.length < 8) redirect(`${back}error=short`);
  if (password !== formData.get("confirm")) redirect(`${back}error=match`);
  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect(`${back}error=save`);
  redirect(formData.get("welcome") === "1" ? "/" : "/settings?password=1");
}

export async function signOut() {
  (await cookies()).delete(VIEW_AS_COOKIE);
  await (await createClient()).auth.signOut();
  redirect("/login");
}

/** Saves a photo the browser already uploaded to avatars/<my id>/, and clears out older ones. */
export async function setAvatar(path: string) {
  const { supabase, me } = await requireEditor();
  if (!new RegExp(`^${me.id}/[\\w-]+\\.jpg$`).test(path)) return { error: "That photo didn't upload. Try again." };
  const bucket = supabase.storage.from("avatars");
  const { error } = await supabase.from("profiles").update({ avatar_url: bucket.getPublicUrl(path).data.publicUrl }).eq("id", me.id);
  if (error) return { error: "That photo didn't save. Try again." };
  await removeAvatarFiles(me.id, path);
  revalidatePath("/", "layout");
  return {};
}

export async function removeAvatar() {
  const { supabase, me } = await requireEditor();
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

/** Coach only: see the app exactly as this member does, read-only, until they exit. */
export async function startViewAs(memberId: string) {
  const { supabase } = await requireRealCoach();
  const { data } = await supabase.from("profiles").select("id").eq("id", memberId).neq("role", "coach").maybeSingle();
  if (!data) redirect("/coach");
  (await cookies()).set(VIEW_AS_COOKIE, memberId, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 8 });
  redirect("/");
}

export async function stopViewAs() {
  const { supabase } = await requireRealCoach();
  const jar = await cookies();
  const id = jar.get(VIEW_AS_COOKIE)?.value;
  jar.delete(VIEW_AS_COOKIE);
  const { data } = id ? await supabase.from("profiles").select("team").eq("id", id).maybeSingle() : { data: null };
  redirect(`/coach?team=${data?.team ?? "all"}`);
}
