// The Focus walkthrough for the Pilot group: seven questions a new member answers
// one at a time, which become their Focus card on the Group board.

export const MEASURE_KINDS = [
  ["decision", "A decision"],
  ["plan", "A plan"],
  ["number", "A number"],
  ["feeling", "A feeling scale"],
] as const;
export type MeasureKind = (typeof MEASURE_KINDS)[number][0];

/** A member's answers (table focus_cards). */
export type Focus = {
  member_id: string;
  topics: string[];
  focus: string;
  later: string[];
  outcome: string;
  measure_kind: MeasureKind | "";
  measure: string;
  measure_start: number | null;
  measure_goal: number | null;
  measure_now: number | null;
  meaning: string;
  start_point: string;
  held_by: string;
  step: number;
  confirmed_at: string | null;
};

export type FocusAnswers = Omit<Focus, "member_id" | "confirmed_at">;

/** The walkthrough's screens, in order. "pick" only shows when they named more than one topic. */
export const FOCUS_STEPS = ["welcome", "topic", "pick", "outcome", "measure", "meaning", "start", "summary", "held"] as const;
export type FocusStep = (typeof FOCUS_STEPS)[number];

/** Ideas to tap on the last question. */
export const HELD_IDEAS = ["A weekly check-in from my coach", "Someone in my group checks on me", "I report back at our meeting"];

export const EMPTY_FOCUS: FocusAnswers = {
  topics: [], focus: "", later: [], outcome: "", measure_kind: "", measure: "",
  measure_start: null, measure_goal: null, measure_now: null, meaning: "", start_point: "", held_by: "", step: 0,
};

const clip = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const whole = (v: unknown, lo: number, hi: number) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null;
};

/**
 * Cleans what the walkthrough sends before it's saved: trims and caps every answer,
 * keeps the focus one of their topics, puts the other topics on the Later list,
 * and keeps the finish line's numbers in range for its kind.
 */
export function cleanFocus(input: Partial<Record<keyof FocusAnswers, unknown>>): FocusAnswers {
  const topics = (Array.isArray(input.topics) ? input.topics : []).map((t) => clip(t, 300)).filter(Boolean)
    .filter((t, i, a) => a.indexOf(t) === i).slice(0, 10);
  const wanted = clip(input.focus, 300);
  const focus = topics.includes(wanted) ? wanted : topics[0] ?? "";
  const kind = MEASURE_KINDS.some(([k]) => k === input.measure_kind) ? (input.measure_kind as MeasureKind) : "";
  const hi = kind === "feeling" ? 10 : 1000;
  const counted = kind === "number" || kind === "feeling";
  const extra = Array.isArray(input.later) ? input.later.map((t) => clip(t, 300)) : [];
  const later = [...topics, ...extra].filter((t, i, a) => t && t !== focus && a.indexOf(t) === i).slice(0, 10);
  return {
    topics,
    focus,
    later,
    outcome: clip(input.outcome, 600),
    measure_kind: kind,
    measure: clip(input.measure, 600),
    measure_start: !counted ? null : kind === "number" ? 0 : whole(input.measure_start, 0, 10),
    measure_goal: counted ? whole(input.measure_goal, kind === "feeling" ? 0 : 1, hi) : null,
    measure_now: counted ? whole(input.measure_now, 0, hi) : null,
    meaning: clip(input.meaning, 600),
    start_point: clip(input.start_point, 300),
    held_by: clip(input.held_by, 400),
    step: whole(input.step, 0, FOCUS_STEPS.length - 1) ?? 0,
  };
}

/** Which answers are still blank, in question order. Empty once the card can be built. */
export function focusGaps(f: Pick<FocusAnswers, "focus" | "outcome" | "measure" | "measure_kind" | "meaning" | "start_point" | "held_by">) {
  const gaps: [FocusStep, string][] = [];
  if (!f.focus) gaps.push(["topic", "your focus"]);
  if (!f.outcome) gaps.push(["outcome", "what you want to create"]);
  if (!f.measure_kind || !f.measure) gaps.push(["measure", "how you'll know"]);
  if (!f.meaning) gaps.push(["meaning", "what it will mean to you"]);
  if (!f.start_point) gaps.push(["start", "where to start"]);
  if (!f.held_by) gaps.push(["held", "how to hold you accountable"]);
  return gaps;
}

/** How far along the finish line they are, 0 to 100, for numbers and feeling scales. Null when it isn't counted. */
export function focusProgress(f: Pick<FocusAnswers, "measure_kind" | "measure_start" | "measure_goal" | "measure_now">) {
  if (f.measure_kind !== "number" && f.measure_kind !== "feeling") return null;
  const start = f.measure_start ?? 0, goal = f.measure_goal, now = f.measure_now ?? start;
  if (goal === null || goal === start) return null;
  return Math.round(Math.max(0, Math.min(1, (now - start) / (goal - start))) * 100);
}

/** "2 of 2", "5 → 7 out of 10 (now 6)" */
export function progressLabel(f: Pick<FocusAnswers, "measure_kind" | "measure_start" | "measure_goal" | "measure_now">) {
  if (f.measure_goal === null) return "";
  if (f.measure_kind === "number") return `${f.measure_now ?? 0} of ${f.measure_goal}`;
  if (f.measure_kind === "feeling") return `Now ${f.measure_now ?? f.measure_start ?? "?"} out of 10, aiming for ${f.measure_goal}`;
  return "";
}
