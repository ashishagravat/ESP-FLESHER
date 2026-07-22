# Wireless ESP Programming Tool — Full Plan

_Last updated: 2026-07-22_

## 1. Goal (in plain words)

Build a website where:

- **Customers** buy your PCBs (with an ESP chip on board), plug the board into their own PC,
  open the website in Chrome, **pick their product from a list, connect the board, and flash
  it online** — WiFi/USB. They **never receive the `.bin` file or source code**.
- **You (admin)** control everything from a dashboard: which products exist, which firmware
  goes on which board, who is allowed to flash, and how many devices each customer can flash.

## 2. How flashing-without-a-file works

Browsers (Chrome/Edge on desktop) support the **Web Serial API**. Combined with **esptool-js**
(the JavaScript version of Espressif's flasher), a web page can talk to the ESP over USB and
flash it directly.

The trick for keeping firmware private:

- The **firmware `.bin` is NOT on the public website.** It lives in **Supabase private storage.**
- When a licensed customer clicks "Flash", the backend checks they're allowed, then streams the
  `.bin` bytes **into browser memory only** (a short-lived signed URL). esptool-js pushes those
  bytes straight to the chip.
- **No download button. No file saved to disk.** The bytes exist in RAM for a few seconds.

> ⚠️ Honest limit: this stops normal customers and casual copiers (99%+). A determined attacker
> with USB-sniffing tools could still capture bytes during flashing. For true anti-cloning we add
> **ESP32 Flash Encryption + Secure Boot** in a later phase (Section 9).

## 3. Technology choices

| Layer | Choice | Why |
|---|---|---|
| Customer flasher UI | Static site (HTML/JS) on **GitHub Pages** | Free, simple; just UI + esptool-js |
| Admin panel UI | Same site, protected `/admin` route | One codebase, gated by login |
| Flashing engine | **esptool-js** | Official, supports ESP32 / S3 / C3 / S2 / ESP8266 |
| Backend + DB + Auth + File storage | **Supabase** (free tier) | All-in-one: Postgres DB, private storage, logins, row-level security |
| Browser requirement | **Desktop Chrome / Edge** | Web Serial not supported on Safari/Firefox/mobile |

## 4. Database design (Supabase / Postgres)

```
products
  id            uuid (pk)
  name          text          -- "Smart Meter v2"
  description   text
  chip          text          -- esp32 | esp32s3 | esp32c3 | esp8266
  image_url     text
  enabled       bool          -- hide from customers without deleting
  created_at    timestamptz

firmwares
  id            uuid (pk)
  product_id    uuid (fk -> products)
  version       text          -- "2.1.0"
  storage_path  text          -- path in private Supabase bucket
  flash_address int           -- e.g. 0x10000 (stored as integer)
  is_current    bool          -- the version customers get now
  notes         text
  created_at    timestamptz

-- optional: multi-file flash (bootloader + partition + app)
firmware_files
  id            uuid (pk)
  firmware_id   uuid (fk -> firmwares)
  storage_path  text
  flash_address int

licenses
  id            uuid (pk)
  key           text unique   -- license key given to customer
  customer_name text
  max_flashes   int           -- XX device limit
  used_flashes  int           -- incremented on each success
  enabled       bool
  created_at    timestamptz

license_products              -- which products a license may flash
  license_id    uuid (fk)
  product_id    uuid (fk)

flash_logs
  id            uuid (pk)
  license_id    uuid (fk)
  product_id    uuid (fk)
  firmware_id   uuid (fk)
  chip_mac      text          -- ESP MAC address, if readable
  status        text          -- success | fail
  error         text
  created_at    timestamptz

admins
  -- handled by Supabase Auth (email + password); admin flag via role
```

## 5. Admin panel — full control list

### Products / Boards
- Add / edit / delete product
- Set name, description, image, ESP chip type
- Enable / disable (hide from customers)

### Firmware
- Upload `.bin` to a product
- Version management (keep old versions, pick "current")
- Set flash address + options; multi-file support (bootloader/partition/app)
- Old versions stay private

### Mapping — "which program for which board"
- Table view: Product → Chip → Current firmware → Status
- Change the current firmware version per product in one click

### Licenses / Access
- Generate license keys (or customer logins)
- Set max flashes per key (the XX-device limit)
- Restrict a license to specific products
- Revoke / disable anytime

### Logs
- Who flashed what, when, success/fail
- Count of devices flashed per customer/license

### Settings
- Admin account, branding (logo, site name)

## 5b. Who selects the serial port (decided: Model A)

- **Model A — Web Serial, runs on the customer's PC (CHOSEN):** the customer clicks Connect,
  the **browser shows the serial-port picker**, they pick their own COM port, and flashing runs
  **locally in their browser**. You never touch their port; you only control which firmware is
  served. Simple, secure, no software to install on their PC.
- **Model B — remote bridge (rejected for now):** you select their port from your PC over the
  internet. Needs a signed desktop agent on every customer PC, handles network latency during
  timing-sensitive flashing. Too complex; revisit only if truly required.
- **Manual / bench mode:** same page has a toggle so a technician (or you at the workbench) can
  pick any `.bin` and any flash address and flash locally. Covers "program manual" cases.

## 6. Customer flow (kept simple)

1. Open website in Chrome
2. Enter license key / log in
3. **Pick product** from dropdown (only products their license allows)
4. Click **Connect device** (Web Serial prompt)
5. Click **Flash** → progress bar → done
6. Never sees firmware files, versions, or other products

## 7. Security rules (Supabase Row-Level Security)

- Firmware bucket is **private**; bytes only served via short-lived **signed URLs** the backend
  issues **after** validating the license + product access + remaining flash count.
- Customers can never list or read the `products`/`firmwares` tables directly for products they
  aren't licensed for.
- Admin actions require an authenticated admin role.
- Every flash decrements `used_flashes` and writes a `flash_logs` row.

## 8. Build phases

| Phase | Deliverable |
|---|---|
| **1** | Customer flasher UI (static): dropdown + Connect + Flash with esptool-js, using a test firmware. Proves the hard part works. |
| **2** | Supabase setup: DB tables, private storage bucket, auth. |
| **3** | Admin panel: products CRUD, firmware upload, mapping table. |
| **4** | Wire customer side to backend: license check, private firmware delivery, flash-count limit, logging. |
| **5** | Polish: branding, error handling, logs dashboard. |
| **6** (optional) | ESP32 Flash Encryption + Secure Boot provisioning for true anti-cloning. |

## 9. Anti-cloning upgrade (optional, later)

For firmware that is useless even if copied:
- **Flash Encryption** — ESP32 encrypts its own flash with a key in write-only eFuse.
- **Secure Boot** — chip only runs firmware you signed.
- These involve **burning eFuses (permanent, one-time)** and are normally done by **you during
  factory provisioning**, not by the customer in a browser. The web tool then only delivers
  encrypted OTA updates.

## 10. Known limitations to tell customers

- **Chrome or Edge on a computer only** (no phone, no Safari/Firefox).
- Customer must install USB-serial drivers (CP210x / CH340) if their OS needs them.
- First-time flash may need holding the BOOT button on some boards.

## 11. Open questions for you

1. Which ESP chip(s) are on your PCBs? (decides flash defaults)
2. Do customers log in with **email/password**, or just enter a **license key**? (key is simpler)
3. Do you flash boards yourself before shipping, or do customers do the first flash?
4. Roughly how many products and how many customers to start?
