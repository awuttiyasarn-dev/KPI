"use strict";

/* ============================================================
 * REPORT KPI DASHBOARD (revised)
 * API   : Google Apps Script Web App
 * Sheet : REPORT_02
 *
 * หมายเหตุด้านความปลอดภัย:
 * ไฟล์นี้ทำงานฝั่งไคลเอนต์ ใครเปิดซอร์สก็เห็น API_URL และ ACCESS_KEY
 * จึงควรตรวจสอบสิทธิ์ (เช่น จำกัดผู้ใช้/โดเมน, ตรวจ key) ที่ฝั่ง Apps Script
 * ห้ามใส่ความลับจริงไว้ในไฟล์นี้
 * ============================================================ */

const CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbyDVuHOl48Fke6Sb7D-MsVSUC4lPlOpe03mw63JdNtn9OU5Y1cGW_64Ly15JUA4p4qF/exec",
  SHEET_NAME: "REPORT_02",
  ACCESS_KEY: "",
  PAGE_SIZE: 100,
  MAX_PAGES: 100,
  TABLE_PAGE_SIZE: 15,
  BACK_URL: "./index.html",
  CASE_URL: "./KPI_CASE.html",
  EXCLUDED_STATUS: ["ระหว่างดำเนินการ"]
};

const STATE = {
  allRows: [],
  filteredRows: [],
  page: 1,

  trendChart: null,
  statusChart: null,
  excellenceChart: null,
  sectionChart: null,

  tableRows: [],
  colFilters: {},
  loading: false
};

const $ = id => document.getElementById(id);

// ผูก event แบบปลอดภัย: ถ้าไม่มี element จะข้าม ไม่ทำให้สคริปต์ล้ม
const on = (id, evt, fn) => {
  const el = $(id);
  if (el) el.addEventListener(evt, fn);
};

// สีของสถานะ ใช้ร่วมกันทุกกราฟ
const STATUS_COLORS = {
  "ผ่าน": "#0b7a5a",
  "ไม่ผ่าน": "#d64545",
  "ไม่ระบุสถานะ": "#94a3b8",
  "ยังไม่ได้กรอกข้อมูล": "#f0a93b",
  "ระหว่างดำเนินการ": "#64748b"
};

const EXTRA_COLORS = [
  "#4285f4", "#9b59b6", "#16a6a1", "#e17055",
  "#6c8ebf", "#b07aa1", "#59a14f", "#edc948"
];

/* ============================================================
   FIELD MAPPING
============================================================ */

const FIELD = {
  year: ["Fisyear", "FisYear", "Fiscal_year", "FiscalYear"],
  group: ["kpi_Group_Des", "KPI_Group", "Group"],
  excellence: ["Excellence", "Excellence_Des"],
  section: ["Tsection", "Section", "หน่วยงาน"],
  kpi: ["KPI", "KPI_ID", "Kpi"],
  description: ["kpi_Des", "KPI_Des", "Description"],
  result: ["Result"],
  target: ["Target"],
  criterion: ["Criterion", "Criteria", "criterion"],
  rate: ["Rate", "Nrate"],
  unit: ["Nunit", "Unit"],
  summary: ["Summary", "Status"]
};

function getField(row, aliases) {
  if (!row || typeof row !== "object") return "";

  for (const a of aliases) {
    if (row[a] != null && String(row[a]).trim() !== "") {
      return row[a];
    }
  }

  const keys = Object.keys(row);

  for (const a of aliases) {
    const k = keys.find(i => i.toLowerCase() === a.toLowerCase());

    if (k && row[k] != null && String(row[k]).trim() !== "") {
      return row[k];
    }
  }

  return "";
}

const fieldValue = (row, name) => getField(row, FIELD[name] || [name]);

function escapeHTML(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[c]);
}

function setConnectionStatus(msg, type = "normal") {
  if ($("connectionStatus")) {
    $("connectionStatus").textContent = msg;
  }

  const dot = $("statusDot");

  if (dot) {
    dot.className = "status-dot";

    if (type === "success") dot.classList.add("success");
    if (type === "error") dot.classList.add("error");
  }
}

/* ============================================================
   STATUS
============================================================ */

function getStatus(row) {
  return String(fieldValue(row, "summary") ?? "").trim()
    || "ไม่ระบุสถานะ";
}

function statusClass(status) {
  if (status === "ผ่าน") return "pass";
  if (status === "ไม่ผ่าน") return "fail";
  return "";
}

