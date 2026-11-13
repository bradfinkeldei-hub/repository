/*
 * Ember – Govee thermometer as the room gauge.
 *
 * Govee Bluetooth thermometers broadcast temperature, humidity and battery
 * every few seconds in their advertisement. We just listen; no pairing, and it
 * doesn't interfere with the heater connection. Formats follow the open-source
 * govee-ble parser (Home Assistant).
 */
(function (root) {
  "use strict";

  const COMPANY_IDS = [0xec88, 0x0001, 0x8801];

  // 3 bytes: temperature and humidity packed into one number (H5075, H5101…).
  function packed(b, i) {
    const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
    const v = n & 0x7fffff;
    let t = Math.trunc(v / 1000) / 10;
    if (n & 0x800000) t = -t;
    return { tempC: t, hum: (v % 1000) / 10, batt: b[i + 3] & 0x7f, err: !!(b[i + 3] & 0x80) };
  }
  // Little-endian int16 temp/100, uint16 humidity/100, battery byte (H5074, H5179…).
  function le(b, i) {
    let t = b[i] | (b[i + 1] << 8);
    if (t & 0x8000) t -= 0x10000;
    return { tempC: t / 100, hum: (b[i + 2] | (b[i + 3] << 8)) / 100, batt: b[i + 4], err: false };
  }

  /** Decode one manufacturer-data payload (company ID already removed). */
  function decode(mgr, bytes, name = "") {
    let b = Array.from(bytes);
    const has = (...m) => m.some((x) => name.includes(x));
    if (b.length > 25) {
      const tag = String.fromCharCode(...b.slice(-25));
      if (tag.includes("INTELLI_ROCKS")) b = b.slice(0, -25);
    }
    const n = b.length;
    let r = null, model = null;
    if (n === 6 && (has("H5072", "H5075", "H5129") || mgr === 0xec88)) {
      r = packed(b, 1); model = (name.match(/H51?\d{3}/) || ["H5075"])[0];
    } else if ((n === 6 || n === 8) && (has("H5100", "H5101", "H5102", "H5103", "H5104", "H5105", "H5108", "H5110", "H5174", "H5177", "GV5179") || (mgr === 0x0001 && n === 8))) {
      r = packed(b, 2); model = (name.match(/(GV|H)5\d{3}/) || ["H5101"])[0];
    } else if (n === 7 && (has("H5074") || mgr === 0xec88)) {
      r = le(b, 1); model = "H5074";
    } else if (n === 9 && (mgr === 0xec88 || has("H5051", "H5052", "H5071"))) {
      r = le(b, 1); model = (name.match(/H50\d{2}/) || ["H5051"])[0];
    } else if (n === 9 && (has("H5178", "B5178") || mgr === 0x0001)) {
      if (b[2] !== 0) return null; // outdoor probe; we want the main unit
      r = packed(b, 3); model = "H5178";
    } else if (n === 9 && (has("H5179") || mgr === 0x8801)) {
      r = le(b, 4); model = "H5179";
    }
    if (!r || r.err || r.tempC < -40 || r.tempC > 70) return null;
    return { ...r, model };
  }

  /* ---------------- Browser listener ---------------- */
  class GoveeSensor {
    constructor(onReading, log) {
      this.onReading = onReading; this.log = log || (() => {});
      this.device = null; this.seen = false; this.sim = null;
    }
    get supported() {
      return !!(root.navigator && navigator.bluetooth && root.BluetoothDevice && "watchAdvertisements" in BluetoothDevice.prototype);
    }
    async pick() {
      if (!this.supported) throw new Error("NO_WATCH");
      this.device = await navigator.bluetooth.requestDevice({
        filters: [
          ...["GV", "Govee", "H5", "B5", "ihoment"].map((n) => ({ namePrefix: n })),
          ...COMPANY_IDS.map((id) => ({ manufacturerData: [{ companyIdentifier: id }] })),
        ],
        optionalManufacturerData: COMPANY_IDS,
      });
      await this.watch();
      return this.device.id;
    }
    // Re-attach to the thermometer chosen last time, without the picker.
    async restore(id) {
      if (!this.supported || !navigator.bluetooth.getDevices) return false;
      const list = await navigator.bluetooth.getDevices();
      this.device = list.find((d) => d.id === id) || null;
      if (!this.device) return false;
      await this.watch();
      return true;
    }
    async watch() {
      const d = this.device;
      if (!d._emberHooked) {
        d.addEventListener("advertisementreceived", (e) => this.handle(e));
        d._emberHooked = true;
      }
      await d.watchAdvertisements();
      this.log("· listening to " + (d.name || "thermometer"));
    }
    handle(e) {
      const name = e.name || this.device.name || "";
      e.manufacturerData.forEach((dv, id) => {
        const r = decode(id, new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength), name);
        if (!r) return;
        if (!this.seen) { this.log(`· ${r.model}: ${r.tempC}°C ${r.hum}% batt ${r.batt}%`); this.seen = true; }
        this.onReading({ ...r, name, at: Date.now() });
      });
    }
    // Demo: fake readings that follow the demo room.
    startSim(getRoomC) {
      this.stop();
      const emit = () => {
        const c = getRoomC();
        if (c != null) this.onReading({ tempC: Math.round((c - 1.2) * 10) / 10, hum: 41, batt: 88, model: "H5075", name: "GVH5075_DEMO", at: Date.now() });
      };
      emit(); this.sim = setInterval(emit, 2000);
    }
    stop() {
      clearInterval(this.sim); this.sim = null;
      try { this.device && this.device.unwatchAdvertisements && this.device.unwatchAdvertisements(); } catch {}
    }
  }

  /* ---------------- Wi-Fi (Govee cloud API) ---------------- */
  // Works on any phone, including iPhone. Calls go through the site's own
  // _worker.js relay (browsers can't call Govee directly).
  const API = "https://openapi.api.govee.com/router/api/v1/";
  class GoveeCloud {
    constructor(onReading, log) { this.onReading = onReading; this.log = log || (() => {}); this.timer = null; }
    async call(path, key, body) {
      const opts = { method: body ? "POST" : "GET", headers: { "Govee-API-Key": key, "Content-Type": "application/json" } };
      if (body) opts.body = JSON.stringify(body);
      let r = null;
      try {
        r = await fetch("govee/" + path, opts);
        if (!(r.headers.get("content-type") || "").includes("json")) r = null; // relay not installed
      } catch { r = null; }
      if (!r) {
        try { r = await fetch(API + path, opts); }
        catch { throw new Error("NO_RELAY"); }
      }
      let j = {};
      try { j = await r.json(); } catch {}
      if (r.status === 401 || r.status === 403 || j.code === 401) throw new Error("BAD_KEY");
      if (!r.ok || (j.code && j.code !== 200)) throw new Error(j.message || j.msg || "Govee error " + r.status);
      return j;
    }
    async list(key) {
      const j = await this.call("user/devices", key);
      return (j.data || []).filter((d) =>
        /thermometer|sensor/i.test(d.type || "") ||
        (d.capabilities || []).some((c) => /sensorTemperature/i.test(c.instance || "")));
    }
    async read(key, dev, unit = "F") {
      const j = await this.call("device/state", key, { requestId: String(Date.now()), payload: { sku: dev.sku, device: dev.device } });
      const caps = (j.payload && j.payload.capabilities) || [];
      const val = (name) => { const c = caps.find((x) => (x.instance || "").toLowerCase() === name.toLowerCase()); return c && c.state ? c.state.value : null; };
      let t = val("sensorTemperature");
      if (t && typeof t === "object") t = t.currentTemperature ?? t.value;
      let h = val("sensorHumidity");
      if (h && typeof h === "object") h = h.currentHumidity ?? h.value;
      if (t == null || isNaN(+t)) throw new Error("No temperature from Govee yet");
      const tempC = unit === "C" ? +t : (+t - 32) * 5 / 9;
      return { tempC: Math.round(tempC * 10) / 10, hum: h == null ? null : +h, batt: null, raw: +t };
    }
    start(key, dev, unit) {
      this.stop();
      const tick = async () => {
        try {
          const r = await this.read(key, dev, unit);
          this.onReading({ ...r, model: dev.sku, name: dev.deviceName || dev.sku, via: "wifi", at: Date.now() });
        } catch (e) { this.log("✗ govee wifi: " + e.message); }
      };
      tick();
      this.timer = setInterval(tick, 60000); // Govee allows 10,000 calls a day; this uses 1,440
    }
    stop() { clearInterval(this.timer); this.timer = null; }
  }

  const api = { decode, GoveeSensor, GoveeCloud, COMPANY_IDS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.EmberGovee = api;
})(typeof window !== "undefined" ? window : globalThis);
