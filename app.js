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
  "loginView","userInput","passInput","rememberKey","keyBtn","loginMsg",
  "appView","usageChip","menuBtn","drawer","drawerBg","drawerCustomer","drawerKey","drawerUsage",
  "changeKeyBtn","logoutBtn","manualMode","manualBox","firmwareFile","flashAddr",
  "unsupported","productSelect","productHint","connectBtn","deviceInfo","chipName","macAddr",
  "disconnectBtn","flashBtn","progressWrap","progPct","progressBar","flashStatus",
  "flashStatusIdle","clearLog",
  "reqProduct","reqCount","reqBtn","reqHint","log",
].forEach((id) => (el[id] = $(id)));

// ---- state ----
let grantedPort = null;                 // the COM port, picked ONCE and reused
let deviceMac = null, deviceChip = null;
let licenseKey = null, products = [], usage = { used: 0, max: 0, name: "" };

// ---- esptool terminal ----
const espTerminal = {
  clean() { el.log.textContent = ""; },
  writeLine(d) { logLine(d); },
  write(d) { el.log.textContent += d; el.log.scrollTop = el.log.scrollHeight; },
};
function logLine(m) { el.log.textContent += m + "\n"; el.log.scrollTop = el.log.scrollHeight; }
function status(m, k) { el.flashStatusIdle.textContent = m; el.flashStatusIdle.className = "dock-status" + (k ? " " + k : ""); }

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

  el.keyBtn.addEventListener("click", () => login());
  el.passInput.addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
  el.menuBtn.addEventListener("click", () => toggleDrawer(true));
  el.drawerBg.addEventListener("click", () => toggleDrawer(false));
  el.changeKeyBtn.addEventListener("click", logout);
  el.logoutBtn.addEventListener("click", logout);
  el.manualMode.addEventListener("change", onManualToggle);
  el.productSelect.addEventListener("change", onProductChange);
  el.connectBtn.addEventListener("click", connect);
  el.disconnectBtn.addEventListener("click", forgetPort);
  el.flashBtn.addEventListener("click", flash);
  el.clearLog.addEventListener("click", () => (el.log.textContent = ""));
  el.reqBtn.addEventListener("click", sendRequest);

  // remembered login? (we store the internal key after a successful login)
  const saved = localStorage.getItem(KEY_STORE) || sessionStorage.getItem(KEY_STORE);
  if (saved && backendReady()) loginWith({ license_key: saved }, true);
}

// ---- login with User ID + Password ----
async function login() {
  const username = el.userInput.value.trim();
  const password = el.passInput.value;
  if (!username || !password) { el.loginMsg.textContent = "Enter your User ID and password."; el.loginMsg.className = "msg err"; return; }
  if (!backendReady()) { el.loginMsg.textContent = "Service not configured."; el.loginMsg.className = "msg err"; return; }
  el.loginMsg.textContent = "Signing in…"; el.loginMsg.className = "msg";
  loginWith({ username, password }, false);
}

// creds = {username,password} for a fresh login, or {license_key} for a remembered session
async function loginWith(creds, silent) {
  try {
    const res = await api(FN.myproducts(), creds);
    if (res.error) {
      if (!silent) { el.loginMsg.textContent = res.error; el.loginMsg.className = "msg err"; }
      localStorage.removeItem(KEY_STORE); sessionStorage.removeItem(KEY_STORE);
      return;
    }
    licenseKey = res.key;               // internal key used for flashing calls
    if (el.rememberKey.checked) localStorage.setItem(KEY_STORE, res.key);
    else sessionStorage.setItem(KEY_STORE, res.key);

    applyLicense(res);
    el.loginView.classList.add("hidden");
    el.appView.classList.remove("hidden");
  } catch (e) {
    if (!silent) { el.loginMsg.textContent = "Could not reach the server."; el.loginMsg.className = "msg err"; }
  }
}

function applyLicense(res) {
  products = res.products || [];
  usage = { used: res.used ?? 0, max: res.max ?? 0, name: res.customer_name || "", username: res.username || "" };
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
  el.drawerKey.textContent = usage.username || "—";
  el.drawerUsage.textContent = `${usage.used}/${fmtMax(usage.max)}`;
}