/* ============================================================
   API
============================================================ */

async function requestPage(page) {
  const res = await fetch(CONFIG.API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      action: "data",
      key: CONFIG.ACCESS_KEY,
      params: {
        sheet: CONFIG.SHEET_NAME,
        page,
        pageSize: CONFIG.PAGE_SIZE,
        limit: CONFIG.PAGE_SIZE
      }
    }),
    redirect: "follow",
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error("API ตอบกลับ HTTP " + res.status);
  }

  const data = await res.json();

  if (!data || data.ok === false || data.success === false || data.error) {
    throw new Error(
      data?.message || data?.error || "ไม่สามารถอ่านข้อมูลจาก API ได้"
    );
  }

  const headers = data.headers || data.header || [];
  const rows = data.rows || [];

  const objects = rows.map(row => {
    if (!Array.isArray(row)) return row;

    const item = {};
    headers.forEach((h, i) => { item[h] = row[i]; });
    return item;
  });

  return {
    rows: objects,
    count: rows.length,
    total: data.total ?? data.totalRows ?? data.count ?? null
  };
}

/* ============================================================
   LOAD DATABASE
============================================================ */

async function loadDatabase() {
  if (STATE.loading) return;

  STATE.loading = true;

  const refreshButton = $("refreshButton");
  if (refreshButton) refreshButton.disabled = true;

  setConnectionStatus("กำลังโหลดข้อมูลจาก REPORT_02...");

  try {
    const combined = [];
    let totalFromApi = null;

    for (let page = 1; page <= CONFIG.MAX_PAGES; page++) {
      const result = await requestPage(page);

      combined.push(...result.rows);

      if (result.total !== null) {
        const total = Number(result.total);
        if (Number.isFinite(total)) totalFromApi = total;
      }

      if (result.count < CONFIG.PAGE_SIZE) break;

      if (totalFromApi !== null && combined.length >= totalFromApi) break;
    }

    STATE.allRows = combined.filter(
      row => !CONFIG.EXCLUDED_STATUS.includes(getStatus(row))
    );

    // รีเซ็ตตัวกรองคอลัมน์เมื่อโหลดฐานข้อมูลใหม่
    STATE.colFilters = {};

    populateFilters();
    renderDashboard();

    if ($("lastUpdated")) {
      $("lastUpdated").textContent =
        "อัปเดต " + new Date().toLocaleString("th-TH");
    }

    setConnectionStatus(
      `เชื่อมต่อสำเร็จ · โหลดข้อมูล ${STATE.allRows.length.toLocaleString("th-TH")} รายการ`,
      "success"
    );

  } catch (error) {
    console.error("[KPI] API error:", error);

    setConnectionStatus("เชื่อมต่อไม่สำเร็จ: " + error.message, "error");

    if ($("kpiTableBody")) {
      $("kpiTableBody").innerHTML = `
        <tr>
          <td colspan="12" class="empty-state">
            โหลดข้อมูลไม่ได้ กรุณาตรวจสอบ API และสิทธิ์การเข้าถึง
            <br>
            ${escapeHTML(error.message)}
          </td>
        </tr>
      `;
    }

    ["totalKpi", "passedKpi", "failedKpi", "pendingKpi", "passRate"].forEach(id => {
      if ($(id)) $(id).textContent = "—";
    });

  } finally {
    STATE.loading = false;
    if (refreshButton) refreshButton.disabled = false;
  }
}

/* ============================================================
   FILTER OPTIONS
============================================================ */

function populateFilters() {
  const ys = $("yearFilter");
  const gs = $("groupFilter");

  if (!ys || !gs) return;

  const oldY = ys.value;
  const oldG = gs.value;

  const years = [
    ...new Set(
      STATE.allRows
        .map(r => String(fieldValue(r, "year") || "").trim())
        .filter(Boolean)
    )
  ].sort((a, b) => Number(b) - Number(a));

  const groups = [
    ...new Set(
      STATE.allRows.map(
        r => String(fieldValue(r, "group") || "ไม่ระบุกลุ่ม").trim()
      )
    )
  ].sort((a, b) => a.localeCompare(b, "th"));

  ys.innerHTML =
    '<option value="all">ทุกปีงบประมาณ</option>' +
    years.map(y =>
      `<option value="${escapeHTML(y)}">${escapeHTML(y)}</option>`
    ).join("");

  gs.innerHTML =
    '<option value="all">ทุกกลุ่มตัวชี้วัด</option>' +
    groups.map(g =>
      `<option value="${escapeHTML(g)}">${escapeHTML(g)}</option>`
    ).join("");

  if (years.includes(oldY)) ys.value = oldY;
  if (groups.includes(oldG)) gs.value = oldG;
}

