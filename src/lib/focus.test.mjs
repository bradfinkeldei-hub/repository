import test from "node:test";
import assert from "node:assert/strict";
import { cleanFocus, focusGaps, focusProgress, progressLabel } from "./focus.ts";
import { coachActions, teamLabel } from "./coaching.ts";

test("the focus is one of their topics and the rest go on the Later list", () => {
  const f = cleanFocus({ topics: ["  Get clients ", "Get fit", "", "Get fit", "Kids"], focus: "Get fit" });
  assert.deepEqual(f.topics, ["Get clients", "Get fit", "Kids"]);
  assert.equal(f.focus, "Get fit");
  assert.deepEqual(f.later, ["Get clients", "Kids"]);
  // A focus that isn't one of their topics falls back to the first.
  assert.equal(cleanFocus({ topics: ["A", "B"], focus: "Z" }).focus, "A");
  // Later items they added themselves are kept, without repeats.
  assert.deepEqual(cleanFocus({ topics: ["A", "B"], focus: "A", later: ["C", "B"] }).later, ["B", "C"]);
});

test("finish-line numbers fit their kind", () => {
  const feel = cleanFocus({ measure_kind: "feeling", measure_start: 4, measure_goal: 15, measure_now: -2 });
  assert.deepEqual([feel.measure_start, feel.measure_goal, feel.measure_now], [4, 10, 0]);
  const num = cleanFocus({ measure_kind: "number", measure_start: 9, measure_goal: 2 });
  assert.deepEqual([num.measure_start, num.measure_goal, num.measure_now], [0, 2, null]);
  const plan = cleanFocus({ measure_kind: "plan", measure_goal: 3 });
  assert.equal(plan.measure_goal, null);
  assert.equal(cleanFocus({ measure_kind: "vibes" }).measure_kind, "");
});

test("progress and gaps", () => {
  assert.equal(focusProgress({ measure_kind: "number", measure_start: 0, measure_goal: 2, measure_now: 1 }), 50);
  assert.equal(focusProgress({ measure_kind: "feeling", measure_start: 4, measure_goal: 7, measure_now: 9 }), 100);
  assert.equal(focusProgress({ measure_kind: "decision", measure_start: null, measure_goal: null, measure_now: null }), null);
  assert.equal(progressLabel({ measure_kind: "number", measure_start: 0, measure_goal: 2, measure_now: 1 }), "1 of 2");
  const gaps = focusGaps({ focus: "A", outcome: "", measure_kind: "plan", measure: "x", meaning: "", start_point: "s", held_by: "h" });
  assert.deepEqual(gaps.map(([s]) => s), ["outcome", "meaning"]);
});

test("the Pilot group is called a group and skips life-wheel nudges", () => {
  assert.equal(teamLabel("Pilot"), "Pilot group");
  assert.equal(teamLabel("Monday"), "Monday team");
  const m = {
    id: "p1", name: "Pat", role: "member", team: "Pilot", wheel: {}, becoming: "", creating: "", accountability: "Call 5 people",
    mission: "", reminder_enabled: true, reminder_day: "Monday", done_week: "", last_reminder_week: "", updated_at: "2026-01-01T00:00:00Z",
  };
  const kinds = coachActions([m], [], [], new Date("2026-11-04T15:00:00Z"), "UTC").map((a) => a.kind);
  assert.ok(!kinds.includes("details") && !kinds.includes("refresh") && !kinds.includes("wheel"), kinds.join());
  const other = coachActions([{ ...m, team: "Tuesday" }], [], [], new Date("2026-11-04T15:00:00Z"), "UTC").map((a) => a.kind);
  assert.ok(other.includes("details"));
});

test("every group except Tuesday uses the Focus cards", async () => {
  const { usesFocusCards } = await import("./coaching.ts");
  assert.equal(usesFocusCards("Tuesday"), false);
  for (const t of ["Monday", "Wednesday", "Thursday", "Example", "Pilot"]) assert.equal(usesFocusCards(t), true, t);
  assert.equal(usesFocusCards(null), false);
});

test("other focuses: answered ones show, and one can become the main focus", async () => {
  const { definedOthers, swapMainFocus } = await import("./focus.ts");
  const other = { outcome: "Run 5K", measure_kind: "", measure: "Finish one", measure_start: null, measure_goal: null, measure_now: null, meaning: "Energy", start_point: "Walk", held_by: "Group", step: 8, confirmed_at: "2026-11-01T00:00:00Z" };
  const card = {
    member_id: "m", topics: ["Clients"], focus: "Clients", later: ["Gym", "Read"], outcome: "10 clients", measure_kind: "number", measure: "10 signed",
    measure_start: 0, measure_goal: 10, measure_now: 3, meaning: "Freedom", start_point: "Call 5", held_by: "Coach", step: 8, confirmed_at: "2026-10-01T00:00:00Z",
    later_details: { Gym: other, Read: { ...other, confirmed_at: null } },
  };
  assert.deepEqual(definedOthers(card).map(([t]) => t), ["Gym"]);
  assert.equal(swapMainFocus(card, "Read"), null);
  const p = swapMainFocus(card, "Gym");
  assert.equal(p.focus, "Gym");
  assert.equal(p.outcome, "Run 5K");
  assert.deepEqual(p.later, ["Clients", "Read"]);
  assert.equal(p.later_details.Clients.outcome, "10 clients");
  assert.equal(p.later_details.Clients.measure_now, 3);
  assert.ok(!("Gym" in p.later_details));
});
