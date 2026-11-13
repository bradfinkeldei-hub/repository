// Ember – Cloudflare Pages worker (advanced mode).
//
// 1. Serves the app files as usual.
// 2. /govee/*  – relays two Govee API calls (browsers can't call Govee directly).
//    The API key comes from the phone and is never stored here.
// 3. /remote/* – "control from away": a home device (old phone/iPad next to the
//    heater) posts status and picks up commands; your phone reads status and
//    sends commands. Needs a KV namespace bound as EMBER (see HOWTO.md).
//    Everything is keyed by a hash of your secret home code.
const GOVEE = "https://openapi.api.govee.com/router/api/v1/";
const ALLOWED = { "user/devices": "GET", "device/state": "POST" };
const ACTIONS = new Set(["start", "stop", "tune", "target", "mode", "level"]);

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

async function homeKey(request) {
  const code = (request.headers.get("X-Ember-Home") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length < 12) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ember:" + code));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readBody(request, max = 6000) {
  const text = await request.text();
  if (text.length > max) throw new Error("too large");
  return JSON.parse(text || "{}");
}

async function remote(request, env, path) {
  if (!env.EMBER) return json(503, { code: 503, message: "NOT_SET_UP" });
  const home = await homeKey(request);
  if (!home) return json(401, { code: 401, message: "Missing or invalid home code" });
  const stKey = "st:" + home, cmdKey = "cmd:" + home;

  try {
    // Home device: publish status (only on change or every ~10 min, to stay in the free tier).
    if (path === "state" && request.method === "POST") {
      const state = await readBody(request);
      state.serverAt = Date.now();
      await env.EMBER.put(stKey, JSON.stringify(state), { expirationTtl: 60 * 60 * 24 * 7 });
      return json(200, { code: 200 });
    }
    // Your phone: read status.
    if (path === "state" && request.method === "GET") {
      const st = await env.EMBER.get(stKey, { type: "json" });
      return json(200, { code: 200, state: st, now: Date.now() });
    }
    // Your phone: send a command.
    if (path === "cmd" && request.method === "POST") {
      const c = await readBody(request, 500);
      if (!ACTIONS.has(c.action)) return json(400, { code: 400, message: "Unknown action" });
      // Only sensible values get through to the heater.
      const v = c.value;
      const ok = { start: v == null, stop: v == null,
        tune: typeof v === "string" && /^[\w-]{1,40}$/.test(v),
        target: typeof v === "number" && v >= 4 && v <= 32,
        mode: v === "thermo" || v === "manual",
        level: Number.isInteger(v) && v >= 1 && v <= 10 }[c.action];
      if (!ok) return json(400, { code: 400, message: "Bad value" });
      const list = (await env.EMBER.get(cmdKey, { type: "json" })) || [];
      const cmd = { id: Date.now() * 1000 + Math.floor(Math.random() * 1000), action: c.action, value: c.value ?? null, at: Date.now() };
      const next = [...list, cmd].slice(-10);
      await env.EMBER.put(cmdKey, JSON.stringify(next), { expirationTtl: 60 * 60 * 24 });
      return json(200, { code: 200, cmd });
    }
    // Home device: pick up commands newer than the last one it ran.
    if (path === "cmd" && request.method === "GET") {
      const after = Number(new URL(request.url).searchParams.get("after") || 0);
      const list = (await env.EMBER.get(cmdKey, { type: "json" })) || [];
      return json(200, { code: 200, cmds: list.filter((c) => c.id > after), now: Date.now() });
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