/* ============================================================
   MAIN FILTER
============================================================ */

function getFilteredRows(skip = "") {
  const year = $("yearFilter")?.value || "all";
  const group = $("groupFilter")?.value || "all";

  const fStatus =
    skip === "status" ? "" : $("statusFilter")?.value || "";

  const fExc =
    skip === "excellence" ? "" : $("excellenceFilter")?.value || "";

  const fSec =
    skip === "section" ? "" : $("sectionFilter")?.value || "";

  const q = ($("searchInput")?.value || "").trim().toLowerCase();

  return STATE.allRows.filter(row => {
    const y = String(fieldValue(row, "year") || "").trim();
    const g = String(fieldValue(row, "group") || "ไม่ระบุกลุ่ม").trim();

    if (year !== "all" && y !== year) return false;
    if (group !== "all" && g !== group) return false;

    if (fStatus && getStatus(row) !== fStatus) return false;

    if (
      fExc &&
      String(fieldValue(row, "excellence") || "ไม่ระบุ Excellence").trim() !== fExc
    ) return false;

    if (
      fSec &&
      String(fieldValue(row, "section") || "ไม่ระบุหน่วยงาน").trim() !== fSec
    ) return false;

    if (q) {
      const searchText = ["kpi", "description", "group", "section", "excellence"]
        .map(n => fieldValue(row, n))
        .join(" ")
        .toLowerCase();

      if (!searchText.includes(q)) return false;
    }

    return true;
  });
}

function fillSelect(id, values, allLabel) {
  const el = $(id);
  if (!el) return;

  const current = el.value;

  el.innerHTML =
    `<option value="">${allLabel}</option>` +
    values.map(v =>
      `<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`
    ).join("");

  el.value = values.includes(current) ? current : "";
}

function updateFilterOptions() {
  const uniq = arr =>
    [...new Set(arr)].sort((a, b) => a.localeCompare(b, "th", { numeric: true }));

  const labelOf = (row, name, empty) =>
    String(fieldValue(row, name) || empty).trim();

  fillSelect(
    "statusFilter",
    uniq(getFilteredRows("status").map(getStatus)),
    "ทุกสถานะ"
  );

  fillSelect(
    "excellenceFilter",
    uniq(getFilteredRows("excellence").map(
      r => labelOf(r, "excellence", "ไม่ระบุ Excellence")
    )),
    "ทุก Excellence"
  );

  fillSelect(
    "sectionFilter",
    uniq(getFilteredRows("section").map(
      r => labelOf(r, "section", "ไม่ระบุหน่วยงาน")
    )),
    "ทุกหน่วยงาน"
  );
}

// ปรับตัวเลือกจนค่าที่เลือกนิ่ง (ตัวกรองที่ขึ้นต่อกันอาจรีเซ็ตกันเป็นทอด)
// แล้วค่อยกรองข้อมูลจริงเพียงครั้งเดียว
function settleFilterOptions() {
  const ids = ["statusFilter", "excellenceFilter", "sectionFilter"];
  const snapshot = () => ids.map(id => $(id)?.value || "").join("|");

  for (let i = 0; i < 4; i++) {
    const before = snapshot();
    updateFilterOptions();
    if (snapshot() === before) break;
  }
}

/* ============================================================
   DASHBOARD RENDER
============================================================ */

function renderDashboard() {
  settleFilterOptions();

  STATE.filteredRows = getFilteredRows();
  STATE.page = 1;

  renderSummary(STATE.filteredRows);
  renderCharts(STATE.filteredRows);
  applyColumnFilters();
  renderTable();
}

/* ============================================================
   SUMMARY CARDS
============================================================ */

