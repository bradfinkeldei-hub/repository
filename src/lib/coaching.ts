// Shared rules for life wheels, weeks and the coach's suggested actions.

/** "Book a call" is switched off for now. Set to true to bring it back everywhere. */
export const BOOKING_ENABLED = false;

export const AREAS = [
  ["health", "Health"],
  ["career", "Career"],
  ["money", "Money"],
  ["love", "Romance"],
  ["family", "Family & friends"],
  ["fun", "Fun"],
  ["growth", "Growth"],
  ["home", "Home"],
] as const;

export type AreaKey = (typeof AREAS)[number][0];
export type Wheel = Partial<Record<AreaKey, number>>;

/** "Example" holds made-up demo members (supabase/seed/example_team.sql). */
export const TEAMS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Example"] as const;
export type Team = (typeof TEAMS)[number];
export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export type Profile = {
  id: string;
  name: string;
  /** Public URL of their photo in the "avatars" bucket, or "" for initials. */
  avatar_url: string;
  role: "coach" | "member";
  team: Team | null;
  wheel: Wheel;
  creating: string;
  accountability: string;
  mission: string;
  reminder_enabled: boolean;
  reminder_day: string;
  done_week: string;
  last_reminder_week: string;
  updated_at: string;
  /** Set while the coach has archived them: off their team and signed out, history kept. */
  archived_at: string | null;
  /** The member's choice: false stops teammates adding comments under their card. */
  thread_open?: boolean;
};

export type CoachActionRow = {
  id: string;
  custom: boolean;
  text: string;
  member_id: string | null;
  done: boolean;
  week: string;
};

export type Booking = { id: string; member_id: string; month: string; kind: "free" | "paid"; created_at: string };

export function isTeam(v: unknown): v is Team {
  return typeof v === "string" && (TEAMS as readonly string[]).includes(v);
}

/** The names the coach has given the teams (table team_names). The keys never change. */
export type TeamNames = Partial<Record<Team, string>>;

export function teamLabel(team: Team | null, names: TeamNames = {}) {
  return team ? names[team]?.trim() || `${team} team` : "Not on a team";
}

/** The team menu's choices: [team key, its current name]. */
export function teamOptions(names: TeamNames = {}): [string, string][] {
  return TEAMS.map((t) => [t, teamLabel(t, names)]);
}

export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || "them";
}

/** The parts of a date in a given IANA time zone. */
function zonedParts(date: Date, timeZone?: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "long",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), weekday: get("weekday") };
}

/** ISO week, like "2026-W44", for the date as seen in timeZone. */
export function weekKey(date = new Date(), timeZone?: string) {
  const { year, month, day } = zonedParts(date, timeZone);
  const t = new Date(Date.UTC(year, month - 1, day));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}

export function weekdayName(date = new Date(), timeZone?: string) {
  return zonedParts(date, timeZone).weekday;
}

