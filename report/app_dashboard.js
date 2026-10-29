/* ============================================================
 * REPORT KPI DASHBOARD
 * File       : app_dashboard.js
 * Frontend   : GitHub Pages
 * HTML       : dashboard.HTML
 * API        : Google Apps Script Web App
 * Sheet      : REPORT_02
 * ============================================================ */

(() => {
  "use strict";

  // ป้องกันสคริปต์ทำงานซ้ำหากถูก include มากกว่าหนึ่งครั้ง
  if (window.__REPORT_KPI_DASHBOARD_STARTED__) {
    console.warn("[REPORT] Dashboard script started already.");
    return;
  }
  window.__REPORT_KPI_DASHBOARD_STARTED__ = true;

  /* ==========================================================
     1. CONFIG
  ========================================================== */

  const CONFIG = {
    API_URL:
      "https://script.google.com/macros/s/AKfycbyDVuHOl48Fke6Sb7D-MsVSUC4lPlOpe03mw63JdNtn9OU5Y1cGW_64Ly15JUA4p4qF/exec",

    SHEET_NAME: "REPORT_02",
    ACCESS_KEY: "",

    PAGE_SIZE: 100,
    MAX_PAGES: 100,

    API_TIMEOUT: 25000,
    CHART_TIMEOUT: 12000,

    CHART_JS_URL:
      "https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js",

    COLORS: {
      primary: "#1a8f63",
      secondary: "#8db8ea",
      teal: "#0f9e91",
      amber: "#f59e0b",
      purple: "#8b5cf6",
      gray: "#94a3b8",
      red: "#dc2626",
      green: "#16a34a"
    }
  };

  /* ==========================================================
     2. FIELD MAPPING
  ========================================================== */

  const FIELDS = {
    year: ["Fisyear", "FisYear", "Fiscal_year", "FiscalYear", "ปีงบประมาณ", "ปีงบฯ"],
    group: ["kpi_Group_Des", "KPI_Group", "Group", "กลุ่มตัวชี้วัด", "กลุ่ม KPI"],
    excellence: ["Excellence", "Excellence_Des"],
    section: ["Tsection", "Section", "หน่วยงาน", "กลุ่มงาน"],
    kpi: ["KPI", "Kpi", "KPI_ID", "รหัสตัวชี้วัด"],
    description: ["kpi_Des", "KPI_Des", "Description", "รายละเอียดตัวชี้วัด"],
    numerator: ["Ndiv", "Numerator"],
    denominator: ["Ndev", "Denominator"],
    rate: ["Nrate", "Rate", "อัตรา"],
    evaluate: ["Evaluate", "การประเมิน"],
    indicate: ["Indicate", "ตัวชี้วัด"],
    standard: ["Nstd", "Standard", "มาตรฐาน"],
    formula: ["Formula", "สูตร"],
    criterion: ["criterion", "Criterion", "เกณฑ์"],
    result: ["Result", "ผลลัพธ์"],
    target: ["Target", "เป้าหมาย"],
    unit: ["Nunit", "Unit", "หน่วย"],
    percent: ["Rate", "Percent", "Percentage", "ร้อยละ"],
    summary: ["Summary", "สรุปผล"]
  };

  /* ==========================================================
     3. STATE
  ========================================================== */

  const STATE = {
    initialized: false,
    loading: false,
    loadingHTML: false,
    loadingChart: false,
    chartPromise: null,

    rawRows: [],
    filteredRows: [],

    page: 1,
    pageSize: 25,

    charts: {
      group: null
    },

    lastUpdated: null,
    loadError: null
  };

  /* ==========================================================
     4. DOM HELPERS
  ========================================================== */

  const $ = (id) => document.getElementById(id);

  function root() {
    return $("reportKpiDashboard");
  }

  function normalizeText(value) {
    return String(value ?? "").trim();
  }

  function normalizeKey(value) {
    return normalizeText(value)
      .toLowerCase()
      .replace(/[\s_\-./()]+/g, "");
  }

  function isBlank(value) {
    return value === null ||
      value === undefined ||
      String(value).trim() === "";
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function setText(id, value) {
    const element = $(id);
    if (!element) return;

    element.textContent =
      value === null || value === undefined || value === ""
        ? "—"
        : String(value);
  }

  function unique(values) {
    return [...new Set(
      values.map(normalizeText).filter(Boolean)
    )];
  }

  function numberValue(value) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    if (isBlank(value)) return null;

    const text = String(value)
      .trim()
      .replace(/,/g, "")
      .replace(/%/g, "")
      .replace(/\s/g, "");

    if (!/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(text)) {
      return null;
    }

    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function formatNumber(value, digits = 2) {
    const number = numberValue(value);

    if (number === null) {
      return isBlank(value) ? "—" : String(value);
    }

    return new Intl.NumberFormat("th-TH", {
      maximumFractionDigits: digits
    }).format(number);
  }

  function formatDate(date) {
    if (!date) return "—";

    try {
      return new Intl.DateTimeFormat("th-TH", {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(date);
    } catch (_) {
      return date.toLocaleString();
    }
  }

  /* ==========================================================
     5. LOADING STATUS
  ========================================================== */

  function setLoadingStatus(state, message = "", count = "") {
    const panel = $("rdLoadingStatus");
    const dot = $("rdLoadingDot");
    const title = $("rdLoadingTitle");
    const detail = $("rdLoadingMessage");
    const countEl = $("rdLoadingCount");

    if (!panel || !title || !detail || !countEl) {
      console.warn(
        "[REPORT] Loading status elements are missing."
      );
      return;
    }

    const styles = {
      loading: {
        title: "กำลังโหลดข้อมูล",
        color: "#f59e0b",
        background: "#fffbeb",
        border: "#fde68a"
      },
      success: {
        title: "โหลดข้อมูลสำเร็จ",
        color: "#16a34a",
        background: "#f0fdf4",
        border: "#bbf7d0"
      },
      error: {
        title: "โหลดข้อมูลไม่สำเร็จ",
        color: "#dc2626",
        background: "#fef2f2",
        border: "#fecaca"
      }
    };

    const style = styles[state] || styles.loading;

    title.textContent = style.title;
    detail.textContent = message;
    countEl.textContent = count;

    panel.dataset.loadState = state;
    panel.setAttribute("aria-live", "polite");
    panel.setAttribute("role", "status");
    panel.setAttribute("aria-label", style.title);
    panel.setAttribute("aria-busy", state === "loading" ? "true" : "false");

    panel.style.display = "flex";
    panel.style.background = style.background;
    panel.style.borderColor = style.border;
    panel.style.color = "#334155";

    if (dot) {
      dot.style.background = style.color;
    }
  }

  // ใช้ฟังก์ชันนี้หลังโหลดเสร็จ เพื่อให้ข้อความถูกอัปเดตตรง ๆ
  function setFinalLoadingStatus(total, message = "") {
    setLoadingStatus(
      "success",
      message || "เชื่อมต่อ Google Apps Script และโหลดข้อมูลเรียบร้อยแล้ว",
      `${Number(total).toLocaleString("th-TH")} รายการ`
    );
  }

  /* ==========================================================
     6. ALERT / TABLE STATUS
  ========================================================== */

  function setStatus(message, type = "normal") {
    const element = $("rdTableStatus");
    if (!element) return;

    element.textContent = message || "";

    element.classList.remove(
      "rd-status-success",
      "rd-status-error"
    );

    if (type === "success") {
      element.classList.add("rd-status-success");
    } else if (type === "error") {
      element.classList.add("rd-status-error");
    }
  }

  function showAlert(message, type = "warning") {
    const element = $("rdDashboardAlert");
    if (!element) return;

    element.textContent = message || "";
    element.hidden = !message;

    element.style.borderColor =
      type === "error" ? "#fecaca" : "#f4d6a0";

    element.style.color =
      type === "error" ? "#991b1b" : "#92400e";

    element.style.background =
      type === "error" ? "#fef2f2" : "#fffbeb";
  }

  function clearAlert() {
    showAlert("");
  }

  /* ==========================================================
     7. API REQUEST
  ========================================================== */

  async function apiRequest(action, params = {}) {
    const controller = new AbortController();

    const timeoutId = setTimeout(
      () => controller.abort(),
      CONFIG.API_TIMEOUT
    );

    try {
      console.info("[REPORT API] Request:", action, params);

      const response = await fetch(CONFIG.API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify({
          action,
          key: CONFIG.ACCESS_KEY,
          params
        }),
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal
      });

      const responseText = await response.text();

      console.info("[REPORT API] HTTP:", response.status);
      console.info(
        "[REPORT API] Response preview:",
        responseText.slice(0, 500)
      );

      if (!response.ok) {
        throw new Error(`API ตอบกลับ HTTP ${response.status}`);
      }

      let data;

      try {
        data = JSON.parse(responseText);
      } catch (_) {
        throw new Error(
          "API ส่งข้อมูลกลับมาไม่ใช่ JSON กรุณาตรวจสอบ Code.gs"
        );
      }

      if (!data || typeof data !== "object") {
        throw new Error("รูปแบบข้อมูลจาก API ไม่ถูกต้อง");
      }

      if (data.ok === false || data.success === false || data.error) {
        throw new Error(
          String(
            data.message ||
            data.error ||
            "Google Apps Script ปฏิเสธคำขอ"
          )
        );
      }

      return data;

    } catch (error) {
      console.error("[REPORT API] Error:", error);

      if (error.name === "AbortError") {
        throw new Error(
          `API ไม่ตอบกลับภายใน ${CONFIG.API_TIMEOUT / 1000} วินาที`
        );
      }

      if (error instanceof TypeError) {
        throw new Error(
          "เรียก Google Apps Script ไม่สำเร็จ กรุณาตรวจสอบ URL และสิทธิ์ Web App"
        );
      }

      throw error;

    } finally {
      clearTimeout(timeoutId);
    }
  }

  /* ==========================================================
     8. RESPONSE NORMALIZATION
  ========================================================== */

  function getHeaders(data) {
    if (Array.isArray(data.headers)) return data.headers;
    if (Array.isArray(data.header)) return data.header;
    return [];
  }

  function rowToObject(row, headers) {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      return row;
    }

    const result = {};

    headers.forEach((header, index) => {
      result[header] = Array.isArray(row) ? row[index] : undefined;
    });

    return result;
  }

  function findFieldValue(row, aliases) {
    const keys = Object.keys(row || {});

    for (const alias of aliases) {
      if (
        Object.prototype.hasOwnProperty.call(row, alias) &&
        !isBlank(row[alias])
      ) {
        return row[alias];
      }
    }

    const normalizedMap = new Map(
      keys.map((key) => [normalizeKey(key), key])
    );

    for (const alias of aliases) {
      const key = normalizedMap.get(normalizeKey(alias));

      if (key !== undefined && !isBlank(row[key])) {
        return row[key];
      }
    }

    return "";
  }

  function getField(row, name) {
    return findFieldValue(row, FIELDS[name] || [name]);
  }

  function normalizeRow(row, headers, index) {
    const source = rowToObject(row, headers);

    return {
      _id: `rd-row-${index}`,
      _source: source,

      year: getField(source, "year"),
      group: getField(source, "group"),
      excellence: getField(source, "excellence"),
      section: getField(source, "section"),

      kpi: getField(source, "kpi"),
      description: getField(source, "description"),

      numerator: getField(source, "numerator"),
      denominator: getField(source, "denominator"),
      rate: getField(source, "rate"),

      evaluate: getField(source, "evaluate"),
      indicate: getField(source, "indicate"),
      standard: getField(source, "standard"),

      formula: getField(source, "formula"),
      criterion: getField(source, "criterion"),

      result: getField(source, "result"),
      target: getField(source, "target"),
      unit: getField(source, "unit"),
      percent: getField(source, "percent"),

      summary: getField(source, "summary")
    };
  }

  /* ==========================================================
     9. FETCH ALL ROWS
  ========================================================== */

  async function fetchAllRows() {
    const allRows = [];
    let headers = [];
    let page = 1;
    let expectedTotal = null;
    let expectedPages = null;

    while (page <= CONFIG.MAX_PAGES) {
      setLoadingStatus(
        "loading",
        `กำลังอ่านข้อมูลจากชีต ${CONFIG.SHEET_NAME}`,
        `หน้า ${page}`
      );

      const response = await apiRequest("data", {
        sheet: CONFIG.SHEET_NAME,
        page,
        pageSize: CONFIG.PAGE_SIZE,
        limit: CONFIG.PAGE_SIZE
      });

      const currentHeaders = getHeaders(response);
      if (currentHeaders.length) headers = currentHeaders;

      const rows = Array.isArray(response.rows)
        ? response.rows
        : Array.isArray(response.data)
          ? response.data
          : [];

      if (expectedTotal === null && response.total !== undefined) {
        const total = Number(response.total);
        if (Number.isFinite(total)) expectedTotal = total;
      }

      if (expectedPages === null) {
        const pages = Number(response.totalPages ?? response.pages ?? 0);
        if (Number.isFinite(pages) && pages > 0) {
          expectedPages = pages;
        }
      }

      if (!rows.length) break;

      allRows.push(...rows);

      setLoadingStatus(
        "loading",
        "กำลังรับข้อมูลจาก Google Apps Script",
        `${allRows.length.toLocaleString("th-TH")} รายการ`
      );

      if (expectedTotal !== null && allRows.length >= expectedTotal) {
        break;
      }

      if (expectedPages !== null && page >= expectedPages) {
        break;
      }

      if (rows.length < CONFIG.PAGE_SIZE) break;

      page += 1;
    }

    if (page > CONFIG.MAX_PAGES) {
      console.warn("[REPORT] ถึง MAX_PAGES แล้ว อาจโหลดไม่ครบ");
    }

    return {
      headers,
      rows: allRows,
      expectedTotal
    };
  }

  /* ==========================================================
     10. CHART.JS LOADER
  ========================================================== */

  function ensureChartJS() {
    if (window.Chart) return Promise.resolve(true);
    if (STATE.chartPromise) return STATE.chartPromise;

    STATE.loadingChart = true;

    STATE.chartPromise = new Promise((resolve) => {
      let finished = false;
      let script = document.querySelector(
        'script[data-report-chartjs="true"]'
      );

      let timeoutId;

      const finish = (success) => {
        if (finished) return;
        finished = true;

        clearTimeout(timeoutId);
        STATE.loadingChart = false;
        STATE.chartPromise = null;

        resolve(Boolean(success && window.Chart));
      };

      timeoutId = setTimeout(
        () => finish(false),
        CONFIG.CHART_TIMEOUT
      );

      if (script && window.Chart) {
        finish(true);
        return;
      }

      if (!script) {
        script = document.createElement("script");
        script.src = CONFIG.CHART_JS_URL;
        script.async = true;
        script.dataset.reportChartjs = "true";
      } else {
        // สคริปต์เดิมอาจโหลดเสร็จหรือผิดพลาดไปแล้ว
        script.remove();
        script = document.createElement("script");
        script.src = CONFIG.CHART_JS_URL;
        script.async = true;
        script.dataset.reportChartjs = "true";
      }

      script.addEventListener("load", () => finish(true), { once: true });
      script.addEventListener("error", () => finish(false), { once: true });

      document.head.appendChild(script);
    });

    return STATE.chartPromise;
  }

  /* ==========================================================
     11. FILTERS
  ========================================================== */

  function populateSelect(id, values, placeholder) {
    const select = $(id);
    if (!select) return;

    const previousValue = select.value;
    select.innerHTML = "";

    const first = document.createElement("option");
    first.value = "";
    first.textContent = placeholder;
    select.appendChild(first);

    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });

    if (values.includes(previousValue)) {
      select.value = previousValue;
    }
  }

  function populateFilters() {
    const sortThai = (a, b) =>
      a.localeCompare(b, "th", { numeric: true });

    const sortYear = (a, b) =>
      String(b).localeCompare(String(a), "th", { numeric: true });

    populateSelect(
      "rdFilterYear",
      unique(STATE.rawRows.map((row) => row.year)).sort(sortYear),
      "ทุกปีงบประมาณ"
    );

    populateSelect(
      "rdFilterGroup",
      unique(STATE.rawRows.map((row) => row.group)).sort(sortThai),
      "ทุกกลุ่ม KPI"
    );

    populateSelect(
      "rdFilterExcellence",
      unique(STATE.rawRows.map((row) => row.excellence)).sort(sortThai),
      "ทุก Excellence"
    );

    populateSelect(
      "rdFilterSection",
      unique(STATE.rawRows.map((row) => row.section)).sort(sortThai),
      "ทุกหน่วยงาน"
    );
  }

  function applyFilters() {
    const year = normalizeText($("rdFilterYear")?.value);
    const group = normalizeText($("rdFilterGroup")?.value);
    const excellence = normalizeText($("rdFilterExcellence")?.value);
    const section = normalizeText($("rdFilterSection")?.value);
    const search = normalizeText($("rdFilterSearch")?.value)
      .toLocaleLowerCase("th");

    STATE.page = 1;

    STATE.filteredRows = STATE.rawRows.filter((row) => {
      if (year && normalizeText(row.year) !== year) return false;
      if (group && normalizeText(row.group) !== group) return false;
      if (excellence && normalizeText(row.excellence) !== excellence) return false;
      if (section && normalizeText(row.section) !== section) return false;

      if (search) {
        const text = [
          row.kpi,
          row.description,
          row.group,
          row.excellence,
          row.section,
          row.formula,
          row.criterion,
          row.result,
          row.target,
          row.summary
        ].map(normalizeText).join(" ").toLocaleLowerCase("th");

        if (!text.includes(search)) return false;
      }

      return true;
    });

    renderAll();

    setStatus(
      `แสดง ${formatNumber(STATE.filteredRows.length, 0)} จาก ${formatNumber(STATE.rawRows.length, 0)} รายการ`
    );
  }

  function resetFilters() {
    [
      "rdFilterYear",
      "rdFilterGroup",
      "rdFilterExcellence",
      "rdFilterSection",
      "rdFilterSearch"
    ].forEach((id) => {
      const element = $(id);
      if (element) element.value = "";
    });

    applyFilters();
  }

  /* ==========================================================
     12. SUMMARY CARDS
  ========================================================== */

  /* ==========================================================
     13. CHARTS
  ========================================================== */

  const CHART_FONT = '"IBM Plex Sans Thai", "Inter", system-ui, sans-serif';

  function ensureChartDefaults() {
    const C = window.Chart;
    if (!C || C.__rdStyled) return;

    C.__rdStyled = true;

    // ตั้งค่า style กลาง — ถ้าเวอร์ชัน Chart.js ไม่รองรับบางค่า ให้ข้ามไป ไม่ให้กราฟพัง
    try {
      C.defaults.font.family = CHART_FONT;
      C.defaults.font.size = 12;
      C.defaults.color = "#52675c";

      Object.assign(C.defaults.plugins.tooltip, {
        backgroundColor: "rgba(20, 53, 42, 0.95)",
        titleColor: "#ffffff",
        bodyColor: "#e4f2ea",
        footerColor: "#bfe3cf",
        padding: 12,
        cornerRadius: 10,
        boxPadding: 5,
        caretSize: 6
      });

      C.defaults.plugins.tooltip.titleFont = { weight: "600", size: 13 };
    } catch (error) {
      console.warn("[REPORT CHART] ตั้งค่า style กราฟไม่สำเร็จ:", error);
    }
  }

  // แสดงจำนวนรวมตรงกลางกราฟโดนัท
  const doughnutCenterPlugin = {
    id: "rdDoughnutCenter",

    afterDraw(chart) {
      const area = chart.chartArea;
      const data = chart.data.datasets[0]?.data || [];
      if (!area || !data.length) return;

      const total = data.reduce((sum, item) => sum + Number(item || 0), 0);
      const x = (area.left + area.right) / 2;
      const y = (area.top + area.bottom) / 2;
      const { ctx } = chart;

      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      ctx.fillStyle = "#172b22";
      ctx.font = `700 28px ${CHART_FONT}`;
      ctx.fillText(formatNumber(total, 0), x, y - 8);

      ctx.fillStyle = "#829187";
      ctx.font = `500 12px ${CHART_FONT}`;
      ctx.fillText("ตัวชี้วัด", x, y + 16);

      ctx.restore();
    }
  };

  function destroyChart(key) {
    const chart = STATE.charts[key];

    if (chart && typeof chart.destroy === "function") {
      chart.destroy();
    }

    STATE.charts[key] = null;
  }

  function renderCharts(rows) {
    ensureChartDefaults();

    if (!window.Chart) {
      destroyChart("group");

      setText("rdGroupChartNote", "ไม่พบ Chart.js จึงไม่สามารถแสดงกราฟได้");

      return false;
    }

    let result = true;

    try {
      renderGroupChart(rows);
    } catch (error) {
      console.error("[REPORT CHART] Group chart error:", error);
      destroyChart("group");
      setText("rdGroupChartNote", "สร้างกราฟจำนวนตัวชี้วัดตามกลุ่มไม่สำเร็จ");
      result = false;
    }

    return result;
  }

  const GROUP_EMPTY_LABEL = "ไม่ระบุกลุ่ม";
  const GROUP_OTHER_LABEL = "อื่น ๆ";
  const GROUP_MAX_SLICES = 12;

  const GROUP_PALETTE = [
    "#1a8f63", "#4f8fd6", "#14a3a0", "#e3a634",
    "#8b6bd6", "#d9628b", "#3aa0bd", "#7bb342",
    "#e07b39", "#6b7a8f", "#2fbf9a", "#a779d6"
  ];

/* ==========================================================
   EXCELLENCE SUMMARY — นับจากคอลัมน์ Summary
========================================================== */

function renderExcellenceSummary(rows, selectedGroup, groupMap = null) {
  const container = $("rdExcellenceSummary");
  if (!container) return;

  const selectedGroups = groupMap?.get(selectedGroup) || [selectedGroup];

  const selectedRows = rows.filter((row) => {
    const group = normalizeText(row.group) || GROUP_EMPTY_LABEL;
    return selectedGroups.includes(group);
  });

  // นับ Summary แยกตาม Excellence และข้อความ Summary
  const counts = new Map();
  let totalSummary = 0;
  let rowsWithoutSummary = 0;

  selectedRows.forEach((row) => {
    const excellence = normalizeText(row.excellence) || "ไม่ระบุ Excellence";
    const summary = normalizeText(row.summary);

    if (!summary) {
      rowsWithoutSummary++;
      return;
    }

    if (!counts.has(excellence)) {
      counts.set(excellence, new Map());
    }

    const summaryMap = counts.get(excellence);

    summaryMap.set(
      summary,
      (summaryMap.get(summary) || 0) + 1
    );

    totalSummary++;
  });

  const excellenceEntries = [...counts.entries()].sort(
    (a, b) => {
      const countA = [...a[1].values()].reduce((sum, n) => sum + n, 0);
      const countB = [...b[1].values()].reduce((sum, n) => sum + n, 0);

      return countB - countA || a[0].localeCompare(b[0], "th");
    }
  );

  const heading = selectedGroups.length > 1
    ? `สรุป Excellence: ${selectedGroup}`
    : `สรุป Excellence: ${selectedGroup}`;

  if (!totalSummary) {
    container.innerHTML = `
      <div class="rd-excellence-header">
        <h3>${escapeHTML(heading)}</h3>
        <p>ตัวชี้วัดที่ตรงกับกลุ่ม: ${formatNumber(selectedRows.length, 0)} รายการ</p>
      </div>
      <div class="rd-excellence-empty">
        ไม่พบข้อมูล Summary ที่มีค่าในกลุ่มนี้
      </div>
    `;
    return;
  }

  const detailHTML = excellenceEntries.map(([excellence, summaryMap]) => {
    const excellenceTotal = [...summaryMap.values()]
      .reduce((sum, n) => sum + n, 0);

    const summaryHTML = [...summaryMap.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "th"))
      .map(([summary, count]) => {
        const percent = count / totalSummary * 100;

        return `
          <div class="rd-excellence-item">
            <span class="rd-excellence-summary-text">
              ${escapeHTML(summary)}
            </span>
            <strong>${formatNumber(count, 0)}</strong>
            <small>${formatNumber(percent, 1)}%</small>
          </div>
        `;
      }).join("");

    return `
      <article class="rd-excellence-card">
        <div class="rd-excellence-card-header">
          <div>
            <h4>${escapeHTML(excellence)}</h4>
            <small>จำนวน Summary ${formatNumber(excellenceTotal, 0)} รายการ</small>
          </div>
          <strong>${formatNumber(excellenceTotal / totalSummary * 100, 1)}%</strong>
        </div>
        <div class="rd-excellence-list">
          ${summaryHTML}
        </div>
      </article>
    `;
  }).join("");

  container.innerHTML = `
    <div class="rd-excellence-header">
      <h3>${escapeHTML(heading)}</h3>
      <p>จำแนกตาม Excellence และนับรายการจาก Summary</p>
    </div>

    <div class="rd-excellence-kpis">
      <div class="rd-excellence-stat">
        <span>ตัวชี้วัดในกลุ่ม</span>
        <strong>${formatNumber(selectedRows.length, 0)}</strong>
      </div>
      <div class="rd-excellence-stat">
        <span>รายการ Summary ที่นับได้</span>
        <strong>${formatNumber(totalSummary, 0)}</strong>
      </div>
      <div class="rd-excellence-stat">
        <span>รายการไม่มี Summary</span>
        <strong>${formatNumber(rowsWithoutSummary, 0)}</strong>
      </div>
    </div>

    <div class="rd-excellence-cards">
      ${detailHTML}
    </div>
  `;
}

