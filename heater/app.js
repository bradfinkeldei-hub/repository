/* Ember – app logic. Plain JS, no build step. */
(() => {
  "use strict";
  const VERSION = "1.53"; // bump with every release (also sw.js CACHE)
  const P = window.EmberProtocol;
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const params = new URLSearchParams(location.search);
  const FAST = params.has("fast") ? 30 : 1; // testing: time runs 30x faster

  /* ---------------- Storage ---------------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem("ember." + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("ember." + k, JSON.stringify(v)); } catch {} },
  };
  const usLocale = /^en-US/i.test(navigator.language || "en-US");
  const S = Object.assign({
    unit: usLocale ? "F" : "C", targetC: 21, mode: "thermo", cleanMins: 10, coachHours: 4,
    tankGal: 5, minLevel: 2, tunes: [], tuneId: "std", lead: 30, batt: true, battV: 11.5, native: false, proto: "auto", hUnit: "auto",
    showAll: false, pin: "0000", room: "heater", goveeId: null, gwifi: null, gUnit: "F",
  }, store.get("settings", {}));
  const stats = Object.assign({ runSec: 0, lowSec: 0, sinceFillL: 0, days: {} }, store.get("stats", {}));
  if (S.mode !== "thermo" && S.mode !== "manual") S.mode = "thermo";
  const saveS = () => store.set("settings", S);
  // Outside temperature (see "Outside temperature" below).
  const out = Object.assign({ c: null, at: 0 }, store.get("outside", {}));
  const outFresh = () => out.c != null && Date.now() - out.at < 3 * 3600e3;
  // Heating styles ("tunes"): Standard is built in; custom ones are saved on this phone.
  const STD = () => ({ id: "std", name: "Standard", max: 10, bandC: 3, hold: S.minLevel || 2, clean: S.cleanMins });
  const tune = () => S.tunes.find((t) => t.id === S.tuneId) || STD();
  // Three temperature buttons + one Custom. All are ordinary tunes, so every one can be edited.
  const STARTERS = [["Sleep", 17], ["Comfort", 21], ["Boost", 25]];
  const starterTunes = () => STARTERS.map(([n, c]) => ({ id: "p-" + n.toLowerCase(), name: n, targetC: c, max: 10, bandC: 3, hold: S.minLevel || 2, clean: S.cleanMins }));
  if (!S.seeded) {
    S.tunes = [...starterTunes(), ...S.tunes];
    S.seeded = true;
    const match = S.tunes.find((t) => Math.abs(t.targetC - S.targetC) < 0.3);
    if (S.tuneId === "std" && match) S.tuneId = match.id;
    store.set("settings", S);
  }
  if (!S.threeButtons) { // v1.18: keep just Sleep, Comfort, Boost and one Custom
    const customs = S.tunes.filter((t) => !t.id.startsWith("p-"));
    S.tunes = [...S.tunes.filter((t) => t.id.startsWith("p-") && t.id !== "p-frost"), ...customs.slice(0, 1)];
    if (!S.tunes.some((t) => t.id === S.tuneId)) S.tuneId = "p-comfort";
    S.threeButtons = true;
    store.set("settings", S);
  }
  if (S.cleanMins === 15) S.cleanMins = 10; // burn-off choices are 1, 5, 10 or 20 min
  S.tunes.forEach((t) => { if (t.clean === 15) t.clean = 10; });
  // Schedule: three daily windows. Each turns the heater on at its start time and off at its stop time.
  const SLOT_DEFAULTS = [
    { id: "morning", name: "Morning", on: false, start: "06:00", stop: "09:00", tune: "p-comfort" },
    { id: "midday", name: "Midday", on: false, start: "11:30", stop: "13:30", tune: "p-comfort" },
    { id: "evening", name: "Evening", on: false, start: "17:00", stop: "22:00", tune: "p-comfort" },
  ];
  if (!Array.isArray(S.sched)) {
    S.sched = SLOT_DEFAULTS.map((d) => ({ ...d }));
    if (S.warmOn && S.warmTime) { S.sched[0].on = true; S.sched[0].start = S.warmTime; } // carry over the old Warm-by time
  }
  S.schedFired = S.schedFired || {}; S.schedOwn = S.schedOwn || {};
  const GAL = 3.785; // litres per US gallon (fuel use is tracked in litres, shown in gallons)
  const saveStats = () => store.set("stats", stats);

  /* ---------------- Units ---------------- */
  const cToF = (c) => c * 9 / 5 + 32;
  const fToC = (f) => (f - 32) * 5 / 9;
  const show = (c) => Math.round(S.unit === "F" ? cToF(c) : c);
  const fromShow = (v) => (S.unit === "F" ? fToC(v) : v);
  const range = () => (S.unit === "F" ? [41, 86] : [5, 30]);
  const PRESETS = [["Frost", 5], ["Sleep", 17], ["Comfort", 21], ["Boost", 25]];

  // Turn any error (including ones with no message) into readable text.
  const errText = (e) => {
    if (e == null || e === "") return "no details";
    if (typeof e === "number") return "Bluetooth error " + e; // Bluefy sometimes rejects with a bare number
    if (typeof e === "string") return /^\d+$/.test(e) ? "Bluetooth error " + e : e;
    if (e.code != null && !e.message) return "Bluetooth error " + e.code;
    const t = [e.name, e.message].filter((x) => x && x !== "Error").join(": ");
    try { return t || JSON.stringify(e) || String(e); } catch { return String(e); }
  };
  const cancelled = (e) => /cancel|NotFoundError|User/i.test(errText(e));

  /* ---------------- Bluetooth link ---------------- */
  class BleLink {
    constructor() { this.listener = null; this.onDrop = null; }
    get name() { return (this.device && this.device.name) || "Heater"; }
    async pick(showAll, log) {
      const all = { acceptAllDevices: true, optionalServices: [P.BD39, P.SERVICE] };
      const filtered = {
        filters: [{ services: [P.BD39] }, { services: [P.SERVICE] }, ...["hcalory", "Hcalory", "HCALORY", "hc", "HC", "Hc", "TY", "Air", "BT", "Heater"].map((n) => ({ namePrefix: n }))],
        optionalServices: [P.BD39, P.SERVICE],
      };
      // Try the preferred list first; if the browser rejects it (not a cancel), fall back
      // to simpler requests. Bluefy has been seen to reject some forms with a bare "2".
      const short = { acceptAllDevices: true, optionalServices: [0xbd39, 0xfff0] };
      const tries = showAll ? [["all devices", all], ["listed heaters", filtered], ["basic", short]] : [["listed heaters", filtered], ["all devices", all], ["basic", short]];
      let last = null;
      for (const [name, opts] of tries) {
        try { this.device = await navigator.bluetooth.requestDevice(opts); last = null; break; }
        catch (e) { if (cancelled(e)) throw e; last = e; log(`✗ device list (${name}): ${errText(e)}`); }
      }
      if (last) throw last;
      log("· picked " + (this.device.name || "(no name)"));
      this.device.addEventListener("gattserverdisconnected", () => this.onDrop && this.onDrop());
    }
    async connect() {
      const step = async (name, fn) => { try { return await fn(); } catch (e) { throw new Error(name + " failed (" + errText(e) + ")"); } };
      const server = await step("Bluetooth connect", () => this.device.gatt.connect());
      // Newer Hcalory controllers (TB2S) use service BD39; older ones FFF0.
      let svc = null;
      try { svc = await server.getPrimaryService(P.BD39); } catch {}
      if (svc) {
        this.transport = "bd39";
        this.rx = await step("Finding status channel", () => svc.getCharacteristic(P.BD39_NOTIFY));
        this.tx = await step("Finding command channel", () => svc.getCharacteristic(P.BD39_WRITE));
      } else {
        this.transport = "fff0";
        svc = await step("Finding heater service", () => server.getPrimaryService(P.SERVICE));
        this.rx = await step("Finding status channel", () => svc.getCharacteristic(P.NOTIFY));
        this.tx = await step("Finding command channel", () => svc.getCharacteristic(P.WRITE));
      }
      this.rx.addEventListener("characteristicvaluechanged", (e) => {
        const v = e.target.value;
        this.listener && this.listener(new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice());
      });
      await this.rx.startNotifications();
    }
    onNotify(fn) { this.listener = fn; }
    async write(bytes) {
      const t = this.tx, pr = t.properties || {};
      // Prefer acknowledged writes so a command can't be silently dropped.
      if (pr.write && t.writeValueWithResponse) {
        try { return await t.writeValueWithResponse(bytes); }
        catch (e) { if (!pr.writeWithoutResponse) throw e; }
      }
      if (pr.writeWithoutResponse && t.writeValueWithoutResponse) return t.writeValueWithoutResponse(bytes);
      if (t.writeValueWithResponse) return t.writeValueWithResponse(bytes);
      return t.writeValue(bytes);
    }
    get connected() { return !!(this.device && this.device.gatt.connected); }
    disconnect() { try { this.device && this.device.gatt.disconnect(); } catch {} }
  }

  class SimLink extends P.SimHeaterH {
    get name() { return "Demo heater"; }
  }

  /* ---------------- Heater driver ---------------- */
  class Heater {
    constructor(link, onStatus, onLog) {
      this.link = link; this.onStatus = onStatus; this.log = onLog;
      this.proto = null; this.status = null; this.lastPoll = null;
      this.chain = Promise.resolve(); this.lastSend = 0; this.waiters = []; this.authWaiters = []; this.busy = 0;
      this.pins = ["0000", "1234"];
      link.onNotify((x) => this.receive(x));
    }
    receive(x) {
      this.log("◀ " + P.hex(x));
      if (this.proto === P.H) {
        const ok = P.H.authResult(x);
        if (ok !== null) { this.authWaiters.splice(0).forEach((w) => w(ok)); return; }
      }
      let p = this.proto;
      if (!p) {
        p = this.lastPoll && this.lastPoll.looksLike(x) ? this.lastPoll : P.B.looksLike(x) ? P.B : P.A.looksLike(x) ? P.A : null;
        if (!p) return;
        this.proto = p;
        this.log("✓ Using format " + p.id);
      }
      const s = p.parse(x);
      if (!s) return;
      this.status = s; this.statusAt = Date.now();
      this.waiters.splice(0).forEach((w) => w(s));
      this.onStatus(s);
    }
    send(bytes) {
      // One command at a time, at least 550 ms apart. Heaters ignore floods.
      this.chain = this.chain.then(async () => {
        const wait = this.lastSend + 550 - Date.now();
        if (wait > 0) await sleep(wait);
        this.log("▶ " + P.hex(bytes));
        // Never wait forever on one message: a write that hangs would freeze every
        // later command (and the thermostat) while the screen still looks fine.
        try {
          await Promise.race([this.link.write(bytes), sleep(3000).then(() => { throw new Error("no answer from the heater (write timed out)"); })]);
          this.writeFails = 0;
        } catch (e) { this.log("✗ " + errText(e)); this.writeFails = (this.writeFails || 0) + 1; }
        this.lastSend = Date.now();
      });
      return this.chain;
    }
    async sendAll(frames) { for (const f of frames) await this.send(f); }
    next(ms) {
      return new Promise((resolve) => {
        const t = setTimeout(() => { this.waiters = this.waiters.filter((w) => w !== done); resolve(null); }, ms);
        const done = (s) => { clearTimeout(t); resolve(s); };
        this.waiters.push(done);
      });
    }
    // Newer Hcalory controllers must be unlocked with a 4-digit PIN (factory 0000).
    async unlock() {
      for (const pin of [...new Set(this.pins)]) {
        const got = new Promise((resolve) => {
          const t = setTimeout(() => resolve(null), 1500);
          this.authWaiters.push((ok) => { clearTimeout(t); resolve(ok); });
        });
        await this.send(P.H.auth(pin));
        const ok = await got;
        this.authWaiters = [];
        if (ok) { this.log("✓ Unlocked with PIN " + pin); this.pin = pin; return true; }
        this.log(ok === false ? "✗ PIN " + pin + " rejected" : "✗ No reply to PIN " + pin);
      }
      return false;
    }
    async detect(pref) {
      if (this.link.transport === "bd39") {
        this.proto = P.H;
        this.log("✓ Hcalory BD39 controller (format H)");
        this.unlocked = await this.unlock();
        if (!this.unlocked) this.log("· continuing without unlock (heater may ignore commands)");
        for (let i = 0; i < 3; i++) if (await this.poll()) return true;
        return false;
      }
      const order = pref === "A" ? [P.A] : pref === "B" ? [P.B] : [P.B, P.A];
      for (let round = 0; round < 3 && !this.proto; round++) {
        for (const p of order) {
          this.lastPoll = p;
          const got = this.next(1800);
          await this.send(p.poll());
          if (await got) return true;
        }
      }
      return !!this.proto;
    }
    async poll() {
      if (!this.proto) return null;
      const got = this.next(2200);
      await this.send(this.proto.poll());
      return got;
    }
    async start() { await this.sendAll(this.proto.start()); return this.poll(); }
    // Start, checked: confirm the heater is igniting/heating; if not, send Off then On once
    // (what the remote effectively does) and check again.
    // Start, checked. Give the heater ~6 s to report it's igniting (it can be slow to
    // update its status). Never send Off in between: that could cancel the start.
    // If it still shows off, re-send the PIN if needed and send Start once more.
    async startVerified() {
      this.busy++;
      const ok = (s) => s && (s.power === "starting" || s.power === "running");
      try {
        for (let attempt = 1; attempt <= 2; attempt++) {
          await this.sendAll(this.proto.start());
          let s = null;
          for (let i = 0; i < 6 && !ok(s); i++) {
            await sleep(1000);
            s = await this.poll();
            if (s && s.power === "error") break;
          }
          this.log(`· start attempt ${attempt}: ${s ? s.power + (s.fault ? " (fault " + s.fault + ")" : "") : "no reply"}`);
          if (ok(s) || (s && s.power === "error")) return s;
          if (attempt === 1 && this.proto === P.H) { this.log("· re-sending PIN"); this.unlocked = await this.unlock(); }
        }
        return this.status;
      } finally { this.busy--; }
    }
    async stop() { await this.sendAll(this.proto.stop()); return this.poll(); }
    async fan() { if (!this.proto.fan) return null; await this.sendAll(this.proto.fan()); await sleep(1200); return this.poll(); }
    // Turn off, checked: confirm the heater is shutting down, retry (and re-send the PIN) if not.
    async stopVerified() {
      this.busy++;
      try {
        for (let attempt = 1; attempt <= 5; attempt++) {
          await this.sendAll(this.proto.stop());
          await sleep(1500);
          const s = await this.poll();
          this.log(`· turn off attempt ${attempt}: ${s ? s.power : "no reply"}`);
          if (s && (s.power === "off" || s.power === "cooling")) return true;
          if (attempt >= 2 && this.proto === P.H) { this.log("· re-sending PIN"); this.unlocked = await this.unlock(); }
        }
        this.log("✗ heater did not turn off");
        return false;
      } finally { this.busy--; }
    }
    async ensureMode(mode) {
      const p = this.proto;
      if (!p.hasThermostat || !this.status || this.status.mode === mode) return;
      await this.sendAll(mode === "thermostat" ? p.thermoMode() : p.gearMode());
      await sleep(800); await this.poll();
    }
    // Step the power level (or B's setpoint) one click at a time until it matches.
    async stepTo(target, key = "level") {
      this.busy++;
      try {
        if (this.proto.direct) {
          const unitF = this.status && this.status.unit === "F";
          await this.sendAll(key === "level" ? this.proto.setLevel(target) : this.proto.setTemp(target, unitF));
          await sleep(600); await this.poll();
          return;
        }
        let stuck = 0, prev = null;
        for (let i = 0; i < 40; i++) {
          const s = await this.poll();
          if (!s || s.power === "error" || s[key] == null) return;
          const cur = s[key];
          if (cur === target) return;
          if (prev !== null && cur === prev) { if (++stuck >= 2) return; } else stuck = 0;
          prev = cur;
          await this.sendAll(cur < target ? this.proto.up() : this.proto.down());
          await sleep(700);
        }
      } finally { this.busy--; }
    }
    // Full power, checked: switch to level mode, ask for max, confirm, retry.
    async toMax() {
      const max = this.proto.maxLevel;
      if (!this.proto.direct) { await this.ensureMode("gear"); return this.stepTo(max); }
      this.busy++;
      try {
        for (let attempt = 1; attempt <= 4; attempt++) {
          const before = this.status || {};
          if (before.mode !== "gear") {
            this.log(`· full power: switching to level mode (was ${before.mode || "?"})`);
            await this.sendAll(this.proto.gearMode());
            await sleep(900);
          }
          await this.sendAll(this.proto.setLevel(max));
          await sleep(1200);
          const s = await this.poll();
          this.log(`· full power attempt ${attempt}: mode ${s ? s.mode : "?"}, level ${s ? s.level : "?"} (want ${max})`);
          if (s && s.mode === "gear" && s.level === max) return true;
          if (attempt === 2 && this.proto === P.H) { this.log("· re-sending PIN"); this.unlocked = await this.unlock(); }
        }
        this.log("✗ heater did not go to full power");
        return false;
      } finally { this.busy--; }
    }
  }

  /* ---------------- App state ---------------- */
  let link = null, heater = null, demo = false;
  let clean = store.get("clean", null); // { kind, endAt, total }
  let lastAcct = 0, lowVSince = null, lastThermo = 0, settleUntil = 0, drag = null, wakeLock = null, maxRunSec = 0;
  let reconnecting = false;

  const logLines = [], events = []; // events: decisions and errors only (no raw radio traffic), kept longer
  function log(line) {
    const t = new Date().toLocaleTimeString([], { hour12: false });
    logLines.push(t + "  " + line);
    if (logLines.length > 300) logLines.shift();
    if (!/^[▶◀]/.test(line)) { events.push(new Date().toISOString().slice(5, 19).replace("T", " ") + "  " + line); if (events.length > 600) events.shift(); diagDirty = true; }
    const el = $("log");
    if (el && !$("settings").hidden && $("logBox").open) { el.textContent = logLines.slice(-80).join("\n"); el.scrollTop = el.scrollHeight; }
  }

  function toast(msg, ms = 3200) {
    const t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
  }

  /* ---------------- Govee room gauge ---------------- */
  // Two ways in: Wi-Fi (Govee cloud API, works on iPhone) or Bluetooth (Android Chrome).
  let govee = null;
  const onGovee = (r) => {
    // A new room reading that changes what you see: let the thermostat react now
    // instead of waiting for its next 45-second check.
    const moved = !govee || Math.round(govee.tempC * 2) !== Math.round(r.tempC * 2);
    govee = r; if (moved) lastThermo = 0; render();
  };
  const gsensor = new window.EmberGovee.GoveeSensor(onGovee, log);
  const gcloud = new window.EmberGovee.GoveeCloud(onGovee, log);
  if (S.goveeId === "demo") S.goveeId = null; // older versions saved the demo pairing
  const goveeLive = () => !!govee && Date.now() - govee.at < (govee.via === "wifi" ? 300000 : 180000);
  const useGovee = () => S.room === "govee" && goveeLive();
  const goveeSetUp = () => !!(S.gwifi || S.goveeId);
  const demoRoom = () => (link && link.room != null ? link.room : null);

  function openGoveeSetup() {
    $("gKey").value = (S.gwifi && S.gwifi.key) || S.gkey || "";
    $("gList").innerHTML = ""; $("gMsg").textContent = "";
    $("btnGForget").hidden = !goveeSetUp();
    const ble = gsensor.supported || demo;
    $("btnGBle").disabled = !ble;
    $("btnGBle").textContent = demo ? "Use demo thermometer" : "Pair over Bluetooth";
    $("gBleNote").textContent = ble
      ? "Reads the thermometer directly every few seconds. No internet needed."
      : "This browser can't listen to Govee over Bluetooth (Bluefy on iPhone can't). Use Wi-Fi above.";
    $("settings").hidden = true; // open on top, not behind Settings
    $("gsetup").hidden = false;
  }

  function useGoveeNow(msg) {
    S.room = "govee"; $("setRoom").value = "govee"; saveS(); lastThermo = 0;
    $("gsetup").hidden = true; render(); toast(msg, 4500);
  }

  $("btnGFind").onclick = async () => {
    const key = $("gKey").value.trim();
    if (!key) return ($("gMsg").textContent = "Paste your API key first.");
    S.gkey = key; saveS();
    $("gMsg").textContent = "Looking for your thermometers…"; $("gList").innerHTML = "";
    try {
      const list = await gcloud.list(key);
      if (!list.length) return ($("gMsg").textContent = "No thermometers found on this Govee account. Make sure the H5051 is set up on Wi-Fi in the Govee Home app.");
      $("gMsg").textContent = "Tap your thermometer:";
      $("gList").innerHTML = list.map((d, i) => `<button class="gs-dev" data-i="${i}"><b>${(d.deviceName || d.sku).replace(/</g, "&lt;")}</b><span>${d.sku}</span></button>`).join("");
      $("gList").onclick = (e) => {
        const b = e.target.closest(".gs-dev"); if (!b) return;
        const d = list[+b.dataset.i];
        S.gwifi = { key, sku: d.sku, device: d.device, deviceName: d.deviceName || d.sku };
        gsensor.stop(); gcloud.start(key, S.gwifi, S.gUnit || "F");
        useGoveeNow(`Connected to ${S.gwifi.deviceName} over Wi-Fi. First reading in a few seconds.`);
      };
    } catch (e) {
      $("gMsg").textContent = e.message === "BAD_KEY" ? "Govee didn't accept that key. Check it and try again."
        : e.message === "NO_RELAY" ? "Your Cloudflare site is missing the Govee relay. Upload the latest Ember zip (it includes _worker.js), then try again."
        : "Couldn't reach Govee: " + e.message;
    }
  };

  $("btnGBle").onclick = async () => {
    try {
      if (demo) { gcloud.stop(); gsensor.startSim(demoRoom); return useGoveeNow("Using the demo thermometer"); }
      S.goveeId = await gsensor.pick();
      gcloud.stop(); S.gwifi = null;
      useGoveeNow("Thermometer paired. Readings appear in a few seconds.");
    } catch (e) {
      if (e.message === "NO_WATCH") $("gBleNote").textContent = "This browser can't listen to Govee over Bluetooth. Use Wi-Fi above.";
      else if (!cancelled(e)) toast("Couldn't pair: " + errText(e), 6000);
    }
  };

  $("btnGForget").onclick = () => {
    gcloud.stop(); gsensor.stop(); govee = null;
    S.gwifi = null; S.goveeId = null; S.room = "heater"; $("setRoom").value = "heater"; saveS();
    $("gsetup").hidden = true; render(); toast("Thermometer disconnected. Using the heater's sensor.");
  };
  $("btnGsClose").onclick = () => ($("gsetup").hidden = true);
  $("gsetup").addEventListener("click", (e) => { if (e.target.id === "gsetup") $("gsetup").hidden = true; });

  // Reconnect the thermometer chosen last time.
  async function restoreGovee() {
    if (S.room !== "govee" || goveeLive()) return;
    if (S.gwifi) return gcloud.start(S.gwifi.key, S.gwifi, S.gUnit || "F");
    if (demo || !S.goveeId) return;
    try { await gsensor.restore(S.goveeId); } catch (e) { log("✗ govee " + errText(e)); }
  }

  const heaterUnit = () =>
    S.hUnit !== "auto" ? S.hUnit
      : heater && heater.status && heater.status.unit ? heater.status.unit
      : heater && heater.proto ? heater.proto.unit : "C";
  const ambientC = () => {
    if (useGovee()) return govee.tempC;
    const s = heater && heater.status;
    if (!s || s.ambient == null) return null;
    return heaterUnit() === "F" ? fToC(s.ambient) : s.ambient;
  };
  const bodyC = () => {
    const s = heater && heater.status;
    if (!s || s.body == null) return null;
    return heaterUnit() === "F" ? fToC(s.body) : s.body;
  };
  const isOn = (s) => s && (s.power === "running" || s.power === "starting");

  /* ---------------- Connect ---------------- */
  let connecting = false;
  async function connect(useDemo) {
    if (connecting) return;
    connecting = true;
    try { await connectInner(useDemo); } finally { connecting = false; }
  }
  async function connectInner(useDemo) {
    $("connectMsg").textContent = "";
    demo = useDemo;
    try {
      if (useDemo) {
        link = new SimLink(FAST);
        await link.connect();
      } else {
        if (navigator.bluetooth.getAvailability) {
          const ok = await navigator.bluetooth.getAvailability().catch(() => true);
          if (!ok) throw new Error("Bluetooth is unavailable (off, or not allowed for this browser)");
        }
        link = new BleLink();
        await link.pick(S.showAll, log);
        $("connectMsg").textContent = "Connecting…";
        await link.connect();
        link.onDrop = onDrop;
      }
      heater = new Heater(link, onStatus, log);
      heater.pins = [S.pin || "0000", "0000", "1234"];
      $("connectMsg").textContent = "Talking to heater…";
      const ok = await heater.detect(S.proto);
      if (!ok) {
        $("connectMsg").textContent = "Connected, but the heater didn't answer. Open Settings → Copy log and send it over.";
        showMain();
        setPill("warn", "No reply");
        return;
      }
      showMain();
      keepAwake();
      restoreGovee();
      if (clean && heater.status && isOn(heater.status)) resumeClean();
      else if (clean) { clean = null; store.set("clean", null); }
    } catch (e) {
      const why = errText(e);
      log("✗ " + why);
      $("connectMsg").innerHTML = cancelled(e) ? "" : /Bluetooth error|NotAllowed|NotSupported|unavailable|SecurityError|InvalidState/i.test(why) || !/failed \(/.test(why)
        ? `<b>Couldn't open Bluetooth</b> (${why.replace(/</g, "&lt;")}). Try:<br>1. Turn Bluetooth on in Control Center.<br>2. iPhone Settings → <b>Bluefy</b> → allow <b>Bluetooth</b>.<br>3. If an iPad or other phone is your home gateway, close Ember there. A heater connects to one device at a time (or use <b>Control from away</b> here).<br>4. Fully close Bluefy, reopen it, then tap Connect once.`
        : "Couldn't connect: " + why.replace(/</g, "&lt;");
      $("btnCopyLog2").hidden = cancelled(e);
    }
  }

  // Watchdog: if the heater hasn't answered for 20 s (or writes keep failing) while
  // we think we're connected, reset the command queue and reconnect.
  setInterval(() => {
    if (!heater || !heater.proto || !link || reconnecting || params.has("demo")) return;
    const quiet = Date.now() - (heater.statusAt || Date.now()) > 20000;
    if (!quiet && (heater.writeFails || 0) < 3) return;
    log(`· watchdog: ${quiet ? "no reply for " + Math.round((Date.now() - heater.statusAt) / 1000) + " s" : "writes failing"}; resetting and reconnecting`);
    heater.chain = Promise.resolve(); heater.busy = 0; heater.writeFails = 0; heater.statusAt = Date.now();
    heater.waiters.splice(0).forEach((w) => w(null));
    onDrop();
  }, 5000);
  async function onDrop() {
    if (reconnecting) return;
    reconnecting = true;
    setPill("warn", "Reconnecting");
    for (let i = 0; i < 8 && link; i++) {
      try {
        await sleep(1000 * Math.min(8, 1 + i * 2));
        await link.connect();
        heater.lastSend = 0;
        // Newer Hcalory heaters forget the unlock when the link drops.
        if (heater.proto === P.H) heater.unlocked = await heater.unlock();
        await heater.poll();
        log("· reconnected");
        setPill("ok", "Connected");
        reconnecting = false;
        return;
      } catch (e) { log("✗ reconnect " + errText(e)); }
    }
    reconnecting = false;
    setPill("bad", "Disconnected");
  }

  function showMain() {
    $("connect").hidden = true; $("main").hidden = false;
    setPill("ok", demo ? "Demo" : link.name);
    render();
  }

  function setPill(kind, text) {
    $("pill").className = "pill" + (kind === "ok" ? "" : " " + kind);
    $("pillText").textContent = text;
  }

  async function keepAwake() {
    try { if ("wakeLock" in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => (wakeLock = null)); } } catch {}
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && heater) { keepAwake(); tick(); } });

  /* ---------------- Status updates ---------------- */
