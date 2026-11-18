# Quick Cycle

Interval timer for indoor cycling. It's a static site with no build step, made for a phone on the handlebars.

- Set the warm-up, relaxed and intense durations, the number of rounds and the cool-down. Settings are saved on the device.
- The workout runs in full screen and keeps the screen awake (Screen Wake Lock API).
- The background color shows the phase. Beeps and vibration mark the last 3 seconds and each phase change.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository.
2. Go to **Settings → Pages** and set **Source** to *Deploy from a branch*, then pick `main` and `/ (root)`.
3. Open `https://<user>.github.io/<repo>/` on your phone.

## Phone setup

- **iPhone:** Safari can't put a web page in full screen. Use **Share → Add to Home Screen**, then launch it from the icon. The wake lock needs iOS 16.4 or later. Sound is muted when the silent switch is on.
- **Android (Chrome):** Full screen starts when you tap Start. Use **Install app** for a launcher icon.

If the workout screen says "Screen may sleep", the wake lock was refused. Turn off auto-lock for the session.

## Run locally

```sh
python3 -m http.server 8000
```