function renderSummary(rows) {
  const passed = rows.filter(r => getStatus(r) === "ผ่าน").length;
  const failed = rows.filter(r => getStatus(r) === "ไม่ผ่าน").length;

  const pending = rows.filter(
    r => getStatus(r) === "ยังไม่ได้กรอกข้อมูล"
  ).length;

  // อัตราบรรลุเป้าหมายคิดจากตัวชี้วัดที่ประเมินแล้ว (ผ่าน + ไม่ผ่าน) เท่านั้น
  const evaluated = passed + failed;
  const rate = evaluated > 0 ? passed / evaluated * 100 : 0;

  if ($("pendingKpi")) $("pendingKpi").textContent = pending.toLocaleString("th-TH");
  if ($("totalKpi")) $("totalKpi").textContent = rows.length.toLocaleString("th-TH");
  if ($("passedKpi")) $("passedKpi").textContent = passed.toLocaleString("th-TH");
  if ($("failedKpi")) $("failedKpi").textContent = failed.toLocaleString("th-TH");
  if ($("passRate")) $("passRate").textContent = rate.toFixed(1) + "%";
  if ($("rateBar")) $("rateBar").style.width = rate.toFixed(1) + "%";
}

/* ============================================================
   CHART VALUE LABEL PLUGIN
   - เก็บตำแหน่งปลายสุดของป้ายที่ล้นแท่ง ไว้ที่ chart.$overflowEnd[j]
     เพื่อให้ป้าย "(N ตัวชี้วัด)" เลี่ยงไม่ให้ทับกัน
============================================================ */

function valueLabelPlugin(kind) {
  return {
    id: "valueLabels",

    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      const F = px => `600 ${px}px "Kanit", sans-serif`;
      const overflow = {};

      chart.$overflowEnd = {};

      ctx.save();

      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = F(11);

      ctx.shadowColor = "rgba(0,0,0,.30)";
      ctx.shadowBlur = 2;

      chart.data.datasets.forEach((ds, i) => {
        const meta = chart.getDatasetMeta(i);

        if (meta.hidden) return;

        meta.data.forEach((el, j) => {
          const v = Number(ds.data[j] || 0);

          if (!v) return;

          const total = kind === "doughnut"
            ? ds.data.reduce((a, b) => a + Number(b || 0), 0)
            : chart.data.datasets.reduce(
                (a, d) => a + Number(d.data[j] || 0), 0
              );

          const pct = total ? (v / total * 100).toFixed(1) : "0.0";
          const num = v.toLocaleString("th-TH");
          const c = el.getCenterPoint();

          if (kind === "doughnut") {
            if (Number(pct) < 5) return;

            ctx.fillText(num, c.x, c.y - 7);
            ctx.fillText(pct + "%", c.x, c.y + 8);
            return;
          }

          const len = Math.abs(el.x - el.base);
          const full = `${num} (${pct}%)`;

          if (len >= ctx.measureText(full).width + 12) {
            ctx.fillText(full, c.x, c.y);
            return;
          }

          ctx.font = F(9);

          const need = Math.max(
            ctx.measureText(num).width,
            ctx.measureText(pct + "%").width
          ) + 8;

          if (len >= need && el.height >= 25) {
            ctx.fillText(num, c.x, c.y - 6);
            ctx.fillText(pct + "%", c.x, c.y + 6);
            ctx.font = F(11);
            return;
          }

          ctx.font = F(11);

          if (!overflow[j]) overflow[j] = [];

          overflow[j].push({
            text: full,
            color: Array.isArray(ds.backgroundColor)
              ? ds.backgroundColor[j]
              : ds.backgroundColor,
            y: c.y
          });
        });
      });

      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
      ctx.textAlign = "left";
      ctx.font = F(10);

      Object.keys(overflow).forEach(j => {
        let end = 0;

        chart.data.datasets.forEach((d, i) => {
          const m = chart.getDatasetMeta(i);

          if (!m.hidden && m.data[j]) {
            end = Math.max(end, m.data[j].x);
          }
        });

        let x = end + 8;

        overflow[j].forEach(o => {
          ctx.fillStyle = o.color || "#16322a";

          const w = ctx.measureText(o.text).width;
          const maxX = chart.width - 5;

          // ป้องกันข้อความออกนอกพื้นที่กราฟ
          if (x + w > maxX) {
            ctx.textAlign = "right";
            x = maxX;
          }

          ctx.fillText(o.text, x, o.y);
          ctx.textAlign = "left";

          x += w + 8;
        });

        chart.$overflowEnd[j] = x;
      });

      ctx.restore();
    }
  };
}

/* ============================================================
   STACKED BAR CHART — Excellence / Section / Group
============================================================ */

