import test from "node:test";
import assert from "node:assert/strict";
import { rsvpLink, rsvpValid } from "./rsvp.ts";

const M = "11111111-1111-1111-1111-111111111111";

test("email In/Out links only work for their member and meeting", async () => {
  const link = new URL(await rsvpLink("https://app.example", "secret", M, "2026-10-28", true));
  const [, , a, m, d, k] = link.pathname.split("/");
  assert.equal(link.search, "");
  assert.equal(a, "in");
  assert.equal(link.href, link.href.toLowerCase());
  assert.ok(await rsvpValid("secret", m, d, k));
  assert.ok(await rsvpValid("secret", m.toUpperCase(), d, k.toUpperCase()), "survives a filter changing case");
  assert.ok(!(await rsvpValid("secret", m, "2026-10-29", k)));
  assert.ok(!(await rsvpValid("secret", "22222222-2222-2222-2222-222222222222", d, k)));
  assert.ok(!(await rsvpValid("other", m, d, k)));
});
