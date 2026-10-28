import test from "node:test";
import assert from "node:assert/strict";
import { rsvpLink, rsvpValid } from "./rsvp.ts";

test("email In/Out links only work for their member and meeting", async () => {
  const link = new URL(await rsvpLink("https://app.example", "secret", "11111111-1111-1111-1111-111111111111", "2026-10-28", true));
  const p = Object.fromEntries(link.searchParams);
  assert.equal(link.pathname, "/rsvp");
  assert.equal(p.a, "in");
  assert.ok(await rsvpValid("secret", p.m, p.d, p.k));
  assert.ok(!(await rsvpValid("secret", p.m, "2026-10-29", p.k)));
  assert.ok(!(await rsvpValid("secret", "22222222-2222-2222-2222-222222222222", p.d, p.k)));
  assert.ok(!(await rsvpValid("other", p.m, p.d, p.k)));
});
