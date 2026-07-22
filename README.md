# ESP Wireless Programmer — Phase 1

A browser-based flasher for ESP chips (ESP32 / S3 / C3 / S2 / ESP8266) using the
**Web Serial API** and **esptool-js**. The customer picks their product, connects the
board, and flashes it — no `.bin` file ever leaves as a download.

See [PLAN.md](PLAN.md) for the full system design (admin panel, Supabase backend, licensing).

## What works in Phase 1

- Product dropdown (sample products; real ones come from the backend in Phase 2)
- **Connect device** → browser serial-port picker → reads the chip type + **unique MAC**
- **Flash device** → progress bar → success/fail status
- **Manual / bench mode** — flash any `.bin` you pick, to any address (for your workbench)
- Success/MAC is logged locally now; Phase 4 sends it to the backend for counting

## Requirements

- **Desktop Google Chrome or Microsoft Edge** (Web Serial is not in Safari/Firefox/mobile)
- USB-serial driver installed if your OS needs one (CP210x or CH340)
- The page must be served over **https** or **localhost** (Web Serial needs a secure context)

## Run it locally

Web Serial needs a secure context, so open it via `localhost`, not by double-clicking the file.

```bash
# from this folder, pick either:
python -m http.server 8000
# or
npx serve .
```

Then open <http://localhost:8000> in Chrome.

## Test the flash

1. Plug in an ESP board.
2. Tick **Manual / bench mode** and choose any `.bin` (e.g. an Arduino/PlatformIO build).
3. Set the flash address (`0x0` for a full merged image, `0x10000` for an app-only image).
4. Click **Connect device**, pick the COM port, confirm the chip + MAC appear.
5. Click **Flash device**.

> If connect fails, hold the **BOOT** button on the board while clicking Connect, then release.

## Deploy (later)

Push this folder to a GitHub repo and enable **GitHub Pages** — the site is fully static.
Backend (Supabase) and admin panel come in Phases 2–4.