function logout() {
  localStorage.removeItem(KEY_STORE); sessionStorage.removeItem(KEY_STORE);
  licenseKey = null;
  forgetPort();
  toggleDrawer(false);
  el.appView.classList.add("hidden");
  el.loginView.classList.remove("hidden");
  el.passInput.value = ""; el.loginMsg.textContent = "";
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

// ---- select the COM port ONCE (reused for every PCB) ----
async function connect() {
  try {
    grantedPort = await navigator.serial.requestPort();
    el.connectBtn.textContent = "✓ Port ready";
    el.connectBtn.classList.add("ok-btn");
    el.disconnectBtn.classList.remove("hidden");
    status("Port ready. Pick a device and press Flash. Swap PCBs and press Flash for each.", "ok");
    logLine("> Port selected. Ready to flash.");
    updateFlashBtn();
  } catch (err) {
    status("No port selected.", "err");
  }
}

// forget the chosen port (so a different port can be picked)
function forgetPort() {
  grantedPort = null;
  el.connectBtn.textContent = "🔌 Connect";
  el.connectBtn.classList.remove("ok-btn");
  el.disconnectBtn.classList.add("hidden");
  el.deviceInfo.classList.add("hidden");
  status("Port disconnected. Press Connect to choose a port.");
  updateFlashBtn();
}

// ---- flash (repeatable: one press = one PCB, same port) ----
async function flash() {
  if (!grantedPort) { status("Press Connect and choose the COM port first.", "err"); return; }
  const productId = el.productSelect.value;
  if (!el.manualMode.checked && !productId) { status("Select your device first.", "err"); return; }

  el.flashBtn.disabled = true;
  el.progressWrap.classList.remove("hidden");
  setProgress(0);
  el.flashStatus.textContent = "Connecting to board…";
  el.flashStatus.className = "dock-status";
  status("");

  // fresh loader on the SAME port for each board
  const transport = new Transport(grantedPort, true);
  const esploader = new ESPLoader({ transport, baudrate: 921600, terminal: espTerminal });
  let ok = false, errMsg = null, firmwareId = null;

  try {
    deviceChip = await esploader.main();
    deviceMac = await esploader.chip.readMac(esploader);
    el.chipName.textContent = deviceChip;
    el.macAddr.textContent = deviceMac;
    el.deviceInfo.classList.remove("hidden");

    let fileData, address;
    if (el.manualMode.checked) {
      ({ fileData, address } = await getManualFirmware());
    } else {
      const fw = await getBackendFirmware(productId);   // uses deviceMac
      fileData = fw.fileData; address = fw.address; firmwareId = fw.firmwareId;
    }

    el.flashStatus.textContent = "Flashing… do not unplug.";
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
    el.flashStatus.className = "dock-status err";
  } finally {
    try { await transport.disconnect(); } catch (_) {}  // release the port for the next PCB
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
  el.flashStatus.textContent = "";
  const info = r ? `devices used ${r.used}/${fmtMax(r.max)}${r.counted ? "" : " (re-flash)"}` : "";
  logLine(`✅ SUCCESS   ${deviceChip}   MAC ${deviceMac}   ${info}`);
  logLine("> Swap in the next PCB and press Flash.\n");
  status(`✅ Flashed ${deviceMac} — ${info}. Swap PCB and press Flash for the next one.`, "ok");
}

// ---- firmware sources ----
async function getManualFirmware() {
  const f = el.firmwareFile.files[0];
  if (!f) throw new Error("Pick a .bin file first (manual mode).");
  const buf = await f.arrayBuffer();
  return { fileData: bufToBin(buf), address: parseHex(el.flashAddr.value) };
}
async function getBackendFirmware(productId) {
  const prep = await api(FN.prepare(), { license_key: licenseKey, product_id: productId, chip_mac: deviceMac });
  if (prep.error) throw new Error(prep.error);
  const res = await fetch(prep.signed_url);
  if (!res.ok) throw new Error("Could not download firmware.");
  const buf = await res.arrayBuffer();
  return { fileData: bufToBin(buf), address: prep.flash_address, firmwareId: prep.firmware_id };
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
}
function updateFlashBtn() {
  const haveTarget = el.manualMode.checked || !!el.productSelect.value;
  el.flashBtn.disabled = !(grantedPort && haveTarget);
}
function bufToBin(buf) {
  const b = new Uint8Array(buf); let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}
function parseHex(v) { const n = parseInt(v, 16); return Number.isNaN(n) ? 0 : n; }

init();
