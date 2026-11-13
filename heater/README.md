# Ember – Hcalory heater app

> **New here? Start with the [step-by-step setup guide](HOWTO.md).**

A web app that controls Hcalory diesel heaters (built for the TB2S) over Bluetooth.
It has no app store listing and needs no developer account. Open the link in Chrome on Android.

**Features:** clean shutdown (10 min at full power, then off), one-dial thermostat with presets,
smooth heat, carbon health with a 15-min clean burn, fuel tracker, warm-by start,
battery guard, plain-English faults, a Govee thermometer as the room gauge and a demo heater.

## Put it online (free, about 2 minutes)
Web Bluetooth only works over https, so the folder has to be hosted:
1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Upload assets**.
2. Name it `ember`, drag in this `heater` folder (or `ember-heater-vX.Y.zip`), then **Deploy**.
3. Open `https://ember-xxxx.pages.dev` in **Chrome on Android**. Tap ⋮ → **Add to Home screen**.

## First connect
- Turn the heater's power on. **Close the Hcalory app.** A heater takes one phone at a time.
- Tap **Connect heater** and pick the device (usually `HCALORY…` or `TY…`).
- If it isn't listed: Settings → **Show all Bluetooth devices**.
- If it connects but shows "No reply": Settings → **Copy log** and send it over.

## Govee thermometer as the room gauge
**On iPhone use Wi-Fi:** in the Govee Home app go to Profile → Settings → Apply for API Key. Then in Ember open Settings → Govee thermometer → Set up,
paste the key and tap Find. This needs `_worker.js` from the zip on your Cloudflare site. It relays two Govee calls and stores nothing.

Settings → **Room gauge → Govee thermometer** opens the picker. Choose your `GVH5…` / `Govee_H5…` device.
The app only listens to the thermometer's broadcasts, so the heater stays connected.
The dial then shows the Govee temperature and humidity, and the thermostat aims for that reading.
If the readings stop for 3 minutes, the app falls back to the heater's own sensor.
- Supported: H5072, H5074, H5075, H5100–H5110, H5174, H5177, H5179, H5051/52/71, H5178.
- If Chrome says it needs a setting: open `chrome://flags`, turn on **Experimental Web Platform features** and restart Chrome.

## Versions
The version shows next to the name in the app (and in the browser tab). To release: bump `VERSION` in `app.js`
and `CACHE` in `sw.js`, then run `./release.sh` to build `ember-heater-vX.Y.zip`.

| Version | Changes |
| --- | --- |
| v1.20 | Control from away: an old phone or iPad at home acts as the gateway; your phone sends start/stop, presets and temperature through your Cloudflare site. |
| v1.19 | Fuel is five tappable bars, one per gallon: tap a bar to set the tank (last bar = full). |
| v1.18 | Set the fuel in the tank by hand (slider, ¼ ½ ¾ Full). Just three temperature buttons (Sleep, Comfort, Boost) plus one Custom. |
| v1.17 | Status bar at the top (on/off, level, setting, fuel left at that level) that stays visible while scrolling. Fixes sideways overflow on iPhone. |
| v1.16 | Govee setup screen: connect over Wi-Fi with a Govee API key (works on iPhone, via the included _worker.js relay) or Bluetooth (Android Chrome). Fixes the "Re-pair" label. |
| v1.15 | Every preset button (Frost, Sleep, Comfort, Boost and your own) can be edited: temperature, name, levels, clean burn. Reset in Settings. |
| v1.14 | Custom tunes include their own temperature and appear as one-tap buttons next to the presets. |
| v1.13 | Turning off is confirmed and retried (re-sends the PIN if needed); re-unlocks after a Bluetooth reconnect; warns to keep the screen unlocked during clean shutdown. |
| v1.12 | Manual tune: save your own heating styles (heat-up level, ease-down point, hold level, clean-burn length) and switch with one tap. |
| v1.11 | Teaches how it heats: a live explanation under the status, a "How it heats" guide and help text in Settings. |
| v1.10 | Thermostat never goes below level 2 (adjustable in Settings). |
| v1.9 | Fuel card shows hours left at every power level, with the current level highlighted. |
| v1.8 | Fuel shown in gallons; tank size in gallons (default 5 gal). |
| v1.7 | Clean shutdown checks the heater really reaches full power (switches to level mode, confirms, retries, re-sends PIN). Acknowledged Bluetooth writes. |
| v1.6 | Supports the TB2S (newer Hcalory BD39 controllers): PIN unlock, power levels 1–10, direct temperature. Version shown in the app. |
| v1.5 | Finds heaters named "hcalory…" |
| v1.4 | "Show all devices" on the first screen |
| v1.3 | Clear error messages, Bluefy fixes |
| v1.2 | Govee thermometer as the room gauge |
| v1.1 | Clean shutdown, thermostat, carbon health, fuel, warm-by, battery guard |

## Notes
- Keep the screen open during a clean shutdown or warm-by start. The app keeps the screen awake.
- iPhone/iPad: Safari has no Bluetooth for web pages. Use the free **Bluefy** browser.
- Testing: add `?demo` to the URL to start the demo heater, or `?demo&fast` to run time 30× faster.
- Protocol tests: `node --test protocol.test.mjs`
- Heater formats: **H** = newer Hcalory controllers such as the TB2S (service BD39, unlocked with PIN 0000; change it in Settings).
  **B** and **A** = older FFF0 controllers. The app picks the right one automatically.
- Protocol credits: Spettacolo83/homeassistant-diesel-heater (diesel-heater-ble), mSoftMS/AirHeater-BLE, evanfoster/hcalory-control and govee-ble. Unofficial. Not affiliated with Hcalory.
