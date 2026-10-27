// Shared rules for life wheels, weeks and the coach's suggested actions.

/** "Book a call" is switched off for now. Set to true to bring it back everywhere. */
export const BOOKING_ENABLED = false;

export const AREAS = [
  ["health", "Health"],
  ["career", "Career"],
  ["money", "Money"],
  ["love", "Love"],
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

export function teamLabel(team: Team | null) {
  return team ? `${team} team` : "Not on a team";
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
      id: r.id, kind: "custom", level: "mid", text: r.text, why: m ? `${m.name} · ${teamLabel(m.team)}` : "",
      team: m?.team ?? null, memberId: r.member_id, done: r.done, custom: true,
    });
  }
  const order = { high: 0, mid: 1, low: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
