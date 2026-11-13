/* Ember – app logic. Plain JS, no build step. */
(() => {
  "use strict";
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
    tank: 6, lead: 30, batt: true, battV: 11.5, native: false, proto: "auto", hUnit: "auto",
    showAll: false, pin: "0000", warmOn: false, warmTime: "06:30", room: "heater", goveeId: null,
  }, store.get("settings", {}));
  const stats = Object.assign({ runSec: 0, lowSec: 0, sinceFillL: 0, days: {} }, store.get("stats", {}));
  const saveS = () => store.set("settings", S);
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
      const t = this.tx;
      if (t.properties.writeWithoutResponse && t.writeValueWithoutResponse) return t.writeValueWithoutResponse(bytes);
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
        if (!(await this.unlock())) this.log("· continuing without unlock");
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
    async stop() { await this.sendAll(this.proto.stop()); return this.poll(); }
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
    async toMax() {
      await this.ensureMode("gear");
      await this.stepTo(this.proto.maxLevel);
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
  let govee = null;
  const gsensor = new window.EmberGovee.GoveeSensor((r) => { govee = r; render(); }, log);
  const goveeLive = () => !!govee && Date.now() - govee.at < 180000;
  const useGovee = () => S.room === "govee" && goveeLive();

  async function pairGovee() {
    try {
      if (demo) {
        gsensor.startSim(() => (link && link.room != null ? link.room : null));
        S.goveeId = "demo";
      } else {
        S.goveeId = await gsensor.pick();
        toast("Thermometer paired. Readings appear in a few seconds.");
      }
      S.room = "govee"; $("setRoom").value = "govee"; saveS(); lastThermo = 0; render();
    } catch (e) {
      if (e.message === "NO_WATCH") toast(/iPhone|iPad/.test(navigator.userAgent)
        ? "This browser can't read the thermometer yet. Using the heater's sensor for now."
        : "Chrome needs one setting: open chrome://flags, turn on “Experimental Web Platform features”, restart Chrome.", 9000);
      else if (!cancelled(e)) toast("Couldn't pair: " + errText(e), 6000);
    }
  }

  async function restoreGovee() {
    if (S.room !== "govee" || !S.goveeId || goveeLive()) return;
    if (demo) return gsensor.startSim(() => (link && link.room != null ? link.room : null));
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
        await heater.poll();
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

  const fuelRate = (level) => {
    // TB2S 8 kW: ~0.16 L/h at the lowest level to ~0.62 L/h at the highest.
    const max = (heater && heater.proto && heater.proto.maxLevel) || 6;
    const l = level == null ? 3 : Math.max(1, Math.min(max, level));
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
      heater.stop();
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
    const { minLevel: lo, maxLevel: hi } = heater.proto;
    const gap = S.targetC - room;
    const want = gap >= 3 ? hi : gap <= 0 ? lo : Math.max(lo, Math.min(hi, lo + Math.round((hi - lo) * gap / 3)));
    if (s.mode !== "gear") await heater.ensureMode("gear");
    if (heater.status.level !== want) { lastThermo = Date.now(); heater.stepTo(want); }
  }

  /* ---------------- Clean burn ---------------- */
  async function beginClean(kind) {
    const mins = kind === "burn" ? 15 : S.cleanMins;
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
    await heater.stop();
    toast("Turning off. The fan runs a few minutes to cool down.");
  }

  async function finishClean() {
    const c = clean; clean = null; store.set("clean", null); $("clean").hidden = true;
    stats.lowSec = 0; saveStats();
    if (c.kind === "shutdown") {
      await heater.stop();
      toast("Clean shutdown done. Cooling down now.");
    } else {
      lastThermo = 0;
      toast("Clean burn done. Back to your setting.");
      if (S.mode === "manual") heater.stepTo(S.level || 3);
    }
  }

  /* ---------------- Warm-by schedule ---------------- */
  function schedule() {
    if (!S.warmOn || !heater || !heater.status) return;
    const [h, m] = S.warmTime.split(":").map(Number);
    const now = new Date();
    const start = new Date(now); start.setHours(h, m - S.lead, 0, 0);
    const today = now.toISOString().slice(0, 10);
    const fired = store.get("warmFired", "");
    if (fired !== today && now >= start && now - start < 15 * 60000 && heater.status.power === "off") {
      store.set("warmFired", today);
      heater.start();
      toast("Warming up for " + S.warmTime);
    }
  }

  /* ---------------- Loop ---------------- */
  async function tick() {
    if (!heater || !heater.proto) return;
    if (clean) {
      renderClean();
      if (Date.now() >= clean.endAt) await finishClean();
    }
    schedule();
    thermostat();
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
        (useGovee() ? " · " + Math.round(govee.hum) + "%" : S.room === "govee" ? " · heater" : "");
      const [rx, ry] = pt(A0 + SWEEP * frac(show(room)));
      $("roomDot").style.display = ""; $("roomDot").setAttribute("cx", rx); $("roomDot").setAttribute("cy", ry);
    }
    document.querySelectorAll(".preset").forEach((b) => b.classList.toggle("on", show(+b.dataset.c) === v));
  }

  function renderPresets() {
    $("presets").innerHTML = PRESETS.map(([n, c]) => `<button class="preset" data-c="${c}"><b>${show(c)}°</b><span>${n}</span></button>`).join("");
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

  const POWER_TEXT = { off: "Off", starting: "Igniting", running: "Heating", cooling: "Cooling down", fan: "Fan only", error: "Fault" };

  function render() {
    const s = heater && heater.status;
    $("thermoView").hidden = S.mode !== "thermo";
    $("manualView").hidden = S.mode !== "manual";
    document.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("on", b.dataset.mode === S.mode));
    renderDial(); renderManual();

    // Status line
    let line = s ? POWER_TEXT[s.power] || "On" : "Waiting for heater…";
    if (s && s.power === "running") {
      line += s.level != null ? ` · level ${s.level}` : s.setpoint != null ? ` · heater set ${s.setpoint}°` : "";
      const room = ambientC();
      if (S.mode === "thermo" && room != null) line += show(room) >= show(S.targetC) ? " · at temperature" : "";
    }
    $("statusLine").textContent = line;

    // Fault
    const faults = (heater && heater.proto && heater.proto.faults) || P.FAULTS;
    const f = s && s.power === "error" ? faults[s.fault] || ["Heater fault", "Check the heater's display for details."] : null;
    $("fault").hidden = !f;
    if (f) { $("faultCode").textContent = "E-" + String(s.fault || 0).padStart(2, "0"); $("faultTitle").textContent = f[0]; $("faultText").textContent = f[1]; }

    // Power button
    const btn = $("btnPower");
    btn.disabled = !s || s.power === "cooling" || s.power === "error";
    if (isOn(s)) { btn.textContent = S.cleanMins ? "Turn off" : "Turn off now"; btn.classList.add("off"); }
    else { btn.textContent = s && s.power === "cooling" ? "Cooling down…" : "Start heating"; btn.classList.remove("off"); }

    // Carbon coach
    const pct = Math.min(1, stats.lowSec / (S.coachHours * 3600));
    $("coachBar").style.width = Math.max(3, pct * 100) + "%";
    $("coachBar").style.backgroundPosition = -pct * 200 + "px 0";
    $("coachPct").textContent = pct < 0.5 ? "Good" : pct < 1 ? "Due soon" : "Clean burn due";
    $("coachText").textContent = `${(stats.lowSec / 3600).toFixed(1)} of ${S.coachHours} h on low`;
    $("btnBurn").disabled = !isOn(s) || !!clean;

    // Fuel
    const today = stats.days[new Date().toISOString().slice(0, 10)] || { sec: 0, L: 0 };
    const left = Math.max(0, S.tank - stats.sinceFillL);
    const hrs = left / fuelRate(s && s.level);
    $("fuelBar").style.width = (left / S.tank) * 100 + "%";
    $("fuelLeft").textContent = `≈ ${left.toFixed(1)} L · ${hrs.toFixed(0)} h left`;
    $("fuelText").textContent = `Today ${(today.sec / 3600).toFixed(1)} h · ${today.L.toFixed(2)} L`;

    // Schedule
    $("warmOn").checked = S.warmOn; $("warmTime").value = S.warmTime;
    $("warmText").textContent = S.warmOn ? `Starts ${S.lead} min early. Keep this screen open.` : "Off";

    // Stats
    $("sVolts").textContent = s && s.volts ? s.volts.toFixed(1) + " V" : "—";
    const b = bodyC();
    $("sBody").textContent = b != null && s && s.power !== "off" ? show(b) + "°" : "—";
    $("sHours").textContent = (stats.runSec / 3600).toFixed(1);
    $("protoName").textContent = heater && heater.proto ? ({ H: "Hcalory BD39 (H)", B: "Hcalory (B)", A: "AirHeater (A)" }[heater.proto.id]) : "—";
    $("btnGovee").hidden = !(S.room === "govee" && !goveeLive() && heater);
    $("goveeStatus").textContent = goveeLive()
      ? `${govee.model} · ${show(govee.tempC)}° · ${Math.round(govee.hum)}% · battery ${govee.batt}%`
      : S.goveeId ? "Paired, waiting for reading" : "Not paired";
    $("btnPairGovee").textContent = S.goveeId ? "Re-pair" : "Pair";
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
  $("presets").addEventListener("click", (e) => { const b = e.target.closest(".preset"); if (b) setTarget(show(+b.dataset.c)); });

  document.querySelectorAll(".seg-btn").forEach((b) => (b.onclick = () => { S.mode = b.dataset.mode; saveS(); lastThermo = 0; render(); }));

  $("bars").addEventListener("click", (e) => {
    const b = e.target.closest(".bar"); if (!b || !heater || !heater.proto) return;
    S.level = +b.dataset.l; saveS();
    [...$("bars").children].forEach((x, i) => x.classList.toggle("on", i < S.level));
    $("levelNum").textContent = S.level;
    if (isOn(heater.status)) heater.ensureMode("gear").then(() => heater.stepTo(S.level));
  });

  $("btnPower").onclick = async () => {
    const s = heater && heater.status; if (!s) return;
    if (isOn(s)) return beginClean("shutdown");
    $("btnPower").disabled = true; $("btnPower").textContent = "Starting…";
    lastThermo = 0;
    await heater.start();
    if (S.mode === "manual" && S.level) setTimeout(() => heater.stepTo(S.level), 1500);
  };
  $("btnSkip").onclick = () => (clean && clean.kind === "burn" ? finishClean() : turnOff());
  $("btnKeep").onclick = () => { clean = null; store.set("clean", null); $("clean").hidden = true; lastThermo = 0; toast("Still heating"); };
  $("btnBurn").onclick = () => beginClean("burn");
  $("btnFilled").onclick = () => { stats.sinceFillL = 0; saveStats(); render(); toast("Tank marked full"); };
  $("warmOn").onchange = (e) => { S.warmOn = e.target.checked; saveS(); render(); if (S.warmOn) keepAwake(); };
  $("warmTime").onchange = (e) => { S.warmTime = e.target.value; store.set("warmFired", ""); saveS(); };

  // Settings
  const bind = (id, key, num) => {
    const el = $(id);
    if (el.type === "checkbox") el.checked = !!S[key]; else el.value = String(S[key]);
    el.onchange = () => { S[key] = el.type === "checkbox" ? el.checked : num ? +el.value : el.value; saveS(); renderPresets(); render(); };
  };
  bind("setUnit", "unit"); bind("setClean", "cleanMins", 1); bind("setCoach", "coachHours", 1);
  bind("setTank", "tank", 1); bind("setLead", "lead", 1); bind("setBatt", "batt");
  bind("setBattV", "battV", 1); bind("setNative", "native"); bind("setProto", "proto");
  bind("setHUnit", "hUnit"); bind("setPin", "pin"); bind("setAll", "showAll"); bind("setRoom", "room");
  $("setRoom").addEventListener("change", () => { lastThermo = 0; if (S.room === "govee" && !goveeLive()) (S.goveeId ? restoreGovee() : pairGovee()); });
  $("btnPairGovee").onclick = pairGovee;
  $("btnGovee").onclick = pairGovee; // the picker needs a tap, so this always opens it
  $("btnSettings").onclick = () => { $("settings").hidden = false; log("· settings opened"); };
  $("btnClose").onclick = () => ($("settings").hidden = true);
  $("settings").addEventListener("click", (e) => { if (e.target.id === "settings") $("settings").hidden = true; });
  $("btnCopyLog2").onclick = () => $("btnCopyLog").onclick();
  $("btnCopyLog").onclick = async () => {
    const text = `Ember log · ${navigator.userAgent}\nDevice: ${link ? link.name : "-"} · format ${heater && heater.proto ? heater.proto.id : "?"}\n` + logLines.join("\n");
    try { await navigator.clipboard.writeText(text); toast("Log copied"); } catch { toast("Couldn't copy"); }
  };
  $("btnDisconnect").onclick = () => {
    link && link.disconnect(); link = null; heater = null; gsensor.stop(); govee = null;
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

  renderPresets();
  render();
  if (params.has("demo")) connect(true);
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