function stackedStatusChart(canvasId, rows, fieldName, emptyLabel) {
  const canvas = $(canvasId);

  if (!canvas || typeof Chart === "undefined") return null;

  const dataRows = Array.isArray(rows) ? rows : [];
  const grouped = new Map();
  const statusSet = new Set();

  // 1. รวมข้อมูลตามกลุ่มและสถานะ
  dataRows.forEach(row => {
    const group =
      String(fieldValue(row, fieldName) || emptyLabel).trim() || emptyLabel;
    const status = getStatus(row);

    statusSet.add(status);

    if (!grouped.has(group)) grouped.set(group, {});

    const statusCounts = grouped.get(group);
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });

  const sumOf = obj =>
    Object.values(obj).reduce((t, v) => t + Number(v || 0), 0);

  // 2. เรียงกลุ่มตามจำนวนตัวชี้วัด
  const list = [...grouped.entries()]
    .sort((a, b) => sumOf(b[1]) - sumOf(a[1]));

  const order = [
    "ผ่าน",
    "ไม่ผ่าน",
    ...[...statusSet]
      .filter(s => s !== "ผ่าน" && s !== "ไม่ผ่าน")
      .sort((a, b) => a.localeCompare(b, "th"))
  ].filter(s => statusSet.has(s));

  const getStatusColor = (status, index) =>
    STATUS_COLORS[status] || EXTRA_COLORS[index % EXTRA_COLORS.length];

  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();

  if (!list.length) return null;

  // 3. ปรับความสูงตามจำนวนกลุ่ม
  const parent = canvas.parentElement;

  if (parent) {
    parent.style.height =
      Math.max(300, Math.min(850, list.length * 42 + 100)) + "px";
    parent.style.position = "relative";
  }

  // 4. ป้ายจำนวนตัวชี้วัดท้ายแท่งกราฟ (เลี่ยงป้ายที่ล้นแท่ง)
  const totalLabelPlugin = {
    id: "stackedTotalLabel_" + canvasId,

    afterDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      const xScale = scales.x;
      const yScale = scales.y;

      if (!chartArea || !xScale || !yScale) return;

      ctx.save();
      ctx.font = '500 11px "Kanit", sans-serif';
      ctx.fillStyle = "#52625a";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";

      list.forEach(([, counts], index) => {
        const total = sumOf(counts);
        const y = yScale.getPixelForValue(index);
        const text = `(${total.toLocaleString("th-TH")} ตัวชี้วัด)`;
        const textWidth = ctx.measureText(text).width;

        const barEnd = xScale.getPixelForValue(total);
        const overflowEnd = chart.$overflowEnd?.[index] ?? 0;

        // เริ่มหลังปลายแท่ง หรือหลังป้ายที่ล้นแท่ง แล้วแต่ว่าไกลกว่า
        const desiredX = Math.max(barEnd, overflowEnd) + 12;

        const maxX = chart.width - 8 - textWidth;
        const x = Math.max(chartArea.left, Math.min(desiredX, maxX));

        ctx.fillText(text, x, y);
      });

      ctx.restore();
    }
  };

  // 5. สร้าง datasets
  const datasets = order.map((status, index) => ({
    label: status,
    data: list.map(([, counts]) => Number(counts[status] || 0)),
    backgroundColor: getStatusColor(status, index),
    borderRadius: 5,
    borderSkipped: false,
    barPercentage: 0.75,
    categoryPercentage: 0.8
  }));

  // 6. สร้างกราฟ
  return new Chart(canvas, {
    type: "bar",

    data: {
      labels: list.map(([groupName]) => groupName),
      datasets
    },

    plugins: [valueLabelPlugin("bar"), totalLabelPlugin],

    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,

      // สำรองพื้นที่ด้านขวาให้ป้ายจำนวนตัวชี้วัดและป้ายที่ล้นแท่ง
      layout: {
        padding: { left: 5, right: 200, top: 8, bottom: 8 }
      },

      interaction: { mode: "index", intersect: true },

      scales: {
        x: {
          stacked: true,
          beginAtZero: true,
          ticks: { precision: 0, font: { family: "Kanit", size: 10 } },
          grid: { color: "#e9f0ed" },
          border: { display: false }
        },

        y: {
          stacked: true,
          ticks: { autoSkip: false, font: { family: "Kanit", size: 11 } },
          grid: { display: false },
          border: { display: false }
        }
      },

      plugins: {
        legend: {
          position: "bottom",
          labels: {
            usePointStyle: true,
            pointStyle: "circle",
            padding: 14,
            font: { family: "Kanit", size: 11 }
          }
        },

        tooltip: {
          callbacks: {
            label(context) {
              const total = context.chart.data.datasets.reduce(
                (sum, ds) => sum + Number(ds.data[context.dataIndex] || 0),
                0
              );

              const value = Number(context.raw || 0);
              const percent = total ? (value / total * 100).toFixed(1) : "0.0";

              return `${context.dataset.label}: ${value.toLocaleString("th-TH")} รายการ (${percent}%)`;
            },

            footer(items) {
              const total = items.reduce(
                (sum, item) => sum + Number(item.raw || 0), 0
              );

              return `รวมทั้งหมด: ${total.toLocaleString("th-TH")} รายการ`;
            }
          }
        }
      }
    }
  });
}

