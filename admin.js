// Admin dashboard — talks only to the password-protected `admin` Edge Function.
import { CONFIG } from "./config.js";

const ADMIN_FN = `${CONFIG.SUPABASE_URL}/functions/v1/admin`;
const CHIPS = ["esp32", "esp32s3", "esp32c3", "esp32s2", "esp8266"];
const UNLIMITED = 1000000000; // sentinel: max_flashes >= this means "unlimited"
const fmtMax = (m) => (m >= UNLIMITED ? "∞" : m);
const $ = (id) => document.getElementById(id);

let pass = sessionStorage.getItem("adminPass") || "";
let products = [];
let firmwares = [];   // for the currently selected product in Firmware tab

// ---- API ----
async function call(action, data = {}) {
  const res = await fetch(ADMIN_FN, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "apikey": CONFIG.SUPABASE_ANON_KEY,
      "Authorization": "Bearer " + CONFIG.SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ admin_password: pass, action, data }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || ("HTTP " + res.status));
  return body;
}

// ---- Login ----
$("loginBtn").addEventListener("click", login);
$("adminPass").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
async function login() {
  pass = $("adminPass").value;
  $("loginHint").textContent = "Checking…";
  try {
    await call("verify");
    sessionStorage.setItem("adminPass", pass);
    $("loginView").classList.add("hidden");
    $("dashView").classList.remove("hidden");
    openTab("products");
    refreshReqBadge();
  } catch (e) {
    $("loginHint").textContent = e.message;
    $("loginHint").className = "hint err";
  }
}
$("logoutBtn").addEventListener("click", () => {
  sessionStorage.removeItem("adminPass"); pass = "";
  $("dashView").classList.add("hidden");
  $("loginView").classList.remove("hidden");
  $("adminPass").value = ""; $("loginHint").textContent = "";
});

// If a password is already stored, auto-enter.
if (pass) call("verify").then(() => {
  $("loginView").classList.add("hidden");
  $("dashView").classList.remove("hidden");
  openTab("products");
}).catch(() => sessionStorage.removeItem("adminPass"));

// ---- Tabs ----
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => openTab(t.dataset.tab)));
function openTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".tabpane").forEach((p) => p.classList.add("hidden"));
  $("tab-" + name).classList.remove("hidden");
  if (name === "products") loadProducts();
  if (name === "firmware") loadFirmwareTab();
  if (name === "licenses") loadLicenses();
  if (name === "requests") loadRequests();
  if (name === "logs") loadLogs();
}

// ---- Products ----
async function loadProducts() {
  const [{ products: p }, fwByProduct] = [await call("products.list"), {}];
  products = p;
  // fetch current firmware per product for the table
  const rows = await Promise.all(products.map(async (prod) => {
    const { firmwares } = await call("firmwares.list", { product_id: prod.id });
    const cur = firmwares.find((f) => f.is_current);
    return { prod, cur };
  }));
  $("productRows").innerHTML = rows.map(({ prod, cur }) => `
    <tr>
      <td>${esc(prod.name)}</td>
      <td><code>${prod.chip}</code></td>
      <td>${cur ? esc(cur.version) : '<span class="hint">— none —</span>'}</td>
      <td>${statusPill(prod.enabled)}</td>
      <td><div class="row-actions">
        <button class="icon-btn" data-edit="${prod.id}">Edit</button>
        <button class="icon-btn danger" data-del="${prod.id}">Delete</button>
      </div></td>
    </tr>`).join("") || emptyRow(5);
  $("productRows").querySelectorAll("[data-edit]").forEach((b) =>
    b.onclick = () => editProduct(products.find((x) => x.id === b.dataset.edit)));
  $("productRows").querySelectorAll("[data-del]").forEach((b) =>
    b.onclick = async () => { if (confirm("Delete this product?")) { await call("products.delete", { id: b.dataset.del }); loadProducts(); } });
}
$("addProductBtn").onclick = () => editProduct(null);

