import { test } from "node:test";
import assert from "node:assert/strict";
import { composeMission, missionText } from "./mission.ts";

test("weaves all three answers into one sentence", () => {
  const p = composeMission("my family, freedom, being honest", "my kids, by showing them it's never too late", "helping someone solve a problem.");
  assert.equal(missionText(p), "My mission is to make a difference for my kids by showing them it's never too late, guided by my family, freedom and being honest, and to be at my best when I am helping someone solve a problem.");
  assert.deepEqual(p.filter((x) => x.own).map((x) => x.text), ["my kids", "by showing them it's never too late", "my family, freedom and being honest", "helping someone solve a problem"]);
});

test("works with only some answers", () => {
  assert.equal(missionText(composeMission("Faith", "", "")), "My mission is to live by what matters most: Faith.");
  assert.equal(missionText(composeMission("", "", "")), "");
  assert.equal(missionText(composeMission("", "My team", "outside")), "My mission is to make a difference for my team, and to be at my best outside.");
});
