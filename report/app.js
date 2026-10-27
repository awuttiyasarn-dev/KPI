"use strict";
/* ===== 1. CONFIG ===== */
const API_URL = "https://script.google.com/macros/s/AKfycbyDVuHOl48Fke6Sb7D-MsVSUC4lPlOpe03mw63JdNtn9OU5Y1cGW_64Ly15JUA4p4qF/exec";
const IMPORT_BATCH = 500;

const state = {
  sheets: [], currentSheet: "", currentPage: 1, pageSize: 25, search: "",
  currentHeader: [], currentRows: [], totalRows: 0, totalPages: 0,
  distributionChart: null, sheetChart: null, exportData: null,
  workbookRows: [], workbookHeader: [], workbookName: "", importing: false
};
const $ = id => document.getElementById(id);
const PAGE_INFO = {
  dashboard: ["ภาพรวมข้อมูล", "ภาพรวม Google Spreadsheet และข้อมูลทั้งหมด"],
  database: ["สำรวจข้อมูล", "ค้นหา ดูตาราง และวิเคราะห์ข้อมูล"],
  sheets: ["รายการ Sheets", "จัดการและสำรวจทุก Sheet"],
  upload: ["นำเข้าข้อมูล", "อัปโหลด Excel/CSV ไปยัง Google Sheets"],
  export: ["ส่งออกข้อมูล", "ดาวน์โหลดข้อมูลเป็น Excel, CSV และ JSON"]
};

/* ===== 2. API CLIENT (POST + รหัสเข้าใช้งาน) ===== */
let ACCESS_KEY = sessionStorage.getItem("reportKey") || "";

async function api(action, params = {}) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, key: ACCESS_KEY, params })
  });
  let data;
  try { data = await res.json(); }
  catch (_) { throw new Error("เรียก API ไม่สำเร็จ กรุณาตรวจสอบ URL และการ Deploy (ต้องเป็น Anyone)"); }
  if (!data || data.ok === false) throw new Error((data && data.error) || "API ทำงานไม่สำเร็จ");
  return data;
}

async function ensureKey() {
  while (true) {
    if (!ACCESS_KEY) {
      ACCESS_KEY = (prompt("ใส่รหัสเข้าใช้งานระบบ") || "").trim();
      if (!ACCESS_KEY) throw new Error("ต้องใส่รหัสเข้าใช้งาน");
    }
    try {
      await api("health");
      sessionStorage.setItem("reportKey", ACCESS_KEY);
      return;
    } catch (err) {
      if (!/รหัส/.test(err.message)) throw err;
      ACCESS_KEY = "";
      sessionStorage.removeItem("reportKey");
      alert("รหัสเข้าใช้งานไม่ถูกต้อง");
    }
  }
}

