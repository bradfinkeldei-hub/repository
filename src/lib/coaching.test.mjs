import test from "node:test";
import assert from "node:assert/strict";
import { addWeeks, calendarEvent, clockLabel, coachActions, googleCalendarUrl, meetingIcs, dateKey, meetingDate, meetingWhen, nextMeeting, monthKey, progress, teamAverage, teamLabel, teamOptions, weekKey, weekdayName } from "./coaching.ts";

const TZ = "America/Chicago";
const base = {
  role: "member", wheel: {}, becoming: "", creating: "", accountability: "Run 3x", mission: "",
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

test("week arithmetic and meeting dates", () => {
  assert.equal(addWeeks("2026-W44", 1), "2026-W45");
  assert.equal(addWeeks("2026-W53", 1), "2027-W01");
  assert.equal(addWeeks("2027-W01", -1), "2026-W53");
  assert.equal(meetingDate("2026-W44", "Tuesday").toISOString().slice(0, 10), "2026-10-27");
  assert.equal(meetingDate("2026-W44", "Example").toISOString().slice(0, 10), "2026-10-26");
});

test("progress fills gaps, carries commitments and counts streaks", () => {
  const row = (week, done, commitment = "") => ({ member_id: "a", week, done, commitment });
  const p = progress([
    row("2026-W40", true, "Run 3x"), row("2026-W41", true), row("2026-W43", true, "Write daily"),
    row("2026-W44", true), row("2026-W45", false), row("2026-W50", true),
  ], "2026-W45");
  assert.deepEqual(p.weeks.map((w) => w.status), ["done", "done", "missed", "done", "done", "open"]);
  assert.equal(p.weeks[2].commitment, "Run 3x");
  assert.equal(p.weeks[2].recorded, false);
  assert.equal(p.weeks[5].commitment, "Write daily");
  assert.equal(p.streak, 2);
  assert.equal(p.best, 2);
  assert.equal(p.done, 4);
  assert.equal(p.total, 5);
  assert.equal(progress([row("2026-W44", false, "x")], "2026-W45").streak, 0);
  assert.deepEqual(progress([], "2026-W45").weeks, []);
});

test("team names: the coach's name wins, blanks fall back to the day", () => {
  const names = { Monday: "Trailblazers", Tuesday: "  " };
  assert.equal(teamLabel("Monday", names), "Trailblazers");
  assert.equal(teamLabel("Tuesday", names), "Tuesday team");
  assert.equal(teamLabel("Wednesday"), "Wednesday team");
  assert.equal(teamLabel(null, names), "Not on a team");
  assert.deepEqual(teamOptions(names)[0], ["Monday", "Trailblazers"]);
});

test("the next meeting counts today, follows the team's day, and Example meets today", () => {
  // Tuesday Oct 27, 2026, 9pm Chicago (02:00 UTC Wednesday).
  const tueNight = new Date("2026-10-28T02:00:00Z");
  assert.equal(dateKey(tueNight, TZ), "2026-10-27");
  assert.equal(nextMeeting("Tuesday", tueNight, TZ), "2026-10-27");
  assert.equal(nextMeeting("Wednesday", tueNight, TZ), "2026-10-28");
  assert.equal(nextMeeting("Monday", tueNight, TZ), "2026-11-02");
  assert.equal(nextMeeting("Example", tueNight, TZ), "2026-10-27");
  assert.equal(meetingWhen("2026-10-27", tueNight, TZ), "tonight");
  assert.equal(meetingWhen("2026-11-02", tueNight, TZ), "Monday, Nov 2");
});

test("milestones come from streaks, kept commitments and kudos", async () => {
  const { autoMilestones } = await import("./coaching.ts");
  assert.deepEqual(autoMilestones(undefined, 0), { earned: [], next: "Mark a week done to earn a first milestone" });
  const p = { weeks: [], streak: 2, best: 4, done: 7, total: 9 };
  const { earned, next } = autoMilestones(p, 12);
  assert.deepEqual(earned.map((m) => m.label), ["Kept a first commitment", "3-week streak", "5 commitments kept", "10 kudos received"]);
  // A 5-week streak is 3 weeks away from a current streak of 2; 10 kept is 3 away too, streak wins the tie.
  assert.equal(next, "3 more weeks to a 5-week streak");
  assert.equal(autoMilestones({ ...p, streak: 4, best: 4, done: 9 }, 0).next, "1 more week to a 5-week streak");
  assert.equal(autoMilestones({ ...p, streak: 0, best: 4, done: 9 }, 0).next, "1 more to 10 commitments kept");
});

test("vague commitments get a coach nudge to make them specific", async () => {
  const { isVagueCommitment } = await import("./coaching.ts");
  assert.equal(isVagueCommitment("Busines goals, physical and health goals, energy retention goals."), true);
  assert.equal(isVagueCommitment("Health"), true);
  assert.equal(isVagueCommitment("Be better with money"), true);
  assert.equal(isVagueCommitment("Work out 4 mornings"), false);
  assert.equal(isVagueCommitment("Phone off by 9pm every night"), false);
  assert.equal(isVagueCommitment("Call two old friends"), false);
  assert.equal(isVagueCommitment("Clear the garage on Saturday"), false);
  assert.equal(isVagueCommitment(""), false);
  const shad = member({ id: "s", name: "Shad", team: "Tuesday", accountability: "Business goals, health goals" });
  const acts = coachActions([shad], [], [], new Date("2026-10-28T18:00:00Z"), TZ);
  assert.ok(acts.some((a) => a.kind === "commit" && a.text === "Help Shad make their commitment specific"));
  assert.ok(acts.some((a) => a.kind === "checkin"));
});

test("up to three commitments, one per line", async () => {
  const { commitmentList, joinCommitments } = await import("./coaching.ts");
  assert.deepEqual(commitmentList("Run 3x"), ["Run 3x"]);
  assert.deepEqual(commitmentList(" Run 3x \n\n Read nightly \nCall Mom\nOne too many"), ["Run 3x", "Read nightly", "Call Mom"]);
  assert.deepEqual(commitmentList(""), []);
  assert.equal(joinCommitments(["Run 3x", "", "  Read\n nightly ", "Call Mom", "Extra"]), "Run 3x\nRead nightly\nCall Mom");
});

test("a team's weekly meeting becomes a repeating calendar event", () => {
  const now = new Date("2026-10-28T17:00:00Z"); // Wednesday in Chicago
  const opts = { title: "Thursday team meeting", details: "Weekly circle; bring your wins", now, timeZone: TZ };
  assert.equal(calendarEvent("Thursday", { time: "", minutes: 60, url: "" }, opts), null);
  assert.equal(calendarEvent("Example", { time: "19:00", minutes: 60, url: "" }, opts), null);
  const e = calendarEvent("Thursday", { time: "23:30", minutes: 90, url: "https://meet.google.com/abc" }, opts);
  assert.equal(e.start, "20261029T233000");
  assert.equal(e.end, "20261030T010000");
  const g = new URL(googleCalendarUrl(e));
  assert.equal(g.searchParams.get("dates"), "20261029T233000/20261030T010000");
  assert.equal(g.searchParams.get("recur"), "RRULE:FREQ=WEEKLY;BYDAY=TH");
  assert.equal(g.searchParams.get("ctz"), TZ);
  assert.equal(g.searchParams.get("location"), "https://meet.google.com/abc");
  const ics = meetingIcs(e, now);
  assert.match(ics, /\r\nDTSTART;TZID=America\/Chicago:20261029T233000\r\n/);
  assert.match(ics, /\r\nRRULE:FREQ=WEEKLY;BYDAY=TH\r\n/);
  assert.match(ics, /\r\nDESCRIPTION:Weekly circle\\; bring your wins\r\n/);
  assert.match(ics, /\r\nUID:team-thursday-meeting@coaching-circle\r\n/);
  assert.equal(clockLabel("19:05"), "7:05 PM");
  assert.equal(clockLabel("00:30"), "12:30 AM");
});
