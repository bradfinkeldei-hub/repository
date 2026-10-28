// Checks the access rules in supabase/migrations against an in-memory Postgres
// (PGlite) with a minimal stand-in for Supabase's auth schema.
// Run: npm run test:db
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";

const db = new PGlite();
await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create role authenticated nologin;
  create role anon nologin;
  grant usage on schema auth to authenticated;
`);
const dir = new URL("../migrations/", import.meta.url);
for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), "utf8"));
await db.exec(`
  grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  insert into public.app_settings values ('coach_email', 'coach@example.com');
  insert into public.invites (email, team) values ('mon1@example.com', 'Monday'), ('mon2@example.com', 'Monday'), ('TUE1@example.com', 'Tuesday'), ('stranger@example.com', 'Monday');
`);

async function addUser(email, name) {
  const r = await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [email, { full_name: name }]);
  return r.rows[0].id;
}
const coach = await addUser("coach@example.com", "Brad");
const mon1 = await addUser("mon1@example.com", "Jordan");
const mon2 = await addUser("mon2@example.com", "Priya");
const tue1 = await addUser("tue1@example.com", "Sam");
const stranger = await addUser("stranger@example.com", "Stranger");
// The coach took Stranger off their team.
await db.query(`update public.profiles set team = null where id = $1`, [stranger]);

// Run a query as a signed-in user, with RLS enforced.
async function as(uid, sql, params = []) {
  await db.exec("begin");
  try {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    await db.exec("set local role authenticated");
    const r = await db.query(sql, params);
    await db.exec("commit");
    return r.rows;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
const names = (rows) => rows.map((r) => r.name).sort();
let passed = 0;
const check = async (label, fn) => { await fn(); passed++; console.log("ok -", label); };

await check("new users get the team from their invite, matched without case", async () => {
  const rows = (await db.query(`select name, role, team from public.profiles order by name`)).rows;
  assert.deepEqual(rows.map((r) => [r.name, r.role, r.team]), [
    ["Brad", "coach", null], ["Jordan", "member", "Monday"], ["Priya", "member", "Monday"],
    ["Sam", "member", "Tuesday"], ["Stranger", "member", null],
  ]);
  const open = (await db.query(`select count(*)::int as n from public.invites where accepted_at is null`)).rows[0].n;
  assert.equal(open, 0);
});
await check("people without an invite can't create an account", async () => {
  await assert.rejects(addUser("uninvited@example.com", "Nobody"), /not been invited/);
  await assert.rejects(addUser("mon1@example.com", "Jordan again"), /not been invited/);
});
await check("coach sees every profile", async () => {
  assert.deepEqual(names(await as(coach, `select name from public.profiles`)), ["Brad", "Jordan", "Priya", "Sam", "Stranger"]);
});
await check("Monday member sees only the Monday team", async () => {
  assert.deepEqual(names(await as(mon1, `select name from public.profiles`)), ["Jordan", "Priya"]);
});
await check("Tuesday member sees only the Tuesday team", async () => {
  assert.deepEqual(names(await as(tue1, `select name from public.profiles`)), ["Sam"]);
});
await check("a member can't read another team even by id", async () => {
  assert.equal((await as(tue1, `select name from public.profiles where id = $1`, [mon1])).length, 0);
});
await check("someone without a team sees only themselves", async () => {
  assert.deepEqual(names(await as(stranger, `select name from public.profiles`)), ["Stranger"]);
});
await check("members can't see email addresses, the coach can", async () => {
  assert.equal((await as(mon1, `select email from public.member_contacts where id = $1`, [mon2])).length, 0);
  assert.equal((await as(mon1, `select email from public.member_contacts`)).length, 1);
  assert.equal((await as(coach, `select email from public.member_contacts`)).length, 5);
});
await check("a member edits their own profile", async () => {
  await as(mon1, `update public.profiles set accountability = 'Run 3x' where id = $1`, [mon1]);
  assert.equal((await db.query(`select accountability from public.profiles where id = $1`, [mon1])).rows[0].accountability, "Run 3x");
});
await check("a member can't edit a teammate's profile", async () => {
  await as(mon1, `update public.profiles set accountability = 'hacked' where id = $1`, [mon2]);
  assert.equal((await db.query(`select accountability from public.profiles where id = $1`, [mon2])).rows[0].accountability, "");
});
await check("a member can't move themselves to another team or make themselves coach", async () => {
  await assert.rejects(as(mon1, `update public.profiles set team = 'Tuesday' where id = $1`, [mon1]));
  await assert.rejects(as(mon1, `update public.profiles set role = 'coach' where id = $1`, [mon1]));
});
await check("the coach moves a member, and access follows", async () => {
  await as(coach, `update public.profiles set team = 'Tuesday' where id = $1`, [mon2]);
  assert.deepEqual(names(await as(mon2, `select name from public.profiles`)), ["Priya", "Sam"]);
  assert.deepEqual(names(await as(mon1, `select name from public.profiles`)), ["Jordan"]);
});
await check("invites and coach actions are coach-only", async () => {
  assert.equal((await as(mon1, `select * from public.invites`)).length, 0);
  await assert.rejects(as(mon1, `insert into public.invites (email, team) values ('x@example.com', 'Monday')`));
  await as(coach, `insert into public.coach_actions (custom, text) values (true, 'Call Sam')`);
  assert.equal((await as(mon1, `select * from public.coach_actions`)).length, 0);
  assert.equal((await as(coach, `select * from public.coach_actions`)).length, 1);
});
await check("one free call per month, own bookings only", async () => {
  await as(mon1, `insert into public.bookings (member_id, month, kind) values ($1, '2026-10', 'free')`, [mon1]);
  await assert.rejects(as(mon1, `insert into public.bookings (member_id, month, kind) values ($1, '2026-10', 'free')`, [mon1]));
  await as(mon1, `insert into public.bookings (member_id, month, kind) values ($1, '2026-10', 'paid')`, [mon1]);
  await assert.rejects(as(mon1, `insert into public.bookings (member_id, month, kind) values ($1, '2026-10', 'paid')`, [tue1]));
  assert.equal((await as(tue1, `select * from public.bookings`)).length, 0);
  assert.equal((await as(coach, `select * from public.bookings`)).length, 2);
});
await check("accountability history: own and own team only, writes only your own", async () => {
  await as(mon1, `insert into public.commitment_log (member_id, week, commitment, done) values ($1, '2026-W44', 'Run 3x', true)`, [mon1]);
  await as(tue1, `insert into public.commitment_log (member_id, week, commitment) values ($1, '2026-W44', 'Read')`, [tue1]);
  await assert.rejects(as(mon1, `insert into public.commitment_log (member_id, week) values ($1, '2026-W45')`, [tue1]));
  await as(mon1, `update public.commitment_log set done = true where member_id = $1`, [tue1]);
  assert.equal((await db.query(`select done from public.commitment_log where member_id = $1`, [tue1])).rows[0].done, false);
  // Priya is on Tuesday now, so she sees Sam's history but not Jordan's.
  assert.equal((await as(mon2, `select * from public.commitment_log`)).length, 1);
  assert.equal((await as(mon1, `select * from public.commitment_log`)).length, 1);
  assert.equal((await as(stranger, `select * from public.commitment_log`)).length, 0);
  assert.equal((await as(coach, `select * from public.commitment_log`)).length, 2);
  await as(coach, `update public.commitment_log set done = true where member_id = $1`, [tue1]);
  await assert.rejects(as(mon1, `insert into public.commitment_log (member_id, week) values ($1, 'week 1')`, [mon1]));
});
await check("only the coach can remove members", async () => {
  await as(mon1, `delete from public.profiles where id = $1`, [tue1]);
  assert.equal((await db.query(`select count(*)::int as n from public.profiles`)).rows[0].n, 5);
});
await check("everyone sees team names, only the coach renames them", async () => {
  assert.equal((await as(tue1, `select name from public.team_names where team = 'Monday'`))[0].name, "Monday team");
  await as(mon1, `update public.team_names set name = 'Hacked' where team = 'Monday'`);
  await assert.rejects(as(mon1, `insert into public.team_names values ('Example', 'Hacked')`));
  await as(coach, `insert into public.team_names values ('Monday', 'Trailblazers') on conflict (team) do update set name = excluded.name`);
  assert.equal((await as(mon1, `select name from public.team_names where team = 'Monday'`))[0].name, "Trailblazers");
  await assert.rejects(as(coach, `update public.team_names set name = '  ' where team = 'Monday'`));
});
await check("meeting check-in: answer for yourself, see your own team, coach sends roll calls", async () => {
  await as(mon1, `insert into public.attendance (member_id, meeting, going) values ($1, '2026-10-26', true)`, [mon1]);
  await as(tue1, `insert into public.attendance (member_id, meeting, going) values ($1, '2026-10-27', false)`, [tue1]);
  await assert.rejects(as(mon1, `insert into public.attendance (member_id, meeting, going) values ($1, '2026-10-27', true)`, [mon2]));
  await as(mon1, `update public.attendance set going = true where member_id = $1`, [tue1]);
  assert.equal((await db.query(`select going from public.attendance where member_id = $1`, [tue1])).rows[0].going, false);
  // Priya is on Tuesday with Sam, so she sees his answer but not Jordan's.
  assert.equal((await as(mon2, `select * from public.attendance`)).length, 1);
  assert.equal((await as(mon1, `select * from public.attendance`)).length, 1);
  assert.equal((await as(coach, `select * from public.attendance`)).length, 2);
  await as(coach, `insert into public.attendance (member_id, meeting, going) values ($1, '2026-10-27', true)`, [mon2]);

  await assert.rejects(as(mon1, `insert into public.roll_calls (team, meeting) values ('Monday', '2026-10-26')`));
  await as(coach, `insert into public.roll_calls (team, meeting, meeting_url) values ('Monday', '2026-10-26', 'https://zoom.us/j/1'), ('Tuesday', '2026-10-27', '')`);
  assert.deepEqual((await as(mon1, `select team from public.roll_calls`)).map((r) => r.team), ["Monday"]);
  assert.equal((await as(coach, `select * from public.roll_calls`)).length, 2);
  await assert.rejects(as(coach, `insert into public.roll_calls (team, meeting, meeting_url) values ('Wednesday', '2026-10-28', 'javascript:alert(1)')`));
});
await check("archived members drop out of their team until the coach restores them", async () => {
  await assert.rejects(as(tue1, `update public.profiles set archived_at = now() where id = $1`, [tue1]));
  await as(mon2, `update public.profiles set archived_at = now() where id = $1`, [tue1]);
  await as(coach, `update public.profiles set archived_at = now() where id = $1`, [tue1]);
  // Priya no longer sees Sam, and Sam no longer sees his team, its answers or its roll calls.
  assert.deepEqual(names(await as(mon2, `select name from public.profiles`)), ["Priya"]);
  assert.deepEqual(names(await as(tue1, `select name from public.profiles`)), ["Sam"]);
  assert.equal((await as(tue1, `select * from public.roll_calls`)).length, 0);
  await assert.rejects(as(tue1, `update public.profiles set archived_at = null where id = $1`, [tue1]));
  assert.equal((await as(coach, `select * from public.profiles where archived_at is not null`)).length, 1);
  await as(coach, `update public.profiles set archived_at = null where id = $1`, [tue1]);
  assert.deepEqual(names(await as(mon2, `select name from public.profiles`)), ["Priya", "Sam"]);
});
await check("teammates comment on and give kudos to each other's cards, and the member can close their thread", async () => {
  // Sam is on Tuesday with Priya; Jordan is on Monday.
  await as(mon2, `insert into public.card_comments (member_id, body) values ($1, 'Proud of you')`, [tue1]);
  await assert.rejects(as(mon1, `insert into public.card_comments (member_id, body) values ($1, 'Hi')`, [tue1]));
  // The author is always whoever is signed in, whatever the request says.
  await as(mon2, `insert into public.card_comments (member_id, author_id, author_name, body) values ($1, $2, 'Brad', 'Fake')`, [tue1, coach]);
  assert.deepEqual((await db.query(`select author_name from public.card_comments where body = 'Fake'`)).rows.map((r) => r.author_name), ["Priya"]);
  await as(coach, `insert into public.card_comments (member_id, body) values ($1, 'Great week')`, [tue1]);
  const seen = await as(mon2, `select author_name from public.card_comments where member_id = $1 order by created_at`, [tue1]);
  assert.deepEqual(seen.map((r) => r.author_name).sort(), ["Brad", "Priya", "Priya"]);
  assert.equal((await as(mon1, `select * from public.card_comments`)).length, 0);

  // Sam closes his thread: Priya can't add more, Sam and the coach still can, Priya can't reopen it.
  await as(tue1, `update public.profiles set thread_open = false where id = $1`, [tue1]);
  await assert.rejects(as(mon2, `insert into public.card_comments (member_id, body) values ($1, 'One more')`, [tue1]));
  await as(tue1, `insert into public.card_comments (member_id, body) values ($1, 'Thanks all')`, [tue1]);
  await as(coach, `insert into public.card_comments (member_id, body) values ($1, 'Still here')`, [tue1]);
  await as(mon2, `update public.profiles set thread_open = true where id = $1`, [tue1]);
  assert.equal((await db.query(`select thread_open from public.profiles where id = $1`, [tue1])).rows[0].thread_open, false);
  await as(tue1, `update public.profiles set thread_open = true where id = $1`, [tue1]);

  // Sam can take down a comment on his card; Priya can't take down the coach's.
  await as(mon2, `delete from public.card_comments where author_name = 'Brad'`);
  assert.equal((await db.query(`select count(*)::int as n from public.card_comments where author_name = 'Brad'`)).rows[0].n, 2);
  await as(tue1, `delete from public.card_comments where body = 'Still here'`);
  assert.equal((await db.query(`select count(*)::int as n from public.card_comments where author_name = 'Brad'`)).rows[0].n, 1);

  // Kudos: once a week, never to yourself, only to teammates.
  await as(mon2, `insert into public.kudos (member_id, week) values ($1, '2026-W44')`, [tue1]);
  await assert.rejects(as(mon2, `insert into public.kudos (member_id, week) values ($1, '2026-W44')`, [tue1]));
  await assert.rejects(as(tue1, `insert into public.kudos (member_id, week) values ($1, '2026-W44')`, [tue1]));
  await assert.rejects(as(mon1, `insert into public.kudos (member_id, week) values ($1, '2026-W44')`, [tue1]));
  await as(coach, `insert into public.kudos (member_id, week) values ($1, '2026-W44')`, [tue1]);
  assert.deepEqual((await as(tue1, `select author_name from public.kudos`)).map((r) => r.author_name).sort(), ["Brad", "Priya"]);
  await as(tue1, `delete from public.kudos`);
  assert.equal((await db.query(`select count(*)::int as n from public.kudos`)).rows[0].n, 2);
  await as(mon2, `delete from public.kudos where member_id = $1`, [tue1]);
  assert.equal((await db.query(`select count(*)::int as n from public.kudos`)).rows[0].n, 1);
  await as(mon2, `insert into public.kudos (member_id, week) values ($1, '2026-W44')`, [tue1]);

  // Milestones: on your own card or by the coach; teammates can see but not add.
  await as(tue1, `insert into public.milestones (member_id, title) values ($1, 'Ran my first 5k')`, [tue1]);
  await as(coach, `insert into public.milestones (member_id, title, achieved_on) values ($1, 'Six months in the circle', '2026-10-01')`, [tue1]);
  await assert.rejects(as(mon2, `insert into public.milestones (member_id, title) values ($1, 'Nope')`, [tue1]));
  assert.equal((await as(mon2, `select * from public.milestones`)).length, 2);
  assert.equal((await as(mon1, `select * from public.milestones`)).length, 0);
  await as(mon2, `delete from public.milestones`);
  assert.equal((await db.query(`select count(*)::int as n from public.milestones`)).rows[0].n, 2);
});
await check("members tick off their own commitments, not a teammate's", async () => {
  await as(tue1, `insert into public.commitment_log (member_id, week, commitment, checked) values ($1, '2026-W44', 'Run 3x\nRead', '{"Run 3x"}')
    on conflict (member_id, week) do update set checked = excluded.checked`, [tue1]);
  await as(mon2, `update public.commitment_log set checked = '{}' where member_id = $1`, [tue1]);
  assert.deepEqual((await db.query(`select checked from public.commitment_log where member_id = $1 and week = '2026-W44'`, [tue1])).rows[0].checked, ["Run 3x"]);
});
await check("members mark only their own comments as seen", async () => {
  await as(tue1, `insert into public.thread_seen (member_id) values ($1)`, [tue1]);
  await assert.rejects(as(mon2, `insert into public.thread_seen (member_id) values ($1)`, [tue1]));
  await assert.rejects(as(mon2, `insert into public.thread_seen (member_id) values ($1)`, [mon1]));
  await as(mon2, `update public.thread_seen set seen_at = now() - interval '1 year' where member_id = $1`, [tue1]);
  assert.equal((await as(mon2, `select * from public.thread_seen`)).length, 0);
  assert.equal((await as(tue1, `select * from public.thread_seen`)).length, 1);
  assert.equal((await as(coach, `select * from public.thread_seen`)).length, 1);
});
await check("an archived member's card, comments and kudos are hidden until they're restored", async () => {
  await as(coach, `update public.profiles set archived_at = now() where id = $1`, [mon2]);
  // Priya's comment and kudos on Sam's card disappear for Sam, and for the coach too.
  assert.deepEqual((await as(tue1, `select author_name from public.card_comments`)).map((r) => r.author_name).sort(), ["Brad", "Sam"]);
  assert.deepEqual((await as(tue1, `select author_name from public.kudos`)).map((r) => r.author_name), ["Brad"]);
  assert.equal((await as(coach, `select * from public.kudos`)).length, 1);
  await assert.rejects(as(mon2, `insert into public.card_comments (member_id, body) values ($1, 'Back?')`, [tue1]));
  await as(coach, `update public.profiles set archived_at = null where id = $1`, [mon2]);
  assert.equal((await as(tue1, `select * from public.kudos`)).length, 2);
});
await check("only the coach can read or write private notes", async () => {
  await as(coach, `insert into public.coach_notes (member_id, body) values ($1, 'New job stress, check in on Career')`, [mon1]);
  assert.equal((await as(coach, `select * from public.coach_notes`)).length, 1);
  assert.equal((await as(mon1, `select * from public.coach_notes`)).length, 0);
  assert.equal((await as(mon2, `select * from public.coach_notes`)).length, 0);
  await assert.rejects(as(mon1, `insert into public.coach_notes (member_id, body) values ($1, 'Sneaky')`, [mon1]));
  await as(mon1, `delete from public.coach_notes`);
  await as(mon1, `update public.coach_notes set body = 'changed'`);
  assert.equal((await db.query(`select body from public.coach_notes`)).rows[0].body, "New job stress, check in on Career");
});
await check("authors and the coach edit comments, members and the coach edit milestones, givers change their kudos note", async () => {
  // Priya edits her own comment on Sam's card; the database marks it edited by her.
  await as(mon2, `update public.card_comments set body = 'So proud of you' where body = 'Proud of you'`);
  const [c] = (await db.query(`select body, edited_at, edited_by, author_id from public.card_comments where body = 'So proud of you'`)).rows;
  assert.ok(c.edited_at);
  assert.equal(c.edited_by, mon2);
  // Sam can't reword Priya's comment even though it's on his card, and Jordan can't either.
  await as(tue1, `update public.card_comments set body = 'Sam wrote this' where body = 'So proud of you'`);
  await as(mon1, `update public.card_comments set body = 'Jordan wrote this' where body = 'So proud of you'`);
  assert.equal((await db.query(`select count(*)::int as n from public.card_comments where body = 'So proud of you'`)).rows[0].n, 1);
  // Only the words change: who wrote it, whose card and when stay put.
  await as(mon2, `update public.card_comments set author_id = $1, author_name = 'Brad', member_id = $2, created_at = '2020-01-01', body = 'Edited again' where body = 'So proud of you'`, [coach, mon2]);
  const [after] = (await db.query(`select author_id, author_name, member_id, created_at from public.card_comments where body = 'Edited again'`)).rows;
  assert.deepEqual([after.author_id, after.author_name, after.member_id], [mon2, "Priya", tue1]);
  assert.notEqual(new Date(after.created_at).getFullYear(), 2020);
  // The coach can edit anyone's comment.
  await as(coach, `update public.card_comments set body = 'Kept it kind' where body = 'Edited again'`);
  assert.equal((await db.query(`select edited_by from public.card_comments where body = 'Kept it kind'`)).rows[0].edited_by, coach);

  // Milestones: Sam on his own card and the coach; not teammates.
  await as(tue1, `update public.milestones set title = 'Ran my first 10k', achieved_on = '2026-10-20' where title = 'Ran my first 5k'`);
  await as(mon2, `update public.milestones set title = 'Nope' where member_id = $1`, [tue1]);
  await as(coach, `update public.milestones set title = 'Half a year in the circle' where title = 'Six months in the circle'`);
  assert.deepEqual((await db.query(`select title from public.milestones order by title`)).rows.map((r) => r.title), ["Half a year in the circle", "Ran my first 10k"]);

  // Kudos: the giver can add a note; nobody else can change it or move the kudos to another week.
  await as(mon2, `update public.kudos set note = 'Loved your share tonight', week = '2026-W01' where author_id = $1`, [mon2]);
  await as(tue1, `update public.kudos set note = 'Hacked' where author_id = $1`, [mon2]);
  await as(coach, `update public.kudos set note = 'Coach changed it' where author_id = $1`, [mon2]);
  assert.deepEqual((await db.query(`select note, week from public.kudos where author_id = $1`, [mon2])).rows.map((r) => [r.note, r.week]), [["Loved your share tonight", "2026-W44"]]);
  await assert.rejects(as(mon2, `update public.kudos set note = repeat('x', 141) where author_id = $1`, [mon2]));

  // Private notes: the coach edits and it's marked; members still can't.
  await as(coach, `update public.coach_notes set body = 'New job going better'`);
  assert.ok((await db.query(`select edited_at from public.coach_notes`)).rows[0].edited_at);
});
await check("only the coach sets meeting times; everyone can read them", async () => {
  await as(coach, `update public.team_names set meeting_time = '19:00', meeting_url = 'https://meet.google.com/abc' where team = 'Monday'`);
  await as(mon1, `update public.team_names set meeting_time = '06:00' where team = 'Monday'`);
  assert.deepEqual((await as(mon1, `select meeting_time from public.team_names where team = 'Monday'`)).map((r) => r.meeting_time), ["19:00"]);
  await assert.rejects(as(coach, `update public.team_names set meeting_time = '7pm' where team = 'Monday'`));
});
console.log(`\n${passed} checks passed`);
