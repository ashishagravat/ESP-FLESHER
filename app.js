// ESP Wireless Programmer — customer app
// Web Serial + esptool-js flashing. Private firmware via Supabase. Remembered login.
import { ESPLoader, Transport } from "https://unpkg.com/esptool-js@0.5.7/bundle.js";
import { CONFIG, backendReady } from "./config.js";

const UNLIMITED = 1000000000;
const fmtMax = (m) => (m >= UNLIMITED ? "∞" : m);
const KEY_STORE = "esp_license_key";

const FN = {
  myproducts: () => `${CONFIG.SUPABASE_URL}/functions/v1/my-products`,
  prepare:    () => `${CONFIG.SUPABASE_URL}/functions/v1/prepare-flash`,
  report:     () => `${CONFIG.SUPABASE_URL}/functions/v1/report-flash`,
  request:    () => `${CONFIG.SUPABASE_URL}/functions/v1/request-flashes`,
};

const $ = (id) => document.getElementById(id);
const el = {};
[
  "loginView","keyInput","rememberKey","keyBtn","loginMsg",
  "appView","usageChip","menuBtn","drawer","drawerBg","drawerCustomer","drawerKey","drawerUsage",
  "changeKeyBtn","logoutBtn","manualMode","manualBox","firmwareFile","flashAddr",
  "unsupported","productSelect","productHint","connectBtn","deviceInfo","chipName","macAddr",
  "disconnectBtn","flashBtn","progressWrap","progRing","progPct","progressBar","flashStatus",
  "flashStatusIdle","successPanel","successInfo","flashAnotherBtn",
  "reqProduct","reqCount","reqBtn","reqHint","log",
].forEach((id) => (el[id] = $(id)));

// ---- state ----
let transport = null, esploader = null;
let deviceMac = null, deviceChip = null;
let licenseKey = null, products = [], usage = { used: 0, max: 0, name: "" };

// ---- esptool terminal ----
const espTerminal = {
  clean() { el.log.textContent = ""; },
  writeLine(d) { logLine(d); },
  write(d) { el.log.textContent += d; el.log.scrollTop = el.log.scrollHeight; },
};
function logLine(m) { el.log.textContent += m + "\n"; el.log.scrollTop = el.log.scrollHeight; }
function status(m, k) { el.flashStatusIdle.textContent = m; el.flashStatusIdle.className = "fstatus" + (k ? " " + k : ""); }

// ---- API ----
async function api(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "apikey": CONFIG.SUPABASE_ANON_KEY,
      "Authorization": "Bearer " + CONFIG.SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ---- init ----
function init() {
  if (!("serial" in navigator)) el.unsupported.classList.remove("hidden");

  el.keyBtn.addEventListener("click", () => submitKey());
  el.keyInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitKey(); });
  el.menuBtn.addEventListener("click", () => toggleDrawer(true));
  el.drawerBg.addEventListener("click", () => toggleDrawer(false));
  el.changeKeyBtn.addEventListener("click", logout);
  el.logoutBtn.addEventListener("click", logout);
  el.manualMode.addEventListener("change", onManualToggle);
  el.productSelect.addEventListener("change", onProductChange);
  el.connectBtn.addEventListener("click", connect);
  el.disconnectBtn.addEventListener("click", () => cleanup().then(() => status("Disconnected.")));
  el.flashBtn.addEventListener("click", flash);
  el.flashAnotherBtn.addEventListener("click", flashAnother);
  el.reqBtn.addEventListener("click", sendRequest);

  // remembered login?
  const saved = localStorage.getItem(KEY_STORE) || sessionStorage.getItem(KEY_STORE);
  if (saved && backendReady()) {
    el.keyInput.value = saved;
    submitKey(true);
  }
}

