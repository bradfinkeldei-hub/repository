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

const G = createRequire(import.meta.url)("./govee.js");
test("Govee H5075 packed format", () => {
  // 0x03 0x45 0x7B = 214395 -> 21.4°C, 39.5 %, battery 87
  const r = G.decode(0xec88, [0x00, 0x03, 0x45, 0x7b, 87, 0x00], "GVH5075_1A2B");
  assert.equal(r.tempC, 21.4); assert.equal(r.hum, 39.5); assert.equal(r.batt, 87); assert.equal(r.model, "H5075");
});
test("Govee negative temperature", () => {
  const r = G.decode(0xec88, [0x00, 0x80 | 0x00, 0xc3, 0x50, 60, 0x00], "GVH5075"); // -5.0°C, 0 %
  assert.equal(r.tempC, -5);
});
test("Govee H5101 / H5100 format", () => {
  const r = G.decode(0x0001, [0x01, 0x01, 0x03, 0x45, 0x7b, 64], "GVH5101_AB12");
  assert.equal(r.tempC, 21.4); assert.equal(r.batt, 64);
});
test("Govee H5074 and H5179 little-endian formats", () => {
  const a = G.decode(0xec88, [0x00, 0x5c, 0x08, 0x10, 0x0e, 77, 0x02], "Govee_H5074_ABCD");
  assert.equal(a.tempC, 21.4); assert.equal(a.hum, 36); assert.equal(a.batt, 77);
  const b = G.decode(0x8801, [0, 0, 0, 0, 0x5c, 0x08, 0x10, 0x0e, 90], "Govee_H5179_ABCD");
  assert.equal(b.tempC, 21.4); assert.equal(b.model, "H5179");
});
test("Govee ignores unrelated data", () => {
  assert.equal(G.decode(0x004c, [1, 2, 3], "iPhone"), null);
});