/* ==========================================================
   NAVIGATE TO EXCELLENCE.HTML
========================================================== */

function openExcellencePage(selectedGroup) {
  const url = new URL("Excellence.html", document.baseURI);

  // ส่งชื่อกลุ่ม KPI ที่คลิกจากกราฟ
  url.searchParams.set("group", selectedGroup);

  // ส่งชื่อ Excellence สำหรับใช้กรองข้อมูลในหน้าปลายทาง
  url.searchParams.set("excellence", selectedGroup);

  window.location.href = url.href;
}

  // จำนวนตัวชี้วัดตามกลุ่ม (คอลัมน์ kpi_Group_Des)
  
function renderGroupChart(rows) {
  const canvas = $("rdGroupChart");
  if (!canvas) return;

  destroyChart("group");

  const counts = new Map();

  rows.forEach((row) => {
    const label = normalizeText(row.group) || GROUP_EMPTY_LABEL;
    counts.set(label, (counts.get(label) || 0) + 1);
  });

  if (!counts.size) {
    setText("rdGroupChartNote", "ไม่มีข้อมูลกลุ่มตัวชี้วัดสำหรับแสดงกราฟ");

    const summary = $("rdExcellenceSummary");
    if (summary) {
      summary.innerHTML = `
        <div class="rd-excellence-empty">
          ไม่มีข้อมูลกลุ่มตัวชี้วัดสำหรับสรุป Excellence
        </div>
      `;
    }
    return;
  }

  let entries = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "th")
  );

  const groupMap = new Map();

  entries.forEach(([label]) => {
    groupMap.set(label, [label]);
  });

  // รวมกลุ่มที่เกินจำนวนแผ่นสูงสุดเป็น "อื่น ๆ"
  if (entries.length > GROUP_MAX_SLICES) {
    const rest = entries.slice(GROUP_MAX_SLICES - 1);

    entries = entries.slice(0, GROUP_MAX_SLICES - 1);

    entries.push([
      GROUP_OTHER_LABEL,
      rest.reduce((sum, item) => sum + item[1], 0)
    ]);

    groupMap.set(
      GROUP_OTHER_LABEL,
      rest.map((item) => item[0])
    );
  }

  const labels = entries.map((item) => item[0]);
  const values = entries.map((item) => item[1]);
  const total = values.reduce((sum, value) => sum + value, 0);

  const colors = labels.map((label, index) =>
    label === GROUP_OTHER_LABEL || label === GROUP_EMPTY_LABEL
      ? "#b4bdb8"
      : GROUP_PALETTE[index % GROUP_PALETTE.length]
  );

  setText(
    "rdGroupChartNote",
    `แสดง ${formatNumber(counts.size, 0)} กลุ่มตัวชี้วัด · รวม ${formatNumber(total, 0)} ตัวชี้วัด · คลิกกราฟเพื่อดู Excellence`
  );

  const container = canvas.parentElement;
  if (container) container.style.height = "360px";

  STATE.charts.group = new window.Chart(canvas, {
    type: "doughnut",
    plugins: [doughnutCenterPlugin],

    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderColor: "#ffffff",
        borderWidth: 3,
        hoverOffset: 8
      }]
    },

    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",

      // คลิกส่วนกราฟเพื่อแสดงสรุป Excellence
     
