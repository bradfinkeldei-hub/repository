import test from "node:test";
import assert from "node:assert/strict";
import { coachActions, monthKey, teamAverage, weekKey, weekdayName } from "./coaching.ts";

const TZ = "America/Chicago";
const base = {
  role: "member", wheel: {}, creating: "", accountability: "Run 3x", mission: "",
  reminder_enabled: true, reminder_day: "Monday", done_week: "", last_reminder_week: "",
  created_at: "2026-10-20T00:00:00Z", updated_at: "2026-10-20T00:00:00Z",
};
const member = (o) => ({ ...base, ...o });

test("weeks, days and months follow the coach's time zone", () => {
  // 03:00 UTC Monday is still Sunday evening in Chicago.
  const d = new Date("2026-10-26T03:00:00Z");
  assert.equal(weekdayName(d, TZ), "Sunday");
  assert.equal(weekdayName(d, "UTC"), "Monday");
  assert.equal(weekKey(d, TZ), "2026-W43");
  assert.equal(weekKey(d, "UTC"), "2026-W44");
  assert.equal(monthKey(new Date("2026-11-01T03:00:00Z"), TZ), "2026-10");
});

test("check-ins appear only after the team's day, until the week is marked done", () => {
  const tue = new Date("2026-10-27T18:00:00Z");
  const wk = weekKey(tue, TZ);
  const list = coachActions([
    member({ id: "a", name: "Ann Lee", team: "Monday" }),
    member({ id: "b", name: "Bo", team: "Wednesday" }),
    member({ id: "c", name: "Cy", team: "Monday", done_week: wk }),
  ], [], [], tue, TZ);
  const checkins = list.filter((s) => s.kind === "checkin").map((s) => s.memberId);
  assert.deepEqual(checkins, ["a"]);
  assert.equal(list.find((s) => s.memberId === "a").text, "Check in with Ann");
});

test("other suggestions, done marks and ordering", () => {
  const now = new Date("2026-12-01T18:00:00Z");
  const wk = weekKey(now, TZ);
  const list = coachActions([
    member({ id: "d", name: "Di", team: null, accountability: "", wheel: { health: 2, money: 8 }, reminder_enabled: false }),
  ], [{ id: `g_${wk}_d_commit`, custom: false, text: "", member_id: "d", done: true, week: wk },
      { id: "x1", custom: true, text: "Text Di", member_id: "d", done: false, week: wk }],
  [{ id: "k1", member_id: "d", month: "2026-12", kind: "paid", created_at: "2026-11-30T00:00:00Z" }], now, TZ);
  const kinds = list.map((s) => s.kind);
  for (const k of ["commit", "wheel", "team", "remind", "refresh", "call", "custom"]) assert.ok(kinds.includes(k), k);
  assert.equal(list.find((s) => s.kind === "commit").done, true);
  assert.equal(list[0].level, "high");
  assert.equal(list.at(-1).level, "low");
});

test("team average ignores unrated areas", () => {
  const avg = teamAverage([{ wheel: { health: 4 } }, { wheel: { health: 7, money: 5 } }, { wheel: {} }]);
  assert.equal(avg.health, 5.5);
  assert.equal(avg.money, 5);
});
