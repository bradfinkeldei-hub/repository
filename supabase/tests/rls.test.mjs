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
console.log(`\n${passed} checks passed`);