/* ============================================================
   DOUGHNUT CHART
============================================================ */

function renderStatusChart(rows) {
  const canvas = $("kpiStatusChart");

  if (!canvas || typeof Chart === "undefined") return null;

  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();

  const map = new Map();

  rows.forEach(row => {
    const status = getStatus(row);
    map.set(status, (map.get(status) || 0) + 1);
  });

  const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);

  let fi = 0;

  const colors = entries.map(
    e => STATUS_COLORS[e[0]] || EXTRA_COLORS[fi++ % EXTRA_COLORS.length]
  );

  return new Chart(canvas, {
    type: "doughnut",

    data: {
      labels: entries.map(e => e[0]),
      datasets: [{
        label: "จำนวนตัวชี้วัด",
        data: entries.map(e => e[1]),
        backgroundColor: colors,
        borderColor: "#ffffff",
        borderWidth: 3,
        hoverOffset: 7
      }]
    },

    plugins: [valueLabelPlugin("doughnut")],

    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "60%",

      plugins: {
        legend: {
          position: "bottom",
          labels: {
            usePointStyle: true,
            pointStyle: "circle",
            padding: 14,
            font: { family: "Kanit", size: 11 }
          }
        },

        tooltip: {
          callbacks: {
            label(c) {
              const total = c.dataset.data.reduce(
                (s, v) => s + Number(v || 0), 0
              );
              const n = Number(c.raw || 0);

              return `${c.label}: ${n.toLocaleString("th-TH")} รายการ (${total ? (n / total * 100).toFixed(1) : "0.0"}%)`;
            }
          }
        }
      }
    }
  });
}

/* ============================================================
   RENDER ALL CHARTS
============================================================ */

function renderCharts(rows) {
  if (typeof Chart === "undefined") return;

  ["trendChart", "statusChart", "excellenceChart", "sectionChart"]
    .forEach(key => {
      if (STATE[key]) {
        STATE[key].destroy();
        STATE[key] = null;
      }
    });

  Chart.defaults.font.family = '"Kanit", sans-serif';
  Chart.defaults.color = "#718179";

  STATE.trendChart = stackedStatusChart(
    "kpiTrendChart", rows, "group", "ไม่ระบุกลุ่ม"
  );

  STATE.excellenceChart = stackedStatusChart(
    "kpiExcellenceChart", rows, "excellence", "ไม่ระบุ Excellence"
  );

  STATE.sectionChart = stackedStatusChart(
    "kpiSectionChart", rows, "section", "ไม่ระบุหน่วยงาน"
  );

  STATE.statusChart = renderStatusChart(rows);
}

/* ============================================================
   TABLE
============================================================ */

