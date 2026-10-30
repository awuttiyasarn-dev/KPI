
"use strict";

/* ============================================================
 * REPORT KPI DASHBOARD
 * JavaScript compatible with Modern Hospital Dashboard CSS
 * API   : Google Apps Script Web App
 * Sheet : REPORT_02
 * ============================================================ */

const CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbyDVuHOl48Fke6Sb7D-MsVSUC4lPlOpe03mw63JdNtn9OU5Y1cGW_64Ly15JUA4p4qF/exec",
  SHEET_NAME: "REPORT_02",
  ACCESS_KEY: "",
  PAGE_SIZE: 100,
  MAX_PAGES: 100,
  TABLE_PAGE_SIZE: 15,

  BACK_URL: "../index.html",
  CASE_URL: "../KPI_CASE.html",

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
    const k = keys.find(
      i => i.toLowerCase() === a.toLowerCase()
    );

    if (k && row[k] != null && String(row[k]).trim() !== "") {
      return row[k];
    }
  }

  return "";
}

const fieldValue = (row, name) =>
  getField(row, FIELD[name] || [name]);

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

    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },

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

  if (
    !data ||
    data.ok === false ||
    data.success === false ||
    data.error
  ) {
    throw new Error(
      data?.message ||
      data?.error ||
      "ไม่สามารถอ่านข้อมูลจาก API ได้"
    );
  }

  const headers = data.headers || data.header || [];
  const rows = data.rows || [];

  const objects = rows.map(row => {
    if (!Array.isArray(row)) return row;

    const item = {};

    headers.forEach((h, i) => {
      item[h] = row[i];
    });

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

  if (refreshButton) {
    refreshButton.disabled = true;
  }

  setConnectionStatus(
    "กำลังโหลดข้อมูลจาก REPORT_02..."
  );

  try {
    const combined = [];
    let totalFromApi = null;

    for (
      let page = 1;
      page <= CONFIG.MAX_PAGES;
      page++
    ) {
      const result = await requestPage(page);

      combined.push(...result.rows);

      if (result.total !== null) {
        const total = Number(result.total);

        if (Number.isFinite(total)) {
          totalFromApi = total;
        }
      }

      if (result.count < CONFIG.PAGE_SIZE) break;

      if (
        totalFromApi !== null &&
        combined.length >= totalFromApi
      ) {
        break;
      }
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
        "อัปเดต " +
        new Date().toLocaleString("th-TH");
    }

    setConnectionStatus(
      `เชื่อมต่อสำเร็จ · โหลดข้อมูล ${STATE.allRows.length.toLocaleString("th-TH")} รายการ`,
      "success"
    );

  } catch (error) {
    console.error("[KPI] API error:", error);

    setConnectionStatus(
      "เชื่อมต่อไม่สำเร็จ: " + error.message,
      "error"
    );

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

    [
      "totalKpi",
      "passedKpi",
      "failedKpi",
      "passRate"
    ].forEach(id => {
      if ($(id)) $(id).textContent = "—";
    });

  } finally {
    STATE.loading = false;

    if (refreshButton) {
      refreshButton.disabled = false;
    }
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
        r => String(
          fieldValue(r, "group") || "ไม่ระบุกลุ่ม"
        ).trim()
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

  const q = ($("searchInput")?.value || "")
    .trim()
    .toLowerCase();

  return STATE.allRows.filter(row => {
    const y = String(fieldValue(row, "year") || "").trim();

    const g = String(
      fieldValue(row, "group") || "ไม่ระบุกลุ่ม"
    ).trim();

    if (year !== "all" && y !== year) return false;
    if (group !== "all" && g !== group) return false;

    if (fStatus && getStatus(row) !== fStatus) {
      return false;
    }

    if (
      fExc &&
      String(
        fieldValue(row, "excellence") || "ไม่ระบุ Excellence"
      ).trim() !== fExc
    ) {
      return false;
    }

    if (
      fSec &&
      String(
        fieldValue(row, "section") || "ไม่ระบุหน่วยงาน"
      ).trim() !== fSec
    ) {
      return false;
    }

    if (q) {
      const searchText = [
        "kpi",
        "description",
        "group",
        "section",
        "excellence"
      ]
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
    [...new Set(arr)].sort(
      (a, b) => a.localeCompare(b, "th", { numeric: true })
    );

  const labelOf = (row, name, empty) =>
    String(fieldValue(row, name) || empty).trim();

  fillSelect(
    "statusFilter",
    uniq(getFilteredRows("status").map(getStatus)),
    "ทุกสถานะ"
  );

  fillSelect(
    "excellenceFilter",
    uniq(
      getFilteredRows("excellence").map(
        r => labelOf(r, "excellence", "ไม่ระบุ Excellence")
      )
    ),
    "ทุก Excellence"
  );

  fillSelect(
    "sectionFilter",
    uniq(
      getFilteredRows("section").map(
        r => labelOf(r, "section", "ไม่ระบุหน่วยงาน")
      )
    ),
    "ทุกหน่วยงาน"
  );
}

/* ============================================================
   DASHBOARD RENDER
============================================================ */

function renderDashboard() {
  updateFilterOptions();

  STATE.filteredRows = getFilteredRows();

  updateFilterOptions();

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
  const passed = rows.filter(
    r => getStatus(r) === "ผ่าน"
  ).length;

  const failed = rows.filter(
    r => getStatus(r) === "ไม่ผ่าน"
  ).length;

  const evaluated = passed + failed;

  const rate = evaluated > 0
    ? passed / evaluated * 100
    : 0;

  $("totalKpi").textContent =
    rows.length.toLocaleString("th-TH");

  $("passedKpi").textContent =
    passed.toLocaleString("th-TH");

  $("failedKpi").textContent =
    failed.toLocaleString("th-TH");

  $("passRate").textContent =
    rate.toFixed(1) + "%";

  $("rateBar").style.width =
    rate.toFixed(1) + "%";
}

/* ============================================================
   CHART VALUE LABEL PLUGIN
============================================================ */

function valueLabelPlugin(kind) {
  return {
    id: "valueLabels",

    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;

      const F = px =>
        `600 ${px}px "Kanit", sans-serif`;

      const overflow = {};

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
            ? ds.data.reduce(
                (a, b) => a + Number(b || 0), 0
              )
            : chart.data.datasets.reduce(
                (a, d) => a + Number(d.data[j] || 0), 0
              );

          const pct = total
            ? (v / total * 100).toFixed(1)
            : "0.0";

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

          // ป้องกันข้อความออกนอกพื้นที่กราฟ
          const maxX = chart.width - 5;

          if (x + ctx.measureText(o.text).width > maxX) {
            ctx.textAlign = "right";
            x = maxX;
          }

          ctx.fillText(o.text, x, o.y);

          ctx.textAlign = "left";

          x += ctx.measureText(o.text).width + 8;
        });
      });

      ctx.restore();
    }
  };
}