onClick(event, elements, chart) {
  if (!elements.length) return;

  const index = elements[0].index;
  const selectedGroup = chart.data.labels[index];

  // เปิดหน้า Excellence.html เมื่อคลิกกลุ่มในกราฟ
  openExcellencePage(selectedGroup);
},

      plugins: {
        legend: {
          position: "bottom",
          labels: {
            usePointStyle: true,
            pointStyle: "circle",
            boxWidth: 8,
            padding: 14
          }
        },

        tooltip: {
          callbacks: {
            label(context) {
              const value = Number(context.raw || 0);
              const percent = total
                ? formatNumber((value / total) * 100, 1)
                : "0";

              return `${context.label}: ${formatNumber(value, 0)} รายการ (${percent}%)`;
            }
          }
        }
      }
    }
  });
}

  /* ==========================================================
     14. TABLE
  ========================================================== */

  function badgeClass(row) {
    const result = numberValue(row.result);
    const target = numberValue(row.target);

    return result === null || target === null
      ? "rd-badge-neutral"
      : "rd-badge-blue";
  }

  function renderEmptyTable(message) {
    const body = $("rdKpiTableBody");
    if (!body) return;

    body.innerHTML = `
      <tr>
        <td colspan="7" class="rd-empty rd-table-placeholder">${escapeHTML(message)}</td>
      </tr>
    `;

    setText("rdVisibleCount", "0");
  }

  function formatRate(value) {
    if (isBlank(value)) return "—";

    const text = String(value).trim();
    const number = numberValue(value);

    if (number === null) return text;

    // แสดง % เฉพาะเมื่อค่าต้นฉบับมี % หรือ field บ่งบอกว่าเป็นเปอร์เซ็นต์
    return text.includes("%")
      ? `${formatNumber(number)}%`
      : formatNumber(number);
  }

  function renderPagination(from, to, total, page, totalPages) {
    setText(
      "rdPaginationInfo",
      `แสดง ${formatNumber(from, 0)}–${formatNumber(to, 0)} จาก ${formatNumber(total, 0)} รายการ`
    );
    setText("rdPageInfo", `หน้า ${page} / ${totalPages}`);

    const prev = $("rdPrevPage");
    const next = $("rdNextPage");
    if (prev) prev.disabled = page <= 1;
    if (next) next.disabled = page >= totalPages;
  }

  function renderTable(rows) {
    const body = $("rdKpiTableBody");
    if (!body) return;

    setText("rdVisibleCount", formatNumber(rows.length, 0));

    if (!rows.length) {
      renderEmptyTable("ไม่พบข้อมูลที่ตรงกับเงื่อนไข");
      renderPagination(0, 0, 0, 1, 1);
      return;
    }

    const totalPages = Math.max(1, Math.ceil(rows.length / STATE.pageSize));
    STATE.page = Math.min(Math.max(1, STATE.page), totalPages);

    const startIndex = (STATE.page - 1) * STATE.pageSize;
    const pageRows = rows.slice(startIndex, startIndex + STATE.pageSize);

    renderPagination(
      startIndex + 1,
      startIndex + pageRows.length,
      rows.length,
      STATE.page,
      totalPages
    );

    body.innerHTML = pageRows.map((row) => {
      const title = row.kpi || "ไม่ระบุรหัส KPI";
      const description = row.description || "";

      const resultText = isBlank(row.result)
        ? "—"
        : `${formatNumber(row.result)}${row.unit ? ` ${row.unit}` : ""}`;

      const targetText = isBlank(row.target)
        ? "—"
        : `${formatNumber(row.target)}${row.unit ? ` ${row.unit}` : ""}`;

      return `
        <tr data-rd-id="${escapeHTML(row._id)}">
          <td>${escapeHTML(row.year || "—")}</td>
          <td>${escapeHTML(row.group || "—")}</td>

          <td>
            <div class="rd-kpi-name">${escapeHTML(title)}</div>
            ${
              description
                ? `<span class="rd-kpi-description">${escapeHTML(description)}</span>`
                : ""
            }
          </td>

          <td class="rd-number">
            <span class="rd-badge ${badgeClass(row)}">${escapeHTML(resultText)}</span>
          </td>

          <td class="rd-number">${escapeHTML(targetText)}</td>
          <td class="rd-number">${escapeHTML(formatRate(row.percent))}</td>
          <td>${escapeHTML(row.summary || "—")}</td>
        </tr>
      `;
    }).join("");
  }

  /* ==========================================================
     16. RENDER ALL
  ========================================================== */

  function renderAll() {
    const rows = STATE.filteredRows;

    renderCharts(rows);
    renderTable(rows);
  }

  /* ==========================================================
     17. EVENT HANDLERS
  ========================================================== */

  function exportDashboardXlsx() {
    if (!STATE.rawRows.length) return;

    if (!window.XLSX) {
      showAlert("โหลดไลบรารี Excel (SheetJS) ไม่สำเร็จ จึงส่งออกไม่ได้", "error");
      return;
    }

    const rows = STATE.filteredRows;
    const headers = [
      "ปีงบประมาณ", "กลุ่มตัวชี้วัด", "Excellence", "หน่วยงาน",
      "รหัส KPI", "คำอธิบาย", "ผลลัพธ์", "เป้าหมาย",
      "ร้อยละ", "สรุปผล", "เกณฑ์", "สูตร"
    ];

    const data = [
      headers,
      ...rows.map((row) => [
        row.year, row.group, row.excellence, row.section,
        row.kpi, row.description, row.result, row.target,
        row.percent, row.summary, row.criterion, row.formula
      ])
    ];

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(workbook, worksheet, "REPORT_KPI");
    XLSX.writeFile(workbook, "REPORT_KPI_export.xlsx");
  }

  function bindEvents() {
    [
      "rdFilterYear",
      "rdFilterGroup",
      "rdFilterExcellence",
      "rdFilterSection"
    ].forEach((id) => {
      $(id)?.addEventListener("change", applyFilters);
    });

    let searchTimer;
    $("rdFilterSearch")?.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(applyFilters, 200);
    });
    $("rdResetFilters")?.addEventListener("click", resetFilters);

    $("rdRefreshBtn")?.addEventListener("click", () => {
      loadDashboard();
    });

    $("rdExportBtn")?.addEventListener("click", exportDashboardXlsx);


    $("rdPageSize")?.addEventListener("change", (event) => {
      const size = Number(event.target.value);
      STATE.pageSize = Number.isFinite(size) && size > 0 ? size : 25;
      STATE.page = 1;
      renderTable(STATE.filteredRows);
    });

    $("rdPrevPage")?.addEventListener("click", () => {
      if (STATE.page > 1) {
        STATE.page -= 1;
        renderTable(STATE.filteredRows);
      }
    });

    $("rdNextPage")?.addEventListener("click", () => {
      STATE.page += 1;
      renderTable(STATE.filteredRows);
    });
  }

  /* ==========================================================
     18. INITIALIZE
  ========================================================== */

  function initDashboard() {
    if (STATE.initialized || !root()) return;

    STATE.initialized = true;
    bindEvents();

    setLoadingStatus(
      "loading",
      "กำลังเชื่อมต่อ Google Apps Script...",
      "กำลังโหลด"
    );

    loadDashboard();
  }

  /* ==========================================================
     19. LOAD DATA
  ========================================================== */

  async function loadDashboard(options = {}) {
    if (STATE.loading || !root()) return;

    STATE.loading = true;
    STATE.loadError = null;

    clearAlert();

    const exportBtn = $("rdExportBtn");
    if (exportBtn) exportBtn.disabled = true;

    setLoadingStatus(
      "loading",
      "กำลังอ่านข้อมูลจากชีต REPORT_02...",
      "กำลังโหลด"
    );

    setStatus("กำลังโหลดข้อมูลจาก REPORT_02...");

    try {
      // ไม่ให้ปัญหา Chart.js ขัดขวางการโหลดข้อมูล
      const chartPromise = ensureChartJS().catch((error) => {
        console.error("[REPORT CHART] Loader error:", error);
        return false;
      });

      const result = await fetchAllRows();
      const chartAvailable = await chartPromise;

      STATE.rawRows = result.rows.map((row, index) =>
        normalizeRow(row, result.headers, index)
      );

      STATE.lastUpdated = new Date();

      if (exportBtn) exportBtn.disabled = STATE.rawRows.length === 0;

      populateFilters();

      STATE.filteredRows = [...STATE.rawRows];
      STATE.page = 1;

      renderTable(STATE.filteredRows);

      const chartsRendered = chartAvailable
        ? renderCharts(STATE.filteredRows)
        : false;

      if (!chartAvailable) {
        setText(
          "rdGroupChartNote",
          "โหลดข้อมูลแล้ว แต่โหลด Chart.js ไม่สำเร็จ"
        );
      }

      setText("rdLastUpdated", formatDate(STATE.lastUpdated));

      const total = STATE.rawRows.length;
      const expected = result.expectedTotal;

      if (total === 0) {
        setFinalLoadingStatus(
          0,
          "API ตอบกลับแล้ว แต่ไม่พบข้อมูลในชีต REPORT_02"
        );

        showAlert(
          "ไม่พบข้อมูล กรุณาตรวจสอบชื่อชีตและการตั้งค่า API ใน Code.gs",
          "warning"
        );

        setStatus("เชื่อมต่อสำเร็จ แต่ไม่พบข้อมูล", "success");

      } else if (expected !== null && total < expected) {
        setFinalLoadingStatus(
          total,
          `โหลดได้ ${total.toLocaleString("th-TH")} จาก ${expected.toLocaleString("th-TH")} รายการ`
        );

        showAlert(
          `โหลดข้อมูลได้ ${total} จาก ${expected} รายการ กรุณาตรวจสอบ pagination`,
          "warning"
        );

        setStatus("โหลดข้อมูลแล้ว แต่ควรตรวจสอบจำนวนรายการ", "success");

      } else if (!chartsRendered) {
        setFinalLoadingStatus(
          total,
          "โหลดข้อมูลสำเร็จ แต่กราฟไม่พร้อมใช้งาน"
        );

        showAlert(
          "ข้อมูลโหลดแล้ว แต่สร้างกราฟไม่ได้ สามารถใช้ตารางได้ตามปกติ",
          "warning"
        );

        setStatus(
          `โหลดข้อมูลสำเร็จ ${total.toLocaleString("th-TH")} รายการ`,
          "success"
        );

      } else {
        setFinalLoadingStatus(
          total,
          "เชื่อมต่อ Google Apps Script และแสดง Dashboard เรียบร้อยแล้ว"
        );

        clearAlert();

        setStatus(
          `โหลดข้อมูลสำเร็จ ${total.toLocaleString("th-TH")} รายการ`,
          "success"
        );
      }

      console.info("[REPORT] Dashboard loaded", {
        totalRows: total,
        expectedTotal: expected,
        chartAvailable,
        chartsRendered
      });

    } catch (error) {
      STATE.loadError = error?.message || String(error);

      console.error("[REPORT] Dashboard load error:", error);

      setLoadingStatus(
        "error",
        STATE.loadError,
        "ไม่สำเร็จ"
      );

      showAlert(STATE.loadError, "error");
      setStatus("โหลดข้อมูลไม่สำเร็จ", "error");

      if (!options.silent) {
        renderEmptyTable("ไม่สามารถโหลดข้อมูลได้");
      }

    } finally {
      STATE.loading = false;
    }
  }

  /* ==========================================================
     20. LOAD dashboard.HTML
  ========================================================== */

 
  /* ==========================================================
     20. LOAD dashboard.html
     Frontend: GitHub Pages
  ========================================================== */

  async function loadDashboardHTML() {
    // ป้องกันการโหลด HTML ซ้อนกัน
    if (STATE.loadingHTML) return;

    const mount = $("dashboardMount");

    if (!mount) {
      // อาจมี dashboard อยู่ในหน้าโดยตรง
      if (root()) {
        initDashboard();
      } else {
        console.error(
          "[REPORT] ไม่พบ #dashboardMount และ #reportKpiDashboard"
        );
      }
      return;
    }

    // ถ้าโหลดและเริ่มต้นแล้ว ไม่ต้องโหลดซ้ำ
    if (
      mount.dataset.rdLoaded === "true" &&
      root() &&
      STATE.initialized
    ) {
      return;
    }

    // ไม่รองรับการ fetch ไฟล์ผ่าน file://
    if (window.location.protocol === "file:") {
      mount.innerHTML = `
        <div class="card" role="alert">
          <h3>กรุณาเปิดเว็บไซต์ผ่านเว็บเซิร์ฟเวอร์</h3>
          <p>ไม่สามารถโหลด dashboard.html ผ่าน file:// ได้</p>
          <p>ใช้ GitHub Pages หรือ python -m http.server 8000</p>
        </div>
      `;
      return;
    }

    STATE.loadingHTML = true;

    mount.innerHTML = `
      <div class="card" role="status" aria-live="polite">
        กำลังโหลด Dashboard...
      </div>
    `;

    try {
      // สำคัญ: ใช้ dashboard.html ตัวพิมพ์เล็ก
      // URL นี้อิงจาก URL ของหน้าเว็บที่กำลังเปิด
      const url = new URL(
        "dashboard.html",
        document.baseURI
      );

      // ป้องกันการใช้ cache ของ HTML เก่า
      url.searchParams.set("_", String(Date.now()));

      console.info("[REPORT] Loading dashboard HTML:", url.href);

      const response = await fetch(url.href, {
        method: "GET",
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(
          `โหลด dashboard.html ไม่สำเร็จ ` +
          `(HTTP ${response.status}) — ${url.pathname}`
        );
      }

      const html = await response.text();

      if (!html.trim()) {
        throw new Error("ไฟล์ dashboard.html ไม่มีเนื้อหา");
      }

      // ตรวจสอบว่าเป็นไฟล์ Dashboard ที่ถูกต้อง
      const parser = new DOMParser();
      const parsedHTML = parser.parseFromString(
        html,
        "text/html"
      );

      const dashboardRoot = parsedHTML.getElementById(
        "reportKpiDashboard"
      );

      if (!dashboardRoot) {
        throw new Error(
          'ไม่พบ id="reportKpiDashboard" ใน dashboard.html'
        );
      }

      // แทรกเนื้อหา Dashboard ลงในหน้า
      mount.innerHTML = dashboardRoot.outerHTML;
      mount.dataset.rdLoaded = "true";

      // เริ่มต้นระบบหลังจากแทรก HTML แล้ว
      initDashboard();

      console.info("[REPORT] Dashboard HTML loaded successfully");

    } catch (error) {
      console.error("[REPORT] Dashboard HTML error:", error);

      mount.dataset.rdLoaded = "false";

      mount.innerHTML = `
        <div class="card" role="alert">
          <h3>ไม่สามารถโหลด Dashboard ได้</h3>
          <p>${escapeHTML(
            error.message || "เกิดข้อผิดพลาด"
          )}</p>
          <p>
            ตรวจสอบตำแหน่งไฟล์ dashboard.html
            และการเผยแพร่ GitHub Pages
          </p>
          <button
            type="button"
            class="rd-btn rd-btn-light"
            id="rdRetryLoadHTML"
          >
            ลองโหลดอีกครั้ง
          </button>
        </div>
      `;

      $("rdRetryLoadHTML")?.addEventListener(
        "click",
        loadDashboardHTML
      );

    } finally {
      STATE.loadingHTML = false;
    }
  }


  /* ==========================================================
     21. STARTUP
  ========================================================== */

  function startDashboard() {
    const mount = $("dashboardMount");

    if (mount) {
      if (
        mount.dataset.rdLoaded === "true" &&
        root() &&
        STATE.initialized
      ) {
        return;
      }

      loadDashboardHTML();
      return;
    }

    if (root()) {
      initDashboard();
      return;
    }

    console.error(
      "[REPORT] ไม่พบทั้ง #dashboardMount และ #reportKpiDashboard"
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      startDashboard,
      { once: true }
    );
  } else {
    startDashboard();
  }

  /* ==========================================================
     22. PUBLIC API
  ========================================================== */

  window.REPORT_KPI_DASHBOARD = {
    refresh: () => loadDashboard(),
    reloadHTML: () => loadDashboardHTML(),
    applyFilters,
    resetFilters,

    getState: () => ({
      loading: STATE.loading,
      loadingHTML: STATE.loadingHTML,
      loadingChart: STATE.loadingChart,
      initialized: STATE.initialized,
      totalRows: STATE.rawRows.length,
      filteredRows: STATE.filteredRows.length,
      lastUpdated: STATE.lastUpdated,
      loadError: STATE.loadError
    })
  };

})();