function editProduct(p) {
  modal(p ? "Edit product" : "Add product", `
    <div class="field"><label>Name</label><input id="m_name" value="${esc(p?.name ?? "")}"></div>
    <div class="field"><label>Chip</label><select id="m_chip">${CHIPS.map((c) =>
      `<option ${p?.chip === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
    <div class="field"><label>Description</label><input id="m_desc" value="${esc(p?.description ?? "")}"></div>
    <div class="field"><label class="check"><input type="checkbox" id="m_en" ${p?.enabled !== false ? "checked" : ""}> Enabled</label></div>
  `, async () => {
    const data = { id: p?.id, name: $("m_name").value.trim(), chip: $("m_chip").value,
      description: $("m_desc").value.trim(), enabled: $("m_en").checked };
    if (!data.name) throw new Error("Name required.");
    await call(p ? "products.update" : "products.create", data);
    loadProducts();
  });
}

// ---- Firmware ----
async function loadFirmwareTab() {
  const { products: p } = await call("products.list");
  products = p;
  const sel = $("fwProduct");
  sel.innerHTML = products.map((x) => `<option value="${x.id}">${esc(x.name)} (${x.chip})</option>`).join("");
  sel.onchange = loadFirmwareRows;
  if (products.length) loadFirmwareRows();
  else $("fwRows").innerHTML = emptyRow(5, "Add a product first.");
}
async function loadFirmwareRows() {
  const productId = $("fwProduct").value;
  const { firmwares: fws } = await call("firmwares.list", { product_id: productId });
  firmwares = fws;
  $("fwRows").innerHTML = fws.map((f) => `
    <tr>
      <td>${esc(f.version)}</td>
      <td><code>0x${(f.flash_address).toString(16)}</code></td>
      <td><code>${esc(f.storage_path)}</code></td>
      <td>${f.is_current ? '<span class="pill on">current</span>' :
        `<button class="icon-btn" data-cur="${f.id}">make current</button>`}</td>
      <td><div class="row-actions">
        <button class="icon-btn danger" data-del="${f.id}">Delete</button>
      </div></td>
    </tr>`).join("") || emptyRow(5, "No firmware yet.");
  $("fwRows").querySelectorAll("[data-cur]").forEach((b) =>
    b.onclick = async () => { await call("firmwares.setCurrent", { id: b.dataset.cur, product_id: productId }); loadFirmwareRows(); });
  $("fwRows").querySelectorAll("[data-del]").forEach((b) =>
    b.onclick = async () => { if (confirm("Delete this firmware?")) { await call("firmwares.delete", { id: b.dataset.del }); loadFirmwareRows(); } });
}
$("addFwBtn").onclick = () => uploadFirmware();

function uploadFirmware() {
  const productId = $("fwProduct").value;
  const prod = products.find((x) => x.id === productId);
  if (!prod) { alert("Add a product first."); return; }
  modal("Upload firmware — " + prod.name, `
    <div class="field"><label>Version</label><input id="m_ver" placeholder="1.0.0"></div>
    <div class="field"><label>Flash address (hex)</label><input id="m_addr" value="0x0"></div>
    <div class="field"><label>.bin file</label><input type="file" id="m_file" accept=".bin"></div>
    <div class="field"><label class="check"><input type="checkbox" id="m_cur" checked> Make this the current version</label></div>
  `, async () => {
    const ver = $("m_ver").value.trim();
    const file = $("m_file").files[0];
    if (!ver) throw new Error("Version required.");
    if (!file) throw new Error("Pick a .bin file.");
    const addr = parseInt($("m_addr").value, 16) || 0;
    const path = `${slug(prod.name)}/${ver}.bin`;

    // 1. get a signed upload URL, 2. PUT the file straight to private storage
    const up = await call("firmwares.uploadUrl", { path });
    const put = await fetch(up.url, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: file,
    });
    if (!put.ok) throw new Error("Upload failed (" + put.status + ").");

    // 3. record the firmware row
    await call("firmwares.create", {
      product_id: productId, version: ver, storage_path: up.path || path,
      flash_address: addr, is_current: $("m_cur").checked,
    });
    loadFirmwareRows();
  });
}

// ---- Licenses ----
async function loadLicenses() {
  const [{ licenses }, { products: p }] = [await call("licenses.list"), await call("products.list")];
  products = p;
  const nameOf = (id) => (products.find((x) => x.id === id)?.name) ?? "?";
  $("licRows").innerHTML = licenses.map((l) => `
    <tr>
      <td><code>${esc(l.key)}</code></td>
      <td>${esc(l.customer_name ?? "")}</td>
      <td>${l.used}/${fmtMax(l.max_flashes)}</td>
      <td>${l.product_ids.map((id) => esc(nameOf(id))).join(", ") || '<span class="hint">none</span>'}</td>
      <td>${statusPill(l.enabled)}</td>
      <td><div class="row-actions">
        <button class="icon-btn" data-edit="${l.id}">Edit</button>
        <button class="icon-btn danger" data-del="${l.id}">Delete</button>
      </div></td>
    </tr>`).join("") || emptyRow(6);
  $("licRows").querySelectorAll("[data-edit]").forEach((b) =>
    b.onclick = () => editLicense(licenses.find((x) => x.id === b.dataset.edit)));
  $("licRows").querySelectorAll("[data-del]").forEach((b) =>
    b.onclick = async () => { if (confirm("Delete this license?")) { await call("licenses.delete", { id: b.dataset.del }); loadLicenses(); } });
}
$("addLicBtn").onclick = () => editLicense(null);

function editLicense(l) {
  const checks = products.map((p) => `<label><input type="checkbox" value="${p.id}"
    ${l?.product_ids?.includes(p.id) ? "checked" : ""}> ${esc(p.name)}</label>`).join("");
  modal(l ? "Edit license" : "New license key", `
    <div class="field"><label>License key</label>
      <input id="m_key" value="${esc(l?.key ?? randKey())}" ${l ? "readonly" : ""}></div>
    <div class="field"><label>Customer name</label><input id="m_cust" value="${esc(l?.customer_name ?? "")}"></div>
    <div class="field"><label>Max devices (flash limit)</label>
      <input id="m_max" type="number" min="1" value="${(l && l.max_flashes < UNLIMITED) ? l.max_flashes : (l ? "" : 1)}" ${l?.max_flashes >= UNLIMITED ? "disabled" : ""}></div>
    <div class="field"><label class="check"><input type="checkbox" id="m_unlim" ${l?.max_flashes >= UNLIMITED ? "checked" : ""}
      onchange="document.getElementById('m_max').disabled=this.checked"> Unlimited devices (no limit)</label></div>
    <div class="field"><label class="check"><input type="checkbox" id="m_en" ${l?.enabled !== false ? "checked" : ""}> Enabled</label></div>
    <div class="field"><label>Allowed products</label><div class="checklist" id="m_prods">${checks || '<span class="hint">no products yet</span>'}</div></div>
  `, async () => {
    const key = $("m_key").value.trim();
    const max = $("m_unlim").checked ? UNLIMITED : (parseInt($("m_max").value, 10) || 1);
    const cust = $("m_cust").value.trim();
    const en = $("m_en").checked;
    const pids = [...$("m_prods").querySelectorAll("input:checked")].map((c) => c.value);
    if (!key) throw new Error("Key required.");
    let id = l?.id;
    if (l) await call("licenses.update", { id, customer_name: cust, max_flashes: max, enabled: en });
    else id = (await call("licenses.create", { key, customer_name: cust, max_flashes: max, enabled: en })).license.id;
    await call("licenses.setProducts", { id, product_ids: pids });
    loadLicenses();
  });
}

// ---- Requests ----
$("refreshReqs").onclick = loadRequests;
async function loadRequests() {
  const { requests } = await call("requests.list");
  const pending = requests.filter((r) => r.status === "pending");
  updateReqBadge(pending.length);
  $("reqRows").innerHTML = requests.map((r) => `
    <tr>
      <td>${new Date(r.created_at).toLocaleString()}</td>
      <td>${esc(r.customer_name ?? "")}</td>
      <td><code>${esc(r.license_key ?? "")}</code></td>
      <td>${esc(r.product_name)}</td>
      <td><b>${r.requested_count}</b></td>
      <td>${r.used}/${fmtMax(r.current_max)}</td>
      <td>${reqStatus(r.status)}</td>
      <td><div class="row-actions">${r.status === "pending"
        ? `<button class="icon-btn" data-appr="${r.id}">Approve</button>
           <button class="icon-btn danger" data-rej="${r.id}">Reject</button>`
        : ""}</div></td>
    </tr>`).join("") || emptyRow(8, "No requests yet.");
  $("reqRows").querySelectorAll("[data-appr]").forEach((b) =>
    b.onclick = () => approveRequest(requests.find((x) => x.id === b.dataset.appr)));
  $("reqRows").querySelectorAll("[data-rej]").forEach((b) =>
    b.onclick = async () => { if (confirm("Reject this request?")) { await call("requests.reject", { id: b.dataset.rej }); loadRequests(); } });
}

function approveRequest(r) {
  modal(`Approve request — ${esc(r.customer_name ?? r.license_key)}`, `
    <p class="hint">Requested <b>${r.requested_count}</b> flashes for <b>${esc(r.product_name)}</b>.
    They currently have ${r.used}/${fmtMax(r.current_max)}.</p>
    <div class="field"><label>Flashes to add to their limit</label>
      <input id="m_grant" type="number" min="1" value="${r.requested_count}"></div>
    <div class="field"><label class="check"><input type="checkbox" id="m_unlim"
      onchange="document.getElementById('m_grant').disabled=this.checked"> Grant UNLIMITED access instead</label></div>
  `, async () => {
    const unlimited = $("m_unlim").checked;
    const grant = parseInt($("m_grant").value, 10);
    if (!unlimited && (!grant || grant < 1)) throw new Error("Enter a number or tick unlimited.");
    await call("requests.approve", { id: r.id, grant, unlimited });
    loadRequests();
  });
}

function reqStatus(s) {
  if (s === "pending") return '<span class="pill pending">pending</span>';
  if (s === "approved") return '<span class="pill on">approved</span>';
  return '<span class="pill off">rejected</span>';
}
function updateReqBadge(n) {
  const b = $("reqBadge");
  b.textContent = n;
  b.classList.toggle("hidden", n === 0);
}

// Check pending count on login so the badge shows immediately.
async function refreshReqBadge() {
  try { const { requests } = await call("requests.list");
    updateReqBadge(requests.filter((r) => r.status === "pending").length); } catch (_) {}
}

// ---- Logs ----
$("refreshLogs").onclick = loadLogs;
async function loadLogs() {
  const { logs } = await call("logs.list");
  $("logRows").innerHTML = logs.map((g) => `
    <tr>
      <td>${new Date(g.created_at).toLocaleString()}</td>
      <td><code>${esc(g.chip_mac ?? "")}</code></td>
      <td>${g.status === "success" ? '<span class="pill on">success</span>' : '<span class="pill off">' + esc(g.status) + '</span>'}</td>
      <td class="hint">${esc(g.error ?? "")}</td>
    </tr>`).join("") || emptyRow(4, "No flashes yet.");
}

// ---- Modal helper ----
let modalSaveFn = null;
function modal(title, bodyHtml, onSave) {
  $("modalTitle").textContent = title;
  $("modalBody").innerHTML = bodyHtml;
  $("modalErr").textContent = "";
  modalSaveFn = onSave;
  $("modal").classList.remove("hidden");
}
$("modalCancel").onclick = () => $("modal").classList.add("hidden");
$("modalSave").onclick = async () => {
  try { await modalSaveFn(); $("modal").classList.add("hidden"); }
  catch (e) { $("modalErr").textContent = e.message; }
};

// ---- utils ----
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function statusPill(on) { return on ? '<span class="pill on">enabled</span>' : '<span class="pill off">disabled</span>'; }
function emptyRow(cols, msg = "Nothing yet.") { return `<tr><td colspan="${cols}" class="hint">${msg}</td></tr>`; }
function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }
function randKey() {
  const p = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${p()}-${p()}-${p()}-${p()}`;
}
