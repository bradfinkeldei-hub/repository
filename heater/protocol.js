/*
 * Ember – Hcalory heater Bluetooth protocol.
 *
 * Hcalory heaters expose BLE service 0xFFF0: commands are written to 0xFFF2,
 * status frames arrive as notifications on 0xFFF1. Two frame formats are in
 * the wild (community reverse-engineering, not official documentation):
 *
 *   "A" – AirHeater / BA AB frames  (github.com/mSoftMS/AirHeater-BLE)
 *   "B" – Hcalory app 20-byte header (github.com/evanfoster/hcalory-control)
 *
 * The app tries both and locks onto whichever one the heater answers.
 * Works in the browser (window.EmberProtocol) and in Node for tests.
 */
(function (root) {
  "use strict";

  // Full 128-bit IDs: some browsers (e.g. Bluefy on iPhone) reject the short form.
  const SERVICE = "0000fff0-0000-1000-8000-00805f9b34fb";
  const NOTIFY = "0000fff1-0000-1000-8000-00805f9b34fb";
  const WRITE = "0000fff2-0000-1000-8000-00805f9b34fb";
  // Newer Hcalory controllers (TB2S, HBU1S…) advertise service BD39.
  const BD39 = "0000bd39-0000-1000-8000-00805f9b34fb";
  const BD39_WRITE = "0000bdf7-0000-1000-8000-00805f9b34fb";
  const BD39_NOTIFY = "0000bdf8-0000-1000-8000-00805f9b34fb";

  const sum8 = (bytes) => bytes.reduce((a, b) => (a + b) & 0xff, 0);
  const withSum = (bytes) => Uint8Array.from([...bytes, sum8(bytes)]);
  const hex = (bytes) =>
    Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ").toUpperCase();

  // Plain-English faults, shared by both formats.
  const FAULTS = {
    1: ["General fault", "Turn the heater off, wait a minute and start it again."],
    2: ["Voltage problem", "Battery is too low or too high. Charge it or check the wiring."],
    3: ["Glow plug fault", "The igniter isn't working. Check its plug or replace it."],
    4: ["Fuel pump fault", "Check the pump wiring and that the fuel line isn't kinked."],
    5: ["Overheating", "Something is blocking airflow. Clear the inlet and outlet."],
    6: ["Fan fault", "The fan is stuck or unplugged. Check for debris."],
    7: ["Lost connection", "The control board isn't talking to the heater. Check the cable."],
    8: ["Flame went out", "Usually low fuel or air in the line. Top up and prime the pump."],
    9: ["Sensor fault", "A temperature sensor isn't reading. Check its plug."],
    10: ["Didn't ignite", "Often low fuel, air in the line or carbon. Prime and retry."],
  };

  /* ---------------- Format A: BA AB ---------------- */
  const A = {
    id: "A",
    maxLevel: 6,
    minLevel: 1,
    hasThermostat: false,
    unit: "C",
    poll: () => Uint8Array.from([0xba, 0xab, 0x04, 0xcc, 0x00, 0x00, 0x00, 0x35]),
    bb: (mode) => withSum([0xba, 0xab, 0x04, 0xbb, mode, 0x00, 0x00]),
    start() { return [A.bb(0xa1)]; },
    fan() { return [A.bb(0xa4)]; }, // ventilation
    // Same sequence as the official app: ventilate, heat, ventilate (≈500 ms apart).
    stop() { return [A.bb(0xa4), A.bb(0xa1), A.bb(0xa4)]; },
    up() { return [A.bb(0xa2)]; },
    down() { return [A.bb(0xa3)]; },
    looksLike: (x) => x.length >= 14 && x.length < 32,
    parse(x) {
      if (x.length < 14) return null;
      const status = x[4];
      const mode = x[5];
      const gear = x[6];
      let volts = x[9];
      if (volts > 40) volts = volts / 10;
      const offset = x[10] === 0 ? 30 : 22;
      const s = {
        proto: "A",
        raw: hex(x),
        level: null,
        mode: "gear",
        setpoint: null,
        volts,
        ambient: x[11] - offset,
        body: (x[12] << 8) | x[13],
        fault: null,
        power: "off",
      };
      if (mode === 0xff) {
        s.power = "error";
        s.fault = gear;
        return s;
      }
      s.level = gear;
      s.power = { 0: "off", 1: "running", 2: "cooling", 4: "fan" }[status] || "running";
      return s;
    },
  };

  /* ---------------- Format B: Hcalory 20-byte header ---------------- */
  const B_HEAD = [0x00, 0x02, 0x00, 0x01, 0x00, 0x01, 0x00, 0x0e, 0x04, 0x00,
    0x00, 0x09, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
  const bcmd = (a, b) => Uint8Array.from([...B_HEAD, a, b]);
  const B_STATE = {
    0: "off", 65: "cooling", 67: "cooling", 69: "cooling",
    128: "starting", 129: "starting", 131: "starting", 135: "starting",
    133: "running", 255: "error",
  };
  const B = {
    id: "B",
    maxLevel: 6,
    minLevel: 1,
    hasThermostat: true,
    unit: "F",
    poll: () => bcmd(0x00, 0x0d),
    start() { return [bcmd(0x02, 0x0f)]; },
    stop() { return [bcmd(0x01, 0x0e)]; },
    up() { return [bcmd(0x03, 0x10)]; },
    down() { return [bcmd(0x04, 0x11)]; },
    gearMode() { return [bcmd(0x07, 0x14)]; },
    fan() { return [bcmd(0x08, 0x15)]; }, // ventilation (same power family as H; unconfirmed)
    thermoMode() { return [bcmd(0x06, 0x13)]; },
    looksLike: (x) => x.length >= 32,
    parse(x) {
      if (x.length < 32) return null;
      const state = x[20];
      const modeByte = x[21];
      const setting = x[22];
      const u16 = (i) => ((x[i] << 8) | x[i + 1]) / 10;
      const s = {
        proto: "B",
        raw: hex(x),
        power: B_STATE[state] || (state & 0x80 ? "running" : "off"),
        mode: modeByte === 1 ? "thermostat" : "gear",
        level: modeByte === 1 ? null : setting,
        setpoint: modeByte === 1 ? setting : null,
        volts: Math.round(x[25]) / 10,
        body: Math.round(u16(27)),
        ambient: Math.round(u16(30)),
        fault: null,
      };
      if (modeByte === 8) { s.power = "error"; s.fault = 10; }
      else if (state === 255) { s.fault = 1; }
      return s;
    },
  };

  /* ---------------- Format H: Hcalory MVP2 (BD39 service) ----------------
   * Source: Spettacolo83/homeassistant-diesel-heater (diesel-heater-ble),
   * reverse-engineered from the Hcalory Android app.
   * Frame: 00 02 00 01 00 01 00 CMD_HI | CMD_LO 00 00 LEN PAYLOAD | SUM
   * (SUM = sum of everything after CMD_HI, mod 256)
   */
  const hcmd = (cmd, payload) => {
    const body = [cmd & 0xff, 0, 0, payload.length, ...payload];
    return Uint8Array.from([0x00, 0x02, 0x00, 0x01, 0x00, 0x01, 0x00, (cmd >> 8) & 0xff, ...body, sum8(body)]);
  };
  const power = (v) => [hcmd(0x0e04, [0, 0, 0, 0, 0, 0, 0, 0, v])];
  const H_FAULTS = {
    1: ["Didn't ignite", "Often low fuel, air in the line or carbon. Prime and retry."],
    2: ["Flame went out", "Usually low fuel or air in the line. Top up and prime the pump."],
    3: ["Overheating", "Something is blocking airflow. Clear the inlet and outlet."],
    4: ["Fan fault", "The fan is stuck or unplugged. Check for debris."],
    5: ["Fuel pump fault", "Check the pump wiring and that the fuel line isn't kinked."],
    6: ["Sensor fault", "A temperature sensor isn't reading. Check its plug."],
    7: ["Battery too low", "Charge the battery or check the wiring."],
    8: ["Voltage too high", "Check your charger or alternator output."],
    9: ["Lost connection", "The control board isn't talking to the heater. Check the cable."],
    10: ["Carbon monoxide high", "Ventilate now and check the exhaust for leaks."],
    11: ["Carbon monoxide critical", "Get fresh air immediately. Check the exhaust before using again."],
  };
  const H = {
    id: "H",
    maxLevel: 10,
    minLevel: 1,
    hasThermostat: true,
    direct: true, // sets level/temperature directly, no up/down stepping
    unit: "C",
    faults: H_FAULTS,
    // Status request carries the phone's clock (raw hour, minute, second, ISO weekday).
    poll(now = new Date()) {
      return hcmd(0x0a0a, [now.getHours(), now.getMinutes(), now.getSeconds(), now.getDay() || 7, 0]);
    },
    auth(pin = "0000") { return hcmd(0x0a0c, [1, ...String(pin).padStart(4, "0").slice(-4).split("").map(Number)]); },
    authResult(x) {
      if (x.length < 18 || x[0] !== 0 || x[1] !== 3 || x[7] !== 0x0b || x[8] !== 0x0c) return null;
      return x[17] === 1;
    },
    start() { return power(2); },
    stop() { return power(1); },
    thermoMode() { return power(6); },
    fan() { return power(8); }, // fan only / ventilation (decoded, not yet confirmed on a TB2S)
    gearMode() { return power(7); },
    setLevel(l) { return [hcmd(0x0607, [Math.max(1, Math.min(10, l))])]; },
    setTemp(t, fahrenheit) { return [hcmd(0x0706, [Math.round(t), fahrenheit ? 1 : 0])]; },
    looksLike: (x) => x.length >= 38 && x[8] === 0x03,
    parse(x) {
      if (x.length < 38 || x[8] !== 0x03) return null;
      if (sum8(Array.from(x.slice(8, -1))) !== x[x.length - 1]) return null;
      const state = x[20] >> 4, step = x[20] & 0x0f, mode = x[21], value = x[22];
      const signed = (i) => (x[i] === 1 ? -1 : 1) * ((x[i + 1] << 8) | x[i + 2]) / 10;
      const s = {
        proto: "H",
        raw: hex(x),
        power: "off",
        mode: mode === 1 ? "thermostat" : mode === 3 ? "fan" : "gear",
        level: null,
        setpoint: null,
        volts: ((x[24] << 8) | x[25]) / 10,
        body: Math.round(signed(26)),
        ambient: Math.round(signed(29) * 10) / 10,
        unit: x.length > 38 && x[37] === 1 ? "F" : "C",
        fault: null,
        auto: x[23] === 1,
      };
      if (state === 0xf) { s.power = "error"; s.fault = value; return s; }
      s.power = state === 0x4 ? "cooling" : state === 0xc ? "fan" : state === 0x8 ? (step === 3 ? "starting" : "running") : "off";
      if (s.power !== "off" && s.power !== "cooling") {
        if (mode === 1) s.setpoint = value; else if (mode === 2) s.level = value;
      }
      return s;
    },
  };

  /* ---------------- Simulated heater (demo + tests) ---------------- */
  // Speaks format A over a fake transport so the real parser is exercised.
  class SimHeater {
    constructor(speed = 1) {
      this.speed = speed;
      this.status = 0; this.gear = 2; this.fault = 0;
      this.room = 9; this.body = 12; this.volts = 12.9;
      this.coolLeft = 0; this.ignite = 0;
      this.listener = null; this.connected = false;
      this.offSeq = [];
      this._t = null;
    }
    async connect() {
      this.connected = true;
      this._t = setInterval(() => this.tick(1), 1000);
    }
    disconnect() { this.connected = false; clearInterval(this._t); }
    onNotify(fn) { this.listener = fn; }
    tick(sec) {
      const dt = sec * this.speed;
      const heating = this.status === 1 && this.ignite <= 0;
      if (this.status === 1 && this.ignite > 0) this.ignite -= dt;
      const target = heating ? 10 + this.gear * 3.2 : 8;
      this.room += (target - this.room) * Math.min(1, 0.004 * dt);
      const bodyTarget = heating ? 60 + this.gear * 22 : this.room;
      this.body += (bodyTarget - this.body) * Math.min(1, 0.05 * dt);
      this.volts = heating ? 12.7 - this.gear * 0.05 : 12.9;
      if (this.status === 2) {
        this.coolLeft -= dt;
        if (this.coolLeft <= 0) this.status = 0;
      }
    }
    async write(bytes) {
      if (!this.connected) throw new Error("not connected");
      const x = Array.from(bytes);
      if (x[0] !== 0xba || x[1] !== 0xab) return; // ignores format B
      if (x[3] === 0xcc) return this.reply();
      if (x[3] !== 0xbb) return;
      const m = x[4];
      if (m === 0xa1) {
        this.offSeq.push(m);
        if (this.status === 0) { this.status = 1; this.ignite = 30; }
      } else if (m === 0xa4) {
        this.offSeq.push(m);
        const seq = this.offSeq.slice(-3).join(",");
        if (seq === "164,161,164" || this.status === 0) {
          if (this.status !== 0) { this.status = 2; this.coolLeft = 120; }
          this.offSeq = [];
        }
      } else if (m === 0xa2 && this.status === 1) this.gear = Math.min(6, this.gear + 1);
      else if (m === 0xa3 && this.status === 1) this.gear = Math.max(1, this.gear - 1);
    }
    reply() {
      const f = new Array(18).fill(0);
      f[0] = 0xab; f[1] = 0xba; f[2] = 0x11;
      f[4] = this.status;
      f[5] = this.fault ? 0xff : 0x01;
      f[6] = this.fault || this.gear;
      f[9] = Math.round(this.volts * 10);
      f[10] = 0;
      f[11] = Math.round(this.room) + 30;
      const b = Math.round(this.body);
      f[12] = (b >> 8) & 0xff; f[13] = b & 0xff;
      f[17] = sum8(f.slice(0, 17));
      const frame = Uint8Array.from(f);
      setTimeout(() => this.listener && this.listener(frame), 60);
    }
  }

  // Demo heater that speaks format H, like a real TB2S.
  class SimHeaterH {
    constructor(speed = 1) {
      this.speed = speed; this.transport = "bd39";
      this.state = 0; this.step = 0; this.mode = 2; this.level = 4; this.temp = 21;
      this.room = 9; this.body = 12; this.volts = 12.9; this.timer = 0; this.authed = false; this.fault = 0;
      this.listener = null; this.connected = false; this._t = null;
    }
    async connect() { this.connected = true; this._t = setInterval(() => this.tick(1), 1000); }
    disconnect() { this.connected = false; clearInterval(this._t); }
    onNotify(fn) { this.listener = fn; }
    get output() {
      if (this.state !== 8 || this.step !== 5) return 0;
      if (this.mode === 2) return this.level;
      return Math.max(1, Math.min(10, Math.round((this.temp - this.room) * 2 + 1)));
    }
    tick(sec) {
      const dt = sec * this.speed;
      if (this.state === 8 && this.step === 3 && (this.timer -= dt) <= 0) this.step = 5;
      if (this.state === 4 && (this.timer -= dt) <= 0) { this.state = 0; this.step = 0; }
      const out = this.output;
      this.room += ((out ? 10 + out * 2 : 8) - this.room) * Math.min(1, 0.004 * dt);
      this.body += ((out ? 60 + out * 13 : this.room) - this.body) * Math.min(1, 0.05 * dt);
      this.volts = out ? 12.7 - out * 0.03 : 12.9;
    }
    send(frame) { setTimeout(() => this.listener && this.listener(frame), 60); }
    async write(bytes) {
      if (!this.connected) throw new Error("not connected");
      const x = Array.from(bytes);
      if (x[0] !== 0 || x[1] !== 2) return;
      const cmd = (x[7] << 8) | x[8], p = x.slice(12, -1);
      if (cmd === 0x0a0c) {
        this.authed = p.slice(1).join("") === "0000";
        const r = [0, 3, 0, 1, 0, 1, 0, 0x0b, 0x0c, 0, 0, 6, 1, ...p.slice(1), this.authed ? 1 : 0];
        return this.send(Uint8Array.from([...r, sum8(r.slice(8))]));
      }
      if (!this.authed) return;
      if (cmd === 0x0a0a) return this.reply();
      if (cmd === 0x0e04) {
        const v = p[8];
        if (this.fault) { if (v === 1) { this.fault = 0; this.state = 0; this.step = 0; } return; } // off clears a fault
        if (v === 2 && (this.state === 0 || this.state === 4)) { this.state = 8; this.step = 3; this.timer = 30; }
        else if (v === 1 && this.state === 8) { this.state = 4; this.step = 0; this.timer = 120; }
        else if (v === 1 && this.state === 0xc) { this.state = 0; this.step = 0; }
        else if (v === 8 && this.state === 0) { this.state = 0xc; this.step = 1; }
        else if (v === 6) this.mode = 1;
        else if (v === 7) this.mode = 2;
      } else if (cmd === 0x0607) this.level = Math.max(1, Math.min(10, p[0]));
      else if (cmd === 0x0706) this.temp = p[0];
    }
    reply() {
      const f = new Array(39).fill(0);
      f[1] = 2; f[3] = 1; f[5] = 1; f[7] = 0x0a; f[8] = 0x03; f[11] = 27;
      f[20] = this.fault ? 0xf0 : (this.state << 4) | this.step; f[21] = this.state === 0xc ? 3 : this.state ? this.mode : 0;
      f[22] = this.fault || (this.mode === 1 ? this.temp : this.level); f[23] = 2;
      const v = Math.round(this.volts * 10); f[24] = v >> 8; f[25] = v & 0xff;
      const b = Math.round(this.body * 10); f[27] = (b >> 8) & 0xff; f[28] = b & 0xff;
      const r = Math.round(Math.abs(this.room) * 10); f[29] = this.room < 0 ? 1 : 0; f[30] = r >> 8; f[31] = r & 0xff;
      f[37] = 0;
      f[38] = sum8(f.slice(8, 38));
      this.send(Uint8Array.from(f));
    }
  }

  const api = { SERVICE, NOTIFY, WRITE, BD39, BD39_WRITE, BD39_NOTIFY, A, B, H, FAULTS, H_FAULTS, SimHeater, SimHeaterH, hex, sum8 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.EmberProtocol = api;
})(typeof window !== "undefined" ? window : globalThis);