// ---- login ----
async function submitKey(silent) {
  const key = el.keyInput.value.trim();
  if (!key) { el.loginMsg.textContent = "Enter your access key."; el.loginMsg.className = "msg err"; return; }
  if (!backendReady()) { el.loginMsg.textContent = "Service not configured."; el.loginMsg.className = "msg err"; return; }

  if (!silent) { el.loginMsg.textContent = "Checking…"; el.loginMsg.className = "msg"; }
  try {
    const res = await api(FN.myproducts(), { license_key: key });
    if (res.error) {
      el.loginMsg.textContent = res.error; el.loginMsg.className = "msg err";
      localStorage.removeItem(KEY_STORE); sessionStorage.removeItem(KEY_STORE);
      return;
    }
    licenseKey = key;
    // remember
    if (el.rememberKey.checked) localStorage.setItem(KEY_STORE, key);
    else sessionStorage.setItem(KEY_STORE, key);

    applyLicense(res);
    el.loginView.classList.add("hidden");
    el.appView.classList.remove("hidden");
  } catch (e) {
    el.loginMsg.textContent = "Could not reach the server."; el.loginMsg.className = "msg err";
  }
}

function applyLicense(res) {
  products = res.products || [];
  usage = { used: res.used ?? 0, max: res.max ?? 0, name: res.customer_name || "" };
  el.productSelect.innerHTML = '<option value="">— choose your device —</option>';
  el.reqProduct.innerHTML = "";
  products.forEach((p) => {
    const o = document.createElement("option");
    o.value = p.id; o.textContent = `${p.name}  (${p.chip})`;
    el.productSelect.appendChild(o);
    el.reqProduct.appendChild(o.cloneNode(true));
  });
  refreshUsageUI();
}

function refreshUsageUI() {
  el.usageChip.textContent = `${usage.used}/${fmtMax(usage.max)} devices`;
  el.drawerCustomer.textContent = usage.name ? `Signed in as ${usage.name}` : "Signed in";
  el.drawerKey.textContent = licenseKey || "—";
  el.drawerUsage.textContent = `${usage.used}/${fmtMax(usage.max)}`;
}

function logout() {
  localStorage.removeItem(KEY_STORE); sessionStorage.removeItem(KEY_STORE);
  licenseKey = null;
  cleanup();
  toggleDrawer(false);
  el.appView.classList.add("hidden");
  el.loginView.classList.remove("hidden");
  el.keyInput.value = ""; el.loginMsg.textContent = "";
}

function toggleDrawer(open) {
  el.drawer.classList.toggle("hidden", !open);
  el.drawerBg.classList.toggle("hidden", !open);
}

// ---- product / manual ----
function onProductChange() {
  const p = products.find((x) => x.id === el.productSelect.value);
  el.productHint.textContent = p ? `${p.chip}${p.description ? " · " + p.description : ""}` : "";
  updateFlashBtn();
}
function onManualToggle() {
  el.manualBox.classList.toggle("hidden", !el.manualMode.checked);
  el.productSelect.disabled = el.manualMode.checked;
  updateFlashBtn();
}

// ---- connect (reads MAC) ----
async function connect() {
  try {
    status("Requesting serial port…");
    const port = await navigator.serial.requestPort();
    transport = new Transport(port, true);
    esploader = new ESPLoader({ transport, baudrate: 921600, terminal: espTerminal });
    status("Connecting to chip…");
    deviceChip = await esploader.main();
    deviceMac = await esploader.chip.readMac(esploader);
    el.chipName.textContent = deviceChip;
    el.macAddr.textContent = deviceMac;
    el.deviceInfo.classList.remove("hidden");
    el.connectBtn.classList.add("hidden");
    status("Connected. Ready to flash.", "ok");
    updateFlashBtn();
  } catch (err) {
    status("Connect failed: " + err.message, "err");
    logLine("ERROR: " + err.message);
    await cleanup();
  }
}

async function cleanup() {
  try { if (transport) await transport.disconnect(); } catch (_) {}
  transport = null; esploader = null; deviceMac = null; deviceChip = null;
  el.deviceInfo.classList.add("hidden");
  el.connectBtn.classList.remove("hidden");
  updateFlashBtn();
}