/* ============================================================
   STACKED BAR CHART
============================================================ */

function stackedStatusChart(
  canvasId,
  rows,
  fieldName,
  emptyLabel
) {
  const map = new Map();
  const statusSet = new Set();

  rows.forEach(row => {
    const group = String(
      fieldValue(row, fieldName) || emptyLabel
    ).trim();

    const status = getStatus(row);

    statusSet.add(status);

    if (!map.has(group)) {
      map.set(group, {});
    }

    const item = map.get(group);

    item[status] = (item[status] || 0) + 1;
  });

  const sumOf = obj =>
    Object.values(obj).reduce((x, y) => x + y, 0);

  const list = [...map.entries()]
    .sort((a, b) => sumOf(b[1]) - sumOf(a[1]));

  const colorsMap = {
    "ผ่าน": "#0b7a5a",
    "ไม่ผ่าน": "#d64545",
    "ไม่ระบุสถานะ": "#94a3b8",
    "ยังไม่ได้กรอกข้อมูล": "#f0a93b"
  };

  const extra = [
    "#4285f4",
    "#9b59b6",
    "#16a6a1",
    "#e17055",
    "#6c8ebf",
    "#b07aa1"
  ];

  let xi = 0;

  const order = [
    "ผ่าน",
    "ไม่ผ่าน",
    ...[...statusSet].filter(
      x => x !== "ผ่าน" && x !== "ไม่ผ่าน"
    )
  ].filter(x => statusSet.has(x));

  const canvas = $(canvasId);

  if (!canvas) return null;

  const parent = canvas.parentElement;

  // ความสูงกราฟปรับตามจำนวนกลุ่ม
  const chartHeight = Math.max(
    300,
    Math.min(850, list.length * 42 + 90)
  );

  parent.style.height = chartHeight + "px";

  return new Chart(canvas, {
    type: "bar",

    data: {
      labels: list.map(g => g[0]),

      datasets: order.map(status => ({
        label: status,

        data: list.map(
          g => g[1][status] || 0
        ),

        backgroundColor:
          colorsMap[status] ||
          extra[xi++ % extra.length],

        borderRadius: 5,
        borderSkipped: false,

        barPercentage: .75,
        categoryPercentage: .8
      }))
    },

    plugins: [
      valueLabelPlugin("bar")
    ],

    options: {
      indexAxis: "y",

      layout: {
        padding: {
          right: 130,
          left: 5,
          top: 5,
          bottom: 5
        }
      },

      responsive: true,
      maintainAspectRatio: false,

      interaction: {
        mode: "index",
        intersect: false
      },

      scales: {
        x: {
          stacked: true,
          beginAtZero: true,

          grid: {
            color: "#e9f0ed"
          },

          border: {
            display: false
          },

          ticks: {
            precision: 0,
            font: {
              family: "Kanit",
              size: 10
            }
          }
        },

        y: {
          stacked: true,

          grid: {
            display: false
          },

          ticks: {
            autoSkip: false,
            font: {
              family: "Kanit",
              size: 11
            }
          }
        }
      },

      plugins: {
        legend: {
          position: "bottom",

          labels: {
            usePointStyle: true,
            pointStyle: "circle",
            padding: 14,

            font: {
              family: "Kanit",
              size: 11
            }
          }
        },

        tooltip: {
          callbacks: {
            label(c) {
              const total =
                c.chart.data.datasets.reduce(
                  (a, d) =>
                    a + Number(d.data[c.dataIndex] || 0),
                  0
                );

              const n = Number(c.raw || 0);

              return `${c.dataset.label}: ${n.toLocaleString("th-TH")} รายการ (${total ? (n / total * 100).toFixed(1) : "0.0"}%)`;
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
  const map = new Map();

  rows.forEach(row => {
    const status = getStatus(row);

    map.set(
      status,
      (map.get(status) || 0) + 1
    );
  });

  const entries = [...map.entries()]
    .sort((a, b) => b[1] - a[1]);

  const known = {
    "ผ่าน": "#0b7a5a",
    "ไม่ผ่าน": "#d64545",
    "ไม่ระบุสถานะ": "#94a3b8",
    "ยังไม่ได้กรอกข้อมูล": "#f0a93b"
  };

  const fallback = [
    "#4285f4",
    "#9b59b6",
    "#16a6a1",
    "#e17055",
    "#6c8ebf",
    "#b07aa1",
    "#59a14f",
    "#edc948"
  ];

  let fi = 0;

  const colors = entries.map(
    e => known[e[0]] || fallback[fi++ % fallback.length]
  );

  const canvas = $("kpiStatusChart");

  if (!canvas) return null;

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

    plugins: [
      valueLabelPlugin("doughnut")
    ],

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

            font: {
              family: "Kanit",
              size: 11
            }
          }
        },

        tooltip: {
          callbacks: {
            label(c) {
              const total =
                c.dataset.data.reduce(
                  (s, v) => s + Number(v || 0),
                  0
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
  [
    "trendChart",
    "statusChart",
    "excellenceChart",
    "sectionChart"
  ].forEach(key => {
    if (STATE[key]) {
      STATE[key].destroy();
      STATE[key] = null;
    }
  });

  Chart.defaults.font.family = '"Kanit", sans-serif';
  Chart.defaults.color = "#718179";

  STATE.trendChart = stackedStatusChart(
    "kpiTrendChart",
    rows,
    "group",
    "ไม่ระบุกลุ่ม"
  );

  STATE.excellenceChart = stackedStatusChart(
    "kpiExcellenceChart",
    rows,
    "excellence",
    "ไม่ระบุ Excellence"
  );

  STATE.sectionChart = stackedStatusChart(
    "kpiSectionChart",
    rows,
    "section",
    "ไม่ระบุหน่วยงาน"
  );

  STATE.statusChart = renderStatusChart(rows);
}

/* ============================================================
   TABLE
============================================================ */

function renderTable() {
  const rows = STATE.tableRows;
  const size = CONFIG.TABLE_PAGE_SIZE;

  const totalPages = Math.max(
    1,
    Math.ceil(rows.length / size)
  );

  STATE.page = Math.min(
    Math.max(1, STATE.page),
    totalPages
  );

  const start = (STATE.page - 1) * size;

  const pageRows = rows.slice(
    start,
    start + size
  );

  if (!pageRows.length) {
    $("kpiTableBody").innerHTML = `
      <tr>
        <td colspan="12" class="empty-state">
          ไม่พบข้อมูลที่ตรงกับเงื่อนไข
        </td>
      </tr>
    `;
  } else {
    $("kpiTableBody").innerHTML =
      pageRows.map((row, i) => {
        const status = getStatus(row);

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
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </td>

            <td>${escapeHTML(fieldValue(row, "year") || "—")}</td>

            <td>${escapeHTML(fieldValue(row, "kpi") || "—")}</td>

            <td>${escapeHTML(
              fieldValue(row, "description") ||
              fieldValue(row, "kpi") ||
              "—"
            )}</td>

            <td>${escapeHTML(fieldValue(row, "group") || "ไม่ระบุกลุ่ม")}</td>

            <td>${escapeHTML(fieldValue(row, "section") || "—")}</td>

            <td>${escapeHTML(fieldValue(row, "target") || "—")}</td>

            <td>${escapeHTML(fieldValue(row, "result") || "—")}</td>

            <td>${escapeHTML(fieldValue(row, "criterion") || "—")}</td>

            <td>${escapeHTML(fieldValue(row, "rate") || "—")}</td>

            <td>${escapeHTML(fieldValue(row, "unit") || "—")}</td>

            <td>
              <span class="status-pill ${statusClass(status)}">
                ${escapeHTML(status)}
              </span>
            </td>
          </tr>
        `;
      }).join("");
  }

  $("tableCount").textContent =
    `${rows.length.toLocaleString("th-TH")} รายการ · หน้า ${STATE.page}/${totalPages}`;

  $("pageNumber").textContent = STATE.page;

  $("prevPage").disabled = STATE.page <= 1;

  $("nextPage").disabled = STATE.page >= totalPages;
}

/* ============================================================
   EXCEL COLUMN FILTER
============================================================ */

const COLS = [
  "year",
  "kpi",
  "description",
  "group",
  "section",
  "target",
  "result",
  "criterion",
  "rate",
  "unit",
  "summary"
];

function colValue(row, key) {
  if (key === "summary") return getStatus(row);

  const value = String(
    fieldValue(row, key) ?? ""
  ).trim();

  return key === "group"
    ? (value || "ไม่ระบุกลุ่ม")
    : value;
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
    button.classList.toggle(
      "active",
      !!STATE.colFilters[button.dataset.col]
    );
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

    counts.set(
      value,
      (counts.get(value) || 0) + 1
    );
  });

  const values = [...counts.keys()].sort(
    (a, b) => a.localeCompare(
      b,
      "th",
      { numeric: true }
    )
  );

  const current = STATE.colFilters[key];

  const selected = new Set(
    current
      ? values.filter(v => current.has(v))
      : values
  );

  pop = document.createElement("div");

  pop.className = "filter-pop";
  pop.dataset.col = key;

  pop.innerHTML = `
    <input
      class="pop-search"
      type="search"
      placeholder="ค้นหา"
      aria-label="ค้นหาในตัวกรอง"
    >

    <label class="pop-item pop-all">
      <input type="checkbox" class="pop-all-box">
      <span>(เลือกทั้งหมด)</span>
    </label>

    <div class="pop-list"></div>

    <div class="pop-actions">
      <button type="button" class="btn-ghost pop-clear">
        ล้างตัวกรอง
      </button>

      <button type="button" class="btn-ok pop-ok">
        ตกลง
      </button>
    </div>
  `;

  document.body.appendChild(pop);

  const search = pop.querySelector(".pop-search");
  const list = pop.querySelector(".pop-list");
  const allBox = pop.querySelector(".pop-all-box");
  const okBtn = pop.querySelector(".pop-ok");

  const label = value =>
    value === "" ? "(ว่าง)" : value;

  const shownValues = () => {
    const q = search.value.trim().toLowerCase();

    return values.filter(value =>
      label(value).toLowerCase().includes(q)
    );
  };

  function draw() {
    const shown = shownValues();

    list.innerHTML = shown.length
      ? shown.map(value => `
          <label class="pop-item">
            <input
              type="checkbox"
              data-v="${escapeHTML(value)}"
              ${selected.has(value) ? "checked" : ""}
            >

            <span>${escapeHTML(label(value))}</span>

            <em>${counts.get(value).toLocaleString("th-TH")}</em>
          </label>
        `).join("")
      : `
        <div class="empty-state" style="padding:14px">
          ไม่พบรายการ
        </div>
      `;

    const checkedCount = shown.filter(
      value => selected.has(value)
    ).length;

    allBox.checked =
      shown.length > 0 &&
      checkedCount === shown.length;

    allBox.indeterminate =
      checkedCount > 0 &&
      checkedCount < shown.length;

    okBtn.disabled = selected.size === 0;
  }

  list.addEventListener("change", event => {
    const box = event.target.closest("input[data-v]");

    if (!box) return;

    if (box.checked) {
      selected.add(box.dataset.v);
    } else {
      selected.delete(box.dataset.v);
    }

    draw();
  });

  allBox.addEventListener("change", () => {
    shownValues().forEach(value => {
      if (allBox.checked) {
        selected.add(value);
      } else {
        selected.delete(value);
      }
    });

    draw();
  });

  search.addEventListener("input", draw);

  pop.querySelector(".pop-clear").addEventListener(
    "click",
    () => {
      delete STATE.colFilters[key];

      closePopover();

      refreshTable();
    }
  );

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

  const popHeight = Math.min(
    pop.offsetHeight,
    window.innerHeight - 16
  );

  const top = Math.max(
    8,
    Math.min(
      rect.bottom + 6,
      window.innerHeight - popHeight - 8
    )
  );

  const left = Math.max(
    8,
    Math.min(
      rect.left,
      window.innerWidth - pop.offsetWidth - 8
    )
  );

  pop.style.top = top + "px";
  pop.style.left = left + "px";

  search.focus();
}

/* ============================================================
   DETAIL DIALOG
============================================================ */

const DETAIL_FIELDS = [
  ["ปีงบประมาณ", "year"],
  ["รหัส KPI", "kpi"],
  ["ตัวชี้วัด", "description", true],
  ["กลุ่ม", "group"],
  ["หน่วยงาน", "section"],
  ["Excellence", "excellence"],
  ["เป้าหมาย", "target"],
  ["ผลลัพธ์", "result"],
  ["เกณฑ์ (Criterion)", "criterion"],
  ["Rate", "rate"],
  ["หน่วย (Nunit)", "unit"],
  ["สรุปผล", "summary"]
];

function openDetail(row) {
  $("detailKpi").textContent =
    fieldValue(row, "kpi") || "";

  $("detailTitle").textContent =
    fieldValue(row, "description") ||
    fieldValue(row, "kpi") ||
    "รายละเอียดตัวชี้วัด";

  $("detailGrid").innerHTML =
    DETAIL_FIELDS.map(([label, key, wide]) => {
      const raw = key === "summary"
        ? getStatus(row)
        : fieldValue(row, key) || "—";

      const value = key === "summary"
        ? `<span class="status-pill ${statusClass(raw)}">${escapeHTML(raw)}</span>`
        : escapeHTML(raw);

      return `
        <div class="detail-item${wide ? " wide" : ""}">
          <div class="detail-label">${escapeHTML(label)}</div>
          <div class="detail-value">${value}</div>
        </div>
      `;
    }).join("");

  $("detailDialog").showModal();
}

/* ============================================================
   EVENT LISTENERS
============================================================ */

// Column filter
document.querySelector("thead")?.addEventListener(
  "click",
  event => {
    const btn = event.target.closest(".th-filter");

    if (!btn) return;

    event.stopPropagation();

    if (pop && pop.dataset.col === btn.dataset.col) {
      closePopover();
    } else {
      openPopover(btn);
    }
  }
);

// Close filter
document.addEventListener("click", event => {
  if (pop && !pop.contains(event.target)) {
    closePopover();
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closePopover();
  }
});

window.addEventListener("scroll", () => {
  if (pop) closePopover();
}, true);

window.addEventListener("resize", () => {
  if (pop) closePopover();
});

// Clear all column filters
$("clearColFilters").addEventListener("click", () => {
  STATE.colFilters = {};

  closePopover();

  refreshTable();
});

// KPI detail / KPI_CASE
$("kpiTableBody").addEventListener("click", event => {
  const btn = event.target.closest(".eye-btn");

  if (!btn) return;

  const row = STATE.tableRows[
    Number(btn.dataset.i)
  ];

  if (!row) return;

  // สร้าง URL จากตำแหน่งไฟล์ Dashboard
  const url = new URL(
    CONFIG.CASE_URL,
    window.location.href
  );

  // ส่งข้อมูล KPI ไปยังหน้ารายละเอียด
  url.searchParams.set(
    "kpi",
    fieldValue(row, "kpi") || ""
  );

  url.searchParams.set(
    "year",
    fieldValue(row, "year") || ""
  );

  url.searchParams.set(
    "group",
    fieldValue(row, "group") || ""
  );

  url.searchParams.set(
    "excellence",
    fieldValue(row, "excellence") || ""
  );

  url.searchParams.set(
    "section",
    fieldValue(row, "section") || ""
  );

  url.searchParams.set(
    "description",
    fieldValue(row, "description") || ""
  );

  window.location.href = url.href;
});

// Main filters
[
  "yearFilter",
  "groupFilter",
  "statusFilter",
  "excellenceFilter",
  "sectionFilter"
].forEach(id => {
  $(id).addEventListener("change", renderDashboard);
});

// Search
$("searchInput").addEventListener(
  "input",
  renderDashboard
);

// Pagination
$("prevPage").addEventListener("click", () => {
  if (STATE.page > 1) {
    STATE.page--;
    renderTable();
  }
});

$("nextPage").addEventListener("click", () => {
  const max = Math.max(
    1,
    Math.ceil(
      STATE.tableRows.length /
      CONFIG.TABLE_PAGE_SIZE
    )
  );

  if (STATE.page < max) {
    STATE.page++;
    renderTable();
  }
});

// Refresh
$("refreshButton").addEventListener(
  "click",
  loadDatabase
);

// Back
$("backButton").addEventListener("click", () => {
  window.location.href = CONFIG.BACK_URL;
});

/* ============================================================
   INITIALIZE
============================================================ */

loadDatabase();
