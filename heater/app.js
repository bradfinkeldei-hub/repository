/* Ember – app logic. Plain JS, no build step. */
(() => {
  "use strict";
  const VERSION = "1.28"; // bump with every release (also sw.js CACHE)
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
  if (S.cleanMins === 15) S.cleanMins = 10; // v1.23: burn-off choices are 1, 5 or 10 min
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
    if (!e) return "no details";
    if (typeof e === "string") return e;
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
      if (showAll) this.device = await navigator.bluetooth.requestDevice(all);
      else {
        try { this.device = await navigator.bluetooth.requestDevice(filtered); }
        catch (e) {
          if (cancelled(e)) throw e;
          log("✗ filtered picker: " + errText(e) + " → showing all devices");
          this.device = await navigator.bluetooth.requestDevice(all);
        }
      }
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
      this.status = s;
      this.waiters.splice(0).forEach((w) => w(s));
      this.onStatus(s);
    }
    send(bytes) {
      // One command at a time, at least 550 ms apart. Heaters ignore floods.
      this.chain = this.chain.then(async () => {
        const wait = this.lastSend + 550 - Date.now();
        if (wait > 0) await sleep(wait);
        this.log("▶ " + P.hex(bytes));
        try { await this.link.write(bytes); } catch (e) { this.log("✗ " + errText(e)); }
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
    async startVerified() {
      this.busy++;
      try {
        for (let attempt = 1; attempt <= 2; attempt++) {
          await this.sendAll(this.proto.start());
          await sleep(1800);
          const s = await this.poll();
          this.log(`· start attempt ${attempt}: ${s ? s.power + (s.fault ? " (fault " + s.fault + ")" : "") : "no reply"}`);
          if (s && (s.power === "starting" || s.power === "running")) return s;
          if (attempt === 1) {
            if (this.proto === P.H && !this.unlocked) { this.log("· re-sending PIN"); this.unlocked = await this.unlock(); }
            await this.sendAll(this.proto.stop()); await sleep(1500); await this.poll();
          }
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
  let lastAcct = 0, lowVSince = null, lastThermo = 0, wakeLock = null, maxRunSec = 0;
  let reconnecting = false;

  const logLines = [];
  function log(line) {
    const t = new Date().toLocaleTimeString([], { hour12: false });
    logLines.push(t + "  " + line);
    if (logLines.length > 300) logLines.shift();
    const el = $("log");
    if (el && !$("settings").hidden) { el.textContent = logLines.slice(-80).join("\n"); el.scrollTop = el.scrollHeight; }
  }

  function toast(msg, ms = 3200) {
    const t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
  }

  /* ---------------- Govee room gauge ---------------- */
  // Two ways in: Wi-Fi (Govee cloud API, works on iPhone) or Bluetooth (Android Chrome).
  let govee = null;
  const onGovee = (r) => { govee = r; render(); };
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
  async function connect(useDemo) {
    $("connectMsg").textContent = "";
    demo = useDemo;
    try {
      if (useDemo) {
        link = new SimLink(FAST);
        await link.connect();
      } else {
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
      $("connectMsg").textContent = cancelled(e) ? "" : "Couldn't connect: " + why;
      $("btnCopyLog2").hidden = cancelled(e);
    }
  }

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
  function onStatus(s) {
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
  async function thermostat() {
    const s = heater && heater.status;
    if (!s || s.power !== "running" || S.mode !== "thermo" || clean || heater.busy) return;
    if (S.native && heater.proto.hasThermostat && S.room !== "govee") {
      await heater.ensureMode("thermostat");
      const want = Math.round(heaterUnit() === "F" ? cToF(S.targetC) : S.targetC);
      if (heater.status.setpoint !== want) heater.stepTo(want, "setpoint");
      return;
    }
    // Smooth heat: ease power down as the room approaches the target.
    if (Date.now() - lastThermo < 45000 / FAST) return;
    const room = ambientC();
    if (room == null) return;
    const T = tune();
    const hi = Math.min(heater.proto.maxLevel, T.max);
    const lo = Math.min(hi, Math.max(heater.proto.minLevel, T.hold));
    const band = T.bandC, gap = S.targetC - room;
    const want = gap >= band ? hi : gap <= 0 ? lo : Math.max(lo, Math.min(hi, lo + Math.round((hi - lo) * gap / band)));
    if (s.mode !== "gear") await heater.ensureMode("gear");
    if (heater.status.level !== want) { lastThermo = Date.now(); heater.stepTo(want); }
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
    $("schedNext").textContent = schedNext() || "Off";
  }
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
    thermostat();
    if (restartWhenOff && heater.status && heater.status.power === "off" && !recovering) {
      restartWhenOff = false; lastThermo = 0; heater.start(); toast("Cool-down done. Trying again…");
    }
    if (heater.status && heater.status.power === "running" && faultTries) faultTries = 0; // it worked
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
    $("dial").setAttribute("aria-valuenow", v);
    const room = ambientC();
    if (room == null) { $("dRoom").textContent = "Room —"; $("roomDot").style.display = "none"; }
    else {
      $("dRoom").textContent = "Room " + show(room) + "°" +
        (useGovee() ? (govee.hum != null ? " · " + Math.round(govee.hum) + "%" : "") + " · Govee" : S.room === "govee" ? " · heater" : "");
      const [rx, ry] = pt(A0 + SWEEP * frac(show(room)));
      $("roomDot").style.display = ""; $("roomDot").setAttribute("cx", rx); $("roomDot").setAttribute("cy", ry);
    }
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
    if (room == null) return "Waiting for a room temperature reading…";
    const r = show(room);
    if (r >= t) return `At ${t}${u}: holding at level ${lo}. It stays on (it won't shut off by itself) and steps back up if the room cools.`;
    if (r <= near) return `Heating up at level ${Math.min(maxLevel(), T.max)}. It starts easing down at ${near}${u}.`;
    return `Getting close (${t - r}${u} to go): easing the power down to save fuel and avoid overshooting.`;
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
      label = { off: "Off", starting: "Igniting", running: "Heating", cooling: "Cooling down", fan: "Fan only", error: "Fault" + (s.fault ? " E-" + String(s.fault).padStart(2, "0") : "") }[s.power] || "On";
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
      ? `Manual · level ${S.level || (lvl ?? "—")}${roomTxt}`
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
    const f = s && s.power === "error" ? faults[s.fault] || ["Heater fault", "Check the heater's display for details."] : null;
    $("fault").hidden = !f;
    if (f) { $("faultCode").textContent = "E-" + String(s.fault || 0).padStart(2, "0"); $("faultTitle").textContent = f[0]; $("faultText").textContent = f[1]; }

    // Power button
    const btn = $("btnPower");
    btn.disabled = !s || recovering; // starting again during cool-down is fine (the remote does it too)
    if (isOn(s)) { btn.textContent = tune().clean ? "Turn off" : "Turn off now"; btn.classList.add("off"); }
    else { btn.textContent = recovering ? "Recovering…" : s && s.power === "error" ? "Try again" : restartWhenOff && s && s.power === "cooling" ? "Restarts after cool-down…" : "Start heating"; btn.classList.remove("off"); }
    $("btnRetry").disabled = $("btnReset").disabled = recovering;
    const co = coFault(s);
    $("btnRetry").hidden = co;
    if (co) { btn.textContent = "Reset (no restart: CO fault)"; }
    // Fan only: offered when the heater is off; becomes "Stop fan" while the fan runs.
    const fanOn = s && s.power === "fan";
    $("btnFan").hidden = !s || !(s.power === "off" || fanOn) || !heater.proto.fan;
    $("btnFan").textContent = fanOn ? "Stop fan" : "Fan only (no heat)";
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
    const nBars = Math.max(1, Math.round(S.tankGal)), per = S.tankGal / nBars, leftGal = left / GAL;
    const gb = $("galBars");
    if (gb.children.length !== nBars) gb.innerHTML = Array.from({ length: nBars }, (_, i) => `<button class="gal" data-n="${i + 1}" aria-label="${+((i + 1) * per).toFixed(1)} gallons"><i></i><span>${+((i + 1) * per).toFixed(1)}</span></button>`).join("");
    gb.classList.toggle("low", leftGal <= per);
    [...gb.children].forEach((el, i) => { el.querySelector("i").style.setProperty("--h", Math.max(0, Math.min(1, (leftGal - i * per) / per)) * 100 + "%"); });
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
    $("btnKeep").hidden = burn;
  }

  /* ---------------- Input ---------------- */
  function setTarget(displayValue) {
    const [lo, hi] = range();
    const v = Math.max(lo, Math.min(hi, Math.round(displayValue)));
    S.targetC = fromShow(v); saveS(); lastThermo = 0; renderDial();
  }

  const dial = $("dial");
  let dragging = false;
  const fromPointer = (e) => {
    const r = dial.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 300 - CX;
    const y = ((e.clientY - r.top) / r.height) * 300 - CY;
    let deg = (Math.atan2(y, x) * 180) / Math.PI;
    let rel = (deg - A0 + 720) % 360;
    if (rel > SWEEP) rel = rel - SWEEP < (360 - SWEEP) / 2 ? SWEEP : 0;
    const [lo, hi] = range();
    setTarget(lo + (hi - lo) * (rel / SWEEP));
  };
  dial.addEventListener("pointerdown", (e) => { dragging = true; dial.setPointerCapture(e.pointerId); fromPointer(e); });
  dial.addEventListener("pointermove", (e) => dragging && fromPointer(e));
  dial.addEventListener("pointerup", () => (dragging = false));
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
  $("btnFan").onclick = async () => {
    const s = heater && heater.status; if (!s) return;
    $("btnFan").disabled = true;
    try {
      if (s.power === "fan") { await heater.stopVerified(); toast("Fan off"); }
      else {
        const r = await heater.fan();
        toast(r && r.power === "fan" ? "Fan only: blowing air, no fuel used" : "The heater didn't confirm fan-only yet. If nothing happens, Settings → Copy log and send it over.", 6000);
      }
    } finally { $("btnFan").disabled = false; }
  };
  /* ---------------- Fault recovery ----------------
   * Reset = send Off until the fault clears (Hcalory clears faults on Off).
   * Try again = reset, wait for any cool-down, then start. After 3 failed
   * tries in 30 min it asks first (home) or only resets (away), because
   * repeated failed ignitions can flood the burner with fuel. */
  let recovering = false, restartWhenOff = false, faultTries = 0, faultTriesAt = 0;
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
  // Fuel: one bar per gallon. Tap a bar to set the tank to that many gallons
  // (tap the last one after filling up; tap the first one again to set it empty).
  $("galBars").addEventListener("click", (e) => {
    const b = e.target.closest(".gal"); if (!b) return;
    const per = S.tankGal / Math.max(1, Math.round(S.tankGal));
    let gal = +b.dataset.n * per;
    const now = Math.max(0, S.tankGal - stats.sinceFillL / GAL);
    if (+b.dataset.n === 1 && Math.abs(now - gal) < 0.05) gal = 0;
    stats.sinceFillL = Math.max(0, (S.tankGal - gal) * GAL); saveStats(); render();
    toast(gal >= S.tankGal - 0.01 ? "Tank set to full" : gal === 0 ? "Tank set to empty" : `Tank set to ${+gal.toFixed(1)} gal`);
  });

  // Settings
  const bind = (id, key, num) => {
    const el = $(id);
    if (el.type === "checkbox") el.checked = !!S[key]; else el.value = String(S[key]);
    el.onchange = () => { S[key] = el.type === "checkbox" ? el.checked : num ? +el.value : el.value; saveS(); renderPresets(); render(); };
  };
  bind("setUnit", "unit"); bind("setClean", "cleanMins", 1); bind("setCoach", "coachHours", 1);
  bind("setTank", "tankGal", 1); bind("setMin", "minLevel", 1); bind("setBatt", "batt");
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
  $("btnSettings").onclick = () => { $("settings").hidden = false; log("· settings opened"); };
  $("btnClose").onclick = () => ($("settings").hidden = true);
  $("settings").addEventListener("click", (e) => { if (e.target.id === "settings") $("settings").hidden = true; });
  $("btnCopyLog2").onclick = () => $("btnCopyLog").onclick();
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
      v: 1, at: Date.now(), connected: !!(heater && heater.proto && !reconnecting), name: link ? link.name : null,
      power: s ? s.power : null, level: s ? s.level : null, setpoint: s ? s.setpoint : null, max: maxLevel(),
      fault: s ? s.fault : null, volts: s ? s.volts : null,
      noRetry: coFault(s),
      faultText: s && s.power === "error" ? ((heater.proto.faults || P.FAULTS)[s.fault] || ["Heater fault", "Check the heater's display."]).join(": ") : null,
      mode: S.mode, targetC: S.targetC, roomC: ambientC(), roomSrc: useGovee() ? "Govee" : "heater",
      tuneId: tune().id, tuneName: tune().name, hold: tune().hold, top: Math.min(maxLevel(), tune().max),
      tunes: S.tunes.map((t) => ({ id: t.id, name: t.name, targetC: t.targetC })),
      manualLevel: S.level || null, leftL: left, schedNext: schedNext(), clean: clean ? { kind: clean.kind, endAt: clean.endAt } : null,
    };
  }
  let gwKey = "", gwMinor = "", gwPushAt = 0, gwBusy = false, gwInfo = "";
  async function runRemote(c) {
    log(`· remote: ${c.action}${c.value != null ? " " + c.value : ""}`);
    if (!heater || !heater.proto) return;
    const s = heater.status;
    if (c.action === "start" && s && (s.power === "off" || s.power === "cooling")) { lastThermo = 0; await heater.startVerified(); toast("Started from away"); }
    else if (c.action === "stop" && s && isOn(s) && !clean) { await beginClean("shutdown", [1, 5, 10].includes(c.value) ? c.value : undefined); }
    else if (c.action === "stopnow" && s && (isOn(s) || clean || s.power === "fan")) { await turnOff(); }
    else if (c.action === "fan" && s && s.power === "off") { await heater.fan(); }
    else if (c.action === "fanlevel" && s && s.power === "fan") { await heater.stepTo(Math.max(1, Math.min(maxLevel(), +c.value))); }
    else if (c.action === "retry") { await recover(true, true); }
    else if (c.action === "reset") { await recover(false, true); }
    else if (c.action === "tune") {
      const t = S.tunes.find((x) => x.id === c.value);
      if (t) { S.tuneId = t.id; if (t.targetC != null) S.targetC = t.targetC; S.mode = "thermo"; }
    } else if (c.action === "target" && +c.value >= 4 && +c.value <= 32) { S.targetC = +c.value; S.mode = "thermo"; }
    else if (c.action === "mode" && (c.value === "thermo" || c.value === "manual")) S.mode = c.value;
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
      const key = JSON.stringify([st.connected, st.power, st.fault, !!st.clean, st.mode, st.tuneId, Math.round(st.targetC * 2), st.tunes.map((t) => t.id + t.name + t.targetC).join()]);
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

  async function awayPoll() {
    try {
      const j = await rcall("GET", "state", null, S.awayPin);
      awState = j.state; awNow = j.now; renderAway();
    } catch (e) {
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
    const stale = age > 15 * 60000;
    $("awPill").className = "pill" + (stale || !st.connected ? " warn" : "");
    $("awPillText").textContent = stale ? "Home offline?" : st.connected ? "Home online" : "Heater not connected";
    const secs = Math.round(age / 1000);
    $("awFresh").textContent = `Updated ${secs < 10 ? "just now" : secs < 90 ? secs + " s ago" : mins + " min ago"}${st.name ? " · " + st.name : ""}${st.schedNext ? " · ⏱ " + st.schedNext : ""}`;

    // Status bar (same look as at home)
    const max = st.max || 10, on = st.power === "running" || st.power === "starting";
    let state = { running: "on", starting: "on", cooling: "cool", fan: "cool", error: "bad" }[st.power] || "off";
    let label = { off: "Off", starting: "Igniting", running: "Heating", cooling: "Cooling down", fan: "Fan only", error: "Fault" + (st.fault ? " E-" + String(st.fault).padStart(2, "0") : "") }[st.power] || "Unknown";
    if (!st.connected) { state = "warn"; label = "Heater not connected at home"; }
    if (st.clean) {
      const left = Math.max(0, st.clean.endAt - st.at - age);
      state = "clean"; label = `Clean shutdown · ${Math.max(1, Math.ceil(left / 60000))} min`;
    }
    $("awBar").dataset.state = state; $("awState").textContent = label;
    $("awLevel").innerHTML = st.power === "fan" ? (st.level != null ? `Fan <b>${st.level}</b><small> / ${max}</small>` : "Fan · no fuel") : st.power === "error" ? "Needs attention" : on && st.level != null ? `Level <b>${st.level}</b><small> / ${max}</small>` : on && st.setpoint != null ? `Heater set <b>${st.setpoint}°</b>` : st.mode === "manual" ? `Runs level ${st.manualLevel || "—"}` : `Runs level ${st.hold}–${st.top}`;
    const segs = $("awSegs"); if (segs.children.length !== max) segs.innerHTML = "<i></i>".repeat(max);
    const segL = (on || st.power === "fan") && st.level != null ? st.level : null;
    [...segs.children].forEach((el, i) => el.classList.toggle("on", segL != null && i < segL));
    const room = st.roomC != null ? ` · room ${show(st.roomC)}°` : "";
    $("awSetting").textContent = st.power === "fan" ? `Fan only · no fuel used${room}` : st.mode === "manual" ? `Manual · level ${st.manualLevel || "—"}${room}` : `${st.tuneName} · ${show(st.targetC)}°${room}`;
    const gal = (st.leftL / GAL).toFixed(1), lvl = on && st.level != null ? st.level : st.mode === "manual" ? st.manualLevel || 5 : st.top;
    const rate = 0.16 + (0.62 - 0.16) * (Math.max(1, Math.min(max, lvl)) - 1) / (max - 1);
    $("awFuel").textContent = `${gal} gal · ≈ ${Math.round(st.leftL / rate)} h at level ${lvl}`;

    // Controls
    if (awTarget == null) $("awTarget").textContent = show(st.targetC) + "°";
    $("awRoom").textContent = st.roomC != null ? `Room ${show(st.roomC)}° (${st.roomSrc})` : "Room —";
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
    $("awFault").hidden = !fault; $("awFault").textContent = st.faultText || "";
    const fanOn = st.power === "fan";
    $("awFan").hidden = !(st.power === "off" || fanOn) || !live;
    $("awFan").textContent = fanOn ? "Stop fan" : "Fan only (no heat)";
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
  $("awPower").onclick = () => {
    if (!awState) return;
    if (Date.now() - awArmed > 4000) {
      awArmed = Date.now();
      $("awPower").textContent = awState.power === "error" ? "Tap again to try again" : "Tap again to start heating";
      return setTimeout(renderAway, 4100);
    }
    awArmed = 0;
    if (awState.power === "error") awaySend("retry", null, "Sent. It clears the fault and tries again (after any cool-down).");
    else awaySend("start", null, "Sent. The heater should start within about a minute.");
    renderAway();
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
  $("awReset").onclick = () => awaySend("reset", null, "Sent. It clears the fault and stays off.");
  $("awFan").onclick = () => {
    if (!awState) return;
    if (awState.power === "fan") awaySend("stopnow", null, "Sent. The fan turns off.");
    else awaySend("fan", null, "Sent. The fan should start within about a minute (no heat, no fuel).");
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

  document.querySelectorAll("[data-version]").forEach((el) => (el.textContent = "v" + VERSION));
  document.title = "Ember Heater v" + VERSION;
  log("· Ember v" + VERSION);
  renderPresets();
  render();
  if (params.has("demo")) connect(true);
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