/* ===== 3. UTILITIES ===== */
function escapeHtml(v) {
  return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
const formatNumber = v => Number(v || 0).toLocaleString("th-TH");
function setStatus(text, type = "") { $("statusText").textContent = text; $("statusDot").className = "dot" + (type ? " " + type : ""); }
function setNotice(id, msg, type = "info") { $(id).innerHTML = '<div class="notice ' + type + '">' + escapeHtml(msg) + "</div>"; }
function clearNotice(id) { $(id).innerHTML = ""; }
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function csvEscape(v) {
  let t = String(v == null ? "" : v);
  if (/^\s*[=+@]/.test(t) || /^\s*-[0-9]/.test(t)) t = "'" + t;
  return '"' + t.replace(/"/g, '""') + '"';
}
const rowsToCsv = (h, rows) => "\uFEFF" + [h, ...rows].map(r => r.map(csvEscape).join(",")).join("\r\n");
function dateStamp() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("");
}
const safeFilename = v => String(v || "report").replace(/[\\/:*?"<>|]/g, "_");

/* ===== 4. NAVIGATION ===== */
function showView(name) {
  if (!PAGE_INFO[name]) return;
  document.querySelectorAll(".view").forEach(el => el.classList.toggle("active", el.id === "view-" + name));
  document.querySelectorAll(".nav-btn[data-view]").forEach(el => el.classList.toggle("active", el.dataset.view === name));
  $("pageTitle").textContent = PAGE_INFO[name][0];
  $("pageSubtitle").textContent = PAGE_INFO[name][1];
  $("sidebar").classList.remove("open");
  if (name === "database" && state.sheets.length) selectSheet(state.currentSheet || state.sheets[0].name).catch(showError);
  if (name === "export" && !state.exportData) loadExportData().catch(showError);
}
document.querySelectorAll(".nav-btn[data-view]").forEach(b => b.addEventListener("click", () => showView(b.dataset.view)));
$("mobileMenu").addEventListener("click", () => $("sidebar").classList.toggle("open"));

/* ===== 5. SHEETS ===== */
async function loadSheets() {
  setStatus("กำลังโหลด");
  const result = await api("sheets");
  state.sheets = Array.isArray(result.sheets) ? result.sheets : [];
  updateSheetSelectors(); renderDashboardSheets(); renderSheetsTable(); renderSheetChart();
  const rows = state.sheets.reduce((s, i) => s + Number(i.rows || 0), 0);
  const cols = state.sheets.reduce((s, i) => s + Number(i.columns || 0), 0);
  $("kpiSheets").textContent = formatNumber(state.sheets.length);
  $("kpiRows").textContent = formatNumber(rows);
  $("kpiColumns").textContent = formatNumber(cols);
  $("lastUpdated").textContent = "อัปเดต " + new Date().toLocaleTimeString("th-TH");
  $("sideVersion").textContent = state.sheets.length + " Sheets loaded";
  setStatus("เชื่อมต่อแล้ว", "ok");
  return result;
}

function updateSheetSelectors() {
  ["dataSheet", "importSheet"].forEach(id => {
    const sel = $(id), prev = sel.value;
    sel.innerHTML = "";
    if (!state.sheets.length) { sel.add(new Option("ไม่พบ Sheet", "")); return; }
    sel.add(new Option("เลือก Sheet", ""));
    state.sheets.forEach(i => sel.add(new Option(i.name, i.name)));
    if (state.sheets.some(i => i.name === prev)) sel.value = prev;
  });
  const ex = $("exportSheet"), prevEx = ex.value;
  ex.innerHTML = "";
  ex.add(new Option("ทุก Sheet", ""));
  state.sheets.forEach(i => ex.add(new Option(i.name, i.name)));
  if (state.sheets.some(i => i.name === prevEx)) ex.value = prevEx;

  if (!state.sheets.some(i => i.name === state.currentSheet)) state.currentSheet = state.sheets.length ? state.sheets[0].name : "";
  $("dataSheet").value = state.currentSheet;
}

function bindOpenSheet(root) {
  root.querySelectorAll("[data-open-sheet]").forEach(b => b.addEventListener("click", () => {
    showView("database");
    selectSheet(b.dataset.openSheet).catch(showError);
  }));
}

function renderDashboardSheets() {
  const t = $("dashboardSheetList");
  if (!state.sheets.length) { t.innerHTML = '<div class="table-empty">ไม่พบ Sheet ใน Spreadsheet</div>'; return; }
  t.innerHTML = state.sheets.map(i => `
    <button class="sheet-item" data-open-sheet="${escapeHtml(i.name)}">
      <div style="min-width:0"><div class="sheet-item-name">${escapeHtml(i.name)}</div>
      <div class="sheet-item-meta">${formatNumber(i.rows)} แถว · ${formatNumber(i.columns)} คอลัมน์</div></div>
      <span style="color:#2474d2">→</span></button>`).join("");
  bindOpenSheet(t);
}

function renderSheetsTable() {
  const t = $("sheetsTableBody"), f = $("sheetFilter").value.trim().toLowerCase();
  const items = state.sheets.filter(i => i.name.toLowerCase().includes(f));
  if (!items.length) { t.innerHTML = '<tr><td colspan="5" class="table-empty">ไม่พบ Sheet ที่ตรงกับคำค้นหา</td></tr>'; return; }
  t.innerHTML = items.map((i, n) => `
    <tr><td>${n + 1}</td><td><span class="sheet-chip">${escapeHtml(i.name)}</span></td>
    <td>${formatNumber(i.rows)}</td><td>${formatNumber(i.columns)}</td>
    <td><button class="btn btn-light" data-open-sheet="${escapeHtml(i.name)}">เปิดข้อมูล</button></td></tr>`).join("");
  bindOpenSheet(t);
}

function barOptions() {
  return {
    indexAxis: "y", responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { x: { beginAtZero: true }, y: { ticks: { autoSkip: false, font: { size: 10 } } } }
  };
}

function renderSheetChart() {
  if (state.sheetChart) { state.sheetChart.destroy(); state.sheetChart = null; }
  if (!state.sheets.length) return;
  const sorted = [...state.sheets].sort((a, b) => Number(b.rows || 0) - Number(a.rows || 0)).slice(0, 15);
  state.sheetChart = new Chart($("sheetChart"), {
    type: "bar",
    data: { labels: sorted.map(i => i.name), datasets: [{ label: "จำนวนแถวข้อมูล", data: sorted.map(i => Number(i.rows || 0)), backgroundColor: "#2474d2", borderRadius: 5, maxBarThickness: 28 }] },
    options: barOptions()
  });
}

/* ===== 6. HEALTH ===== */
async function checkHealth() {
  try {
    const r = await api("health");
    $("kpiConnection").textContent = "Online";
    $("healthService").textContent = r.service || "REPORT API";
    $("healthSpreadsheet").textContent = r.spreadsheet || "เชื่อมต่อแล้ว";
    $("healthSheets").textContent = formatNumber(r.sheetCount);
    $("healthTime").textContent = new Date().toLocaleString("th-TH");
    setStatus("เชื่อมต่อแล้ว", "ok");
    return r;
  } catch (err) {
    $("kpiConnection").textContent = "Offline";
    $("healthService").textContent = "ไม่สามารถเชื่อมต่อ";
    $("healthTime").textContent = new Date().toLocaleString("th-TH");
    setStatus("เชื่อมต่อไม่สำเร็จ", "error");
    throw err;
  }
}

/* ===== 7. TABLE + PAGINATION ===== */
async function selectSheet(name) {
  if (!name) return;
  if (name !== state.currentSheet) { state.currentPage = 1; $("searchInput").value = ""; }
  state.currentSheet = name;
  $("dataSheet").value = name;
  await loadTableData();
}

async function loadTableData() {
  const name = $("dataSheet").value || state.currentSheet;
  if (!name) return;
  state.currentSheet = name;
  state.pageSize = Number($("pageSize").value) || 25;
  state.search = $("searchInput").value.trim();
  $("dataSheetBadge").textContent = name;

  const r = await api("data", { sheet: name, page: state.currentPage, pageSize: state.pageSize, search: state.search });
  state.currentHeader = Array.isArray(r.header) ? r.header : [];
  state.currentRows = Array.isArray(r.rows) ? r.rows : [];
  state.totalRows = Number(r.total || 0);
  state.totalPages = Number(r.totalPages ?? r.pages ?? 0);
  state.currentPage = Number(r.page || 1);
  renderDataTable(); renderDistributionColumns(); updatePagination();
}

function renderDataTable() {
  const t = $("dataTable");
  if (!state.currentHeader.length) { t.innerHTML = '<tbody><tr><td class="table-empty">Sheet นี้ยังไม่มีข้อมูล</td></tr></tbody>'; return; }
  const head = "<thead><tr>" + state.currentHeader.map((n, i) => `<th title="${escapeHtml(n)}">${escapeHtml(n || "Column " + (i + 1))}</th>`).join("") + "</tr></thead>";
  const body = state.currentRows.length
    ? "<tbody>" + state.currentRows.map(r => "<tr>" + state.currentHeader.map((_, i) => `<td title="${escapeHtml(r[i] ?? "")}">${escapeHtml(r[i] ?? "")}</td>`).join("") + "</tr>").join("") + "</tbody>"
    : `<tbody><tr><td class="table-empty" colspan="${state.currentHeader.length}">ไม่พบข้อมูลที่ตรงกับคำค้นหา</td></tr></tbody>`;
  t.innerHTML = head + body;
}

function updatePagination() {
  const start = state.totalRows ? (state.currentPage - 1) * state.pageSize + 1 : 0;
  const end = Math.min(state.currentPage * state.pageSize, state.totalRows);
  $("tableInfo").textContent = `แสดง ${formatNumber(start)}–${formatNumber(end)} จาก ${formatNumber(state.totalRows)} แถว`;
  $("pageInfo").textContent = `หน้า ${state.currentPage} / ${Math.max(1, state.totalPages)}`;
  $("btnPrev").disabled = state.currentPage <= 1;
  $("btnNext").disabled = state.totalPages === 0 || state.currentPage >= state.totalPages;
}

function renderDistributionColumns() {
  const sel = $("distributionColumn"), prev = sel.value;
  sel.innerHTML = "";
  if (!state.currentHeader.length) { sel.add(new Option("ไม่มีคอลัมน์", "")); return; }
  state.currentHeader.forEach((h, i) => sel.add(new Option(h || "Column " + (i + 1), String(i))));
  if (prev !== "" && Number(prev) < state.currentHeader.length) sel.value = prev;
}

async function searchCurrent() { state.currentPage = 1; await loadTableData(); }

/* ===== 8. DISTRIBUTION ===== */
async function loadDistribution() {
  const sheet = $("dataSheet").value || state.currentSheet, col = $("distributionColumn").value;
  if (!sheet || col === "") throw new Error("กรุณาเลือก Sheet และคอลัมน์ก่อน");
  const r = await api("distribution", { sheet, columnIndex: Number(col) });
  const items = Array.isArray(r.items) ? r.items : [];
  if (state.distributionChart) { state.distributionChart.destroy(); state.distributionChart = null; }
  state.distributionChart = new Chart($("distributionChart"), {
    type: "bar",
    data: { labels: items.map(i => String(i[0])), datasets: [{ label: "ความถี่", data: items.map(i => Number(i[1])), backgroundColor: "#16b8c9", borderRadius: 5, maxBarThickness: 36 }] },
    options: barOptions()
  });
  $("distributionInfo").textContent = `คอลัมน์ ${r.column || ""} · รวม ${formatNumber(r.total)} ค่า · แสดงไม่เกิน ${formatNumber(items.length)} รายการ`;
}

/* ===== 9. READ EXCEL / CSV ===== */
function resetUpload() {
  state.workbookRows = []; state.workbookHeader = []; state.workbookName = "";
  $("fileInput").value = "";
  $("fileName").textContent = "ยังไม่ได้เลือกไฟล์";
  $("previewInfo").textContent = "เลือกไฟล์เพื่อดูตัวอย่าง";
  $("previewTable").innerHTML = '<tbody><tr><td class="table-empty">ยังไม่มีข้อมูลตัวอย่าง</td></tr></tbody>';
  $("btnImport").disabled = true;
  $("importProgress").style.width = "0%";
  $("progressText").textContent = "รอการนำเข้า";
  clearNotice("importResult");
}

async function readUploadFile(file) {
  if (!file) return;
  const ext = file.name.split(".").pop().toLowerCase();
  if (!["xlsx", "xls", "csv"].includes(ext)) throw new Error("รองรับเฉพาะไฟล์ .xlsx, .xls และ .csv");
  if (file.size > 50 * 1024 * 1024) throw new Error("ไฟล์มีขนาดเกิน 50 MB กรุณาแบ่งไฟล์ก่อนนำเข้า");
  if (!window.XLSX) throw new Error("ไม่สามารถโหลดไลบรารีอ่าน Excel ได้");

  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", raw: false, cellDates: false });
  if (!wb.SheetNames.length) throw new Error("ไม่พบ Sheet ภายในไฟล์");
  const matrix = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: false, blankrows: false });
  if (!matrix.length) throw new Error("ไฟล์ไม่มีข้อมูล");

  const header = matrix[0].map(v => String(v ?? "").trim());
  if (!header.length || header.every(v => v === "")) throw new Error("ไม่พบแถวหัวคอลัมน์ในไฟล์");

  const rows = matrix.slice(1)
    .filter(r => r.some(v => String(v ?? "").trim() !== ""))
    .map(r => { const n = r.slice(0, header.length); while (n.length < header.length) n.push(""); return n.map(v => String(v ?? "")); });
  if (!rows.length) throw new Error("ไม่พบแถวข้อมูลใต้หัวคอลัมน์");

  state.workbookHeader = header; state.workbookRows = rows; state.workbookName = file.name;
  $("fileName").textContent = `${file.name} · ${formatNumber(rows.length)} แถว · ${header.length} คอลัมน์`;
  $("previewInfo").textContent = `Sheet ต้นทาง: ${wb.SheetNames[0]} · แสดงตัวอย่างไม่เกิน 10 แถว`;
  renderPreviewTable();
  $("btnImport").disabled = false;
  clearNotice("importResult");
}

function renderPreviewTable() {
  const h = state.workbookHeader, rows = state.workbookRows.slice(0, 10);
  $("previewTable").innerHTML =
    "<thead><tr>" + h.map(v => `<th>${escapeHtml(v)}</th>`).join("") + "</tr></thead>" +
    "<tbody>" + rows.map(r => "<tr>" + h.map((_, i) => `<td>${escapeHtml(r[i] ?? "")}</td>`).join("") + "</tr>").join("") + "</tbody>";
}

/* ===== 10. IMPORT ===== */
async function importFile() {
  if (state.importing) return;
  if (!state.workbookHeader.length || !state.workbookRows.length) throw new Error("กรุณาเลือกไฟล์และตรวจสอบข้อมูลก่อน");

  const token = $("writeToken").value.trim();
  if (!token) throw new Error("กรุณาใส่ Write Token");

  const newName = $("newSheetName").value.trim();
  const sheetName = newName || $("importSheet").value;
  if (!sheetName) throw new Error("กรุณาเลือก Sheet ปลายทางหรือระบุชื่อ Sheet ใหม่");
  if (sheetName.length > 100 || /[\[\]\*\/\\\?\:]/.test(sheetName)) throw new Error("ชื่อ Sheet ไม่ถูกต้อง");

  const isNew = !state.sheets.some(i => i.name === sheetName);
  const replace = $("replaceData").checked;

  const ok = window.confirm(replace
    ? `ยืนยันแทนที่ข้อมูลเดิมใน Sheet "${sheetName}" หรือไม่?\nข้อมูลเดิมจะถูกล้างก่อนนำเข้า`
    : `ยืนยันนำเข้าข้อมูล ${state.workbookRows.length} แถวไปยัง Sheet "${sheetName}" หรือไม่?`);
  if (!ok) return;

  state.importing = true;
  $("btnImport").disabled = true;
  $("importProgress").style.width = "0%";
  $("progressText").textContent = "กำลังเริ่มนำเข้า...";
  clearNotice("importResult");

  try {
    if (isNew) await api("createSheet", { token, sheet: sheetName, header: state.workbookHeader });

    const rows = state.workbookRows, total = Math.ceil(rows.length / IMPORT_BATCH);
    let imported = 0;

    for (let b = 0; b < total; b++) {
      const batch = rows.slice(b * IMPORT_BATCH, (b + 1) * IMPORT_BATCH);
      await api("import", {
        token,
        payload: { sheet: sheetName, header: state.workbookHeader, rows: batch, replace: replace && b === 0 && !isNew }
      });
      imported += batch.length;
      const pct = Math.round(imported / rows.length * 100);
      $("importProgress").style.width = pct + "%";
      $("progressText").textContent = `นำเข้าแล้ว ${formatNumber(imported)} / ${formatNumber(rows.length)} แถว (${pct}%)`;
    }

    setNotice("importResult", `นำเข้าสำเร็จ: ${formatNumber(imported)} แถว ไปยัง Sheet "${sheetName}"`, "success");
    state.currentSheet = sheetName; state.currentPage = 1;
    $("searchInput").value = ""; $("newSheetName").value = "";
    state.exportData = null;
    await loadSheets();
    $("importSheet").value = sheetName;
    await loadTableData();
  } catch (err) {
    setNotice("importResult", err.message || String(err), "error");
    throw err;
  } finally {
    state.importing = false;
    $("btnImport").disabled = !state.workbookRows.length;
  }
}

/* ===== 11. EXPORT ===== */
function setExportButtons(on) { ["btnExportXlsx", "btnExportCsv", "btnExportJson"].forEach(id => $(id).disabled = !on); }

async function loadExportData() {
  $("exportStatus").textContent = "กำลังโหลด";
  $("btnLoadExport").disabled = true;
  try {
    const sheet = $("exportSheet").value;
    const r = await api("export", sheet ? { sheet } : {});
    state.exportData = Array.isArray(r.sheets) ? r.sheets : [];
    const total = state.exportData.reduce((s, i) => s + (i.rows || []).length, 0);
    $("exportSheetCount").textContent = formatNumber(state.exportData.length);
    $("exportRowCount").textContent = formatNumber(total);
    $("exportStatus").textContent = "พร้อมส่งออก";
    setExportButtons(state.exportData.length > 0);
    $("btnExportCsv").disabled = state.exportData.length !== 1;
    const w = Array.isArray(r.warnings) ? r.warnings : [];
    $("exportWarnings").innerHTML = w.length ? '<div class="notice warn">' + w.map(escapeHtml).join("<br>") + "</div>" : "";
    return r;
  } finally {
    $("btnLoadExport").disabled = false;
  }
}

function exportXlsx() {
  if (!state.exportData) throw new Error("กรุณาโหลดข้อมูลก่อนส่งออก");
  const wb = XLSX.utils.book_new();
  state.exportData.forEach(item => {
    const ws = XLSX.utils.aoa_to_sheet([item.header || [], ...(item.rows || [])]);
    let name = String(item.name || "Sheet").slice(0, 31).replace(/[\[\]\*\/\\\?\:]/g, "_");
    const base = name; let n = 1;
    while (wb.SheetNames.includes(name)) { const s = "_" + n++; name = base.slice(0, 31 - s.length) + s; }
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  XLSX.writeFile(wb, "REPORT_export_" + dateStamp() + ".xlsx");
}

function exportCsv() {
  if (!state.exportData || state.exportData.length !== 1) throw new Error("CSV ส่งออกได้ครั้งละ 1 Sheet กรุณาเลือก Sheet แล้วโหลดข้อมูลใหม่");
  const item = state.exportData[0];
  downloadBlob(new Blob([rowsToCsv(item.header || [], item.rows || [])], { type: "text/csv;charset=utf-8;" }),
    safeFilename(item.name) + "_" + dateStamp() + ".csv");
}

function exportJson() {
  if (!state.exportData) throw new Error("กรุณาโหลดข้อมูลก่อนส่งออก");
  downloadBlob(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), sheets: state.exportData }, null, 2)], { type: "application/json;charset=utf-8;" }),
    "REPORT_export_" + dateStamp() + ".json");
}