export function monthKey(date = new Date(), timeZone?: string) {
  const { year, month } = zonedParts(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function monthName(date = new Date(), timeZone?: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", timeZone }).format(date);
}

/** "2026-10-28" for the date as seen in timeZone. */
export function dateKey(date = new Date(), timeZone?: string) {
  const { year, month, day } = zonedParts(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The date of a team's next meeting, counting today, like "2026-10-28".
 * Teams without a weekday (Example) always meet today.
 */
export function nextMeeting(team: Team, now = new Date(), timeZone?: string) {
  const { year, month, day, weekday } = zonedParts(now, timeZone);
  const ahead = DAY_INDEX[team] ? (DAY_INDEX[team] - DAY_INDEX[weekday] + 7) % 7 : 0;
  return new Date(Date.UTC(year, month - 1, day + ahead)).toISOString().slice(0, 10);
}

/** "tonight" for today's date, otherwise "Thursday, Oct 30". */
export function meetingWhen(meeting: string, now = new Date(), timeZone?: string) {
  if (meeting === dateKey(now, timeZone)) return "tonight";
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${meeting}T12:00:00Z`));
}

/** A member's answer to "Will you be at the meeting?" (table attendance). */
export type Rsvp = { member_id: string; meeting: string; going: boolean };

export function teamAverage(list: Pick<Profile, "wheel">[]): Record<AreaKey, number | null> {
  const avg = {} as Record<AreaKey, number | null>;
  for (const [k] of AREAS) {
    const vals = list.map((m) => Number(m.wheel?.[k])).filter((v) => v > 0);
    avg[k] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  return avg;
}

export function fmt(v: number | null | undefined) {
  return v == null ? "–" : String(Math.round(v * 10) / 10);
}

export type Suggestion = {
  id: string;
  kind: "checkin" | "commit" | "wheel" | "team" | "remind" | "refresh" | "call" | "custom";
  level: "high" | "mid" | "low";
  text: string;
  why: string;
  team: Team | null;
  memberId: string | null;
  done: boolean;
  custom?: boolean;
};

const DAY_INDEX: Record<string, number> = { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7 };

/**
 * What the coach should do this week. Generated from member profiles and
 * bookings; done marks and the coach's own actions come from coach_actions.
 */
export function coachActions(
  members: Profile[],
  rows: CoachActionRow[],
  bookings: Booking[],
  now = new Date(),
  timeZone?: string,
  names: TeamNames = {},
): Suggestion[] {
  const wk = weekKey(now, timeZone);
  const today = DAY_INDEX[weekdayName(now, timeZone)] ?? 1;
  const marks = new Map(rows.filter((r) => !r.custom).map((r) => [r.id, r.done]));
  const out: Suggestion[] = [];
  for (const m of members) {
    if (m.role === "coach") continue;
    const fn = firstName(m.name);
    const add = (kind: Suggestion["kind"], level: Suggestion["level"], text: string, why: string) => {
      const id = `g_${wk}_${m.id}_${kind}`;
      out.push({ id, kind, level, text, why, team: m.team, memberId: m.id, done: marks.get(id) ?? false });
    };
    if (!m.accountability) add("commit", "high", `Help ${fn} set a commitment`, "They haven't shared what they want to be held accountable to.");
    else if (m.team && today >= DAY_INDEX[m.team] && m.done_week !== wk)
      add("checkin", "high", `Check in with ${fn}`, `Not marked done since ${m.team}'s meeting: ${m.accountability}`);
    const low = AREAS.filter(([k]) => Number(m.wheel?.[k]) > 0 && Number(m.wheel?.[k]) <= 3);
    if (low.length)
      add("wheel", "mid", `Talk with ${fn} about ${low.map(([, l]) => l).join(" and ")}`,
        `Rated ${low.map(([k, l]) => `${l} ${m.wheel[k]}/10`).join(", ")} on their wheel.`);
    if (!m.team) add("team", "mid", `Put ${fn} on a team`, "They signed in but aren't on a team yet, so they can't see anyone.");
    if (!m.reminder_enabled) add("remind", "low", `Invite ${fn} to turn on weekly reminder emails`, "Their reminder is off.");
    const age = m.updated_at ? (now.getTime() - Date.parse(m.updated_at)) / 864e5 : 0;
    if (age > 30) add("refresh", "low", `Ask ${fn} to refresh their life wheel`, `Last updated ${Math.floor(age)} days ago.`);
    const recent = bookings.filter((b) => b.member_id === m.id && now.getTime() - Date.parse(b.created_at) < 7 * 864e5);
    for (const b of recent) {
      const id = `g_${wk}_${m.id}_call_${b.id}`;
      out.push({
        id, kind: "call", level: "low", team: m.team, memberId: m.id, done: marks.get(id) ?? false,
        text: `Prepare for ${fn}'s call`,
        why: b.kind === "free" ? "Started booking their free call this month." : "Started booking a paid $150 session.",
      });
    }
  }
  for (const r of rows.filter((r) => r.custom)) {
    const m = members.find((x) => x.id === r.member_id);
    out.push({
      id: r.id, kind: "custom", level: "mid", text: r.text, why: m ? `${m.name} · ${teamLabel(m.team, names)}` : "",
      team: m?.team ?? null, memberId: r.member_id, done: r.done, custom: true,
    });
  }
  const order = { high: 0, mid: 1, low: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

/** One meeting week of a member's accountability history (commitment_log). */
export type LogRow = { member_id: string; week: string; commitment: string; done: boolean };

export type WeekStatus = "done" | "missed" | "open";
export type ProgressWeek = { week: string; commitment: string; status: WeekStatus; recorded: boolean };
export type Progress = { weeks: ProgressWeek[]; streak: number; best: number; done: number; total: number };

/** Midnight UTC on the Monday of an ISO week like "2026-W44". */
function weekMonday(week: string) {
  const [y, w] = week.split("-W").map(Number);
  // ISO week 1 is the week holding January 4th.
  const jan4 = Date.UTC(y, 0, 4);
  return jan4 - ((new Date(jan4).getUTCDay() || 7) - 1) * 864e5 + (w - 1) * 7 * 864e5;
}

/** The ISO week n weeks after (or before, if negative) the given one. */
export function addWeeks(week: string, n: number) {
  return weekKey(new Date(weekMonday(week) + n * 7 * 864e5), "UTC");
}

/** The date of a team's meeting in the given ISO week. Teams without a weekday meet Monday. */
export function meetingDate(week: string, team: Team | null) {
  return new Date(weekMonday(week) + (((team && DAY_INDEX[team]) || 1) - 1) * 864e5);
}

export function shortDate(d: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(d);
}

/**
 * A member's week-by-week record, from their first logged week to this one.
 * Weeks with no row count as missed and keep the last known commitment. This
 * week stays "open" until it's marked done, so it never breaks a streak.
 */
export function progress(rows: LogRow[], currentWeek: string): Progress {
  const byWeek = new Map(rows.filter((r) => r.week <= currentWeek).map((r) => [r.week, r]));
  const weeks: ProgressWeek[] = [];
  const first = [...byWeek.keys()].sort()[0];
  if (first) {
    let commitment = "";
    for (let wk = first; wk <= currentWeek; wk = addWeeks(wk, 1)) {
      const r = byWeek.get(wk);
      if (r?.commitment) commitment = r.commitment;
      const status: WeekStatus = r?.done ? "done" : wk === currentWeek ? "open" : "missed";
      weeks.push({ week: wk, commitment: r?.commitment || commitment, status, recorded: !!r });
    }
  }
  let streak = 0, best = 0, run = 0;
  for (const w of weeks) {
    if (w.status === "done") best = Math.max(best, ++run);
    else if (w.status === "missed") run = 0;
  }
  for (const w of [...weeks].reverse()) {
    if (w.status === "open") continue;
    if (w.status !== "done") break;
    streak++;
  }
  const counted = weeks.filter((w) => w.status !== "open");
  return { weeks, streak, best, done: counted.filter((w) => w.status === "done").length, total: counted.length };
}

export function progressByMember(rows: LogRow[], currentWeek: string): Record<string, Progress> {
  const out: Record<string, LogRow[]> = {};
  for (const r of rows) (out[r.member_id] ??= []).push(r);
  return Object.fromEntries(Object.entries(out).map(([id, list]) => [id, progress(list, currentWeek)]));
}

export type EarnedMilestone = { key: string; label: string; icon: string };

const STREAKS = [3, 5, 10, 26, 52];
const KEPT = [5, 10, 25, 50, 100];
const KUDOS = [5, 10, 25, 50, 100];

/** The largest step in a ladder that n has reached, and the next one up. */
function ladder(steps: number[], n: number) {
  const hit = steps.filter((s) => n >= s).at(-1);
  return { hit, next: steps.find((s) => n < s) };
}

/**
 * Milestones worked out from the accountability tracker and kudos: a first
 * kept commitment, then the highest streak, follow-through and kudos marks
 * reached, plus the nearest next one to aim for.
 */
export function autoMilestones(p: Progress | undefined, kudos: number): { earned: EarnedMilestone[]; next: string | null } {
  const earned: EarnedMilestone[] = [];
  const best = p?.best ?? 0, kept = p?.done ?? 0;
  if (kept >= 1) earned.push({ key: "first", label: "Kept a first commitment", icon: "\u2713" });
  const s = ladder(STREAKS, best), k = ladder(KEPT, kept), u = ladder(KUDOS, kudos);
  if (s.hit) earned.push({ key: `streak-${s.hit}`, label: `${s.hit}-week streak`, icon: "\u{1F525}" });
  if (k.hit) earned.push({ key: `kept-${k.hit}`, label: `${k.hit} commitments kept`, icon: "\u2B50" });
  if (u.hit) earned.push({ key: `kudos-${u.hit}`, label: `${u.hit} kudos received`, icon: "\u{1F44F}" });
  // The closest goal: the current streak counts toward the next streak mark.
  const goals: [number, string][] = [];
  const streak = p?.streak ?? 0;
  if (kept >= 1) {
    const ns = STREAKS.find((n) => streak < n && n > best) ?? STREAKS.find((n) => streak < n);
    if (ns) goals.push([ns - streak, `${ns - streak} more ${ns - streak === 1 ? "week" : "weeks"} to a ${ns}-week streak`]);
  } else {
    goals.push([1, "Mark a week done to earn a first milestone"]);
  }
  if (k.next && kept >= 1) goals.push([k.next - kept, `${k.next - kept} more to ${k.next} commitments kept`]);
  goals.sort((a, b) => a[0] - b[0]);
  return { earned, next: goals[0]?.[1] ?? null };
}
