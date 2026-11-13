# Reddit post

Ready to paste into Reddit. Use **Markdown mode** in the post editor.
Good subreddits: r/dieselheaters, r/vandwellers, r/overlanding, r/GoRVing, r/camping, r/Hcalory (if it exists).

---

## Title

**I built a free app for Hcalory diesel heaters: clean-burn shutdown, a real thermostat, schedules, fuel gauge and control from anywhere (no app store needed)**

---

## Post

I have a Hcalory TB2S and kept wishing the app did a few things better, so I built my own. It's free and works on Android and iPhone/iPad. Sharing it in case it helps someone else.

**What it does that the stock app doesn't**

- **Clean-burn shutdown.** When you turn it off, pick a **1, 5 or 10 minute** burn at full power to burn off carbon, then it shuts down by itself. Diesel heaters coke up when they run low for hours, and this is the easy fix.
- **A thermostat that doesn't cycle.** Full power while it's cold, eases down as it gets close, then holds at a low level (you pick, I use 2) instead of turning on and off all night.
- **Sleep / Comfort / Boost + one Custom button.** Tap to use, tap again to change the temperature, levels and burn-off for that button.
- **Schedule.** Morning, Midday and Evening windows with start and stop times.
- **Fuel gauge.** One bar per gallon (tap to set after a fill-up), plus **hours left at each power level**.
- **Control from anywhere.** Leave an old phone or iPad by the heater as a "home gateway", then start, stop, change temp, power level or fan from your phone. Protected by a PIN with lockout.
- **Govee thermometer as the room sensor** (optional), so it heats to the temp where you actually sit.
- **Fan only** (no heat), **fault codes in plain English** with Try again / Reset, **battery guard**, and a **status bar** that shows on/off, level and fuel at a glance.

**How it works**

It's a web app that talks to the heater over Bluetooth, the same way the official app does. There's no app store and no developer account. You host it free on Cloudflare (a 2-minute drag-and-drop), then open it in **Chrome on Android** or the free **Bluefy** browser on iPhone/iPad.

**Setup (about 5 minutes)**

1. Download the zip from GitHub.
2. Cloudflare → Workers & Pages → Create → Pages → **Upload assets** → drop the zip in.
3. Open your link in Chrome (Android) or Bluefy (iPhone), close the Hcalory app, and tap **Connect heater**.
4. Optional: Govee thermometer and away control. The guide walks through both.

Tap **Try the demo** first if you want to see it without a heater.

**Links**

- **Setup guide with screenshots:** https://github.com/bradfinkeldei-hub/repository/blob/claude/funny-hypatia-5cjonk/heater/HOWTO.md
- **Download (always the latest):** https://github.com/bradfinkeldei-hub/repository/raw/claude/funny-hypatia-5cjonk/heater/ember-heater-latest.zip

**Honest notes**

- Unofficial and not affiliated with Hcalory.
- Tested on my **TB2S**. It includes the protocols for older Hcalory and AirHeater-type controllers, but I haven't been able to test those. If you try it on another model, I'd love to hear how it goes.
- The app has to stay open on the phone or tablet connected to the heater for schedules, clean shutdowns and away control. An old phone plugged in next to the heater works great.
- Fan-only and fan speed use the decoded commands but aren't confirmed on every model yet. If something doesn't work, Settings → **Copy log** and post it here.
- Diesel heaters burn fuel indoors-adjacent. **Keep a CO alarm nearby** and follow your heater's manual. It will never auto-restart after a carbon monoxide fault.

Huge thanks to the folks who reverse-engineered these heaters' Bluetooth protocols (credits in the guide). Happy to answer questions or take feature requests!
