# Ember – Hcalory heater app

A web app that controls Hcalory diesel heaters (built for the TB2S) over Bluetooth.
It has no app store listing and needs no developer account. Open the link in Chrome on Android.

**Features:** clean shutdown (10 min at full power, then off), one-dial thermostat with presets,
smooth heat, carbon health with a 15-min clean burn, fuel tracker, warm-by start,
battery guard, plain-English faults and a demo heater.

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

## Notes
- Keep the screen open during a clean shutdown or warm-by start. The app keeps the screen awake.
- iPhone/iPad: Safari has no Bluetooth for web pages. Use the free **Bluefy** browser.
- Testing: add `?demo` to the URL to start the demo heater, or `?demo&fast` to run time 30× faster.
- Protocol tests: `node --test protocol.test.mjs`
- Protocol credits: mSoftMS/AirHeater-BLE and evanfoster/hcalory-control. Unofficial. Not affiliated with Hcalory.
