# Ember – Hcalory heater app

A web app that controls Hcalory diesel heaters (built for the TB2S) over Bluetooth.
It has no app store listing and needs no developer account. Open the link in Chrome on Android.

**Features:** clean shutdown (10 min at full power, then off), one-dial thermostat with presets,
smooth heat, carbon health with a 15-min clean burn, fuel tracker, warm-by start,
battery guard, plain-English faults, a Govee thermometer as the room gauge and a demo heater.

## Put it online (free, about 2 minutes)
Web Bluetooth only works over https, so the folder has to be hosted:
1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Upload assets**.
2. Name it `ember`, drag in this `heater` folder (or `ember-heater.zip`), then **Deploy**.
3. Open `https://ember-xxxx.pages.dev` in **Chrome on Android**. Tap ⋮ → **Add to Home screen**.

## First connect
- Turn the heater's power on. **Close the Hcalory app.** A heater takes one phone at a time.
- Tap **Connect heater** and pick the device (usually `HCALORY…` or `TY…`).
- If it isn't listed: Settings → **Show all Bluetooth devices**.
- If it connects but shows "No reply": Settings → **Copy log** and send it over.

## Govee thermometer as the room gauge
Settings → **Room gauge → Govee thermometer** opens the picker. Choose your `GVH5…` / `Govee_H5…` device.
The app only listens to the thermometer's broadcasts, so the heater stays connected.
The dial then shows the Govee temperature and humidity, and the thermostat aims for that reading.
If the readings stop for 3 minutes, the app falls back to the heater's own sensor.
- Supported: H5072, H5074, H5075, H5100–H5110, H5174, H5177, H5179, H5051/52/71, H5178.
- If Chrome says it needs a setting: open `chrome://flags`, turn on **Experimental Web Platform features** and restart Chrome.

## Notes
- Keep the screen open during a clean shutdown or warm-by start. The app keeps the screen awake.
- iPhone/iPad: Safari has no Bluetooth for web pages. Use the free **Bluefy** browser.
- Testing: add `?demo` to the URL to start the demo heater, or `?demo&fast` to run time 30× faster.
- Protocol tests: `node --test protocol.test.mjs`
- Protocol credits: mSoftMS/AirHeater-BLE, evanfoster/hcalory-control and govee-ble. Unofficial. Not affiliated with Hcalory.