function renderTable() {
  const body = $("kpiTableBody");
  if (!body) return;

  const rows = STATE.tableRows;
  const size = CONFIG.TABLE_PAGE_SIZE;

  const totalPages = Math.max(1, Math.ceil(rows.length / size));

  STATE.page = Math.min(Math.max(1, STATE.page), totalPages);

  const start = (STATE.page - 1) * size;
  const pageRows = rows.slice(start, start + size);

  if (!pageRows.length) {
    body.innerHTML = `
      <tr>
        <td colspan="12" class="empty-state">
          ไม่พบข้อมูลที่ตรงกับเงื่อนไข
        </td>
      </tr>
    `;
  } else {
    body.innerHTML = pageRows
      .map((row, i) => {
        const statusText = getStatus(row);
        const cell = (name, fallback = "—") =>
          escapeHTML(fieldValue(row, name) || fallback);

        return `
          <tr>
            <td class="eye-cell">
              <button
                type="button"
                class="eye-btn"
                data-i="${start + i}"
                aria-label="ดูรายละเอียด"
                title="ดูรายละเอียด"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round"
                  stroke-linejoin="round" aria-hidden="true">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </td>
            <td>
              <span class="status-pill ${statusClass(statusText)}">
                ${escapeHTML(statusText)}
              </span>
            </td>
            <td>${cell("year")}</td>
            <td>${cell("kpi")}</td>
            <td>${escapeHTML(fieldValue(row, "description") || fieldValue(row, "kpi") || "—")}</td>
            <td>${cell("group", "ไม่ระบุกลุ่ม")}</td>
            <td>${cell("section")}</td>
            <td>${cell("target")}</td>
            <td>${cell("result")}</td>
            <td>${cell("criterion")}</td>
            <td>${cell("rate")}</td>
            <td>${cell("unit")}</td>
          </tr>
        `;
      })
      .join("");
  }

  if ($("tableCount")) {
    $("tableCount").textContent =
      `${rows.length.toLocaleString("th-TH")} รายการ · หน้า ${STATE.page}/${totalPages}`;
  }

  if ($("pageNumber")) $("pageNumber").textContent = STATE.page;
  if ($("prevPage")) $("prevPage").disabled = STATE.page <= 1;
  if ($("nextPage")) $("nextPage").disabled = STATE.page >= totalPages;
}

/* ============================================================
   EXCEL-STYLE COLUMN FILTER
============================================================ */

const COLS = [
  "year", "kpi", "description", "group", "section",
  "target", "result", "criterion", "rate", "unit", "summary"
];

function colValue(row, key) {
  if (key === "summary") return getStatus(row);

  const value = String(fieldValue(row, key) ?? "").trim();

  return key === "group" ? (value || "ไม่ระบุกลุ่ม") : value;
}

function rowsForColumn(exceptKey) {
  return STATE.filteredRows.filter(row =>
    COLS.every(key =>
      key === exceptKey ||
      !STATE.colFilters[key] ||
      STATE.colFilters[key].has(colValue(row, key))
    )
  );
}

function applyColumnFilters() {
  STATE.tableRows = rowsForColumn(null);

  document.querySelectorAll(".th-filter").forEach(button => {
    button.classList.toggle("active", !!STATE.colFilters[button.dataset.col]);
  });
}

function refreshTable() {
  STATE.page = 1;
  applyColumnFilters();
  renderTable();
}

let pop = null;

function closePopover() {
  if (pop) {
    pop.remove();
    pop = null;
  }
}

function openPopover(btn) {
  closePopover();

  const key = btn.dataset.col;
  const counts = new Map();

  rowsForColumn(key).forEach(row => {
    const value = colValue(row, key);
    counts.set(value, (counts.get(value) || 0) + 1);
  });

  const values = [...counts.keys()].sort(
    (a, b) => a.localeCompare(b, "th", { numeric: true })
  );

  const current = STATE.colFilters[key];

  const selected = new Set(
    current ? values.filter(v => current.has(v)) : values
  );

  pop = document.createElement("div");
  pop.className = "filter-pop";
  pop.dataset.col = key;

  pop.innerHTML = `
    <input class="pop-search" type="search" placeholder="ค้นหา" aria-label="ค้นหาในตัวกรอง">

    <label class="pop-item pop-all">
      <input type="checkbox" class="pop-all-box">
      <span>(เลือกทั้งหมด)</span>
    </label>

    <div class="pop-list"></div>

    <div class="pop-actions">
      <button type="button" class="btn-ghost pop-clear">ล้างตัวกรอง</button>
      <button type="button" class="btn-ok pop-ok">ตกลง</button>
    </div>
  `;

  document.body.appendChild(pop);

  const search = pop.querySelector(".pop-search");
  const list = pop.querySelector(".pop-list");
  const allBox = pop.querySelector(".pop-all-box");
  const okBtn = pop.querySelector(".pop-ok");

  const label = value => value === "" ? "(ว่าง)" : value;

  const shownValues = () => {
    const q = search.value.trim().toLowerCase();
    return values.filter(value => label(value).toLowerCase().includes(q));
  };

  function draw() {
    const shown = shownValues();

    list.innerHTML = shown.length
      ? shown.map(value => `
          <label class="pop-item">
            <input type="checkbox" data-v="${escapeHTML(value)}"
              ${selected.has(value) ? "checked" : ""}>
            <span>${escapeHTML(label(value))}</span>
            <em>${counts.get(value).toLocaleString("th-TH")}</em>
          </label>
        `).join("")
      : `<div class="empty-state" style="padding:14px">ไม่พบรายการ</div>`;

    const checkedCount = shown.filter(v => selected.has(v)).length;

    allBox.checked = shown.length > 0 && checkedCount === shown.length;
    allBox.indeterminate = checkedCount > 0 && checkedCount < shown.length;

    okBtn.disabled = selected.size === 0;
  }

  list.addEventListener("change", event => {
    const box = event.target.closest("input[data-v]");
    if (!box) return;

    if (box.checked) selected.add(box.dataset.v);
    else selected.delete(box.dataset.v);

    draw();
  });

  allBox.addEventListener("change", () => {
    shownValues().forEach(value => {
      if (allBox.checked) selected.add(value);
      else selected.delete(value);
    });

    draw();
  });

  search.addEventListener("input", draw);

  pop.querySelector(".pop-clear").addEventListener("click", () => {
    delete STATE.colFilters[key];
    closePopover();
    refreshTable();
  });

  okBtn.addEventListener("click", () => {
    if (selected.size === values.length) {
      delete STATE.colFilters[key];
    } else {
      STATE.colFilters[key] = new Set(selected);
    }

    closePopover();
    refreshTable();
  });

  draw();

  const rect = btn.getBoundingClientRect();
  const popHeight = Math.min(pop.offsetHeight, window.innerHeight - 16);

  const top = Math.max(
    8,
    Math.min(rect.bottom + 6, window.innerHeight - popHeight - 8)
  );

  const left = Math.max(
    8,
    Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8)
  );

  pop.style.top = top + "px";
  pop.style.left = left + "px";

  search.focus();
}