/* ===== 12. EVENTS ===== */
const on = (id, ev, fn) => $(id).addEventListener(ev, fn);
const guard = fn => () => { try { const r = fn(); if (r && r.catch) r.catch(showError); } catch (e) { showError(e); } };

on("btnCheckHealth", "click", guard(checkHealth));
on("navHealth", "click", guard(checkHealth));
on("navRefresh", "click", guard(async () => { await loadSheets(); await checkHealth(); if (state.currentSheet) await loadTableData(); }));
on("btnReloadSheets", "click", guard(loadSheets));
on("btnRefreshSheetList", "click", guard(loadSheets));
on("sheetFilter", "input", renderSheetsTable);
on("dataSheet", "change", e => selectSheet(e.target.value).catch(showError));
on("btnSearch", "click", guard(searchCurrent));
on("searchInput", "keydown", e => { if (e.key === "Enter") searchCurrent().catch(showError); });
on("pageSize", "change", () => { state.currentPage = 1; loadTableData().catch(showError); });
on("btnPrev", "click", guard(async () => { if (state.currentPage > 1) { state.currentPage--; await loadTableData(); } }));
on("btnNext", "click", guard(async () => { if (state.currentPage < state.totalPages) { state.currentPage++; await loadTableData(); } }));
on("btnDistribution", "click", guard(loadDistribution));
on("btnChooseFile", "click", () => $("fileInput").click());
on("fileInput", "change", async e => {
  try { const f = e.target.files && e.target.files[0]; if (f) await readUploadFile(f); }
  catch (err) { setNotice("importResult", err.message || String(err), "error"); }
});
on("btnClearFile", "click", resetUpload);
on("btnImport", "click", guard(importFile));
on("dropZone", "dragover", e => { e.preventDefault(); $("dropZone").classList.add("drag"); });
on("dropZone", "dragleave", () => $("dropZone").classList.remove("drag"));
on("dropZone", "drop", async e => {
  e.preventDefault(); $("dropZone").classList.remove("drag");
  const f = e.dataTransfer.files[0]; if (!f) return;
  try { await readUploadFile(f); } catch (err) { setNotice("importResult", err.message || String(err), "error"); }
});
on("btnLoadExport", "click", guard(loadExportData));
on("exportSheet", "change", () => { state.exportData = null; $("exportStatus").textContent = "รอโหลด"; setExportButtons(false); });
on("btnExportXlsx", "click", guard(exportXlsx));
on("btnExportCsv", "click", guard(exportCsv));
on("btnExportJson", "click", guard(exportJson));

/* ===== 13. ERRORS ===== */
function showError(err) {
  const msg = err && err.message ? err.message : String(err || "เกิดข้อผิดพลาด");
  setStatus("พบข้อผิดพลาด", "error");
  console.error("[REPORT]", err);
  if ($("view-upload").classList.contains("active")) {
    if (!$("importResult").innerHTML) setNotice("importResult", msg, "error");
  } else {
    alert("เกิดข้อผิดพลาด\n\n" + msg);
  }
}

/* ===== 14. INIT ===== */
async function init() {
  try {
    setStatus("กำลังเชื่อมต่อ");
    await ensureKey();
    await checkHealth();
    await loadSheets();
  } catch (err) {
    setStatus("เชื่อมต่อไม่สำเร็จ", "error");
    $("kpiConnection").textContent = "Offline";
    console.error(err);
    const m = escapeHtml(err.message || String(err));
    $("dashboardSheetList").innerHTML = '<div class="notice error">' + m + "</div>";
    $("sheetsTableBody").innerHTML = '<tr><td colspan="5" class="table-empty">' + m + "</td></tr>";
  }
}
init();