// ---- flash ----
async function flash() {
  if (!esploader) { status("Connect a device first.", "err"); return; }
  let fileData, address, firmwareId = null, productId = null;
  try {
    if (el.manualMode.checked) ({ fileData, address } = await getManualFirmware());
    else ({ fileData, address, firmwareId, productId } = await getBackendFirmware());
  } catch (err) { status(err.message, "err"); return; }

  el.flashBtn.disabled = true;
  el.successPanel.classList.add("hidden");
  el.progressWrap.classList.remove("hidden");
  setProgress(0);
  el.flashStatus.textContent = "Flashing… do not unplug.";
  el.flashStatus.className = "fstatus";
  status("");

  let ok = false, errMsg = null;
  try {
    await esploader.writeFlash({
      fileArray: [{ data: fileData, address }],
      flashSize: "keep", flashMode: "keep", flashFreq: "keep",
      eraseAll: false, compress: true,
      reportProgress: (i, written, total) => setProgress(Math.round((written / total) * 100)),
    });
    await esploader.after();
    ok = true; setProgress(100);
  } catch (err) {
    errMsg = err.message; logLine("ERROR: " + err.message);
    el.flashStatus.textContent = "Flash failed: " + errMsg;
    el.flashStatus.className = "fstatus err";
  }

  // report + count
  if (!el.manualMode.checked && licenseKey) {
    try {
      const r = await api(FN.report(), {
        license_key: licenseKey, product_id: productId, firmware_id: firmwareId,
        chip_mac: deviceMac, status: ok ? "success" : "fail", error: errMsg,
      });
      if (r.used != null) { usage.used = r.used; usage.max = r.max; refreshUsageUI(); }
      if (ok) showSuccess(r);
    } catch (_) { if (ok) showSuccess(null); }
  } else if (ok) {
    showSuccess(null);
  }

  el.flashBtn.disabled = false;
}

function showSuccess(r) {
  el.progressWrap.classList.add("hidden");
  const line = r
    ? `MAC ${deviceMac} · Devices used ${r.used}/${fmtMax(r.max)}` +
      (r.counted ? "" : " (re-flash, not counted)")
    : `MAC ${deviceMac}`;
  el.successInfo.textContent = line;
  el.successPanel.classList.remove("hidden");
  el.successPanel.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ---- flash another device ----
async function flashAnother() {
  await cleanup();
  el.successPanel.classList.add("hidden");
  el.progressWrap.classList.add("hidden");
  setProgress(0);
  status("Plug in the next board and press Connect.");
  el.connectBtn.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ---- firmware sources ----
async function getManualFirmware() {
  const f = el.firmwareFile.files[0];
  if (!f) throw new Error("Pick a .bin file first (manual mode).");
  const buf = await f.arrayBuffer();
  return { fileData: bufToBin(buf), address: parseHex(el.flashAddr.value) };
}
async function getBackendFirmware() {
  const productId = el.productSelect.value;
  if (!productId) throw new Error("Select your device first.");
  const prep = await api(FN.prepare(), { license_key: licenseKey, product_id: productId, chip_mac: deviceMac });
  if (prep.error) throw new Error(prep.error);
  const res = await fetch(prep.signed_url);
  if (!res.ok) throw new Error("Could not download firmware.");
  const buf = await res.arrayBuffer();
  return { fileData: bufToBin(buf), address: prep.flash_address, firmwareId: prep.firmware_id, productId };
}

// ---- request more ----
async function sendRequest() {
  if (!licenseKey) { el.reqHint.textContent = "Sign in first."; return; }
  const productId = el.reqProduct.value, count = parseInt(el.reqCount.value, 10);
  if (!productId || !count || count < 1) { el.reqHint.textContent = "Pick a device and a number."; return; }
  el.reqBtn.disabled = true; el.reqHint.textContent = "Sending…";
  try {
    const r = await api(FN.request(), { license_key: licenseKey, product_id: productId, count });
    el.reqHint.textContent = r.error ? r.error : "✅ Request sent! You can flash once it's approved.";
    el.reqHint.className = "msg" + (r.error ? " err" : " ok");
    if (!r.error) el.reqCount.value = "";
  } catch (e) { el.reqHint.textContent = "Could not send: " + e.message; el.reqHint.className = "msg err"; }
  finally { el.reqBtn.disabled = false; }
}

// ---- helpers ----
function setProgress(pct) {
  el.progPct.textContent = pct + "%";
  el.progressBar.style.width = pct + "%";
  el.progRing.style.background = `conic-gradient(var(--accent) ${pct}%, var(--card-2) 0)`;
}
function updateFlashBtn() {
  const haveTarget = el.manualMode.checked || !!el.productSelect.value;
  el.flashBtn.disabled = !(esploader && haveTarget);
}
function bufToBin(buf) {
  const b = new Uint8Array(buf); let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}
function parseHex(v) { const n = parseInt(v, 16); return Number.isNaN(n) ? 0 : n; }

init();
