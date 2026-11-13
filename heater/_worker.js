// Ember – Cloudflare Pages worker (advanced mode).
//
// 1. Serves the app files as usual.
// 2. /govee/*  – relays two Govee API calls (browsers can't call Govee directly).
//    The API key comes from the phone and is never stored here.
// 3. /remote/* – "control from away": a home device (old phone/iPad next to the
//    heater) posts status and picks up commands; your phone reads status and
//    sends commands. Needs a KV namespace bound as EMBER (see HOWTO.md).
//    Protected by a PIN you choose; only a salted hash of it is stored.
const GOVEE = "https://openapi.api.govee.com/router/api/v1/";
const ALLOWED = { "user/devices": "GET", "device/state": "POST" };
const ACTIONS = new Set(["start", "stop", "stopnow", "fan", "retry", "reset", "tune", "target", "mode", "level"]);

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

// One home per site, protected by a PIN the owner picks (4–8 digits).
// After 10 wrong PINs, away control locks for 24 hours (keeps guessing impractical).
const MAX_FAILS = 10;
const pinOf = (v) => String(v || "").replace(/\D/g, "");
async function sha(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function checkPin(request, env) {
  const fails = Number(await env.EMBER.get("fails")) || 0;
  if (fails >= MAX_FAILS) return json(429, { code: 429, message: "LOCKED" });
  const home = await env.EMBER.get("home", { type: "json" });
  if (!home) return json(409, { code: 409, message: "NO_HOME" });
  const pin = pinOf(request.headers.get("X-Ember-Pin"));
  if (pin.length >= 4 && (await sha(home.salt + pin)) === home.hash) return null; // OK
  await env.EMBER.put("fails", String(fails + 1), { expirationTtl: 86400 });
  return json(401, { code: 401, message: "WRONG_PIN", left: MAX_FAILS - fails - 1 });
}

async function readBody(request, max = 6000) {
  const text = await request.text();
  if (text.length > max) throw new Error("too large");
  return JSON.parse(text || "{}");
}

async function remote(request, env, path) {
  if (!env.EMBER) return json(503, { code: 503, message: "NOT_SET_UP" });
  try {
    // Home device sets the PIN (first time), or changes it (needs the current PIN).
    if (path === "register" && request.method === "POST") {
      const pin = pinOf((await readBody(request, 200)).pin);
      if (pin.length < 4 || pin.length > 8) return json(400, { code: 400, message: "PIN must be 4 to 8 digits" });
      if (await env.EMBER.get("home")) { const denied = await checkPin(request, env); if (denied) return denied; }
      const salt = crypto.randomUUID();
      await env.EMBER.put("home", JSON.stringify({ salt, hash: await sha(salt + pin) }));
      return json(200, { code: 200 });
    }
    const denied = await checkPin(request, env);
    if (denied) return denied;

    // Home device: publish status (only on change or every few minutes, to stay in the free tier).
    if (path === "state" && request.method === "POST") {
      const state = await readBody(request);
      state.serverAt = Date.now();
      await env.EMBER.put("st", JSON.stringify(state), { expirationTtl: 60 * 60 * 24 * 7 });
      return json(200, { code: 200 });
    }
    // Your phone: read status.
    if (path === "state" && request.method === "GET") {
      return json(200, { code: 200, state: await env.EMBER.get("st", { type: "json" }), now: Date.now() });
    }
    // Your phone: send a command.
    if (path === "cmd" && request.method === "POST") {
      const c = await readBody(request, 500);
      if (!ACTIONS.has(c.action)) return json(400, { code: 400, message: "Unknown action" });
      // Only sensible values get through to the heater.
      const v = c.value;
      const ok = { start: v == null, stop: v == null || v === 1 || v === 5 || v === 10, stopnow: v == null, fan: v == null, retry: v == null, reset: v == null,
        tune: typeof v === "string" && /^[\w-]{1,40}$/.test(v),
        target: typeof v === "number" && v >= 4 && v <= 32,
        mode: v === "thermo" || v === "manual",
        level: Number.isInteger(v) && v >= 1 && v <= 10 }[c.action];
      if (!ok) return json(400, { code: 400, message: "Bad value" });
      const list = (await env.EMBER.get("cmd", { type: "json" })) || [];
      const cmd = { id: Date.now() * 1000 + Math.floor(Math.random() * 1000), action: c.action, value: v ?? null, at: Date.now() };
      await env.EMBER.put("cmd", JSON.stringify([...list, cmd].slice(-10)), { expirationTtl: 60 * 60 * 24 });
      return json(200, { code: 200, cmd });
    }
    // Home device: pick up commands newer than the last one it ran.
    if (path === "cmd" && request.method === "GET") {
      const after = Number(new URL(request.url).searchParams.get("after") || 0);
      const list = (await env.EMBER.get("cmd", { type: "json" })) || [];
      const watchAt = Number(await env.EMBER.get("watch")) || 0;
      return json(200, { code: 200, cmds: list.filter((c) => c.id > after), watchAt, now: Date.now() });
    }
    // Your phone: "I'm watching" (about once a minute while the away screen is open),
    // so the home device sends updates every few seconds instead of every few minutes.
    if (path === "watch" && request.method === "POST") {
      await env.EMBER.put("watch", String(Date.now()), { expirationTtl: 600 });
      return json(200, { code: 200 });
    }
  } catch (e) {
    return json(400, { code: 400, message: "Bad request" });
  }
  return json(404, { code: 404, message: "Not found" });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/remote/")) return remote(request, env, url.pathname.slice("/remote/".length));
    if (url.pathname.startsWith("/govee/")) {
      const path = url.pathname.slice("/govee/".length);
      if (ALLOWED[path] !== request.method) return json(404, { code: 404, message: "Not allowed" });
      const key = request.headers.get("Govee-API-Key");
      if (!key) return json(400, { code: 400, message: "Missing Govee API key" });
      const init = { method: request.method, headers: { "Govee-API-Key": key, "Content-Type": "application/json" } };
      if (request.method === "POST") init.body = await request.text();
      try {
        const r = await fetch(GOVEE + path, init);
        return new Response(r.body, { status: r.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
      } catch (e) {
        return json(502, { code: 502, message: "Couldn't reach Govee" });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
