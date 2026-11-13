// Run: node --test protocol.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const P = createRequire(import.meta.url)("./protocol.js");
const h = (s) => Uint8Array.from(s.split(" ").map((x) => parseInt(x, 16)));

test("format A frames match the published captures", () => {
  assert.equal(P.hex(P.A.poll()), "BA AB 04 CC 00 00 00 35");
  assert.equal(P.hex(P.A.up()[0]), "BA AB 04 BB A2 00 00 C6");
  assert.equal(P.hex(P.A.down()[0]), "BA AB 04 BB A3 00 00 C7");
  assert.deepEqual(P.A.stop().map((f) => f[4]), [0xa4, 0xa1, 0xa4]);
});

test("format A status parses", () => {
  const f = new Uint8Array(18);
  f[4] = 1; f[5] = 1; f[6] = 4; f[9] = 128; f[10] = 0; f[11] = 51; f[12] = 0; f[13] = 180;
  const s = P.A.parse(f);
  assert.equal(s.power, "running"); assert.equal(s.level, 4);
  assert.equal(s.volts, 12.8); assert.equal(s.ambient, 21); assert.equal(s.body, 180);
  f[5] = 0xff; f[6] = 8;
  assert.equal(P.A.parse(f).power, "error"); assert.equal(P.A.parse(f).fault, 8);
});

test("format B frames match hcalory-control", () => {
  assert.equal(P.hex(P.B.start()[0]), "00 02 00 01 00 01 00 0E 04 00 00 09 00 00 00 00 00 00 00 00 02 0F");
  assert.equal(P.hex(P.B.poll()).slice(-5), "00 0D");
});

test("format B status parses (thermostat, °F)", () => {
  const f = new Uint8Array(39);
  f[20] = 133; f[21] = 1; f[22] = 74; f[25] = 132;
  f[27] = 0x08; f[28] = 0xd4; // 2260 -> 226
  f[30] = 0x03; f[31] = 0x66; // 870 -> 87
  const s = P.B.parse(f);
  assert.equal(s.power, "running"); assert.equal(s.mode, "thermostat");
  assert.equal(s.setpoint, 74); assert.equal(s.body, 226); assert.equal(s.ambient, 87); assert.equal(s.volts, 13.2);
});

test("simulator answers format A only", async () => {
  const sim = new P.SimHeater(); await sim.connect();
  let got = null; sim.onNotify((x) => (got = x));
  await sim.write(P.B.poll()); await new Promise((r) => setTimeout(r, 100));
  assert.equal(got, null);
  await sim.write(P.A.poll()); await new Promise((r) => setTimeout(r, 100));
  assert.ok(P.A.looksLike(got)); sim.disconnect();
});
