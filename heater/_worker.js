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
const ALLOWED = { "user/devices": "GET", "device/state": "POST", "device/control": "POST" };
const ACTIONS = new Set(["start", "stop", "stopnow", "fan", "fanlevel", "retry", "reset", "plugon", "plugoff", "plugcycle", "tune", "target", "mode", "level"]);

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

// Only sensible values get through to the heater.
function valid(action, v) {
  if (!ACTIONS.has(action)) return false;
  return { start: v == null, stop: v == null || v === 1 || v === 5 || v === 10 || v === 20, stopnow: v == null, fan: v == null, fanlevel: Number.isInteger(v) && v >= 1 && v <= 10, retry: v == null, reset: v == null, plugon: v == null, plugoff: v == null, plugcycle: v == null,
    tune: typeof v === "string" && /^[\w-]{1,40}$/.test(v),
    target: typeof v === "number" && v >= 4 && v <= 32,
    mode: v === "thermo" || v === "manual",
    level: Number.isInteger(v) && v >= 1 && v <= 10 }[action];
}
// Add commands to the queue the home device picks up (every few seconds).
async function queue(env, action, value, more = []) {
  const all = [[action, value], ...more];
  for (const [a, v] of all) if (!valid(a, v ?? null)) return { error: ACTIONS.has(a) ? "Bad value" : "Unknown action" };
  const list = (await env.EMBER.get("cmd", { type: "json" })) || [];
  const base = Date.now() * 1000 + Math.floor(Math.random() * 500);
  const cmds = all.map(([a, v], i) => ({ id: base + i, action: a, value: v ?? null, at: Date.now() }));
  await env.EMBER.put("cmd", JSON.stringify([...list, ...cmds].slice(-10)), { expirationTtl: 60 * 60 * 24 });
  await env.EMBER.put("watch", String(Date.now()), { expirationTtl: 600 }); // home device: report back quickly
  return { cmd: cmds[cmds.length - 1] };
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
      const r = await queue(env, c.action, c.value);
      return r.error ? json(400, { code: 400, message: r.error }) : json(200, { code: 200, cmd: r.cmd });
    }
    // Access keys for assistants and other services (Claude, Siri Shortcuts, Home Assistant…).
    // Managed with the home PIN. The key is shown once; only its hash is stored.
    if (path === "keys" && request.method === "GET") {
      const keys = (await env.EMBER.get("keys", { type: "json" })) || [];
      return json(200, { code: 200, keys: keys.map(({ id, name, at, used }) => ({ id, name, at, used })) });
    }
    if (path === "keys" && request.method === "POST") {
      const b = await readBody(request, 300);
      const name = String(b.name || "Assistant").replace(/[^\w .'-]/g, "").slice(0, 40) || "Assistant";
      const keys = (await env.EMBER.get("keys", { type: "json" })) || [];
      if (keys.length >= 10) return json(400, { code: 400, message: "Up to 10 keys. Remove one first." });
      const raw = [...crypto.getRandomValues(new Uint8Array(20))].map((x) => x.toString(16).padStart(2, "0")).join("");
      const key = "emb_" + raw, id = raw.slice(0, 6);
      keys.push({ id, name, hash: await sha(key), at: Date.now() });
      await env.EMBER.put("keys", JSON.stringify(keys));
      return json(200, { code: 200, id, name, key });
    }
    if (path.startsWith("keys/") && request.method === "DELETE") {
      const id = path.slice(5);
      const keys = (await env.EMBER.get("keys", { type: "json" })) || [];
      await env.EMBER.put("keys", JSON.stringify(keys.filter((k) => k.id !== id)));
      return json(200, { code: 200 });
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
    if (url.pathname.startsWith("/mcp/") || url.pathname === "/mcp") return assistant.mcp(request, env, url);
    if (url.pathname.startsWith("/api/")) return assistant.api(request, env, url);
    // Troubleshooting logs: write-only from the app (read via the Cloudflare dashboard/API, never from the site).
    if (url.pathname === "/diag" && request.method === "POST") {
      if (!env.EMBER) return json(503, { code: 503, message: "NOT_SET_UP" });
      try {
        const b = await readBody(request, 300000);
        const id = String(b.id || "").replace(/[^a-z0-9]/g, "").slice(0, 12);
        if (!id || typeof b.text !== "string") return json(400, { code: 400, message: "Bad request" });
        await env.EMBER.put("diag:" + id, b.text.slice(0, 250000), { expirationTtl: 60 * 60 * 24 * 14 });
        await env.EMBER.put("diag:last", id, { expirationTtl: 60 * 60 * 24 * 14 });
        return json(200, { code: 200 });
      } catch { return json(400, { code: 400, message: "Bad request" }); }
    }
    if (url.pathname.startsWith("/govee/")) {
      const path = url.pathname.slice("/govee/".length);
      if (ALLOWED[path] !== request.method) return json(404, { code: 404, message: "Not allowed" });
      const key = request.headers.get("Govee-API-Key");
      if (!key) return json(400, { code: 400, message: "Missing Govee API key" });
      const init = { method: request.method, headers: { "Govee-API-Key": key, "Content-Type": "application/json" } };
      if (request.method === "POST") init.body = await request.text();
      // device/control: only switching a device's power on or off is allowed.
      if (path === "device/control") {
        let c = null; try { c = JSON.parse(init.body).payload.capability; } catch {}
        if (!c || c.type !== "devices.capabilities.on_off" || c.instance !== "powerSwitch" || (c.value !== 0 && c.value !== 1))
          return json(400, { code: 400, message: "Only power on/off is allowed" });
      }
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

/* ---------------- Assistants and other services ----------------
 * Claude (and any MCP client) connects to  /mcp/<access key>
 * Anything else (Siri Shortcuts, Home Assistant, scripts) uses  /api/*  with
 * "Authorization: Bearer <access key>". Keys are created in Ember on the home
 * device (Settings → Home gateway → Assistants & services). Commands go into the
 * same queue as away control, so the home device carries them out within seconds,
 * with the same safety rules (e.g. no restart after a carbon monoxide fault).
 */
const assistant = (() => {
  const cToF = (c) => Math.round(c * 9 / 5 + 32);
  const toC = (t, unit) => (String(unit || "F").toUpperCase().startsWith("C") ? +t : (+t - 32) * 5 / 9);

  async function keyOk(env, key) {
    if (!env.EMBER || !key || !/^emb_[0-9a-f]{40}$/.test(key)) return false;
    const keys = (await env.EMBER.get("keys", { type: "json" })) || [];
    const h = await sha(key);
    const k = keys.find((x) => x.hash === h);
    if (!k) return false;
    if (!k.used || Date.now() - k.used > 3600e3) { k.used = Date.now(); await env.EMBER.put("keys", JSON.stringify(keys)); }
    return true;
  }

  const ago = (ms) => (ms < 90e3 ? Math.round(ms / 1000) + " seconds" : ms < 5400e3 ? Math.round(ms / 60e3) + " minutes" : Math.round(ms / 3600e3) + " hours");
  function describe(st) {
    if (!st) return { text: "No status yet. Ember isn't running as the home gateway (Settings → Home gateway on the device next to the heater).", ok: false };
    const age = Date.now() - (st.serverAt || st.at || 0);
    const lines = [];
    const power = { off: "Off", starting: "Igniting", running: "Heating", cooling: "Cooling down", fan: "Fan only", error: "Fault" }[st.power] || "Unknown";
    lines.push(`Heater: ${power}${st.power === "running" || st.power === "fan" ? (st.level != null ? `, level ${st.level} of ${st.max || 10}` : "") : ""}.`);
    if (st.power === "error" && st.faultText) lines.push(`Fault: ${st.faultText}`);
    if (st.clean) lines.push(`Burn-off running (${st.clean.kind}).`);
    if (st.mode === "thermo" && st.targetC != null) lines.push(`Thermostat set to ${cToF(st.targetC)}°F (${Math.round(st.targetC * 10) / 10}°C)${st.tuneName ? `, preset "${st.tuneName}"` : ""}.`);
    if (st.mode === "manual") lines.push(`Fixed power level ${st.manualLevel ?? "—"}.`);
    if (st.roomC != null) lines.push(`Room ${cToF(st.roomC)}°F (${st.roomSrc || "sensor"}).`);
    if (st.outC != null) lines.push(`Outside ${cToF(st.outC)}°F${st.outCity ? " in " + st.outCity : ""}.`);
    if (st.leftL != null) lines.push(`Fuel about ${(st.leftL / 3.785).toFixed(1)} gal.`);
    if (st.tunes && st.tunes.length) lines.push(`Presets: ${st.tunes.map((t) => `${t.name} (${cToF(t.targetC)}°F)`).join(", ")}.`);
    if (!st.connected) lines.push("The home device is NOT connected to the heater right now, so commands will wait until it reconnects.");
    lines.push(age > 600e3 ? `Warning: last update ${ago(age)} ago. The home device may be offline (screen locked, Bluefy closed, or no Wi-Fi).` : `Updated ${ago(age)} ago.`);
    return { text: lines.join("\n"), ok: age <= 600e3 && !!st.connected };
  }
  const state = (env) => env.EMBER.get("st", { type: "json" });
  const sent = async (env, what) => `${what} Sent to the home device; it acts within about 5–10 seconds.\n\nCurrent status (before the change):\n${describe(await state(env)).text}`;

  // Each tool: input schema + handler returning text. Shared by MCP and the plain API.
  const TOOLS = {
    get_heater_status: {
      description: "Get the diesel heater's current status: on/off, power level, thermostat setting, room and outside temperature, fuel, presets, and whether the home device is online.",
      schema: { type: "object", properties: {} },
      run: async (env) => describe(await state(env)).text,
    },
    turn_on_heater: {
      description: "Turn the heater on (or change what it's doing if it's already on). Optionally pick a saved preset by name (e.g. Sleep, Comfort, Boost) or a thermostat temperature. With neither, it uses the last setting.",
      schema: { type: "object", properties: {
        preset: { type: "string", description: "Name of a saved preset, e.g. Comfort" },
        temperature: { type: "number", description: "Thermostat target temperature" },
        unit: { type: "string", enum: ["F", "C"], description: "Unit for temperature (default F)" } } },
      run: async (env, a) => {
        const st = await state(env), more = [];
        let what = "Turning the heater on";
        if (a.preset) {
          const t = (st && st.tunes || []).find((x) => x.name.toLowerCase() === String(a.preset).toLowerCase().trim());
          if (!t) return `No preset called "${a.preset}". Saved presets: ${(st && st.tunes || []).map((x) => x.name).join(", ") || "none reported"}.`;
          more.push(["tune", t.id]); what += ` with preset ${t.name} (${cToF(t.targetC)}°F)`;
        } else if (a.temperature != null) {
          const c = Math.round(toC(a.temperature, a.unit) * 10) / 10;
          if (!(c >= 4 && c <= 32)) return "That temperature is out of range (40–90°F / 4–32°C).";
          more.push(["mode", "thermo"], ["target", c]); what += ` at ${cToF(c)}°F`;
        }
        const on = st && (st.power === "running" || st.power === "starting");
        const r = on ? (more.length ? await queue(env, more[0][0], more[0][1], more.slice(1)) : { cmd: true })
          : more.length ? await queue(env, more[0][0], more[0][1], [...more.slice(1), ["start", null]]) : await queue(env, "start", null);
        if (r.error) return "Couldn't send: " + r.error;
        return sent(env, on ? what.replace("Turning the heater on", "The heater is already on; changing it") + "." : what + ".");
      },
    },
    turn_off_heater: {
      description: "Turn the heater off. By default it does the clean burn-off at high power first (the user's chosen length), then shuts down. Set burn_off_minutes to 0 to turn off right away, or 1, 5, 10 or 20.",
      schema: { type: "object", properties: { burn_off_minutes: { type: "integer", enum: [0, 1, 5, 10, 20], description: "Clean burn-off length before shutdown; 0 = off now" } } },
      run: async (env, a) => {
        const m = a.burn_off_minutes;
        const r = m === 0 ? await queue(env, "stopnow", null) : await queue(env, "stop", m == null ? null : m);
        if (r.error) return "Couldn't send: " + r.error;
        return sent(env, m === 0 ? "Turning off now (no burn-off)." : `Turning off after a ${m == null ? "clean" : m + "-minute"} burn-off.`);
      },
    },
    set_temperature: {
      description: "Set the thermostat target temperature (switches to thermostat mode). Doesn't turn the heater on by itself.",
      schema: { type: "object", required: ["temperature"], properties: { temperature: { type: "number" }, unit: { type: "string", enum: ["F", "C"], description: "Default F" } } },
      run: async (env, a) => {
        const c = Math.round(toC(a.temperature, a.unit) * 10) / 10;
        if (!(c >= 4 && c <= 32)) return "That temperature is out of range (40–90°F / 4–32°C).";
        const r = await queue(env, "mode", "thermo", [["target", c]]);
        return r.error ? "Couldn't send: " + r.error : sent(env, `Thermostat set to ${cToF(c)}°F.`);
      },
    },
    set_power_level: {
      description: "Run at a fixed power level from 1 (lowest) to 10 (highest), instead of the thermostat.",
      schema: { type: "object", required: ["level"], properties: { level: { type: "integer", minimum: 1, maximum: 10 } } },
      run: async (env, a) => {
        const r = await queue(env, "mode", "manual", [["level", Math.round(a.level)]]);
        return r.error ? "Couldn't send: " + r.error : sent(env, `Power level set to ${Math.round(a.level)}.`);
      },
    },
    fan_only: {
      description: "Run the blower fan only (no heat, no fuel). Optional speed 1–10. If the heater is heating, it cools down first.",
      schema: { type: "object", properties: { speed: { type: "integer", minimum: 1, maximum: 10 } } },
      run: async (env, a) => {
        const r = a.speed ? await queue(env, "fan", null, [["fanlevel", Math.round(a.speed)]]) : await queue(env, "fan", null);
        return r.error ? "Couldn't send: " + r.error : sent(env, "Switching to fan only.");
      },
    },
  };

  async function call(env, name, args) {
    const t = TOOLS[name];
    if (!t) throw new Error("Unknown tool " + name);
    return t.run(env, args || {});
  }

  // Minimal MCP server (Streamable HTTP, JSON responses).
  async function mcp(request, env, url) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
    const key = url.pathname.split("/")[2] || (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!(await keyOk(env, key))) return json(401, { code: 401, message: "Invalid or missing access key" });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST", ...cors() } });
    let msg;
    try { msg = await readBody(request, 20000); } catch { return rpc(null, null, { code: -32700, message: "Parse error" }); }
    if (Array.isArray(msg)) return rpc(null, null, { code: -32600, message: "Batches not supported" });
    const { id, method, params } = msg;
    if (id === undefined || id === null) return new Response(null, { status: 202, headers: cors() }); // notification
    try {
      if (method === "initialize") {
        const want = params && params.protocolVersion;
        const known = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
        return rpc(id, { protocolVersion: known.includes(want) ? want : "2025-06-18", capabilities: { tools: {} },
          serverInfo: { name: "ember-heater", version: "1.0" },
          instructions: "Controls the user's diesel heater through their Ember home gateway. Check get_heater_status when unsure. Commands are queued and carried out by the home device within about 5–10 seconds; call get_heater_status afterwards to confirm. Temperatures default to Fahrenheit." });
      }
      if (method === "ping") return rpc(id, {});
      if (method === "tools/list") return rpc(id, { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.schema })) });
      if (method === "tools/call") {
        const text = await call(env, params && params.name, params && params.arguments);
        return rpc(id, { content: [{ type: "text", text }] });
      }
      return rpc(id, null, { code: -32601, message: "Method not found" });
    } catch (e) {
      return rpc(id, { content: [{ type: "text", text: "Error: " + e.message }], isError: true });
    }
  }
  const cors = () => ({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" });
  const rpc = (id, result, error) => new Response(JSON.stringify(error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result }),
    { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors() } });

  // Plain web API for Siri Shortcuts, Home Assistant, scripts.
  //   GET  /api/status            POST /api/on   {preset?, temperature?, unit?}
  //   POST /api/off {burn_off_minutes?}   POST /api/temperature {temperature, unit?}
  //   POST /api/level {level}     POST /api/fan {speed?}
  async function api(request, env, url) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
    const key = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!(await keyOk(env, key))) return json(401, { code: 401, message: "Invalid or missing access key (Authorization: Bearer emb_…)" });
    const route = { "GET status": "get_heater_status", "POST on": "turn_on_heater", "POST off": "turn_off_heater", "POST temperature": "set_temperature", "POST level": "set_power_level", "POST fan": "fan_only" }[request.method + " " + url.pathname.slice(5)];
    if (!route) return json(404, { code: 404, message: "Not found" });
    let args = {};
    if (request.method === "POST") { try { args = await readBody(request, 2000); } catch { args = {}; } }
    const text = await call(env, route, args);
    const st = await state(env);
    return new Response(JSON.stringify({ code: 200, message: text, state: st }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors() } });
  }

  return { mcp, api, TOOLS };
})();
