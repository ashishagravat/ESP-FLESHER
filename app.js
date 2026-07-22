// ESP Wireless Programmer — frontend
// Uses esptool-js over Web Serial to flash ESP chips directly from the browser.
// Firmware comes from the Supabase backend (private) after a license check.
import { ESPLoader, Transport } from "https://unpkg.com/esptool-js@0.5.7/bundle.js";
import { CONFIG, FN, backendReady } from "./config.js";

const UNLIMITED = 1000000000;
const fmtMax = (m) => (m >= UNLIMITED ? "∞" : m);

// ---- DOM ----
const $ = (id) => document.getElementById(id);
const els = {
  licenseCard: $("licenseCard"),
  licenseKey: $("licenseKey"),
  licenseBtn: $("licenseBtn"),
  licenseHint: $("licenseHint"),
  unsupported: $("unsupported"),
  productSelect: $("productSelect"),
  productHint: $("productHint"),
  manualMode: $("manualMode"),
  manualBox: $("manualBox"),
  firmwareFile: $("firmwareFile"),
  flashAddr: $("flashAddr"),
  connectBtn: $("connectBtn"),
  disconnectBtn: $("disconnectBtn"),
  deviceInfo: $("deviceInfo"),
  chipName: $("chipName"),
  macAddr: $("macAddr"),
  flashBtn: $("flashBtn"),
  progressWrap: $("progressWrap"),
  progressBar: $("progressBar"),
  flashStatus: $("flashStatus"),
  log: $("log"),
  requestCard: $("requestCard"),
  reqProduct: $("reqProduct"),
  reqCount: $("reqCount"),
  reqBtn: $("reqBtn"),
  reqHint: $("reqHint"),
};

// ---- State ----
let transport = null;
let esploader = null;
let deviceMac = null;
let deviceChip = null;
let licenseKey = null;
let products = [];        // [{id,name,chip,description}]

// ---- esptool-js terminal shim ----
const espTerminal = {
  clean() { els.log.textContent = ""; },
  writeLine(d) { logLine(d); },
  write(d) { els.log.textContent += d; els.log.scrollTop = els.log.scrollHeight; },
};
function logLine(m) { els.log.textContent += m + "\n"; els.log.scrollTop = els.log.scrollHeight; }
function setStatus(m, k) { els.flashStatus.textContent = m; els.flashStatus.className = "status" + (k ? " " + k : ""); }

// ---- Init ----
function init() {
  if (!("serial" in navigator)) {
    els.unsupported.classList.remove("hidden");
    els.connectBtn.disabled = true;
  }
  els.licenseBtn.addEventListener("click", loadProducts);
  els.productSelect.addEventListener("change", onProductChange);
  els.manualMode.addEventListener("change", onManualToggle);
  els.connectBtn.addEventListener("click", connect);
  els.disconnectBtn.addEventListener("click", disconnect);
  els.flashBtn.addEventListener("click", flash);
  els.reqBtn.addEventListener("click", sendRequest);

  if (!backendReady()) {
    els.licenseHint.textContent =
      "Backend not configured yet — set your keys in config.js. You can still use Manual mode below.";
  }
  updateFlashButton();
}

// ---- Load a license's allowed products from the backend ----
async function loadProducts() {
  const key = els.licenseKey.value.trim();
  if (!key) { els.licenseHint.textContent = "Enter your license key."; return; }
  if (!backendReady()) { els.licenseHint.textContent = "Backend not configured. Use Manual mode."; return; }

  els.licenseHint.textContent = "Checking…";
  try {
    const res = await api(FN_myproducts(), { license_key: key });
    if (res.error) { els.licenseHint.textContent = res.error; return; }

    licenseKey = key;
    products = res.products || [];
    els.productSelect.innerHTML = '<option value="">— choose your product —</option>';
    els.reqProduct.innerHTML = "";
    products.forEach((p) => {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = `${p.name}  (${p.chip})`;
      els.productSelect.appendChild(o);
      els.reqProduct.appendChild(o.cloneNode(true));
    });
    els.requestCard.classList.remove("hidden");
    els.licenseHint.textContent =
      `${res.customer_name ? res.customer_name + " · " : ""}devices used ${res.used}/${fmtMax(res.max)}`;
  } catch (e) {
    els.licenseHint.textContent = "Could not reach the server: " + e.message;
  }
}
const FN_myproducts = () => `${CONFIG.SUPABASE_URL}/functions/v1/my-products`;
const FN_request = () => `${CONFIG.SUPABASE_URL}/functions/v1/request-flashes`;

// ---- Send a "need more flashes" request to the admin ----
async function sendRequest() {
  if (!licenseKey) { els.reqHint.textContent = "Load your license first."; return; }
  const productId = els.reqProduct.value;
  const count = parseInt(els.reqCount.value, 10);
  if (!productId || !count || count < 1) { els.reqHint.textContent = "Pick a product and a number."; return; }
  els.reqBtn.disabled = true;
  els.reqHint.textContent = "Sending…";
  try {
    const r = await api(FN_request(), { license_key: licenseKey, product_id: productId, count });
    els.reqHint.textContent = r.error
      ? r.error
      : "✅ Request sent! You can flash once the admin approves it.";
    if (!r.error) els.reqCount.value = "";
  } catch (e) {
    els.reqHint.textContent = "Could not send: " + e.message;
  } finally {
    els.reqBtn.disabled = false;
  }
}