/* ============================================================
   EVENT LISTENERS
============================================================ */

// Column filter buttons
document.querySelector("thead")?.addEventListener("click", event => {
  const btn = event.target.closest(".th-filter");
  if (!btn) return;

  event.stopPropagation();

  if (pop && pop.dataset.col === btn.dataset.col) closePopover();
  else openPopover(btn);
});

// Close popover
document.addEventListener("click", event => {
  if (pop && !pop.contains(event.target)) closePopover();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closePopover();
});

window.addEventListener("scroll", event => {
  // ไม่ปิด popover เมื่อเลื่อนรายการภายในตัวมันเอง
  if (pop && !(event.target instanceof Node && pop.contains(event.target))) {
    closePopover();
  }
}, true);

window.addEventListener("resize", () => {
  if (pop) closePopover();
});

// Clear all column filters
on("clearColFilters", "click", () => {
  STATE.colFilters = {};
  closePopover();
  refreshTable();
});

// เปิดหน้า KPI_CASE
on("kpiTableBody", "click", event => {
  const btn = event.target.closest(".eye-btn");
  if (!btn) return;

  const row = STATE.tableRows[Number(btn.dataset.i)];
  if (!row) return;

  const params = new URLSearchParams({
    kpi: String(fieldValue(row, "kpi") || ""),
    year: String(fieldValue(row, "year") || ""),
    group: String(fieldValue(row, "group") || ""),
    excellence: String(fieldValue(row, "excellence") || ""),
    section: String(fieldValue(row, "section") || ""),
    description: String(fieldValue(row, "description") || "")
  });

  window.location.href = `${CONFIG.CASE_URL}?${params.toString()}`;
});

// Main filters
[
  "yearFilter",
  "groupFilter",
  "statusFilter",
  "excellenceFilter",
  "sectionFilter"
].forEach(id => on(id, "change", renderDashboard));

// Search (หน่วงเวลาเล็กน้อยเพื่อไม่ให้วาดกราฟใหม่ทุกตัวอักษร)
let searchTimer = null;

on("searchInput", "input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderDashboard, 200);
});

// Pagination
on("prevPage", "click", () => {
  if (STATE.page > 1) {
    STATE.page--;
    renderTable();
  }
});

on("nextPage", "click", () => {
  const max = Math.max(
    1,
    Math.ceil(STATE.tableRows.length / CONFIG.TABLE_PAGE_SIZE)
  );

  if (STATE.page < max) {
    STATE.page++;
    renderTable();
  }
});

// Refresh / Back
on("refreshButton", "click", loadDatabase);

on("backButton", "click", () => {
  window.location.href = CONFIG.BACK_URL;
});

/* ============================================================
   INITIALIZE
============================================================ */

loadDatabase();