const fcode = (n) => (n ? "E-" + String(n).padStart(2, "0") : "E-?");
  const steps = (el, list) => { el.replaceChildren(...(list || []).map((t) => Object.assign(document.createElement("li"), { textContent: t }))); };
  let faultLogged = "";
  function onStatus(s) {
    if (s && s.power === "error" && s.raw !== faultLogged) { faultLogged = s.raw; log("· fault frame (code " + (s.fault || "?") + "): " + s.raw); setTimeout(() => sendDiag("fault"), 3000); }
    if (clean) renderClean();
    account(s);
    batteryGuard(s);
    render();
  }

  const maxLevel = () => (heater && heater.proto && heater.proto.maxLevel) || 10;
  const hrsText = (h) => (h >= 100 ? Math.round(h) : h >= 10 ? Math.round(h) : h.toFixed(1)) + "h";
  const fuelRate = (level) => {
    // TB2S 8 kW: ~0.16 L/h at the lowest level to ~0.62 L/h at the highest.
    const max = maxLevel();
    const l = level == null ? Math.ceil(max / 2) : Math.max(1, Math.min(max, level));
    return 0.16 + (0.62 - 0.16) * (l - 1) / (max - 1);
  };

  function account(s) {
    const now = Date.now();
    const dt = lastAcct ? Math.min(30, (now - lastAcct) / 1000) * FAST : 0;
    lastAcct = now;
    if (s.power !== "running" || !dt) { maxRunSec = 0; return; }
    const day = new Date().toISOString().slice(0, 10);
    const d = stats.days[day] || (stats.days[day] = { sec: 0, L: 0 });
    const litres = fuelRate(s.level) * dt / 3600;
    d.sec += dt; d.L += litres; stats.runSec += dt; stats.sinceFillL += litres;
    const max = heater.proto.maxLevel;
    if (s.level != null && s.level <= 2) stats.lowSec += dt;
    if (s.level === max) { maxRunSec += dt; if (maxRunSec >= 600) stats.lowSec = 0; } else maxRunSec = 0;
    const keys = Object.keys(stats.days).sort();
    while (keys.length > 60) delete stats.days[keys.shift()];
    saveStats();
  }

  function batteryGuard(s) {
    if (!S.batt || !isOn(s) || !s.volts) { lowVSince = null; return; }
    const limit = S.battV * (s.volts > 18 ? 2 : 1);
    if (s.volts >= limit) { lowVSince = null; return; }
    lowVSince = lowVSince || Date.now();
    if ((Date.now() - lowVSince) * FAST > 60000) {
      lowVSince = null; clean = null; store.set("clean", null);
      heater.stopVerified();
      toast(`Turned off to protect your battery (${s.volts} V)`, 6000);
    }
  }

  /* ---------------- Thermostat ---------------- */
  let thermoWhy = "";
  const thermoSkip = (why) => { if (why !== thermoWhy) { thermoWhy = why; if (why) log("· thermostat waiting: " + why); } };
  async function thermostat() {
    const s = heater && heater.status;
    if (!s || s.power !== "running" || S.mode !== "thermo") return thermoSkip("");
    if (clean) return thermoSkip("clean burn running");
    if (heater.busy) return thermoSkip("heater busy with another command");
    thermoSkip("");
    // Wait until the new temperature has settled (finger off the dial, no taps for a moment).
    if (drag || Date.now() < settleUntil) return;
    if (S.native && heater.proto.hasThermostat && S.room !== "govee") {
      await heater.ensureMode("thermostat");
      const want = Math.round(heaterUnit() === "F" ? cToF(S.targetC) : S.targetC);
      if (heater.status.setpoint !== want) heater.stepTo(want, "setpoint");
      return;
    }
    // Smooth heat: ease power down as the room approaches the target.
    const want = thermoWant();
    if (want == null) return thermoSkip(awaitingGovee() ? "first Govee reading" : "");
    // Normally re-check every 45 s; if the heater ignored the last change, retry after 10 s.
    const retry = thermoLast && thermoLast.want === want && heater.status.level === thermoLast.from;
    if (Date.now() - lastThermo < (retry ? 10000 : 45000) / FAST) return;
    if (s.mode !== "gear") await heater.ensureMode("gear");
    if (heater.status.level !== want) {
      log(`· thermostat: room ${show(ambientC())}° target ${show(S.targetC)}° → level ${want} (was ${heater.status.level})${retry ? " (retry)" : ""}`);
      thermoLast = { want, from: heater.status.level };
      lastThermo = Date.now(); heater.stepTo(want);
    } else thermoLast = null;
  }
  // The level the thermostat wants now. Uses the same rounded numbers you see on
  // screen, so "72° room, 72° target" always means the hold level.
  let thermoLast = null;
  const appStart = Date.now();
  // Govee chosen but its first reading hasn't arrived yet (first ~3 min after opening):
  // wait for it rather than acting on the heater's own sensor, which reads the cold intake air.
  const awaitingGovee = () => S.room === "govee" && !govee && Date.now() - appStart < 180000;
  function thermoWant() {
    if (awaitingGovee()) return null;
    const room = ambientC();
    if (room == null || !heater || !heater.proto) return null;
    const T = tune();
    const hi = Math.min(heater.proto.maxLevel, T.max);
    const lo = Math.min(hi, Math.max(heater.proto.minLevel, T.hold));
    const band = T.bandC, gap = show(room) >= show(S.targetC) ? 0 : S.targetC - room;
    return gap >= band ? hi : gap <= 0 ? lo : Math.max(lo, Math.min(hi, lo + Math.round((hi - lo) * gap / band)));
  }

  /* ---------------- Clean burn ---------------- */
  async function beginClean(kind, chosen) {
    const mins = kind === "burn" ? 15 : chosen ?? tune().clean;
    if (kind === "shutdown" && (!mins || !isOn(heater.status))) return turnOff();
    clean = { kind, endAt: Date.now() + (mins * 60000) / FAST, total: (mins * 60000) / FAST };
    store.set("clean", clean);
    keepAwake();
    renderClean();
    if (heater.status.power === "off") await heater.start();
    await heater.toMax();
  }
  function resumeClean() { renderClean(); heater.toMax(); }

  async function turnOff() {
    clean = null; store.set("clean", null); $("clean").hidden = true;
    toast("Turning off…");
    const ok = await heater.stopVerified();
    toast(ok ? "Turning off. The fan runs a few minutes to cool down." : "The heater didn't confirm it turned off. Check it, then Settings → Copy log.", ok ? 3200 : 9000);
  }

  async function finishClean() {
    const c = clean; clean = null; store.set("clean", null); $("clean").hidden = true;
    stats.lowSec = 0; saveStats();
    if (c.kind === "shutdown") {
      const ok = await heater.stopVerified();
      toast(ok ? "Clean shutdown done. Cooling down now." : "The heater didn't confirm it turned off. Check it, then Settings → Copy log.", ok ? 3200 : 9000);
    } else {
      lastThermo = 0;
      toast("Clean burn done. Back to your setting.");
      if (S.mode === "manual") heater.stepTo(S.level || 3);
    }
  }

  /* ---------------- Schedule ---------------- */
  const toMin = (t) => { const [h, m] = String(t || "0:0").split(":").map(Number); return h * 60 + m; };
  const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const fmtTime = (t) => { const d = new Date(); d.setHours(...t.split(":").map(Number), 0, 0); return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); };
  // Is "now" inside the slot's window, and which day did that window start on?
  function slotWindow(slot, now = new Date()) {
    const m = now.getHours() * 60 + now.getMinutes(), a = toMin(slot.start), b = toMin(slot.stop);
    const overnight = b <= a;
    const inside = overnight ? m >= a || m < b : m >= a && m < b;
    const startDay = new Date(now); if (overnight && m < b) startDay.setDate(startDay.getDate() - 1);
    return { inside, key: dayKey(startDay) };
  }
  async function schedule() {
    if (!heater || !heater.status || recovering) return;
    const s = heater.status;
    for (const slot of S.sched) {
      const w = slotWindow(slot);
      // Start once per window (not again if you turned it off yourself).
      if (slot.on && w.inside && S.schedFired[slot.id] !== w.key) {
        S.schedFired[slot.id] = w.key; saveS();
        if (s.power === "off" || s.power === "cooling") {
          const t = S.tunes.find((x) => x.id === slot.tune);
          if (t) { S.tuneId = t.id; if (t.targetC != null) S.targetC = t.targetC; S.mode = "thermo"; saveS(); renderPresets(); }
          S.schedOwn[slot.id] = w.key; saveS();
          log(`· schedule: ${slot.name} start`); toast(`${slot.name} schedule: heating to ${show(S.targetC)}°`, 5000);
          lastThermo = 0; await heater.startVerified();
        }
      }
      // Stop at the end of a window this schedule started.
      if (!w.inside && S.schedOwn[slot.id]) {
        delete S.schedOwn[slot.id]; saveS();
        if (isOn(heater.status) && !clean) { log(`· schedule: ${slot.name} stop`); toast(`${slot.name} schedule ended: turning off`, 5000); await beginClean("shutdown"); }
      }
    }
  }
  // Next scheduled event, for the card and the away screen.
  function schedNext() {
    const on = S.sched.filter((x) => x.on);
    if (!on.length) return null;
    const now = new Date(), m = now.getHours() * 60 + now.getMinutes();
    let best = null;
    for (const slot of on) {
      if (S.schedOwn[slot.id]) { const d = (toMin(slot.stop) - m + 1440) % 1440; if (!best || d < best.d) best = { d, text: `${slot.name} ends ${fmtTime(slot.stop)}` }; }
      const d = (toMin(slot.start) - m + 1440) % 1440 || 1440;
      if (!best || d < best.d) best = { d, text: `${slot.name} starts ${fmtTime(slot.start)}` };
    }
    return best && best.text;
  }
  function renderSchedule() {
    const opts = S.tunes.map((t) => `<option value="${t.id}">${t.name.replace(/</g, "&lt;")} ${show(t.targetC ?? S.targetC)}°</option>`).join("");
    document.querySelectorAll(".slot").forEach((el) => {
      const slot = S.sched.find((x) => x.id === el.dataset.slot);
      el.querySelector(".slot-on").checked = slot.on;
      if (document.activeElement !== el.querySelector(".slot-start")) el.querySelector(".slot-start").value = slot.start;
      if (document.activeElement !== el.querySelector(".slot-stop")) el.querySelector(".slot-stop").value = slot.stop;
      const sel = el.querySelector(".slot-tune");
      if (sel.dataset.opts !== opts) { sel.innerHTML = opts; sel.dataset.opts = opts; }
      sel.value = S.tunes.some((t) => t.id === slot.tune) ? slot.tune : "p-comfort";
      el.classList.toggle("off", !slot.on);
      el.querySelector(".slot-sum").textContent = slot.on ? (S.schedOwn[slot.id] ? "running" : "") : "off";
    });
    $("schedNext").textContent = schedNext() || "Not set";
    $("schedBody").hidden = !S.schedOpen;
    $("schedToggle").setAttribute("aria-expanded", String(!!S.schedOpen));
  }
  $("schedToggle").onclick = () => { S.schedOpen = !S.schedOpen; saveS(); renderSchedule(); };
  $("schedCard").addEventListener("change", (e) => {
    const el = e.target.closest(".slot"); if (!el) return;
    const slot = S.sched.find((x) => x.id === el.dataset.slot);
    if (e.target.classList.contains("slot-on")) { slot.on = e.target.checked; if (slot.on) keepAwake(); }
    if (e.target.classList.contains("slot-start")) { slot.start = e.target.value || slot.start; delete S.schedFired[slot.id]; }
    if (e.target.classList.contains("slot-stop")) slot.stop = e.target.value || slot.stop;
    if (e.target.classList.contains("slot-tune")) slot.tune = e.target.value;
    // Turning a slot on in the middle of its window should start it now.
    if (e.target.classList.contains("slot-on") && slot.on) delete S.schedFired[slot.id];
    saveS(); renderSchedule();
    if (slot.on) toast(`${slot.name}: ${fmtTime(slot.start)} → ${fmtTime(slot.stop)}`);
  });

  /* ---------------- Loop ---------------- */
  async function tick() {
    if (!heater || !heater.proto) return;
    if (clean) {
      renderClean(); renderStatusBar(heater.status);
      if (Date.now() >= clean.endAt) await finishClean();
      else {
        const s = heater.status, max = heater.proto.maxLevel;
        // If the heater isn't at full power yet, keep asking (every 15 s).
        if (s && isOn(s) && (s.mode !== "gear" || s.level !== max) && !heater.busy && Date.now() - (tick.lastMax || 0) > 15000) {
          tick.lastMax = Date.now();
          heater.toMax().then((ok) => { if (!ok) toast("Heater didn't go to full power. Settings → Copy log and send it over.", 6000); });
        }
      }
    }
    schedule();
    if (!drag && Date.now() >= settleUntil && $("dLabel").textContent !== "SET TO") renderDial();
    thermostat();
    if (fanWhenOff && heater.status && heater.status.power === "off" && !recovering) {
      fanWhenOff = false; heater.fan(); toast("Cool-down done. Fan only now.");
    }
    if (restartWhenOff && heater.status && heater.status.power === "off" && !recovering) {
      restartWhenOff = false; lastThermo = 0; heater.start(); toast("Cool-down done. Trying again…");
    }
    if (heater.status && heater.status.power === "running" && faultTries) faultTries = 0; // it worked
    if (plugPending && safeToCut() && !plugBusy) plugFinish(plugPending);
  }
  setInterval(() => { if (heater && heater.proto && !heater.busy && !reconnecting) heater.poll(); }, 2500);
  setInterval(tick, 1000);

  /* ---------------- Rendering ---------------- */
  const CX = 150, CY = 150, R = 118, A0 = 135, SWEEP = 270;
  const pt = (deg) => { const r = (deg * Math.PI) / 180; return [CX + R * Math.cos(r), CY + R * Math.sin(r)]; };
  const arcPath = (a, b) => {
    const [x1, y1] = pt(a), [x2, y2] = pt(b);
    return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${R} ${R} 0 ${b - a > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };
  const frac = (v) => { const [lo, hi] = range(); return Math.max(0, Math.min(1, (v - lo) / (hi - lo))); };

  function renderDial() {
    const v = show(S.targetC);
    const a = A0 + SWEEP * frac(v);
    $("track").setAttribute("d", arcPath(A0, A0 + SWEEP));
    const d = a - A0 < 0.5 ? "" : arcPath(A0, a);
    $("arc").setAttribute("d", d);
    $("arcGlow").setAttribute("d", d);
    $("arcGlow").style.opacity = isOn(heater && heater.status) ? 0.55 : 0;
    const [kx, ky] = pt(a);
    $("knob").setAttribute("cx", kx); $("knob").setAttribute("cy", ky);
    $("dTemp").textContent = v + "°";
    $("dLabel").textContent = drag || Date.now() < settleUntil ? "SETTING…" : "SET TO";
    $("dial").setAttribute("aria-valuenow", v);
    const room = ambientC();
    if (room == null) { $("dRoom").textContent = "Room —"; $("roomDot").style.display = "none"; }
    else {
      $("dRoom").textContent = "Room " + show(room) + "°" +
        (useGovee() ? (govee.hum != null ? " · " + Math.round(govee.hum) + "%" : "") + " · Govee" : S.room === "govee" ? " · heater" : "");
      const [rx, ry] = pt(A0 + SWEEP * frac(show(room)));
      $("roomDot").style.display = ""; $("roomDot").setAttribute("cx", rx); $("roomDot").setAttribute("cy", ry);
    }
    renderOutside();
    markPresets();
  }

  // Preset buttons: the built-in four (Standard style) + your saved tunes + "＋ Custom".
  function renderPresets() {
    const esc = (x) => String(x).replace(/[<&"]/g, (m) => ({ "<": "&lt;", "&": "&amp;", '"': "&quot;" }[m]));
    const order = STARTERS.map(([n]) => "p-" + n.toLowerCase());
    const starters = order.map((id) => S.tunes.find((t) => t.id === id)).filter(Boolean);
    const custom = S.tunes.find((t) => !t.id.startsWith("p-"));
    const btn = (t, cls = "") => `<button class="preset${cls}" data-tune="${t.id}"><b>${show(t.targetC ?? S.targetC)}°</b><span>${esc(t.name)}</span></button>`;
    $("presets").innerHTML = starters.map((t) => btn(t)).join("") +
      (custom ? btn(custom, " custom") : `<button class="preset add" data-new="1"><b>＋</b><span>Custom</span></button>`);
    markPresets();
  }
  function markPresets() {
    const v = show(S.targetC);
    document.querySelectorAll(".preset").forEach((b) => {
      const on = !!b.dataset.tune && b.dataset.tune === S.tuneId;
      b.classList.toggle("on", on);
    });
  }

  function renderManual() {
    const max = (heater && heater.proto && heater.proto.maxLevel) || 6;
    const lvl = (heater && heater.status && heater.status.level) || S.level || 1;
    $("levelNum").textContent = lvl; $("levelMax").textContent = max;
    const bars = $("bars");
    if (bars.children.length !== max) {
      bars.innerHTML = Array.from({ length: max }, (_, i) => `<button class="bar" data-l="${i + 1}" style="height:${30 + (70 * (i + 1)) / max}%" aria-label="Level ${i + 1}"></button>`).join("");
    }
    [...bars.children].forEach((b, i) => b.classList.toggle("on", i < lvl));
  }

  // Plain-English "what's happening" line under the status.
  function teachText(s) {
    const T = tune(), t = show(S.targetC), u = "°", lo = T.hold;
    const near = show(S.targetC - T.bandC), room = ambientC();
    if (!s) return "";
    if (s.power === "error") return "The heater stopped because of a fault. See the message above.";
    if (s.power === "cooling") return "The fan keeps running a few minutes to cool the heater safely. Don't cut the power.";
    if (s.power === "fan") return "Fan only: blowing air without burning fuel.";
    if (s.power === "off") {
      return S.mode === "manual"
        ? "Tap Start. It runs at the level you pick until you turn it off."
        : `Tap Start. It heats at level ${Math.min(maxLevel(), T.max)} until about ${near}${u}, then eases down to level ${lo} at ${t}${u}.`;
    }
    if (s.power === "starting") return "Igniting: the glow plug lights the fuel. This takes 1 to 3 minutes.";
    if (S.mode === "manual") return `Fixed at level ${s.level ?? "—"}. The thermostat is paused until you switch back.`;
    if (S.native && heater.proto.hasThermostat && S.room !== "govee") return `The heater's own thermostat is holding ${t}${u}. It may turn itself off and on.`;
    if (room == null || awaitingGovee()) return "Waiting for a room temperature reading…";
    const r = show(room);
    if (r >= t) return `At ${t}${u}: holding at level ${lo}. It stays on (it won't shut off by itself) and steps back up if the room cools.`;
    if (r <= near) return `Heating up at level ${Math.min(maxLevel(), T.max)}. It starts easing down at ${near}${u}.`;
    return `Getting close (${t - r}${u} to go): easing down to level ${thermoWant() ?? "—"} to save fuel and avoid overshooting.`;
  }

  function renderHow() {
    const T = tune(), t = show(S.targetC), u = "°", lo = T.hold, max = Math.min(maxLevel(), T.max), near = show(S.targetC - T.bandC);
    const steps = [
      ["Heating up", `Below ${near}${u}, it runs at level ${max}${max === maxLevel() ? " (full power)" : ""} to warm up.`],
      ["Getting close", `From ${near}${u} to ${t}${u}, it lowers the power step by step so it doesn't overshoot.`],
      ["At temperature", `At ${t}${u}, it holds at level ${lo}. It doesn't turn off. If the room cools, the power goes back up.`],
      ["Turning off", T.clean
        ? `When you tap Turn off, it runs ${T.clean} min at full power to burn off carbon, then shuts down. The fan cools it for a few minutes.`
        : "When you tap Turn off, it shuts down right away. The fan cools it for a few minutes."],
    ];
    $("howFoot").dataset.tune = T.name;
    $("howSteps").innerHTML = steps.map(([h, p], i) => `<li><b><i>${i + 1}</i>${h}</b><span>${p}</span></li>`).join("");
    $("howFoot").textContent = `It checks the ${useGovee() ? "Govee" : "heater's"} temperature about every 45 seconds. Keep this app open: if it closes, the heater stays at its last level. Running on low for hours builds carbon, so you'll be reminded to do a clean burn.`;
  }

  const POWER_TEXT = { off: "Off", starting: "Igniting", running: "Heating", cooling: "Cooling down", fan: "Fan only", error: "Fault" };

  // Top status bar: on/off, current level, the setting it's following, fuel left.
  function renderStatusBar(s) {
    const max = maxLevel();
    let state = "off", label = "Connecting…";
    if (reconnecting) { state = "warn"; label = "Reconnecting…"; }
    else if (clean) {
      const sec = Math.ceil((Math.max(0, clean.endAt - Date.now()) * FAST) / 1000);
      state = "clean"; label = `${clean.kind === "burn" ? "Clean burn" : "Clean shutdown"} · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    } else if (s) {
      state = { running: "on", starting: "on", cooling: "cool", fan: "cool", error: "bad" }[s.power] || "off";
      label = { off: "Off", starting: "Igniting", running: "Heating", cooling: "Cooling down", fan: "Fan only", error: "Fault " + fcode(s.fault) }[s.power] || "On";
    }
    $("sbar").dataset.state = state;
    $("sbState").textContent = label;

    const running = s && (s.power === "running" || s.power === "starting");
    const lvl = running ? s.level : null;
    $("sbLevel").innerHTML = lvl != null ? `Level <b>${lvl}</b><small> / ${max}</small>`
      : s && s.power === "fan" ? (s.level != null ? `Fan <b>${s.level}</b><small> / ${max}</small>` : "Fan · no fuel")
      : s && s.power === "error" ? "Needs attention"
      : running && s.setpoint != null ? `Heater set <b>${s.setpoint}°</b>`
      : S.mode === "manual" ? `Runs level ${S.level || 5}`
      : `Runs level ${tune().hold}–${Math.min(max, tune().max)}`;
    const segs = $("sbSegs");
    if (segs.children.length !== max) segs.innerHTML = "<i></i>".repeat(max);
    const segLvl = lvl ?? (s && s.power === "fan" ? s.level : null);
    [...segs.children].forEach((el, i) => el.classList.toggle("on", segLvl != null && i < segLvl));

    const room = ambientC();
    const roomTxt = room != null ? ` · room ${show(room)}°` : "";
    $("sbSetting").textContent = s && s.power === "fan" ? `Fan only · no fuel used${roomTxt}` : S.mode === "manual"
      ? `Manual · level ${lvl ?? S.level ?? "—"}${roomTxt}`
      : `${tune().name} · ${show(S.targetC)}°${roomTxt}`;

    // Fuel left, and how long it lasts at the level it's running (or will run) at.
    const left = Math.max(0, S.tankGal * GAL - stats.sinceFillL), gal = (left / GAL).toFixed(1);
    const hrs = (l) => left / fuelRate(l);
    const h = (x) => (x >= 10 ? Math.round(x) : x.toFixed(1));
    let fuel;
    if (lvl != null) fuel = `${gal} gal · ≈ ${h(hrs(lvl))} h at level ${lvl}`;
    else if (S.mode === "manual") fuel = `${gal} gal · ≈ ${h(hrs(S.level || 5))} h at level ${S.level || 5}`;
    else { const T = tune(); fuel = `${gal} gal · ≈ ${h(hrs(Math.min(max, T.max)))}–${h(hrs(T.hold))} h`; }
    $("sbFuel").textContent = fuel;
  }

  function render() {
    const s = heater && heater.status;
    $("thermoView").hidden = S.mode !== "thermo";
    $("manualView").hidden = S.mode !== "manual";
    $("presetBox").hidden = S.mode !== "thermo";
    document.querySelectorAll(".seg-btn[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === S.mode));
    renderDial(); renderManual();

    // Status line
    let line = s ? POWER_TEXT[s.power] || "On" : "Waiting for heater…";
    if (s && s.power === "running") {
      line += s.level != null ? ` · level ${s.level}` : s.setpoint != null ? ` · heater set ${s.setpoint}°` : "";
      const room = ambientC();
      if (S.mode === "thermo" && room != null) line += show(room) >= show(S.targetC) ? " · at temperature" : "";
    }
    $("statusLine").textContent = line;
    renderStatusBar(s);
    $("teach").textContent = teachText(s);

    // Fault
    const faults = (heater && heater.proto && heater.proto.faults) || P.FAULTS;
    const f = s && s.power === "error" ? faults[s.fault] || (s.fault ? ["Heater fault", "Code E-" + String(s.fault).padStart(2, "0") + ". Check the heater's display for details."] : ["Heater fault", "The heater didn't send a code. Its own display shows the E- number."]) : null;
    $("fault").hidden = !f;
    if (f) { $("faultCode").textContent = fcode(s.fault); $("faultTitle").textContent = f[0]; $("faultText").textContent = f[1]; steps($("faultSteps"), f[2]); }

    // Power button
    const btn = $("btnPower");
    btn.disabled = !s || recovering; // starting again during cool-down is fine (the remote does it too)
    if (isOn(s)) { btn.textContent = tune().clean ? "Turn off" : "Turn off now"; btn.classList.add("off"); }
    else { btn.textContent = recovering ? "Recovering…" : s && s.power === "error" ? "Try again" : restartWhenOff && s && s.power === "cooling" ? "Restarts after cool-down…" : "Start heating"; btn.classList.remove("off"); }
    $("btnRetry").disabled = $("btnReset").disabled = recovering;
    if (S.gplug && plugOn === false && !isOn(s)) { btn.textContent = "Power plug is off · turn it on below"; btn.disabled = true; }
    const co = coFault(s);
    $("btnRetry").hidden = co;
    if (co) { btn.textContent = "Reset (no restart: CO fault)"; }
    // Fan only: offered when the heater is off; becomes "Stop fan" while the fan runs.
    const fanOn = s && s.power === "fan";
    $("btnFan").hidden = !s || !heater.proto.fan;
    $("btnFan").textContent = fanOn ? "Stop fan" : fanWhenOff ? "Fan starts after cool-down…" : s && s.power === "error" ? "Clear fault and run fan only" : "Fan only (no heat)";
    $("btnFan").classList.toggle("on", !!fanOn);
    renderFanBars("fanBox", fanOn ? s.level : null, !!fanOn);

    // Carbon coach
    const pct = Math.min(1, stats.lowSec / (S.coachHours * 3600));
    $("coachBar").style.width = Math.max(3, pct * 100) + "%";
    $("coachBar").style.backgroundPosition = -pct * 200 + "px 0";
    $("coachPct").textContent = pct < 0.5 ? "Good" : pct < 1 ? "Due soon" : "Clean burn due";
    $("coachText").textContent = `${(stats.lowSec / 3600).toFixed(1)} of ${S.coachHours} h on low`;
    $("btnBurn").disabled = !isOn(s) || !!clean;

    // Fuel
    const today = stats.days[new Date().toISOString().slice(0, 10)] || { sec: 0, L: 0 };
    const tankL = S.tankGal * GAL;
    const left = Math.max(0, tankL - stats.sinceFillL);
    const hrs = left / fuelRate(s && s.level);
    renderFuelGauge(left / GAL);
    $("fuelLeft").textContent = `≈ ${(left / GAL).toFixed(1)} gal · ${hrs.toFixed(0)} h left`;
    $("fuelText").textContent = `Today ${(today.sec / 3600).toFixed(1)} h · ${(today.L / GAL).toFixed(2)} gal`;

    // Runtime at each level
    const max = maxLevel(), cur = s && isOn(s) ? s.level : null;
    const hrsAt = Array.from({ length: max }, (_, i) => left / fuelRate(i + 1));
    const top = Math.max(...hrsAt) || 1;
    const rt = $("runtime");
    if (rt.children.length !== max) {
      rt.innerHTML = hrsAt.map((_, i) => `<div class="rt-col"><b></b><i><u></u></i><span>${i + 1}</span></div>`).join("");
    }
    [...rt.children].forEach((col, i) => {
      col.classList.toggle("on", cur === i + 1);
      col.querySelector("b").textContent = hrsText(hrsAt[i]);
      col.querySelector("u").style.height = Math.max(4, (hrsAt[i] / top) * 100) + "%";
    });
    $("rtNow").textContent = cur ? `Now: level ${cur}` : "Level";

    // Schedule
    renderSchedule();
    renderPlug();

    // Stats
    $("sVolts").textContent = s && s.volts ? s.volts.toFixed(1) + " V" : "—";
    const b = bodyC();
    $("sBody").textContent = b != null && s && s.power !== "off" ? show(b) + "°" : "—";
    $("sHours").textContent = (stats.runSec / 3600).toFixed(1);
    $("protoName").textContent = heater && heater.proto ? ({ H: "Hcalory BD39 (H)", B: "Hcalory (B)", A: "AirHeater (A)" }[heater.proto.id]) : "—";
    $("btnGovee").hidden = !(S.room === "govee" && !goveeLive() && heater);
    $("btnGovee").textContent = goveeSetUp() ? "Govee not reading. Tap to fix" : "Connect your Govee";
    $("goveeStatus").textContent = goveeLive()
      ? [govee.model, show(govee.tempC) + "°", govee.hum != null ? Math.round(govee.hum) + "%" : "", govee.via === "wifi" ? "via Wi-Fi" : govee.batt != null ? "battery " + govee.batt + "%" : ""].filter(Boolean).join(" · ")
      : S.gwifi ? `${S.gwifi.deviceName} (Wi-Fi) · waiting for a reading` : S.goveeId ? "Bluetooth · waiting for a reading" : "Not set up";
    $("btnPairGovee").textContent = goveeSetUp() ? "Change" : "Set up";
    $("nativeRow").hidden = !(heater && heater.proto && heater.proto.hasThermostat);
  }

  function renderClean() {
    if (!clean) { $("clean").hidden = true; return; }
    $("clean").hidden = false;
    const left = Math.max(0, clean.endAt - Date.now());
    const sec = Math.ceil((left * FAST) / 1000);
    $("ringTime").textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    const C = 2 * Math.PI * 104;
    const ring = $("ringFill");
    ring.style.strokeDasharray = C;
    ring.style.strokeDashoffset = C * (1 - left / clean.total);
    const burn = clean.kind === "burn";
    $("cleanEyebrow").textContent = burn ? "CLEAN BURN" : "CLEAN SHUTDOWN";
    $("cleanText").textContent = burn
      ? "Burning off carbon at full power. Goes back to your setting after."
      : "Burning off carbon at full power. The heater turns itself off when the timer ends.";
    $("btnSkip").textContent = burn ? "Stop clean burn" : "Turn off now";
    const s = heater && heater.status, max = maxLevel(), lvl = s && s.level;
    const atMax = lvl === max;
    $("csState").textContent = !s ? "Waiting for the heater…" : s.power === "error" ? "Heater fault" : s.power === "starting" ? "Igniting" :
      s.power !== "running" ? (s.power === "cooling" ? "Cooling down" : "Waiting for the heater…") : atMax ? "Burning at full power" : "Ramping up to full power";
    $("csLevel").textContent = lvl != null ? `Level ${lvl} / ${max}` : "Level — / " + max;
    $("ringSub").textContent = lvl != null ? `level ${lvl} of ${max}` : "full power";
    $("cleanStatus").classList.toggle("ok", atMax);
    const segs = $("cleanSegs"); if (segs.children.length !== max) segs.innerHTML = "<i></i>".repeat(max);
    [...segs.children].forEach((el, i) => el.classList.toggle("on", lvl != null && i < lvl));
    $("btnKeep").hidden = burn;
  }

  /* ---------------- Input ---------------- */
  const SETTLE_MS = 2500; // pause after a temperature change before the power level follows
  function setTarget(displayValue) {
    const [lo, hi] = range();
    const v = Math.max(lo, Math.min(hi, Math.round(displayValue)));
    S.targetC = fromShow(v); saveS(); lastThermo = 0;
    settleUntil = Date.now() + SETTLE_MS; renderDial();
  }

  const dial = $("dial");
  // Relative, slowed-down dragging: the value moves by how far you turn, at half
  // speed. A tap doesn't jump it, and tiny touches (under ~10 px) are ignored.
  const DIAL_SPEED = 0.5, DEADZONE = 10;
  const angleAt = (e) => {
    const r = dial.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 300 - CX, y = ((e.clientY - r.top) / r.height) * 300 - CY;
    return (Math.atan2(y, x) * 180) / Math.PI;
  };
  dial.addEventListener("pointerdown", (e) => {
    dial.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, a: angleAt(e), v: show(S.targetC), live: false };
  });
  dial.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.live) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DEADZONE) return;
      drag.live = true; drag.a = angleAt(e); // start counting from here
    }
    const a = angleAt(e);
    let d = a - drag.a; if (d > 180) d -= 360; if (d < -180) d += 360;
    drag.a = a;
    const [lo, hi] = range();
    drag.v = Math.max(lo, Math.min(hi, drag.v + ((hi - lo) * d / SWEEP) * DIAL_SPEED));
    if (Math.round(drag.v) !== show(S.targetC)) setTarget(drag.v);
  });
  const endDrag = () => { if (drag && drag.live) settleUntil = Date.now() + SETTLE_MS; drag = null; renderDial(); };
  dial.addEventListener("pointerup", endDrag);
  dial.addEventListener("pointercancel", endDrag);
  dial.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowRight") setTarget(show(S.targetC) + 1);
    if (e.key === "ArrowDown" || e.key === "ArrowLeft") setTarget(show(S.targetC) - 1);
  });
  $("plus").onclick = () => setTarget(show(S.targetC) + 1);
  $("minus").onclick = () => setTarget(show(S.targetC) - 1);
  $("presets").addEventListener("click", (e) => {
    const b = e.target.closest(".preset"); if (!b) return;
    if (b.dataset.new) return openTuner("new");
    if (b.dataset.tune) {
      const t = S.tunes.find((x) => x.id === b.dataset.tune); if (!t) return;
      if (S.tuneId === t.id && show(S.targetC) === show(t.targetC ?? S.targetC)) return openTuner(t); // tap again to edit
      S.tuneId = t.id; if (t.targetC != null) S.targetC = t.targetC;
      saveS(); lastThermo = 0; render();
      return toast(`${t.name}: ${show(S.targetC)}° · tap again to edit`);
    }
  });
  $("btnResetPresets").onclick = () => {
    const custom = S.tunes.filter((t) => !t.id.startsWith("p-"));
    S.tunes = [...starterTunes(), ...custom];
    if (!S.tunes.some((t) => t.id === S.tuneId)) S.tuneId = "p-comfort";
    saveS(); renderPresets(); render(); toast("Sleep, Comfort and Boost reset");
  };

  document.querySelectorAll(".seg-btn[data-mode]").forEach((b) => (b.onclick = () => { S.mode = b.dataset.mode; saveS(); lastThermo = 0; render(); }));

  $("bars").addEventListener("click", (e) => {
    const b = e.target.closest(".bar"); if (!b || !heater || !heater.proto) return;
    S.level = +b.dataset.l; saveS();
    [...$("bars").children].forEach((x, i) => x.classList.toggle("on", i < S.level));
    $("levelNum").textContent = S.level;
    if (isOn(heater.status)) heater.ensureMode("gear").then(() => heater.stepTo(S.level));
  });

  $("btnPower").onclick = async () => {
    const s = heater && heater.status; if (!s) return;
    if (s.power === "error") return recover(!coFault(s));
    if (isOn(s)) return openOffSheet();
    $("btnPower").disabled = true; $("btnPower").textContent = "Starting…";
    lastThermo = 0; restartWhenOff = false;
    const r = await heater.startVerified();
    if (!r || (r.power !== "starting" && r.power !== "running")) toast(r && r.power === "error" ? "The heater reported a fault. See the message at the top." : "The heater didn't confirm it started. Check its display; if it shows an error code, Settings → Copy log and send it over.", 9000);
    if (S.mode === "manual" && S.level) setTimeout(() => heater.stepTo(S.level), 1500);
  };
  // Fan only, from any state: clears a fault first, ends heating first (with its cool-down).
  async function fanOnly(remote = false) {
    const s = heater && heater.status; if (!s || !heater.proto.fan) return;
    if (s.power === "fan") { fanWhenOff = false; await heater.stopVerified(); toast("Fan off"); return; }
    if (s.power === "error") {
      await recover(false, remote);
      if (!heater.status || heater.status.power === "error") return;
    } else if (s.power === "running" || s.power === "starting") {
      if (!remote && !confirm("Stop heating and run the fan only? The heater cools down first.")) return;
      clean = null; store.set("clean", null); $("clean").hidden = true;
      await heater.stopVerified();
    }
    const now = heater.status && heater.status.power;
    if (now === "cooling") { fanWhenOff = true; toast("Cooling down first. The fan keeps running, then switches to fan only.", 6000); render(); return; }
    const r = await heater.fan();
    toast(r && r.power === "fan" ? "Fan only: blowing air, no fuel used" : "The heater didn't confirm fan-only yet. If nothing happens, Settings → Copy log and send it over.", 6000);
  }
  $("btnFan").onclick = async () => {
    $("btnFan").disabled = true;
    try { await fanOnly(); } finally { $("btnFan").disabled = false; render(); }
  };
  /* ---------------- Govee smart plug ----------------
   * Cuts or restores the heater's mains power. Never cuts power while the heater
   * is burning or cooling down: it turns the heater off first, waits for the
   * cool-down to finish, then switches the plug off. */
  let plugOn = null, plugBusy = "", plugPending = null; // plugPending: "off" | "cycle"
  const plugKey = () => S.gplug && (S.gplug.key || S.gkey || (S.gwifi && S.gwifi.key));
  async function plugRefresh() {
    if (!S.gplug) return;
    try { const st = await gcloud.plugState(plugKey(), S.gplug); plugOn = st.on; } catch (e) { log("✗ plug: " + e.message); }
    render();
  }
  setInterval(plugRefresh, 60000);
  async function plugSwitch(on) {
    await gcloud.plugSet(plugKey(), S.gplug, on);
    plugOn = on; log("· plug " + (on ? "on" : "off")); render();
    if (on && link && !demo) setTimeout(() => { if (link && !link.connected) onDrop(); }, 8000); // heater boots, reconnect
  }
  // Is it safe to cut power right now?
  const safeToCut = () => { const s = heater && heater.status; return !s || s.power === "off" || s.power === "error"; };
  async function plugAction(kind, remote = false) {
    if (!S.gplug || plugBusy) return;
    try {
      if (kind === "on") { plugBusy = "Turning on…"; render(); await plugSwitch(true); toast("Plug on. The heater is powering up."); return; }
      const s = heater && heater.status;
      if (!heater && !remote && !confirm("Ember isn't connected to the heater, so it can't check it's off and cooled down. Only cut power if it is. Continue?")) return;
      if (s && (isOn(s) || s.power === "fan")) {
        if (!remote && !confirm("The heater is on. Turn it off now and cut the power once it has cooled down?")) return;
        clean = null; store.set("clean", null); $("clean").hidden = true;
        await heater.stopVerified();
      }
      if (safeToCut()) return await plugFinish(kind);
      plugPending = kind; render();
      toast("Waiting for the cool-down to finish, then cutting power…", 6000);
    } catch (e) { toast("Plug: " + (e.message === "BAD_KEY" ? "Govee didn't accept the API key." : e.message), 7000); }
    finally { plugBusy = ""; render(); }
  }
  async function plugFinish(kind) {
    plugPending = null;
    plugBusy = "Cutting power…"; render();
    try {
      await plugSwitch(false);
      if (kind === "cycle") {
        plugBusy = "Power off · back on in 30 s"; render();
        toast("Power off. Turning it back on in 30 seconds.", 6000);
        await sleep(30000 / FAST);
        await plugSwitch(true);
        toast("Power restored. The heater is powering up.");
      } else toast("Heater power is off.");
    } finally { plugBusy = ""; render(); }
  }
  function renderPlug() {
    $("plugCard").hidden = !S.gplug;
    $("plugStatus").textContent = S.gplug ? `${S.gplug.deviceName} · ${plugOn == null ? "checking…" : plugOn ? "on" : "off"}` : "Not set up";
    $("btnPlugSetup").textContent = S.gplug ? "Change" : "Set up";
    if (!S.gplug) return;
    $("plugName").textContent = "· " + S.gplug.deviceName;
    $("plugState").textContent = plugBusy || (plugPending ? "Waiting for cool-down…" : plugOn == null ? "—" : plugOn ? "On" : "Off");
    $("plugState").classList.toggle("on", plugOn === true);
    const busy = !!plugBusy || !!plugPending;
    $("btnPlugOn").hidden = plugOn === true; $("btnPlugOn").disabled = busy;
    $("btnPlugOff").hidden = plugOn === false; $("btnPlugOff").disabled = busy;
    $("btnPlugCycle").hidden = plugOn === false; $("btnPlugCycle").disabled = busy;
  }
  $("btnPlugOn").onclick = () => plugAction("on");
  $("btnPlugOff").onclick = () => plugAction("off");
  $("btnPlugCycle").onclick = () => plugAction("cycle");

  // Setup sheet
  $("btnPlugSetup").onclick = () => {
    $("pKey").value = plugKey() || S.gkey || (S.gwifi && S.gwifi.key) || "";
    $("pList").innerHTML = ""; $("pMsg").textContent = ""; $("btnPForget").hidden = !S.gplug;
    $("settings").hidden = true; $("plugSheet").hidden = false;
  };
  $("btnPlugClose").onclick = () => ($("plugSheet").hidden = true);
  $("plugSheet").addEventListener("click", (e) => { if (e.target.id === "plugSheet") $("plugSheet").hidden = true; });
  $("btnPForget").onclick = () => { S.gplug = null; plugOn = null; saveS(); $("plugSheet").hidden = true; render(); toast("Smart plug removed"); };
  $("btnPFind").onclick = async () => {
    const key = $("pKey").value.trim();
    if (!key) return ($("pMsg").textContent = "Paste your API key first.");
    S.gkey = key; saveS();
    $("pMsg").textContent = "Looking for your plugs…"; $("pList").innerHTML = "";
    try {
      const list = await gcloud.listPlugs(key);
      if (!list.length) return ($("pMsg").textContent = "No smart plugs found on this Govee account. Set the plug up in the Govee Home app first.");
      $("pMsg").textContent = "Tap the plug the heater is plugged into:";
      $("pList").innerHTML = list.map((d, i) => `<button class="gs-dev" data-i="${i}"><b>${(d.deviceName || d.sku).replace(/</g, "&lt;")}</b><span>${d.sku}</span></button>`).join("");
      $("pList").onclick = (e) => {
        const b = e.target.closest(".gs-dev"); if (!b) return;
        const d = list[+b.dataset.i];
        S.gplug = { key, sku: d.sku, device: d.device, deviceName: d.deviceName || d.sku }; saveS();
        $("plugSheet").hidden = true; plugRefresh(); toast(`Smart plug set: ${S.gplug.deviceName}`);
      };
    } catch (e) {
      $("pMsg").textContent = e.message === "BAD_KEY" ? "Govee didn't accept that key." : e.message === "NO_RELAY" ? "Upload the latest Ember zip (it includes _worker.js) to your Cloudflare site." : "Couldn't reach Govee: " + e.message;
    }
  };

  /* ---------------- Fault recovery ----------------
   * Reset = send Off until the fault clears (Hcalory clears faults on Off).
   * Try again = reset, wait for any cool-down, then start. After 3 failed
   * tries in 30 min it asks first (home) or only resets (away), because
   * repeated failed ignitions can flood the burner with fuel. */
  let recovering = false, restartWhenOff = false, fanWhenOff = false, faultTries = 0, faultTriesAt = 0;
  // Never restart by itself after a carbon monoxide fault (Hcalory E-10 / E-11).
  const coFault = (s) => !!s && s.power === "error" && heater && heater.proto === P.H && (s.fault === 10 || s.fault === 11);
  async function recover(start, remote = false) {
    if (!heater || !heater.proto || recovering) return;
    if (Date.now() - faultTriesAt > 30 * 60000) faultTries = 0;
    if (start && coFault(heater.status)) {
      start = false; log("· carbon monoxide fault: not restarting, reset only");
      toast("Carbon monoxide fault: Ember won't restart the heater. Ventilate, check the exhaust, then start it yourself.", 10000);
    }
    if (start && faultTries >= 3) {
      if (remote) { log("· remote retry refused after 3 failed tries; resetting only"); start = false; }
      else if (!confirm("It has failed 3 times. Check fuel, the fuel line and the exhaust first. Try once more?")) return;
    }
    recovering = true; render();
    log(`· fault recovery: ${start ? "try again" : "reset"} (fault ${heater.status && heater.status.fault})`);
    try {
      let s = heater.status;
      for (let i = 0; i < 4 && s && s.power === "error"; i++) {
        await heater.sendAll(heater.proto.stop());
        await sleep(1500);
        s = await heater.poll();
        if (i === 1 && heater.proto === P.H) heater.unlocked = await heater.unlock();
      }
      if (!s || s.power === "error") {
        toast("The fault didn't clear. Switch the heater's main power off for 30 seconds, then try again.", 9000);
        return;
      }
      if (!start) { toast("Fault cleared. The heater is off."); return; }
      faultTries++; faultTriesAt = Date.now();
      if (s.power === "off" || s.power === "cooling") { lastThermo = 0; toast("Trying again…"); await heater.startVerified(); }
      else { restartWhenOff = true; toast("Cooling down first. It restarts by itself when that's done.", 6000); }
    } finally { recovering = false; render(); }
  }
  $("btnRetry").onclick = () => recover(true);
  $("btnReset").onclick = () => recover(false);

  // Fan speed bars (fan-only mode), shared by home and away.
  function renderFanBars(id, lvl, show) {
    $(id).hidden = !show;
    if (!show) return;
    const max = maxLevel(), bars = $(id + "Bars");
    if (bars.children.length !== max) bars.innerHTML = Array.from({ length: max }, (_, i) => `<button class="bar" data-l="${i + 1}" style="height:${30 + (70 * (i + 1)) / max}%" aria-label="Fan speed ${i + 1}"></button>`).join("");
    [...bars.children].forEach((b, i) => b.classList.toggle("on", lvl != null && i < lvl));
  }
  $("fanBoxBars").addEventListener("click", async (e) => {
    const b = e.target.closest(".bar"); if (!b || !heater || !heater.status || heater.status.power !== "fan") return;
    const l = +b.dataset.l;
    [...$("fanBoxBars").children].forEach((x, i) => x.classList.toggle("on", i < l));
    const r = await heater.stepTo(l);
    const s = heater.status;
    if (s && s.level !== l) toast("The heater didn't confirm the fan speed. If it didn't change, Settings → Copy log and send it over.", 7000);
  });

  // Turn off: pick 1, 5 or 10 min burn-off, or off right away.
  function openOffSheet() {
    const def = tune().clean;
    document.querySelectorAll("#offBurn [data-min]").forEach((b) => b.classList.toggle("on", +b.dataset.min === def));
    $("offSheet").hidden = false;
  }
  $("offBurn").onclick = (e) => {
    const b = e.target.closest("[data-min]"); if (!b) return;
    $("offSheet").hidden = true; beginClean("shutdown", +b.dataset.min);
  };
  $("btnOffNow").onclick = () => { $("offSheet").hidden = true; turnOff(); };
  $("btnOffClose").onclick = () => ($("offSheet").hidden = true);
  $("offSheet").addEventListener("click", (e) => { if (e.target.id === "offSheet") $("offSheet").hidden = true; });
  $("btnSkip").onclick = () => (clean && clean.kind === "burn" ? finishClean() : turnOff());
  $("btnKeep").onclick = () => { clean = null; store.set("clean", null); $("clean").hidden = true; lastThermo = 0; toast("Still heating"); };
  $("btnBurn").onclick = () => beginClean("burn");
  // Fuel: a classic E–F gauge. Tap it to enter a custom amount; the hours at
  // each level are worked out from whatever amount you set.
  function renderFuelGauge(gal) {
    const f = Math.max(0, Math.min(1, gal / S.tankGal));
    const ang = Math.PI * (1 - f), r = 74;
    const n = $("fgNeedle");
    n.setAttribute("x2", (110 + r * Math.cos(ang)).toFixed(1)); n.setAttribute("y2", (110 - r * Math.sin(ang)).toFixed(1));
    $("fgArc").style.strokeDasharray = `${f * 100} 100`;
    $("fgVal").textContent = gal.toFixed(1);
    $("fgUnit").textContent = `gal of ${+S.tankGal}`;
    $("fuelGauge").classList.toggle("low", f <= 0.2);
    if (!$("fgTicks").childElementCount) {
      $("fgTicks").innerHTML = [0, 0.25, 0.5, 0.75, 1].map((t) => {
        const a = Math.PI * (1 - t), c = Math.cos(a), si = Math.sin(a);
        return `<line x1="${(110 + 82 * c).toFixed(1)}" y1="${(110 - 82 * si).toFixed(1)}" x2="${(110 + 98 * c).toFixed(1)}" y2="${(110 - 98 * si).toFixed(1)}" class="fg-tick"/>`;
      }).join("");
    }
  }
  const fuelGalNow = () => Math.max(0, S.tankGal - stats.sinceFillL / GAL);
  function setFuel(gal) {
    gal = Math.max(0, Math.min(S.tankGal, Math.round(gal * 10) / 10));
    stats.sinceFillL = (S.tankGal - gal) * GAL; saveStats(); render();
    toast(gal >= S.tankGal - 0.01 ? "Tank set to full" : `Fuel set to ${gal.toFixed(1)} gal`);
  }
  // Tank size: any size you like. Changing it keeps the fuel you already have.
  const clampTank = (n) => Math.max(0.5, Math.min(200, Math.round((+n || S.tankGal) * 10) / 10));
  function setTankSize(n) {
    n = clampTank(n);
    if (n === +S.tankGal) { $("setTank").value = n; $("tankMain").value = n; return; }
    const gal = Math.min(fuelGalNow(), n);
    S.tankGal = n; saveS();
    stats.sinceFillL = Math.max(0, (n - gal) * GAL); saveStats();
    $("setTank").value = n; $("tankMain").value = n; render();
    toast(`Tank size set to ${n} gal`);
  }
  const tankNow = () => clampTank($("tankInput").value);
  $("fuelGauge").onclick = () => {
    $("fuelInput").value = fuelGalNow().toFixed(1);
    $("tankInput").value = +S.tankGal;
    $("fuelSheet").hidden = false;
  };
  $("tankInput").oninput = () => { if (+$("fuelInput").value > tankNow()) $("fuelInput").value = tankNow().toFixed(1); };
  const nudgeFuel = (d) => { $("fuelInput").value = Math.max(0, Math.min(tankNow(), (+$("fuelInput").value || 0) + d)).toFixed(1); };
  $("fuelMinus").onclick = () => nudgeFuel(-0.1);
  $("fuelPlus").onclick = () => nudgeFuel(0.1);
  $("fuelQuick").onclick = (e) => { const b = e.target.closest("button"); if (b) $("fuelInput").value = (+b.dataset.f * tankNow()).toFixed(1); };
  $("btnFuelSave").onclick = () => {
    const tank = tankNow();
    if (tank !== +S.tankGal) { S.tankGal = tank; saveS(); $("setTank").value = tank; $("tankMain").value = tank; }
    setFuel(Math.min(tank, +$("fuelInput").value || 0)); $("fuelSheet").hidden = true;
  };
  $("btnFuelClose").onclick = () => ($("fuelSheet").hidden = true);
  $("fuelSheet").addEventListener("click", (e) => { if (e.target.id === "fuelSheet") $("fuelSheet").hidden = true; });
  $("btnFuelFull").onclick = () => setFuel(S.tankGal);

  // Settings
  const bind = (id, key, num) => {
    const el = $(id);
    if (el.type === "checkbox") el.checked = !!S[key]; else el.value = String(S[key]);
    el.onchange = () => { S[key] = el.type === "checkbox" ? el.checked : num ? +el.value : el.value; saveS(); renderPresets(); render(); };
  };
  bind("setUnit", "unit"); bind("setClean", "cleanMins", 1); bind("setCoach", "coachHours", 1);
  bind("setMin", "minLevel", 1);
  $("setTank").value = +S.tankGal; $("tankMain").value = +S.tankGal;
  $("setTank").onchange = () => setTankSize(+$("setTank").value);
  $("tankMain").onchange = () => setTankSize(+$("tankMain").value);
  $("btnFuelSet").onclick = () => $("fuelGauge").click(); bind("setBatt", "batt");
  bind("setBattV", "battV", 1); bind("setNative", "native"); bind("setProto", "proto");
  bind("setHUnit", "hUnit"); bind("setPin", "pin"); bind("setAll", "showAll"); bind("setRoom", "room");
  bind("setGUnit", "gUnit");
  $("setGUnit").addEventListener("change", () => { if (S.gwifi) gcloud.start(S.gwifi.key, S.gwifi, S.gUnit); });
  $("setRoom").addEventListener("change", () => { lastThermo = 0; if (S.room === "govee" && !goveeLive()) (goveeSetUp() ? restoreGovee() : openGoveeSetup()); });
  $("btnPairGovee").onclick = openGoveeSetup;
  $("btnGovee").onclick = openGoveeSetup;
  /* ---------------- Tunes ---------------- */
  let draft = null;
  const bandShow = (c) => Math.round(S.unit === "F" ? c * 9 / 5 : c);
  const bandFrom = (d) => (S.unit === "F" ? d * 5 / 9 : d);
  function openTuner(base) {
    const T = base || tune();
    const isNew = (!base && T.id === "std") || base === "new";
    const src = base === "new" ? tune() : T;
    draft = { ...src, band: bandShow(src.bandC), temp: show(src.targetC ?? S.targetC), id: isNew ? "t" + Date.now() : src.id, isNew };
    if (isNew) draft.name = "Custom " + (S.tunes.length + 1);
    $("tuneName").value = draft.name;
    $("btnTuneDelete").hidden = isNew || String(draft.id).startsWith("p-"); // the three main buttons stay; edit or reset them
    renderTuner();
    $("tuner").hidden = false;
  }
  function renderTuner() {
    const top = maxLevel();
    const lim = { temp: range(), max: [3, top], band: S.unit === "F" ? [2, 15] : [1, 8], hold: [1, Math.max(1, draft.max - 1)] };
    draft.hold = Math.min(draft.hold, lim.hold[1]);
    document.querySelectorAll("#tuner .stepper").forEach((st) => {
      const k = st.dataset.k, [lo, hi] = lim[k];
      st.querySelector("output").textContent = k === "band" || k === "temp" ? draft[k] + "°" : "Level " + draft[k];
      st.querySelector('[data-d="-1"]').disabled = draft[k] <= lo;
      st.querySelector('[data-d="1"]').disabled = draft[k] >= hi;
    });
    document.querySelectorAll("#tuneClean .seg-btn").forEach((b) => b.classList.toggle("on", +b.dataset.v === draft.clean));
    const t = draft.temp;
    $("tunePreview").textContent = `With ${t}°: level ${draft.max} until ${t - draft.band}°, then eases down and holds at level ${draft.hold} at ${t}°. ` +
      (draft.clean ? `Turning off: ${draft.clean} min clean burn, then off.` : "Turning off: off right away.");
  }
  $("tuner").addEventListener("click", (e) => {
    if (e.target.id === "tuner") return ($("tuner").hidden = true);
    const b = e.target.closest(".stepper button");
    if (b) {
      const k = b.closest(".stepper").dataset.k;
      draft[k] += +b.dataset.d;
      if (k === "max" && draft.hold >= draft.max) draft.hold = draft.max - 1;
      renderTuner();
    }
    const c = e.target.closest("#tuneClean .seg-btn");
    if (c) { draft.clean = +c.dataset.v; renderTuner(); }
  });
  $("btnTunerClose").onclick = () => ($("tuner").hidden = true);
  $("btnTuneSave").onclick = () => {
    const name = ($("tuneName").value || "").trim() || "Custom";
    const t = { id: draft.id, name, targetC: fromShow(draft.temp), max: draft.max, bandC: bandFrom(draft.band), hold: draft.hold, clean: draft.clean };
    const i = S.tunes.findIndex((x) => x.id === t.id);
    if (i >= 0) S.tunes[i] = t; else S.tunes.push(t);
    S.tuneId = t.id; S.targetC = t.targetC; saveS(); lastThermo = 0;
    $("tuner").hidden = true; renderPresets(); render();
    toast(`Saved “${name}” and switched to it`);
  };
  $("btnTuneDelete").onclick = () => {
    S.tunes = S.tunes.filter((x) => x.id !== draft.id);
    if (S.tuneId === draft.id) S.tuneId = "std";
    saveS(); $("tuner").hidden = true; renderPresets(); render(); toast("Tune deleted");
  };
  $("btnTune").onclick = () => openTuner(tune().id === "std" ? "new" : tune());

  $("btnHow").onclick = () => { renderHow(); $("how").hidden = false; };
  $("btnHowClose").onclick = () => ($("how").hidden = true);
  $("how").addEventListener("click", (e) => { if (e.target.id === "how") $("how").hidden = true; });
  $("btnSettings").onclick = () => { $("settings").hidden = false; log("· settings opened"); aiLoad(); };
  $("btnClose").onclick = () => ($("settings").hidden = true);
  $("settings").addEventListener("click", (e) => { if (e.target.id === "settings") $("settings").hidden = true; });
  $("btnCopyLog2").onclick = () => $("btnCopyLog").onclick();
  /* ---------------- Send log (troubleshooting) ----------------
   * Uploads a snapshot to this site's own storage (Cloudflare KV) so it can be
   * read for troubleshooting. No API keys or PINs are included. Sent when you
   * tap "Send log", on a fault, and every 15 minutes while something new happened. */
  let diagDirty = false, diagLastAuto = 0;
  const diagId = store.get("diagId", null) || (() => { const id = Math.random().toString(36).slice(2, 8); store.set("diagId", id); return id; })();
  function diagText(reason) {
    const s = heater && heater.status;
    const safe = { unit: S.unit, targetC: S.targetC, mode: S.mode, tuneId: S.tuneId, minLevel: S.minLevel, room: S.room, native: S.native,
      proto: S.proto, hUnit: S.hUnit, tankGal: S.tankGal, tunes: S.tunes, gUnit: S.gUnit, govee: S.gwifi ? S.gwifi.sku : S.goveeId ? "bluetooth" : null, outside: S.outside && S.outside.city };
    const state = { reason, version: VERSION, at: new Date().toString(), ua: navigator.userAgent, device: link ? link.name : null, format: heater && heater.proto ? heater.proto.id : null,
      hidden: document.hidden, heater: s ? { power: s.power, mode: s.mode, level: s.level, setpoint: s.setpoint, ambient: s.ambient, unit: s.unit, fault: s.fault, volts: s.volts, raw: s.raw } : null,
      busy: heater ? heater.busy : null, clean, drag: !!drag, settleIn: settleUntil - Date.now(), roomC: ambientC(), roomShown: ambientC() == null ? null : show(ambientC()),
      govee: govee ? { tempC: govee.tempC, hum: govee.hum, via: govee.via, ageS: Math.round((Date.now() - govee.at) / 1000) } : null, goveeUsed: useGovee(),
      thermo: { want: heater ? thermoWant() : null, sinceLastS: Math.round((Date.now() - lastThermo) / 1000), last: thermoLast }, settings: safe };
    return JSON.stringify(state, null, 1) + "\n\n--- events ---\n" + events.join("\n").replace(/PIN \d+/g, "PIN ****") + "\n\n--- recent radio ---\n" + logLines.slice(-60).join("\n");
  }
  async function sendDiag(reason) {
    try {
      const r = await fetch("diag", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: diagId, text: diagText(reason) }) });
      if (r.ok) { diagDirty = false; return true; }
    } catch {}
    return false;
  }
  setInterval(() => { if (diagDirty && heater && Date.now() - diagLastAuto > 15 * 60000) { diagLastAuto = Date.now(); sendDiag("auto"); } }, 60000);
  $("btnSendLog").onclick = async () => {
    $("btnSendLog").disabled = true;
    const ok = await sendDiag("button");
    $("btnSendLog").disabled = false;
    toast(ok ? `Log sent (ID ${diagId}). Tell Claude it's sent.` : "Couldn't send the log. Check the internet connection, or use Copy log.", 7000);
  };
  $("btnCopyLog").onclick = async () => {
    const text = `Ember log · ${navigator.userAgent}\nDevice: ${link ? link.name : "-"} · format ${heater && heater.proto ? heater.proto.id : "?"}\n` + logLines.join("\n");
    try { await navigator.clipboard.writeText(text); toast("Log copied"); } catch { toast("Couldn't copy"); }
  };
  $("btnDisconnect").onclick = () => {
    link && link.disconnect(); link = null; heater = null; gsensor.stop(); gcloud.stop(); govee = null;
    $("settings").hidden = true; $("main").hidden = true; $("connect").hidden = false;
    $("connectMsg").textContent = "";
  };

  $("btnConnect").onclick = () => connect(false);
  $("btnAll").onclick = () => { S.showAll = true; saveS(); $("setAll").checked = true; connect(false); };
  $("btnDemo").onclick = () => connect(true);

  if (!navigator.bluetooth) {
    $("btNote").hidden = false;
    $("btnConnect").disabled = true; $("btnAll").disabled = true;
    $("btNote").textContent = /iPhone|iPad|Macintosh/.test(navigator.userAgent)
      ? "On iPhone or iPad, open this page in the free Bluefy browser to connect."
      : "Open this page in Chrome to connect over Bluetooth.";
  }


  /* ---------------- Control from away ----------------
   * Home gateway: this device stays by the heater, posts status and runs commands.
   * Away: your phone reads that status and sends commands. Both go through the
   * site's _worker.js (Cloudflare KV), protected by a PIN you choose. */
  const pinOf = (v) => String(v || "").replace(/\D/g, "");
  const GW_EVERY = FAST > 1 ? 1000 : 5000; // how often the home device checks in, and the away screen refreshes
  const remoteMsg = (e) => ({
    NOT_SET_UP: "Cloudflare storage isn't switched on yet. Follow “Control from away” in the setup guide.",
    NO_RELAY: "Your Cloudflare site needs the latest Ember zip (with _worker.js).",
    WRONG_PIN: "Wrong PIN." + (e.left != null ? ` ${e.left} tries left before a 24-hour lock.` : ""),
    LOCKED: "Too many wrong PINs. Away control is locked for up to 24 hours.",
    NO_HOME: "No home device yet. On the device at home, turn on Settings → Home gateway first.",
  }[e.message] || "Can't reach your site: " + e.message);

  async function rcall(method, path, body, pin) {
    let r;
    try {
      r = await fetch("remote/" + path, { method, cache: "no-store", headers: { "X-Ember-Pin": pinOf(pin), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    } catch { throw new Error("offline"); }
    if (!(r.headers.get("content-type") || "").includes("json")) throw new Error("NO_RELAY");
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.message || "error " + r.status), { left: j.left });
    return j;
  }

  /* ----- Home gateway (this device sits by the heater) ----- */
  function snapshot() {
    const s = heater && heater.status;
    const left = Math.max(0, S.tankGal * GAL - stats.sinceFillL);
    return {
      v: 1, at: Date.now(), connected: !!(heater && heater.proto && !reconnecting), reconnecting: !!reconnecting, name: link ? link.name : null,
      power: s ? s.power : null, level: s ? s.level : null, setpoint: s ? s.setpoint : null, max: maxLevel(),
      fault: s ? s.fault : null, volts: s ? s.volts : null,
      noRetry: coFault(s),
      ...(() => {
        if (!s || s.power !== "error") return { faultText: null };
        const f = (heater.proto.faults || P.FAULTS)[s.fault] || ["Heater fault", "Check the heater's display for the code."];
        return { faultText: fcode(s.fault) + " " + f[0] + ": " + f[1], faultTitle: fcode(s.fault) + " · " + f[0], faultInfo: f[1], faultSteps: f[2] || [] };
      })(),
      raw: s && s.power === "error" ? s.raw : undefined,
      mode: S.mode, targetC: S.targetC, roomC: ambientC(), outC: outFresh() ? out.c : null, outCity: S.outside ? S.outside.city || null : null, roomSrc: useGovee() ? "Govee" : "heater",
      tuneId: tune().id, tuneName: tune().name, hold: tune().hold, top: Math.min(maxLevel(), tune().max),
      tunes: S.tunes.map((t) => ({ id: t.id, name: t.name, targetC: t.targetC })),
      manualLevel: S.level || null, leftL: left, schedNext: schedNext(),
      plug: S.gplug ? { name: S.gplug.deviceName, on: plugOn, busy: plugBusy || (plugPending ? "Waiting for cool-down…" : "") } : null, clean: clean ? { kind: clean.kind, endAt: clean.endAt } : null,
      // Extra detail for assistants (Claude, ChatGPT…): everything the app shows.
      x: (() => {
        const today = stats.days[new Date().toISOString().slice(0, 10)] || { sec: 0, L: 0 };
        const week = Object.entries(stats.days).filter(([d]) => Date.now() - Date.parse(d) < 7 * 864e5).reduce((a, [, v]) => ({ sec: a.sec + v.sec, L: a.L + v.L }), { sec: 0, L: 0 });
        const running = s && s.power === "running";
        const lo = Math.max(1, S.minLevel || 2);
        return {
          version: VERSION, unit: S.unit, bodyC: s && s.power !== "off" ? bodyC() : null, hum: useGovee() && govee.hum != null ? Math.round(govee.hum) : null,
          heaterRoomC: s && s.ambient != null ? (heaterUnit() === "F" ? fToC(s.ambient) : s.ambient) : null,
          runH: +(stats.runSec / 3600).toFixed(1), todayH: +(today.sec / 3600).toFixed(1), todayL: +today.L.toFixed(2), weekH: +(week.sec / 3600).toFixed(1), weekL: +week.L.toFixed(2),
          lowH: +(stats.lowSec / 3600).toFixed(1), coachH: S.coachHours, cleanMins: S.cleanMins, minLevel: lo, tankGal: S.tankGal,
          rateLph: running ? +fuelRate(s.level).toFixed(2) : null,
          hoursLeft: { now: running ? +(left / fuelRate(s.level)).toFixed(1) : null, low: +(left / fuelRate(lo)).toFixed(1), max: +(left / fuelRate(maxLevel())).toFixed(1) },
          sched: S.sched.map((x) => ({ id: x.id, name: x.name, on: !!x.on, start: x.start, stop: x.stop })),
          cleanLeftMin: clean ? Math.max(0, Math.round((clean.endAt - Date.now()) / 60000)) : null,
        };
      })(),
    };
  }
  let gwKey = "", gwMinor = "", gwPushAt = 0, gwBusy = false, gwInfo = "";
  async function runRemote(c) {
    log(`· remote: ${c.action}${c.value != null ? " " + c.value : ""}`);
    if (!heater || !heater.proto) return;
    const s = heater.status;
    if (c.action === "start" && s && (s.power === "off" || s.power === "cooling")) { lastThermo = 0; await heater.startVerified(); toast("Started from away"); }
    else if (c.action === "stop" && s && isOn(s) && !clean) { await beginClean("shutdown", [1, 5, 10, 20].includes(c.value) ? c.value : undefined); }
    else if (c.action === "stopnow" && s && (isOn(s) || clean || s.power === "fan")) { await turnOff(); }
    else if (c.action === "fan" && s && s.power !== "fan") { await fanOnly(true); }
    else if (c.action === "fanlevel" && s && s.power === "fan") { await heater.stepTo(Math.max(1, Math.min(maxLevel(), +c.value))); }
    else if (c.action === "retry") { await recover(true, true); }
    else if (c.action === "plugon") { await plugAction("on", true); }
    else if (c.action === "plugoff") { await plugAction("off", true); }
    else if (c.action === "plugcycle") { await plugAction("cycle", true); }
    else if (c.action === "reset") { await recover(false, true); }
    else if (c.action === "tune") {
      const t = S.tunes.find((x) => x.id === c.value);
      if (t) { S.tuneId = t.id; if (t.targetC != null) S.targetC = t.targetC; S.mode = "thermo"; }
    } else if (c.action === "target" && +c.value >= 4 && +c.value <= 32) { S.targetC = +c.value; S.mode = "thermo"; }
    else if (c.action === "mode" && (c.value === "thermo" || c.value === "manual")) S.mode = c.value;
    else if (c.action === "clean" && s && s.power === "running" && !clean) { await beginClean("burn"); }
    else if (c.action === "cleanstop" && clean) {
      if (clean.kind === "burn") { clean = null; store.set("clean", null); $("clean").hidden = true; lastThermo = 0; }
      else { await turnOff(); } // a shutdown burn-off asked to stop early: just turn off now
    }
    else if (c.action === "fuel" && +c.value >= 0) { setFuel(Math.min(S.tankGal, +c.value)); }
    else if (c.action === "fuelfull") { setFuel(S.tankGal); }
    else if ((c.action === "schedon" || c.action === "schedoff") && S.sched.some((x) => x.id === c.value)) {
      S.sched.find((x) => x.id === c.value).on = c.action === "schedon"; renderSchedule();
    }
    else if (c.action === "level") {
      const l = Math.max(1, Math.min(maxLevel(), Math.round(+c.value) || 1));
      S.mode = "manual"; S.level = l;
      if (isOn(s)) { await heater.ensureMode("gear"); await heater.stepTo(l); }
    }
    saveS(); lastThermo = 0; renderPresets(); render();
  }
  async function gatewayTick() {
    if (!S.gateway || !S.homePin || gwBusy || !heater) return;
    gwBusy = true;
    try {
      const { cmds = [], watchAt = 0, now: srvNow = Date.now() } = await rcall("GET", "cmd?after=" + (S.gwLastId || 0), null, S.homePin);
      const watched = srvNow - watchAt < 150000; // someone has the away screen open
      for (const c of cmds) {
        S.gwLastId = Math.max(S.gwLastId || 0, c.id); saveS();
        if (Date.now() - c.at > 15 * 60000) { log("· skipped an old remote command: " + c.action); continue; }
        await runRemote(c);
      }
      // Publish status: right away for important changes, otherwise at most every 3 min
      // (and every 10 min regardless) to stay inside Cloudflare's free KV limits.
      const st = snapshot();
      const key = JSON.stringify([st.plug && st.plug.on, st.plug && st.plug.busy, st.connected, st.power, st.fault, !!st.clean, st.mode, st.tuneId, Math.round(st.targetC * 2), st.tunes.map((t) => t.id + t.name + t.targetC).join()]);
      const minor = JSON.stringify([st.level, st.roomC == null ? null : Math.round(st.roomC), Math.round(st.leftL / GAL * 4), st.power]);
      const since = Date.now() - gwPushAt;
      // Watched: send any change within 10 s and check in every minute.
      // Not watched: send minor changes every 3 min and check in every 10 min (free-tier friendly).
      const due = watched ? (minor !== gwMinor && since > 10000 / FAST) || since > 60000 / FAST
                          : (minor !== gwMinor && since > 180000) || since > 600000;
      if (key !== gwKey || due) {
        await rcall("POST", "state", st, S.homePin);
        gwKey = key; gwMinor = minor; gwPushAt = Date.now();
      }
      gwInfo = "Online · ready for away control";
    } catch (e) { gwInfo = e.message === "WRONG_PIN" ? "The PIN was changed somewhere else. Tap Change PIN to set it again here." : remoteMsg(e); }
    finally { gwBusy = false; renderGateway(); }
  }
  setInterval(gatewayTick, GW_EVERY);
  /* ----- Voice & AI assistants: Claude, ChatGPT, Siri, Home Assistant, other ----- *
   * Each connection gets its own access key (managed with the gateway PIN, so it
   * works from the home device or your phone). Commands run on the home gateway. */
  const aiPin = () => S.homePin || S.awayPin;
  const SERVICES = {
    claude: { name: "Claude", make: (u) => ({
      steps: ["In Claude, open Settings → Connectors.", "Tap Add custom connector. Name it Ember Heater and paste the connector URL below.", "Tap Add. Then just ask Claude: \"turn on my heater to Comfort\", \"set it to 72\", or \"what's the heater doing?\""],
      fields: [["Connector URL", u.mcp]] }) },
    chatgpt: { name: "ChatGPT", make: (u) => ({
      steps: ["On chatgpt.com (paid plans), open Settings → Apps & Connectors → Advanced settings and turn on Developer mode.", "Back in Apps & Connectors, tap Create. Name: Ember Heater. MCP server URL: paste the URL below. Authentication: No authentication. Tap Create.", "In a new chat, open the + menu, turn on Developer mode and pick Ember Heater. Then say \"turn on the heater\"."],
      fields: [["MCP server URL", u.mcp]] }) },
    siri: { name: "Siri", make: (u) => ({
      steps: ["Open the Shortcuts app → + → Add Action → Get Contents of URL.", "Paste the Heater on URL. Tap the arrow to show more: Method POST. Under Headers add Authorization with the header value below.", "Optional: Request Body JSON, add preset = Comfort (or temperature = 72).", "Rename the shortcut \"Heater on\". Now say \"Hey Siri, heater on\".", "Make a second shortcut the same way with the Heater off URL, named \"Heater off\"."],
      fields: [["Heater on URL", u.api + "on"], ["Heater off URL", u.api + "off"], ["Authorization header value", "Bearer " + u.key]] }) },
    ha: { name: "Home Assistant", make: (u) => ({
      steps: ["Add this to configuration.yaml and restart Home Assistant.", "Use script/automation actions rest_command.heater_on and rest_command.heater_off, or expose them to your voice assistant."],
      fields: [["configuration.yaml", `rest_command:\n  heater_on:\n    url: "${u.api}on"\n    method: post\n    headers:\n      authorization: "Bearer ${u.key}"\n    content_type: "application/json"\n    payload: '{"preset": "Comfort"}'\n  heater_off:\n    url: "${u.api}off"\n    method: post\n    headers:\n      authorization: "Bearer ${u.key}"\n    content_type: "application/json"\n    payload: '{}'`]] }) },
    other: { name: "Other", make: (u) => ({
      steps: ["AI apps that support MCP: use the MCP URL.", "Anything else: call the web API with the header below. GET status · POST on, off, temperature, level, fan (details in the setup guide on GitHub)."],
      fields: [["MCP URL", u.mcp], ["Web API", u.api], ["Authorization header value", "Bearer " + u.key]] }) },
  };
  function aiRenderSub() {
    $("aiSub").textContent = aiPin() ? 'Tell Claude, ChatGPT or Siri "turn on the heater".' : "Needs the Home gateway turned on (on the device next to the heater) or Control from away set up on this phone.";
  }
  async function aiLoad() {
    aiRenderSub();
    if (!aiPin()) { $("aiKeys").innerHTML = ""; return; }
    try {
      const { keys = [] } = await rcall("GET", "keys", null, aiPin());
      $("aiKeys").innerHTML = "";
      for (const k of keys) {
        const row = document.createElement("div"); row.className = "ai-key";
        const name = document.createElement("span"); name.textContent = k.name;
        const when = document.createElement("small"); when.textContent = k.used ? "used " + new Date(k.used).toLocaleDateString() : "not used yet";
        name.append(when);
        const del = document.createElement("button"); del.className = "btn small"; del.textContent = "Disconnect";
        del.onclick = async () => {
          if (!confirm(`Disconnect "${k.name}"? It stops working right away.`)) return;
          try { await rcall("DELETE", "keys/" + k.id, null, aiPin()); toast("Disconnected"); } catch (e) { toast(remoteMsg(e), 7000); }
          aiLoad();
        };
        row.append(name, del); $("aiKeys").append(row);
      }
    } catch (e) { $("aiKeys").innerHTML = ""; }
  }
  $("btnAiAdd").onclick = () => {
    if (!aiPin()) { toast("Turn on Home gateway on the device next to the heater first (or set up Control from away on this phone).", 8000); return; }
    $("aiNew").hidden = true; $("aiPick").hidden = !$("aiPick").hidden;
  };
  $("aiPick").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-svc]"); if (!b) return;
    const svc = SERVICES[b.dataset.svc];
    try {
      const j = await rcall("POST", "keys", { name: svc.name }, aiPin());
      const u = { key: j.key, mcp: location.origin + "/mcp/" + j.key, api: location.origin + "/api/" };
      const g = svc.make(u);
      $("aiTitle").textContent = "Connect " + svc.name;
      $("aiSteps").replaceChildren(...g.steps.map((t) => Object.assign(document.createElement("li"), { textContent: t })));
      $("aiFields").replaceChildren(...g.fields.map(([label, value]) => {
        const wrap = document.createElement("div");
        const l = Object.assign(document.createElement("p"), { className: "ai-field", textContent: label });
        const row = Object.assign(document.createElement("div"), { className: "ai-copy" });
        const code = Object.assign(document.createElement("pre"), { textContent: value });
        const btn = Object.assign(document.createElement("button"), { className: "btn small", textContent: "Copy" });
        btn.onclick = async () => { try { await navigator.clipboard.writeText(value); toast("Copied"); } catch { toast("Couldn't copy. Press and hold the text to copy it."); } };
        row.append(code, btn); wrap.append(l, row); return wrap;
      }));
      $("aiPick").hidden = true; $("aiNew").hidden = false; aiLoad();
    } catch (err) { toast(remoteMsg(err), 7000); }
  });
  $("btnAiDone").onclick = () => { $("aiNew").hidden = true; $("aiFields").replaceChildren(); };

  function renderGateway() {
    $("setGateway").checked = !!S.gateway;
    $("gwBox").hidden = !S.gateway;
    $("gwCode").textContent = S.homePin ? "•".repeat(S.homePin.length) : "Not set";
    $("gwStatus").textContent = S.gateway ? gwInfo || "Starting…" : "";
    $("gwBadge").hidden = !S.gateway;
    $("gwBadge").classList.toggle("bad", !!gwInfo && !/^Online/.test(gwInfo));
    $("gwBadgeText").textContent = /^Online/.test(gwInfo) ? "Home gateway on · keep this screen on" : gwInfo || "Home gateway starting…";
  }
  function startGateway() { S.gateway = true; saveS(); gwKey = ""; gwInfo = ""; renderGateway(); keepAwake(); gatewayTick(); }
  $("setGateway").onchange = (e) => {
    if (!e.target.checked) { S.gateway = false; saveS(); return renderGateway(); }
    if (S.homePin) return startGateway();
    e.target.checked = false; openPin("set");
  };
  $("btnGwNew").onclick = () => openPin(S.homePin ? "change" : "set");

  /* ----- PIN sheet: set it (home), change it (home), or enter it (away) ----- */
  let pinMode = "away";
  function openPin(mode) {
    pinMode = mode;
    const T = {
      set: ["Choose a PIN", "Pick 4 to 8 digits. You'll enter it on your phone to control the heater from away.", "New PIN", "Save PIN"],
      change: ["Change PIN", "Enter the current PIN, then the new one. Phones using the old PIN will be asked for the new one.", "Current PIN", "Change PIN"],
      away: ["Control from away", "Enter the PIN you set on the device at home (Settings → Home gateway).", "PIN", "Connect"],
    }[mode];
    $("pinTitle").textContent = T[0]; $("pinText").textContent = T[1];
    $("awCode").placeholder = T[2]; $("btnAwsGo").textContent = T[3];
    $("awCode2").hidden = mode !== "change";
    $("awCode").value = ""; $("awCode2").value = ""; $("awsMsg").textContent = "";
    $("settings").hidden = true; $("awaySetup").hidden = false;
    setTimeout(() => $("awCode").focus(), 50);
  }

  /* ----- Away (your phone) ----- */
  let awTimer = null, awState = null, awNow = 0, awPending = null, awArmed = 0, awTarget = null, awTargetTimer = null, awView = null, awLvl = null;
  function openAway() {
    if (!S.awayPin) return openPin("away");
    $("connect").hidden = true; $("main").hidden = true; $("away").hidden = false;
    awayPoll(); clearInterval(awTimer); awTimer = setInterval(awayPoll, GW_EVERY);
    awayWatch(); clearInterval(awWatchTimer); awWatchTimer = setInterval(awayWatch, FAST > 1 ? 5000 : 60000);
  }
  function closeAway() { clearInterval(awTimer); clearInterval(awWatchTimer); $("away").hidden = true; $("connect").hidden = false; }
  // Tell the home device someone is watching, so it sends updates every few seconds.
  let awWatchTimer = null;
  const awayWatch = () => { if (!document.hidden && S.awayPin) rcall("POST", "watch", null, S.awayPin).catch(() => {}); };
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("away").hidden) { awayWatch(); awayPoll(); } });
  $("btnAway").onclick = openAway;
  $("btnAwayExit").onclick = closeAway;
  $("btnAwsClose").onclick = () => ($("awaySetup").hidden = true);
  $("btnAwayForget").onclick = () => { S.awayPin = null; saveS(); closeAway(); openAway(); };
  $("btnAwsGo").onclick = async () => {
    const pin = pinOf($("awCode").value), pin2 = pinOf($("awCode2").value);
    const bad = (p) => p.length < 4 || p.length > 8;
    if (bad(pin) || (pinMode === "change" && bad(pin2))) return ($("awsMsg").textContent = "A PIN is 4 to 8 digits.");
    $("awsMsg").textContent = "Checking…";
    try {
      if (pinMode === "away") {
        await rcall("GET", "state", null, pin);
        S.awayPin = pin; saveS(); $("awaySetup").hidden = true; return openAway();
      }
      const newPin = pinMode === "change" ? pin2 : pin;
      await rcall("POST", "register", { pin: newPin }, pinMode === "change" ? pin : pin);
      S.homePin = newPin; S.gwLastId = 0; saveS();
      $("awaySetup").hidden = true; toast(pinMode === "change" ? "PIN changed" : "PIN saved. Home gateway is on.");
      startGateway();
    } catch (e) {
      $("awsMsg").textContent = pinMode === "set" && e.message === "WRONG_PIN"
        ? "This site already has a home PIN. Enter that PIN, or use Change PIN." : remoteMsg(e);
    }
  };

  // Connection steps on the away screen: Internet → Home app → Heater.
  function setConn(site, home, heater, text) {
    for (const [id, st] of [["cnSite", site], ["cnHome", home], ["cnHeater", heater]]) $(id).dataset.st = st;
    $("cnText").textContent = text;
    $("awConn").dataset.st = site === "ok" && home === "ok" && heater === "ok" ? "ok" : [site, home, heater].includes("bad") ? "bad" : "wait";
  }
  // One connection check for the whole away screen (strip, status bar, badge, buttons).
  // Updates pass through Cloudflare's storage, which can lag a minute or two, so:
  // fresh ≤ 4 min = connected, 4–10 min = slow (amber), > 10 min = home app offline (red).
  function awHealth() {
    const st = awState;
    if (!st) return { home: "wait", heater: "idle", age: 0, ago: "" };
    const age = Math.max(0, (awNow || Date.now()) - (st.serverAt || st.at));
    const ago = age < 10000 ? "just now" : age < 90000 ? Math.round(age / 1000) + " s ago" : Math.round(age / 60000) + " min ago";
    const home = age > 10 * 60000 ? "bad" : age > 4 * 60000 ? "wait" : "ok";
    const heater = home === "bad" ? "idle" : !st.connected ? (st.reconnecting ? "wait" : "bad") : "ok";
    return { home, heater, age, ago };
  }
  function renderConn() {
    if (!awState) return setConn("ok", "wait", "idle", "Waiting for the home app to check in…");
    const h = awHealth();
    if (h.home === "bad") return setConn("ok", "bad", "idle", `Not connected · the home app last reported ${h.ago}. Check the device at home is awake with Ember open.`);
    if (h.heater === "bad") return setConn("ok", "ok", "bad", "Not connected · the home app can't reach the heater (out of range, unplugged or powered off).");
    if (h.heater === "wait") return setConn("ok", "ok", "wait", "Home app is connecting to the heater…");
    if (h.home === "wait") return setConn("ok", "wait", "ok", `Checking in with the home app… last update ${h.ago}`);
    setConn("ok", "ok", "ok", `Connected · updated ${h.ago}`);
  }
  async function awayPoll() {
    if (!awState) setConn("wait", "idle", "idle", "Establishing connection to home app…");
    try {
      const j = await rcall("GET", "state", null, S.awayPin);
      awState = j.state; awNow = j.now; renderAway(); renderConn();
    } catch (e) {
      setConn("bad", "idle", "idle", e.message === "offline" ? "Not connected · this phone has no internet." : "Not connected · " + remoteMsg(e));
      if (awState) { $("awBar").dataset.state = "stale"; $("awState").textContent = "No connection"; $("awLevel").textContent = "can't reach your site"; }
      if (e.message === "WRONG_PIN") { S.awayPin = null; saveS(); closeAway(); openPin("away"); $("awsMsg").textContent = "The PIN was changed. Enter the new one."; return; }
      $("awFresh").textContent = remoteMsg(e); $("awPill").className = "pill bad"; $("awPillText").textContent = "No connection";
    }
  }
  async function awaySend(action, value, note) {
    try {
      await rcall("POST", "cmd", { action, value }, S.awayPin);
      awPending = { action, value, at: Date.now() };
      $("awMsg").textContent = note || "Sent. Your home device picks it up within about a minute.";
    } catch (e) { $("awMsg").textContent = remoteMsg(e); }
  }
  function renderAway() {
    const st = awState;
    if (!st) { $("awState").textContent = "Home device hasn't reported yet"; return; }
    const age = Math.max(0, (awNow || Date.now()) - (st.serverAt || st.at));
    const mins = Math.round(age / 60000);
    const hl = awHealth();
    const stale = hl.home === "bad";
    $("awPill").className = "pill" + (stale ? " bad" : hl.home === "wait" || hl.heater !== "ok" ? " warn" : "");
    $("awPillText").textContent = stale ? "Home offline" : hl.heater === "bad" ? "Heater not connected" : hl.home === "wait" || hl.heater === "wait" ? "Checking…" : "Connected";
    const secs = Math.round(age / 1000);
    $("awFresh").textContent = `Updated ${secs < 10 ? "just now" : secs < 90 ? secs + " s ago" : mins + " min ago"}${st.name ? " · " + st.name : ""}${st.schedNext ? " · ⏱ " + st.schedNext : ""}`;

    // Status bar (same look as at home)
    const max = st.max || 10, on = st.power === "running" || st.power === "starting";
    let state = { running: "on", starting: "on", cooling: "cool", fan: "cool", error: "bad" }[st.power] || "off";
    let label = { off: "Off", starting: "Igniting", running: "Heating", cooling: "Cooling down", fan: "Fan only", error: "Fault " + fcode(st.fault) }[st.power] || "Unknown";
    if (stale) { state = "stale"; label = `Last known: ${label}`; }
    else if (!st.connected) { state = "warn"; label = "Heater not connected"; }
    if (st.clean) {
      const left = Math.max(0, st.clean.endAt - st.at - age);
      state = "clean"; label = `Clean shutdown · ${Math.max(1, Math.ceil(left / 60000))} min`;
    }
    $("awBar").dataset.state = state; $("awState").textContent = label;
    $("awLevel").innerHTML = stale ? `as of ${hl.ago}` : !st.connected ? "No live data" : st.power === "fan" ? (st.level != null ? `Fan <b>${st.level}</b><small> / ${max}</small>` : "Fan · no fuel") : st.power === "error" ? "Needs attention" : on && st.level != null ? `Level <b>${st.level}</b><small> / ${max}</small>` : on && st.setpoint != null ? `Heater set <b>${st.setpoint}°</b>` : st.mode === "manual" ? `Runs level ${st.manualLevel || "—"}` : `Runs level ${st.hold}–${st.top}`;
    const segs = $("awSegs"); if (segs.children.length !== max) segs.innerHTML = "<i></i>".repeat(max);
    const segL = !stale && st.connected && (on || st.power === "fan") && st.level != null ? st.level : null;
    [...segs.children].forEach((el, i) => el.classList.toggle("on", segL != null && i < segL));
    const room = st.roomC != null ? ` · room ${show(st.roomC)}°` : "";
    $("awSetting").textContent = st.power === "fan" ? `Fan only · no fuel used${room}` : st.mode === "manual" ? `Manual · level ${(on && st.level != null ? st.level : st.manualLevel) || "—"}${room}` : `${st.tuneName} · ${show(st.targetC)}°${room}`;
    const gal = (st.leftL / GAL).toFixed(1), lvl = on && st.level != null ? st.level : st.mode === "manual" ? st.manualLevel || 5 : st.top;
    const rate = 0.16 + (0.62 - 0.16) * (Math.max(1, Math.min(max, lvl)) - 1) / (max - 1);
    $("awFuel").textContent = `${gal} gal · ≈ ${Math.round(st.leftL / rate)} h at level ${lvl}`;

    // Controls
    if (awTarget == null) $("awTarget").textContent = show(st.targetC) + "°";
    $("awRoom").textContent = st.roomC != null ? `Room ${show(st.roomC)}° (${st.roomSrc})` : "Room —";
    $("awOut").textContent = st.outC != null ? `Outside ${show(st.outC)}°` + (st.outCity ? ` · ${st.outCity}` : "") : "";
    const esc = (x) => String(x).replace(/[<&"]/g, (m) => ({ "<": "&lt;", "&": "&amp;", '"': "&quot;" }[m]));
    $("awPresets").innerHTML = st.tunes.map((t) => `<button class="preset${t.id === st.tuneId && st.mode !== "manual" ? " on" : ""}" data-tune="${t.id}"><b>${show(t.targetC ?? st.targetC)}°</b><span>${esc(t.name)}</span></button>`).join("");
    // Thermostat / Power level view
    const view = awView || st.mode;
    document.querySelectorAll("#away [data-awmode]").forEach((b) => b.classList.toggle("on", b.dataset.awmode === view));
    $("awThermo").hidden = view !== "thermo"; $("awManual").hidden = view !== "manual";
    const lvlNow = awLvl ?? (st.mode === "manual" ? (on && st.level != null ? st.level : st.manualLevel) : on ? st.level : null) ?? 1;
    $("awLvl").textContent = lvlNow; $("awMax").textContent = max;
    const bars = $("awBars");
    if (bars.children.length !== max) bars.innerHTML = Array.from({ length: max }, (_, i) => `<button class="bar" data-l="${i + 1}" style="height:${30 + (70 * (i + 1)) / max}%" aria-label="Level ${i + 1}"></button>`).join("");
    [...bars.children].forEach((b, i) => b.classList.toggle("on", i < lvlNow));

    // Power: start, or shut down (clean or right away)
    const fault = st.power === "error";
    const live = st.connected && !stale && !fault;
    const btn = $("awPower");
    btn.hidden = on || !!st.clean || (fault && st.noRetry);
    btn.disabled = !(st.connected && !stale);
    if (Date.now() - awArmed > 4000) btn.textContent = fault ? "Try again" : "Start heating";
    $("awReset").hidden = !fault || !st.connected || stale;
    if (st.plug && st.plug.on === false && !on && Date.now() - awArmed > 4000) { btn.textContent = "Power plug is off · turn it on below"; btn.disabled = true; }
    $("awFault").hidden = !fault;
    if (fault) { $("awFaultTitle").textContent = st.faultTitle || "Fault"; $("awFaultText").textContent = st.faultInfo || st.faultText || ""; steps($("awFaultSteps"), st.faultSteps); }
    $("awPlug").hidden = !st.plug;
    if (st.plug) {
      $("awPlugState").textContent = st.plug.busy || (st.plug.on == null ? "—" : st.plug.on ? "On" : "Off");
      $("awPlugState").classList.toggle("on", st.plug.on === true);
      $("awPlugOn").hidden = st.plug.on === true; $("awPlugOff").hidden = st.plug.on === false; $("awPlugCycle").hidden = st.plug.on === false;
    }
    const fanOn = st.power === "fan";
    $("awFan").hidden = false;
    $("awFan").disabled = !(st.connected && !stale);
    $("awFan").textContent = fanOn ? "Stop fan" : fault ? "Clear fault and run fan only" : on ? "Stop heat, fan only" : "Fan only (no heat)";
    $("awFan").classList.toggle("on", fanOn);
    renderFanBars("awFanBox", fanOn ? (awFanLvl ?? st.level) : null, fanOn && st.connected && !stale);
    $("awOff").hidden = !(on || st.clean);
    $("awClean").hidden = !!st.clean; $("awClean").disabled = !live;
    $("awOffNow").disabled = !live;
    $("awOffNow").textContent = st.clean ? "Skip clean burn · off now" : "Off now";
    // Clear the "sent" note once the home device has caught up.
    if (awPending && (st.serverAt || 0) > awPending.at) {
      const done = (awPending.action === "start" && on) || (awPending.action === "stop" && (st.clean || st.power === "cooling" || st.power === "off")) ||
        (awPending.action === "tune" && st.tuneId === awPending.value) || (awPending.action === "target" && Math.abs(st.targetC - awPending.value) < 0.3) ||
        (awPending.action === "stopnow" && (st.power === "cooling" || st.power === "off")) ||
        (awPending.action === "fan" && st.power === "fan") ||
        (awPending.action === "fanlevel" && st.power === "fan" && st.level === awPending.value) ||
        ((awPending.action === "retry" || awPending.action === "reset") && st.power !== "error") ||
        (awPending.action === "mode" && st.mode === awPending.value) ||
        (awPending.action === "level" && st.mode === "manual" && (on ? st.level === awPending.value : st.manualLevel === awPending.value));
      if (done) { $("awMsg").textContent = "Done ✓ The heater has it."; awPending = null; awView = null; awLvl = null; awFanLvl = null; if (!awTargetTimer) awTarget = null; }
    }
  }
  // One tap starts. An Undo button shows for 15 s in case it was a mis-tap.
  let awUndoTimer = null;
  $("awPower").onclick = async () => {
    if (!awState) return;
    $("awPower").disabled = true; $("awPower").textContent = "Sending…";
    if (awState.power === "error") await awaySend("retry", null, "Sent. It clears the fault and tries again (after any cool-down).");
    else await awaySend("start", null, "Sent. The heater should start within about a minute.");
    $("awUndo").hidden = false;
    clearTimeout(awUndoTimer); awUndoTimer = setTimeout(() => ($("awUndo").hidden = true), 15000);
    setTimeout(renderAway, 1500);
  };
  $("awUndo").onclick = () => {
    clearTimeout(awUndoTimer); $("awUndo").hidden = true;
    awaySend("stopnow", null, "Undone. The heater turns off (or stays off).");
  };
  $("awBurn").onclick = (e) => {
    const b = e.target.closest("[data-min]"); if (!b) return;
    const m = +b.dataset.min;
    awaySend("stop", m, `Sent. ${m} min burn-off at full power, then it turns off.`);
  };
  let awFanLvl = null;
  $("awFanBoxBars").addEventListener("click", (e) => {
    const b = e.target.closest(".bar"); if (!b || !awState) return;
    awFanLvl = +b.dataset.l; renderAway();
    awaySend("fanlevel", awFanLvl, `Sent: fan speed ${awFanLvl}.`);
  });
  $("awPlugOn").onclick = () => awaySend("plugon", null, "Sent. The plug turns on and the heater powers up.");
  $("awPlugOff").onclick = () => { if (confirm("Cut the heater's power? It turns the heater off first and waits for the cool-down.")) awaySend("plugoff", null, "Sent. Power is cut once the heater has cooled down."); };
  $("awPlugCycle").onclick = () => { if (confirm("Power-cycle the heater? Safe off, 30 seconds, then on.")) awaySend("plugcycle", null, "Sent. Safe off, 30 seconds, then power back on."); };
  $("awReset").onclick = () => awaySend("reset", null, "Sent. It clears the fault and stays off.");
  $("awFan").onclick = () => {
    if (!awState) return;
    if (awState.power === "fan") awaySend("stopnow", null, "Sent. The fan turns off.");
    else if (awState.power === "running" || awState.power === "starting") { if (confirm("Stop heating and run the fan only? The heater cools down first.")) awaySend("fan", null, "Sent. It cools down, then runs the fan only."); }
    else awaySend("fan", null, awState.power === "error" ? "Sent. It clears the fault, then runs the fan only." : "Sent. The fan should start within about a minute (no heat, no fuel).");
  };
  $("awOffNow").onclick = () => {
    if (!confirm("Turn the heater off now, without the clean burn?")) return;
    awaySend("stopnow", null, "Sent. The heater turns off and cools down.");
  };
  // Thermostat / Power level from away
  document.querySelectorAll("#away [data-awmode]").forEach((b) => (b.onclick = () => {
    if (!awState || awState.mode === b.dataset.awmode && !awView) return renderAway();
    awView = b.dataset.awmode; awLvl = null; renderAway();
    awaySend("mode", awView, awView === "manual" ? "Sent: power level mode." : "Sent: thermostat mode.");
  }));
  $("awBars").addEventListener("click", (e) => {
    const b = e.target.closest(".bar"); if (!b || !awState) return;
    awView = "manual"; awLvl = +b.dataset.l; renderAway();
    awaySend("level", awLvl, `Sent: level ${awLvl}.`);
  });
  const bumpAway = (d) => {
    if (!awState) return;
    const cur = awTarget ?? show(awState.targetC);
    const [lo, hi] = range();
    awTarget = Math.max(lo, Math.min(hi, cur + d));
    $("awTarget").textContent = awTarget + "°";
    clearTimeout(awTargetTimer);
    const want = awTarget; // capture now, so a status update can't change what gets sent
    awTargetTimer = setTimeout(() => { awTargetTimer = null; awaySend("target", Math.round(fromShow(want) * 10) / 10, `Sent: heat to ${want}°.`); }, 1500);
  };
  $("awMinus").onclick = () => bumpAway(-1);
  $("awPlus").onclick = () => bumpAway(1);
  $("awPresets").addEventListener("click", (e) => {
    const b = e.target.closest(".preset"); if (!b || !awState) return;
    const t = awState.tunes.find((x) => x.id === b.dataset.tune);
    clearTimeout(awTargetTimer);
    if (t && t.targetC != null) { awTarget = show(t.targetC); $("awTarget").textContent = awTarget + "°"; } // so −/+ starts from the new preset
    awaySend("tune", b.dataset.tune, `Sent: ${t ? t.name : "preset"}.`);
    document.querySelectorAll("#awPresets .preset").forEach((x) => x.classList.toggle("on", x === b));
  });
  renderGateway();

  // While any sheet is open, keep the page behind it still (smooth scrolling on iPhone).
  // Tall screens (Settings, Manual tune, …) open as normal pages that scroll with the
  // page itself: no scroll-inside-a-popup, which gets stuck on iPad and iPhone.
  // Small pop-ups and the shutdown countdown stay as overlays with the page locked behind.
  let pageScroll = 0;
  const syncModal = () => {
    const root = document.documentElement, all = [...document.querySelectorAll(".overlay")].filter((o) => !o.hidden);
    const page = all.some((o) => o.classList.contains("as-page"));
    if (page && !root.classList.contains("sheet-page")) { pageScroll = window.scrollY; root.classList.add("sheet-page"); window.scrollTo(0, 0); }
    else if (!page && root.classList.contains("sheet-page")) { root.classList.remove("sheet-page"); const y = pageScroll; requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y))); }
    root.classList.toggle("modal-open", all.some((o) => !o.classList.contains("as-page")));
  };
  new MutationObserver(syncModal).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
  $("logBox").addEventListener("toggle", () => { if ($("logBox").open) { $("log").textContent = logLines.slice(-80).join("\n"); $("log").scrollTop = $("log").scrollHeight; } });
  // Appearance: Auto (follow the phone), Light or Dark.
  function applyTheme() {
    const t = S.theme === "light" || S.theme === "dark" ? S.theme : "auto";
    if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    document.querySelectorAll("#themePick button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
    const light = t === "light" || (t === "auto" && matchMedia("(prefers-color-scheme: light)").matches);
    document.querySelector('meta[name="theme-color"]').setAttribute("content", light ? "#f5f2ed" : "#0b0b0d");
  }
  /* ---------------- Outside temperature ----------------
   * Automatic: finds where this device is (location if allowed, otherwise a
   * rough internet-based guess), then shows the local outside temperature and
   * town. Free Open-Meteo weather + BigDataCloud place names, no keys.
   * Location is rounded to about 1 km. Weather every 15 min, location every 6 h. */
  function renderOutside() {
    const el = $("dOut"); if (!el) return;
    const city = S.outside && S.outside.city ? " · " + S.outside.city.slice(0, 18) : "";
    el.textContent = outFresh() ? "Outside " + show(out.c) + "°" + city : "";
  }
  async function outsideFetch() {
    if (!S.outside) return;
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${S.outside.lat}&longitude=${S.outside.lon}&current=temperature_2m`;
      const j = await (await fetch(u, { cache: "no-store" })).json();
      const c = j && j.current && j.current.temperature_2m;
      if (typeof c === "number") { out.c = c; out.at = Date.now(); store.set("outside", out); renderOutside(); }
    } catch (e) { log("✗ outside temp: " + e.message); }
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  const gps = () => new Promise((ok) => {
    if (!navigator.geolocation) return ok(null);
    navigator.geolocation.getCurrentPosition((p) => ok({ lat: p.coords.latitude, lon: p.coords.longitude }), () => ok(null), { timeout: 15000, maximumAge: 3600e3 });
  });
  // Town for a location; with no location, BigDataCloud guesses from the internet connection.
  async function place(loc) {
    try {
      const q = loc ? `latitude=${loc.lat}&longitude=${loc.lon}&` : "";
      const j = await (await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?${q}localityLanguage=en`)).json();
      const lat = loc ? loc.lat : j.latitude, lon = loc ? loc.lon : j.longitude;
      if (typeof lat !== "number" || typeof lon !== "number") return null;
      return { lat: r2(lat), lon: r2(lon), city: j.city || j.locality || "" };
    } catch { return null; }
  }
  async function locate() {
    const p = await place(await gps());
    if (p) { S.outside = Object.assign(p, { at: Date.now() }); saveS(); outsideFetch(); }
  }
  let outTimer = null;
  function outsideStart() {
    clearInterval(outTimer); renderOutside();
    if (!S.outside || !S.outside.at || Date.now() - S.outside.at > 6 * 3600e3) locate(); else outsideFetch();
    outTimer = setInterval(() => (Date.now() - ((S.outside && S.outside.at) || 0) > 6 * 3600e3 ? locate() : outsideFetch()), 15 * 60000);
  }

  $("themePick").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.theme = b.dataset.t; saveS(); applyTheme(); });
  matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", applyTheme);
  applyTheme();
  document.querySelectorAll("[data-version]").forEach((el) => (el.textContent = "v" + VERSION));
  document.title = "Ember Heater v" + VERSION;
  log("· Ember v" + VERSION);
  renderPresets();
  render();
  plugRefresh();
  outsideStart();
  if (params.has("demo")) connect(true);
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