function onProductChange() {
  const p = products.find((x) => x.id === els.productSelect.value);
  els.productHint.textContent = p ? `Chip: ${p.chip}${p.description ? " · " + p.description : ""}` : "";
  updateFlashButton();
}

function onManualToggle() {
  els.manualBox.classList.toggle("hidden", !els.manualMode.checked);
  els.productSelect.disabled = els.manualMode.checked;
  updateFlashButton();
}

// ---- Connect / read MAC (before flashing) ----
async function connect() {
  try {
    setStatus("Requesting serial port…");
    const port = await navigator.serial.requestPort();
    transport = new Transport(port, true);
    esploader = new ESPLoader({ transport, baudrate: 921600, terminal: espTerminal });

    setStatus("Connecting to chip…");
    deviceChip = await esploader.main();
    deviceMac = await esploader.chip.readMac(esploader);

    els.chipName.textContent = deviceChip;
    els.macAddr.textContent = deviceMac;
    els.deviceInfo.classList.remove("hidden");
    els.connectBtn.classList.add("hidden");
    els.disconnectBtn.classList.remove("hidden");
    setStatus("Connected. MAC: " + deviceMac, "ok");
    updateFlashButton();
  } catch (err) {
    setStatus("Connect failed: " + err.message, "err");
    logLine("ERROR: " + err.message);
    await cleanup();
  }
}

async function disconnect() { await cleanup(); setStatus("Disconnected."); }

async function cleanup() {
  try { if (transport) await transport.disconnect(); } catch (_) {}
  transport = null; esploader = null; deviceMac = null; deviceChip = null;
  els.deviceInfo.classList.add("hidden");
  els.connectBtn.classList.remove("hidden");
  els.disconnectBtn.classList.add("hidden");
  updateFlashButton();
}

// ---- Flash ----
async function flash() {
  if (!esploader) { setStatus("Connect a device first.", "err"); return; }

  let fileData, address, firmwareId = null, productId = null;
  try {
    if (els.manualMode.checked) {
      ({ fileData, address } = await getManualFirmware());
    } else {
      ({ fileData, address, firmwareId, productId } = await getBackendFirmware());
    }
  } catch (err) { setStatus(err.message, "err"); return; }

  els.flashBtn.disabled = true;
  els.progressWrap.classList.remove("hidden");
  setStatus("Flashing… do not unplug the device.");

  let ok = false, errMsg = null;
  try {
    await esploader.writeFlash({
      fileArray: [{ data: fileData, address }],
      flashSize: "keep", flashMode: "keep", flashFreq: "keep",
      eraseAll: false, compress: true,
      reportProgress: (i, written, total) => {
        els.progressBar.style.width = Math.round((written / total) * 100) + "%";
      },
    });
    await esploader.after();
    ok = true;
  } catch (err) {
    errMsg = err.message;
    logLine("ERROR: " + err.message);
  } finally {
    els.flashBtn.disabled = false;
  }

  // Report to backend (counts the MAC only on success, once per unique device).
  if (!els.manualMode.checked && backendReady() && licenseKey) {
    try {
      const r = await api(FN.report(), {
        license_key: licenseKey, product_id: productId,
        firmware_id: firmwareId, chip_mac: deviceMac,
        status: ok ? "success" : "fail", error: errMsg,
      });
      if (ok) {
        setStatus(`✅ Flash successful! Devices used ${r.used}/${fmtMax(r.max)}` +
          (r.counted ? " (this device counted)" : " (re-flash, not counted)"), "ok");
      } else {
        setStatus("❌ Flash failed: " + errMsg, "err");
      }
    } catch (_) {
      setStatus(ok ? "✅ Flash successful (report failed)." : "❌ Flash failed: " + errMsg, ok ? "ok" : "err");
    }
  } else {
    setStatus(ok ? "✅ Flash successful!" : "❌ Flash failed: " + errMsg, ok ? "ok" : "err");
  }
}

// Manual/bench mode: local file, no backend.
async function getManualFirmware() {
  const f = els.firmwareFile.files[0];
  if (!f) throw new Error("Pick a .bin file first (manual mode).");
  const buf = await f.arrayBuffer();
  return { fileData: bufToBinaryString(buf), address: parseHex(els.flashAddr.value) };
}

// Backend mode: ask prepare-flash for a short-lived signed URL, fetch into memory.
async function getBackendFirmware() {
  const productId = els.productSelect.value;
  if (!productId) throw new Error("Select a product first.");
  if (!backendReady() || !licenseKey) throw new Error("Load your license/products first.");

  const prep = await api(FN.prepare(), {
    license_key: licenseKey, product_id: productId, chip_mac: deviceMac,
  });
  if (prep.error) throw new Error(prep.error);

  const res = await fetch(prep.signed_url);           // firmware → memory only
  if (!res.ok) throw new Error("Could not download firmware.");
  const buf = await res.arrayBuffer();
  return {
    fileData: bufToBinaryString(buf),
    address: prep.flash_address,
    firmwareId: prep.firmware_id,
    productId,
  };
}

// ---- Helpers ----
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
function updateFlashButton() {
  const haveTarget = els.manualMode.checked || !!els.productSelect.value;
  els.flashBtn.disabled = !(esploader && haveTarget);
}
function bufToBinaryString(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}
function parseHex(v) { const n = parseInt(v, 16); return Number.isNaN(n) ? 0 : n; }

init();
