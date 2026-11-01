/* ============================================================
 * REPORT KPI DASHBOARD
 * File       : app_dashboard.js
 * Frontend   : GitHub Pages
 * HTML       : dashboard.html
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
    XLSX_URL:
      "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",

    // ชื่อไฟล์หน้าปลายทาง — ต้องตรงกับไฟล์ใน repo (ตัวพิมพ์เล็ก/ใหญ่มีผล)
    // หน้าเหล่านี้ต้องอยู่โฟลเดอร์เดียวกับหน้า dashboard
    PAGES: {
      KPI: "KPI.html",
      EXCELLENCE: "Excellence.html"
    },

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
    scripts: {},           // promise ของสคริปต์ภายนอกที่กำลังโหลด

    rawRows: [],
    filteredRows: [],

    page: 1,
    pageSize: 25,

    charts: { group: null },

    lastUpdated: null,
    loadError: null
  };

  /* ==========================================================
     4. DOM / VALUE HELPERS
  ========================================================== */

  const $ = (id) => document.getElementById(id);
  const root = () => $("reportKpiDashboard");

  const normalizeText = (value) => String(value ?? "").trim();

  const normalizeKey = (value) =>
    normalizeText(value).toLowerCase().replace(/[\s_\-./()]+/g, "");

  const isBlank = (value) =>
    value === null || value === undefined || String(value).trim() === "";

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

  const unique = (values) =>
    [...new Set(values.map(normalizeText).filter(Boolean))];

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

    if (!/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(text)) return null;

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
     5. LOADING STATUS / ALERT
  ========================================================== */

  function setLoadingStatus(state, message = "", count = "") {
    const panel = $("rdLoadingStatus");
    const dot = $("rdLoadingDot");
    const title = $("rdLoadingTitle");
    const detail = $("rdLoadingMessage");
    const countEl = $("rdLoadingCount");

    if (!panel || !title || !detail || !countEl) {
      console.warn("[REPORT] Loading status elements are missing.");
      return;
    }

    const styles = {
      loading: { title: "กำลังโหลดข้อมูล", color: "#f59e0b", background: "#fffbeb", border: "#fde68a" },
      success: { title: "โหลดข้อมูลสำเร็จ", color: "#16a34a", background: "#f0fdf4", border: "#bbf7d0" },
      error:   { title: "โหลดข้อมูลไม่สำเร็จ", color: "#dc2626", background: "#fef2f2", border: "#fecaca" }
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

    if (dot) dot.style.background = style.color;
  }

  function setFinalLoadingStatus(total, message = "") {
    setLoadingStatus(
      "success",
      message || "เชื่อมต่อ Google Apps Script และโหลดข้อมูลเรียบร้อยแล้ว",
      `${Number(total).toLocaleString("th-TH")} รายการ`
    );
  }

  function setStatus(message, type = "normal") {
    const element = $("rdTableStatus");
    if (!element) return;

    element.textContent = message || "";
    element.classList.remove("rd-status-success", "rd-status-error");

    if (type === "success") element.classList.add("rd-status-success");
    else if (type === "error") element.classList.add("rd-status-error");
  }

  function showAlert(message, type = "warning") {
    const element = $("rdDashboardAlert");
    if (!element) return;

    element.textContent = message || "";
    element.hidden = !message;

    element.style.borderColor = type === "error" ? "#fecaca" : "#f4d6a0";
    element.style.color = type === "error" ? "#991b1b" : "#92400e";
    element.style.background = type === "error" ? "#fef2f2" : "#fffbeb";
  }

  const clearAlert = () => showAlert("");

  /* ==========================================================
     6. API REQUEST
  ========================================================== */

  async function apiRequest(action, params = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT);

    try {
      const response = await fetch(CONFIG.API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action, key: CONFIG.ACCESS_KEY, params }),
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal
      });

      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(`API ตอบกลับ HTTP ${response.status}`);
      }

      let data;
      try {
        data = JSON.parse(responseText);
      } catch (_) {
        throw new Error("API ส่งข้อมูลกลับมาไม่ใช่ JSON กรุณาตรวจสอบ Code.gs");
      }

      if (!data || typeof data !== "object") {
        throw new Error("รูปแบบข้อมูลจาก API ไม่ถูกต้อง");
      }

      if (data.ok === false || data.success === false || data.error) {
        throw new Error(
          String(data.message || data.error || "Google Apps Script ปฏิเสธคำขอ")
        );
      }

      return data;

    } catch (error) {
      console.error("[REPORT API] Error:", error);

      if (error.name === "AbortError") {
        throw new Error(`API ไม่ตอบกลับภายใน ${CONFIG.API_TIMEOUT / 1000} วินาที`);
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
     7. RESPONSE NORMALIZATION
  ========================================================== */

  function getHeaders(data) {
    if (Array.isArray(data.headers)) return data.headers;
    if (Array.isArray(data.header)) return data.header;
    return [];
  }

  function rowToObject(row, headers) {
    if (row && typeof row === "object" && !Array.isArray(row)) return row;

    const result = {};
    headers.forEach((header, index) => {
      result[header] = Array.isArray(row) ? row[index] : undefined;
    });
    return result;
  }

  function findFieldValue(row, aliases) {
    for (const alias of aliases) {
      if (Object.prototype.hasOwnProperty.call(row, alias) && !isBlank(row[alias])) {
        return row[alias];
      }
    }

    const normalizedMap = new Map(
      Object.keys(row || {}).map((key) => [normalizeKey(key), key])
    );

    for (const alias of aliases) {
      const key = normalizedMap.get(normalizeKey(alias));
      if (key !== undefined && !isBlank(row[key])) return row[key];
    }

    return "";
  }

  const getField = (row, name) => findFieldValue(row, FIELDS[name] || [name]);

  function normalizeRow(row, headers, index) {
    const source = rowToObject(row, headers);
    const out = { _id: `rd-row-${index}`, _source: source };

    Object.keys(FIELDS).forEach((name) => {
      out[name] = getField(source, name);
    });

    return out;
  }

  /* ==========================================================
     8. FETCH ALL ROWS
  ========================================================== */

  async function fetchAllRows() {
    const allRows = [];
    let headers = [];
    let page = 1;
    let expectedTotal = null;
    let expectedPages = null;

    for (; page <= CONFIG.MAX_PAGES; page++) {
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
        if (Number.isFinite(pages) && pages > 0) expectedPages = pages;
      }

      if (!rows.length) break;

      allRows.push(...rows);

      setLoadingStatus(
        "loading",
        "กำลังรับข้อมูลจาก Google Apps Script",
        `${allRows.length.toLocaleString("th-TH")} รายการ`
      );

      if (expectedTotal !== null && allRows.length >= expectedTotal) break;
      if (expectedPages !== null && page >= expectedPages) break;
      if (rows.length < CONFIG.PAGE_SIZE) break;
    }

    if (page > CONFIG.MAX_PAGES) {
      console.warn("[REPORT] ถึง MAX_PAGES แล้ว อาจโหลดไม่ครบ");
    }

    return { headers, rows: allRows, expectedTotal };
  }

  /* ==========================================================
     9. EXTERNAL SCRIPT LOADER (Chart.js / SheetJS)
  ========================================================== */

  function loadScript(key, url, isReady, timeout = CONFIG.CHART_TIMEOUT) {
    if (isReady()) return Promise.resolve(true);
    if (STATE.scripts[key]) return STATE.scripts[key];

    STATE.scripts[key] = new Promise((resolve) => {
      const script = document.createElement("script");
      let done = false;

      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        STATE.scripts[key] = null;
        if (!ok) script.remove();
        resolve(Boolean(ok && isReady()));
      };

      const timer = setTimeout(() => finish(false), timeout);

      script.src = url;
      script.async = true;
      script.addEventListener("load", () => finish(true), { once: true });
      script.addEventListener("error", () => finish(false), { once: true });
      document.head.appendChild(script);
    });

    return STATE.scripts[key];
  }

  const ensureChartJS = () =>
    loadScript("chart", CONFIG.CHART_JS_URL, () => Boolean(window.Chart));

  const ensureSheetJS = () =>
    loadScript("xlsx", CONFIG.XLSX_URL, () => Boolean(window.XLSX), 15000);

  /* ==========================================================
     10. NAVIGATION (กัน 404)
  ========================================================== */

  // ตรวจว่าไฟล์ปลายทางมีอยู่จริงก่อนเปลี่ยนหน้า ถ้าไม่มีจะแจ้งเตือนแทนการขึ้นหน้า 404
  async function navigateTo(url) {
    try {
      const response = await fetch(url.href, { method: "HEAD", cache: "no-store" });

      if (response.status === 404) {
        const file = url.pathname.split("/").pop();
        console.error("[REPORT] ไม่พบไฟล์ปลายทาง:", url.href);
        showAlert(
          `ไม่พบไฟล์ ${file} ที่ ${url.pathname} กรุณาตรวจสอบชื่อไฟล์ใน repo ` +
          "และค่า CONFIG.PAGES ใน app_dashboard.js",
          "error"
        );
        return;
      }
    } catch (_) {
      // ตรวจไม่ได้ (เช่น เครือข่ายขัดข้อง) ให้ลองเปิดหน้าตามปกติ
    }

    window.location.href = url.href;
  }

  // เปิดหน้า Excellence ตามกลุ่มที่คลิก (ส่งปีงบประมาณที่เลือกอยู่ไปด้วย)
  function openExcellencePage(selectedGroup) {
    const url = new URL(CONFIG.PAGES.EXCELLENCE, document.baseURI);
    url.searchParams.set("group", selectedGroup);

    const year = normalizeText($("rdFilterYear")?.value);
    if (year) url.searchParams.set("year", year);

    navigateTo(url);
  }

  function openKpiPage() {
    const url = new URL(CONFIG.PAGES.KPI, document.baseURI);

    const year = normalizeText($("rdFilterYear")?.value);
    if (year) url.searchParams.set("year", year);

    navigateTo(url);
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

    if (values.includes(previousValue)) select.value = previousValue;
  }

  function populateFilters() {
    const sortThai = (a, b) => a.localeCompare(b, "th", { numeric: true });
    const sortYear = (a, b) =>
      String(b).localeCompare(String(a), "th", { numeric: true });

    populateSelect("rdFilterYear", unique(STATE.rawRows.map((r) => r.year)).sort(sortYear), "ทุกปีงบประมาณ");
    populateSelect("rdFilterGroup", unique(STATE.rawRows.map((r) => r.group)).sort(sortThai), "ทุกกลุ่ม KPI");
    populateSelect("rdFilterExcellence", unique(STATE.rawRows.map((r) => r.excellence)).sort(sortThai), "ทุก Excellence");
    populateSelect("rdFilterSection", unique(STATE.rawRows.map((r) => r.section)).sort(sortThai), "ทุกหน่วยงาน");
  }

  function applyFilters() {
    const year = normalizeText($("rdFilterYear")?.value);
    const group = normalizeText($("rdFilterGroup")?.value);
    const excellence = normalizeText($("rdFilterExcellence")?.value);
    const section = normalizeText($("rdFilterSection")?.value);
    const search = normalizeText($("rdFilterSearch")?.value).toLocaleLowerCase("th");

    STATE.page = 1;

    STATE.filteredRows = STATE.rawRows.filter((row) => {
      if (year && normalizeText(row.year) !== year) return false;
      if (group && normalizeText(row.group) !== group) return false;
      if (excellence && normalizeText(row.excellence) !== excellence) return false;
      if (section && normalizeText(row.section) !== section) return false;

      if (search) {
        const text = [
          row.kpi, row.description, row.group, row.excellence, row.section,
          row.formula, row.criterion, row.result, row.target, row.summary
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
    ["rdFilterYear", "rdFilterGroup", "rdFilterExcellence", "rdFilterSection", "rdFilterSearch"]
      .forEach((id) => {
        const element = $(id);
        if (element) element.value = "";
      });

    applyFilters();
  }

  /* ==========================================================
     12. CHARTS
  ========================================================== */

  const CHART_FONT = '"IBM Plex Sans Thai", "Inter", system-ui, sans-serif';

  const GROUP_EMPTY_LABEL = "ไม่ระบุกลุ่ม";
  const GROUP_OTHER_LABEL = "อื่น ๆ";
  const GROUP_MAX_SLICES = 12;

  const GROUP_PALETTE = [
    "#1a8f63", "#4f8fd6", "#14a3a0", "#e3a634",
    "#8b6bd6", "#d9628b", "#3aa0bd", "#7bb342",
    "#e07b39", "#6b7a8f", "#2fbf9a", "#a779d6"
  ];

  function ensureChartDefaults() {
    const C = window.Chart;
    if (!C || C.__rdStyled) return;

    C.__rdStyled = true;

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
    if (chart && typeof chart.destroy === "function") chart.destroy();
    STATE.charts[key] = null;
  }

  // คลิก/ชี้เมาส์อยู่ในรูตรงกลางโดนัทหรือไม่
  function isInsideDoughnutHole(chart, event) {
    const area = chart.chartArea;
    const arc = chart.getDatasetMeta(0)?.data?.[0];
    if (!area || !arc) return false;

    const rect = chart.canvas.getBoundingClientRect();
    const x = event.native ? event.native.clientX - rect.left : event.x;
    const y = event.native ? event.native.clientY - rect.top : event.y;

    const centerX = (area.left + area.right) / 2;
    const centerY = (area.top + area.bottom) / 2;

    return Math.hypot(x - centerX, y - centerY) <= arc.innerRadius;
  }

  function renderCharts(rows) {
    ensureChartDefaults();

    if (!window.Chart) {
      destroyChart("group");
      setText("rdGroupChartNote", "ไม่พบ Chart.js จึงไม่สามารถแสดงกราฟได้");
      return false;
    }

    try {
      renderGroupChart(rows);
      return true;
    } catch (error) {
      console.error("[REPORT CHART] Group chart error:", error);
      destroyChart("group");
      setText("rdGroupChartNote", "สร้างกราฟจำนวนตัวชี้วัดตามกลุ่มไม่สำเร็จ");
      return false;
    }
  }

  /* ----------------------------------------------------------
   * จำนวนตัวชี้วัดตามกลุ่ม (kpi_Group_Des)
   * - คลิกตรงกลางกราฟ: เปิดหน้า KPI
   * - คลิกชิ้นกราฟ: เปิดหน้า Excellence ตามกลุ่ม
   * - รวมกลุ่มที่เกิน GROUP_MAX_SLICES เป็น "อื่น ๆ"
   * ---------------------------------------------------------- */

  function renderGroupChart(rows) {
    const canvas = $("rdGroupChart");
    if (!canvas) return;

    destroyChart("group");

    const counts = new Map();

    (Array.isArray(rows) ? rows : []).forEach((row) => {
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
          </div>`;
      }
      return;
    }

    let entries = [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "th")
    );

    // กลุ่มจริงที่อยู่เบื้องหลังแต่ละชิ้นกราฟ
    const groupMap = new Map();
    entries.forEach(([label]) => groupMap.set(label, [label]));

    if (entries.length > GROUP_MAX_SLICES) {
      const rest = entries.slice(GROUP_MAX_SLICES - 1);
      entries = entries.slice(0, GROUP_MAX_SLICES - 1);

      entries.push([
        GROUP_OTHER_LABEL,
        rest.reduce((sum, item) => sum + item[1], 0)
      ]);
      groupMap.set(GROUP_OTHER_LABEL, rest.map((item) => item[0]));
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
      `แสดง ${formatNumber(counts.size, 0)} กลุ่มตัวชี้วัด · ` +
      `รวม ${formatNumber(total, 0)} ตัวชี้วัด · ` +
      "คลิกตรงกลางเพื่อดู KPI หรือคลิกชิ้นกราฟเพื่อดู Excellence"
    );

    if (canvas.parentElement) canvas.parentElement.style.height = "360px";

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

        // เปลี่ยนเคอร์เซอร์เป็นมือเมื่อชี้ที่ชิ้นกราฟหรือรูตรงกลาง
        onHover(event, elements, chart) {
          chart.canvas.style.cursor =
            elements.length || isInsideDoughnutHole(chart, event)
              ? "pointer"
              : "default";
        },

        onClick(event, elements, chart) {
          // คลิกตรงกลางกราฟ → หน้า KPI
          if (isInsideDoughnutHole(chart, event)) {
            openKpiPage();
            return;
          }

          if (!elements || !elements.length) return;

          const selectedGroup = chart.data.labels[elements[0].index];

          // กลุ่ม "อื่น ๆ" → ส่งรายชื่อกลุ่มจริงที่ถูกรวมไว้
          if (selectedGroup === GROUP_OTHER_LABEL && groupMap.has(GROUP_OTHER_LABEL)) {
            openExcellencePage(groupMap.get(GROUP_OTHER_LABEL).join(", "));
            return;
          }

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
                const percent = total ? formatNumber((value / total) * 100, 1) : "0";
                return `${context.label}: ${formatNumber(value, 0)} รายการ (${percent}%)`;
              }
            }
          }
        }
      }
    });
  }

  /* ==========================================================
     13. TABLE (ตารางสวยขึ้น + ตัวกรองแบบ Excel)
  ========================================================== */

  const TABLE_CSS = `
#reportKpiDashboard .rd-table-wrapper{max-height:620px;overflow:auto}
#reportKpiDashboard .rd-table thead th{z-index:2}
#reportKpiDashboard .rd-table-toolbar{align-items:flex-end;gap:10px}
#reportKpiDashboard .rdx-clear-btn{height:43px;padding:0 14px}
.rdx-th{display:flex;align-items:center;justify-content:space-between;gap:10px}
.rdx-btn{width:22px;height:22px;flex-shrink:0;padding:0;border:1px solid #d2e1d6;border-radius:6px;background:#fff;color:#20764a;font-size:11px;line-height:1;cursor:pointer;transition:background .15s,border-color .15s}
.rdx-btn:hover{background:#e8f5ec;border-color:#a8d3b7}
.rdx-btn.active{background:#d97706;border-color:#d97706;color:#fff}
.rdx-pct{display:grid;gap:5px;min-width:96px}
.rdx-bar{display:block;height:5px;border-radius:99px;background:#e3ece7;overflow:hidden}
.rdx-bar i{display:block;height:100%;border-radius:99px;background:#20764a}
.rdx-bar.low i{background:#dc4545}
.rdx-pop{position:fixed;z-index:9999;width:270px;padding:12px;background:#fff;border:1px solid #e0eae3;border-radius:16px;box-shadow:0 14px 34px rgba(24,67,43,.16);font:13px/1.6 "IBM Plex Sans Thai","Inter",sans-serif;color:#172b22}
.rdx-pop input[type=search]{width:100%;height:38px;padding:0 10px;margin-bottom:8px;border:1px solid #d2e1d6;border-radius:10px;background:#fff;font:inherit}
.rdx-pop input[type=search]:focus{outline:none;border-color:#278a68;box-shadow:0 0 0 3px rgba(39,138,104,.09)}
.rdx-list{max-height:240px;overflow-y:auto;margin:4px 0 10px;border-top:1px solid #edf2ee;padding-top:4px}
.rdx-item{display:flex;align-items:center;gap:8px;padding:6px 4px;border-radius:8px;cursor:pointer}
.rdx-item:hover{background:#f3faf5}
.rdx-item span{flex:1;min-width:0;overflow-wrap:anywhere}
.rdx-item em{font-style:normal;color:#829187;font-size:12px}
.rdx-actions{display:flex;justify-content:flex-end;gap:8px}
.rdx-ghost,.rdx-ok{padding:7px 14px;border-radius:10px;font:inherit;cursor:pointer}
.rdx-ghost{border:1px solid #d2e1d6;background:#fff;color:#20764a}
.rdx-ghost:hover{background:#f3faf5}
.rdx-ok{border:0;background:#20764a;color:#fff}
.rdx-ok:hover:not(:disabled){background:#145c38}
.rdx-ok:disabled{opacity:.5;cursor:not-allowed}
`;

  const TABLE_COLS = [
    { key: "year",        label: "ปีงบประมาณ" },
    { key: "group",       label: "กลุ่มตัวชี้วัด" },
    { key: "description", label: "ตัวชี้วัด / รายละเอียด" },
    { key: "result",      label: "ผลลัพธ์" },
    { key: "target",      label: "เป้าหมาย" },
    { key: "percent",     label: "ร้อยละ" },
    { key: "summary",     label: "สรุปผล" }
  ];

  let colFilters = {};   // { key: Set(ค่าที่เลือก) }
  let colPopup = null;
  let tableGlobalsBound = false;

  function withUnit(value, unit) {
    return isBlank(value)
      ? ""
      : `${formatNumber(value)}${unit ? ` ${unit}` : ""}`;
  }

  function formatRate(value) {
    if (isBlank(value)) return "—";

    const text = String(value).trim();
    const number = numberValue(value);

    if (number === null) return text;

    // แสดง % เฉพาะเมื่อค่าต้นฉบับมี %
    return text.includes("%") ? `${formatNumber(number)}%` : formatNumber(number);
  }

  // ค่าที่ใช้กรอง = ข้อความเดียวกับที่แสดงในตาราง
  function colValue(row, key) {
    switch (key) {
      case "year":        return normalizeText(row.year);
      case "group":       return normalizeText(row.group);
      case "description": return [row.kpi, row.description].map(normalizeText).filter(Boolean).join(" – ");
      case "result":      return withUnit(row.result, row.unit);
      case "target":      return withUnit(row.target, row.unit);
      case "percent":     return isBlank(row.percent) ? "" : formatRate(row.percent);
      case "summary":     return normalizeText(row.summary);
      default:            return "";
    }
  }

  // แถวที่ผ่านตัวกรองคอลัมน์อื่นทั้งหมด (ยกเว้น exceptKey) แบบเดียวกับ Excel
  function rowsExcept(exceptKey) {
    return STATE.filteredRows.filter((row) =>
      TABLE_COLS.every((col) =>
        col.key === exceptKey ||
        !colFilters[col.key] ||
        colFilters[col.key].has(colValue(row, col.key))
      )
    );
  }

  function refreshColumnFilters() {
    STATE.page = 1;
    renderTable(STATE.filteredRows);
  }

  function closeColPopup() {
    if (colPopup) {
      colPopup.remove();
      colPopup = null;
    }
  }

  function openColPopup(btn) {
    closeColPopup();

    const key = btn.dataset.col;
    const counts = new Map();

    rowsExcept(key).forEach((row) => {
      const v = colValue(row, key);
      counts.set(v, (counts.get(v) || 0) + 1);
    });

    const values = [...counts.keys()].sort((a, b) =>
      a.localeCompare(b, "th", { numeric: true })
    );

    const current = colFilters[key];
    const selected = new Set(current ? values.filter((v) => current.has(v)) : values);
    const labelOf = (v) => (v === "" ? "(ว่าง)" : v);

    colPopup = document.createElement("div");
    colPopup.className = "rdx-pop";
    colPopup.dataset.col = key;
    colPopup.innerHTML = `
      <input type="search" placeholder="ค้นหา" aria-label="ค้นหาในตัวกรอง">
      <label class="rdx-item"><input type="checkbox" class="rdx-all"> <span><b>(เลือกทั้งหมด)</b></span></label>
      <div class="rdx-list"></div>
      <div class="rdx-actions">
        <button type="button" class="rdx-ghost rdx-pop-clear">ล้างตัวกรอง</button>
        <button type="button" class="rdx-ok">ตกลง</button>
      </div>`;
    document.body.appendChild(colPopup);

    const popup = colPopup;
    const search = popup.querySelector("input[type=search]");
    const list = popup.querySelector(".rdx-list");
    const all = popup.querySelector(".rdx-all");
    const ok = popup.querySelector(".rdx-ok");

    const shown = () => {
      const q = search.value.trim().toLocaleLowerCase("th");
      return values.filter((v) => labelOf(v).toLocaleLowerCase("th").includes(q));
    };

    function draw() {
      const visible = shown();

      list.innerHTML = visible.length
        ? visible.map((v) => `
            <label class="rdx-item">
              <input type="checkbox" data-v="${escapeHTML(v)}" ${selected.has(v) ? "checked" : ""}>
              <span>${escapeHTML(labelOf(v))}</span>
              <em>${formatNumber(counts.get(v), 0)}</em>
            </label>`).join("")
        : '<div style="padding:14px;text-align:center;color:#6b7d75">ไม่พบรายการ</div>';

      const on = visible.filter((v) => selected.has(v)).length;
      all.checked = visible.length > 0 && on === visible.length;
      all.indeterminate = on > 0 && on < visible.length;
      ok.disabled = selected.size === 0;
    }

    list.addEventListener("change", (event) => {
      const box = event.target.closest("input[data-v]");
      if (!box) return;
      if (box.checked) selected.add(box.dataset.v);
      else selected.delete(box.dataset.v);
      draw();
    });

    all.addEventListener("change", () => {
      shown().forEach((v) => (all.checked ? selected.add(v) : selected.delete(v)));
      draw();
    });

    search.addEventListener("input", draw);

    popup.querySelector(".rdx-pop-clear").addEventListener("click", () => {
      delete colFilters[key];
      closeColPopup();
      refreshColumnFilters();
    });

    ok.addEventListener("click", () => {
      if (selected.size === values.length) delete colFilters[key];
      else colFilters[key] = new Set(selected);
      closeColPopup();
      refreshColumnFilters();
    });

    draw();

    const rect = btn.getBoundingClientRect();
    popup.style.top =
      Math.max(8, Math.min(rect.bottom + 6, innerHeight - popup.offsetHeight - 8)) + "px";
    popup.style.left =
      Math.max(8, Math.min(rect.left, innerWidth - popup.offsetWidth - 8)) + "px";

    search.focus();
  }

  // เรียกครั้งเดียวหลังแทรก dashboard.html ลงหน้าแล้ว (ดู bindEvents)
  function initTableFilters() {
    if (!document.getElementById("rdxTableStyle")) {
      const style = document.createElement("style");
      style.id = "rdxTableStyle";
      style.textContent = TABLE_CSS;
      document.head.appendChild(style);
    }

    const headers = document.querySelectorAll("#rdKpiTable thead th");
    if (!headers.length || headers[0].querySelector(".rdx-btn")) return;

    headers.forEach((th, index) => {
      const col = TABLE_COLS[index];
      if (!col) return;

      th.innerHTML = `
        <div class="rdx-th">
          <span>${escapeHTML(th.textContent.trim() || col.label)}</span>
          <button type="button" class="rdx-btn" data-col="${col.key}"
            aria-label="ตัวกรองคอลัมน์ ${escapeHTML(col.label)}" aria-haspopup="true">▾</button>
        </div>`;
    });

    document.querySelector("#rdKpiTable thead").addEventListener("click", (event) => {
      const btn = event.target.closest(".rdx-btn");
      if (!btn) return;

      event.stopPropagation();

      if (colPopup && colPopup.dataset.col === btn.dataset.col) closeColPopup();
      else openColPopup(btn);
    });

    const toolbar = document.querySelector(".rd-table-toolbar");

    if (toolbar) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "rd-text-btn rdx-clear-btn";
      clear.textContent = "ล้างตัวกรองคอลัมน์";
      clear.addEventListener("click", () => {
        colFilters = {};
        closeColPopup();
        refreshColumnFilters();
      });
      toolbar.appendChild(clear);
    }

    if (!tableGlobalsBound) {
      tableGlobalsBound = true;

      document.addEventListener("click", (event) => {
        if (colPopup && !colPopup.contains(event.target)) closeColPopup();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeColPopup();
      });
      window.addEventListener("scroll", (event) => {
        if (colPopup && !colPopup.contains(event.target)) closeColPopup();
      }, true);
      window.addEventListener("resize", closeColPopup);
    }
  }

  /* ---------- วาดตาราง ---------- */

  function renderEmptyTable(message) {
    const body = $("rdKpiTableBody");
    if (!body) return;

    body.innerHTML = `
      <tr>
        <td colspan="7" class="rd-empty rd-table-placeholder">${escapeHTML(message)}</td>
      </tr>`;

    setText("rdVisibleCount", "0");
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

  function statusPillClass(text) {
    if (text === "ผ่าน") return "success";
    if (text === "ไม่ผ่าน") return "danger";
    if (text === "ยังไม่ได้กรอกข้อมูล") return "warning";
    return "";
  }

  function badgeClass(row) {
    return numberValue(row.result) === null || numberValue(row.target) === null
      ? "rd-badge-neutral"
      : "rd-badge-blue";
  }

  function percentCell(row) {
    const text = formatRate(row.percent);
    const number = numberValue(row.percent);

    // แสดงแถบเฉพาะค่าที่อยู่ในช่วง 0–100
    if (number === null || number < 0 || number > 100) return escapeHTML(text);

    return `
      <div class="rdx-pct">
        <span>${escapeHTML(text)}</span>
        <b class="rdx-bar ${number < 50 ? "low" : ""}"><i style="width:${number}%"></i></b>
      </div>`;
  }

  function renderTable(sourceRows) {
    const body = $("rdKpiTableBody");
    if (!body) return;

    // ตัวกรองด้านบนทำมาแล้วใน sourceRows — ตรงนี้กรองตามคอลัมน์
    const rows = (Array.isArray(sourceRows) ? sourceRows : []).filter((row) =>
      TABLE_COLS.every((col) =>
        !colFilters[col.key] || colFilters[col.key].has(colValue(row, col.key))
      )
    );

    document.querySelectorAll(".rdx-btn").forEach((btn) =>
      btn.classList.toggle("active", !!colFilters[btn.dataset.col])
    );

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
      const status = normalizeText(row.summary);

      return `
        <tr data-rd-id="${escapeHTML(row._id)}">
          <td>${escapeHTML(row.year || "—")}</td>
          <td>${escapeHTML(row.group || "—")}</td>
          <td>
            <div class="rd-kpi-name">${escapeHTML(title)}</div>
            ${description ? `<span class="rd-kpi-description">${escapeHTML(description)}</span>` : ""}
          </td>
          <td class="rd-number"><span class="rd-badge ${badgeClass(row)}">${escapeHTML(withUnit(row.result, row.unit) || "—")}</span></td>
          <td class="rd-number">${escapeHTML(withUnit(row.target, row.unit) || "—")}</td>
          <td class="rd-number">${percentCell(row)}</td>
          <td>${status
            ? `<span class="rd-status-badge ${statusPillClass(status)}">${escapeHTML(status)}</span>`
            : "—"}</td>
        </tr>`;
    }).join("");
  }

  /* ==========================================================
     14. RENDER ALL
  ========================================================== */

  function renderAll() {
    renderCharts(STATE.filteredRows);
    renderTable(STATE.filteredRows);
  }

  /* ==========================================================
     15. EXPORT / EVENTS
  ========================================================== */

  async function exportDashboardXlsx() {
    if (!STATE.rawRows.length) return;

    const button = $("rdExportBtn");
    if (button) button.disabled = true;

    try {
      // โหลด SheetJS เมื่อต้องใช้ ถ้าหน้า HTML ยังไม่ได้ include
      const ready = await ensureSheetJS();

      if (!ready) {
        showAlert("โหลดไลบรารี Excel (SheetJS) ไม่สำเร็จ จึงส่งออกไม่ได้", "error");
        return;
      }

      const headers = [
        "ปีงบประมาณ", "กลุ่มตัวชี้วัด", "Excellence", "หน่วยงาน",
        "รหัส KPI", "คำอธิบาย", "ผลลัพธ์", "เป้าหมาย",
        "ร้อยละ", "สรุปผล", "เกณฑ์", "สูตร"
      ];

      const data = [
        headers,
        ...STATE.filteredRows.map((row) => [
          row.year, row.group, row.excellence, row.section,
          row.kpi, row.description, row.result, row.target,
          row.percent, row.summary, row.criterion, row.formula
        ])
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data), "REPORT_KPI");
      XLSX.writeFile(workbook, "REPORT_KPI_export.xlsx");

    } finally {
      if (button) button.disabled = STATE.rawRows.length === 0;
    }
  }

  function bindEvents() {
    initTableFilters();

    ["rdFilterYear", "rdFilterGroup", "rdFilterExcellence", "rdFilterSection"]
      .forEach((id) => $(id)?.addEventListener("change", applyFilters));

    let searchTimer;
    $("rdFilterSearch")?.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(applyFilters, 200);
    });

    $("rdResetFilters")?.addEventListener("click", resetFilters);
    $("rdRefreshBtn")?.addEventListener("click", () => loadDashboard());
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
     16. INITIALIZE
  ========================================================== */

  function initDashboard() {
    if (STATE.initialized || !root()) return;

    STATE.initialized = true;
    bindEvents();

    setLoadingStatus("loading", "กำลังเชื่อมต่อ Google Apps Script...", "กำลังโหลด");
    loadDashboard();
  }

  /* ==========================================================
     17. LOAD DATA
  ========================================================== */

  async function loadDashboard(options = {}) {
    if (STATE.loading || !root()) return;

    STATE.loading = true;
    STATE.loadError = null;

    clearAlert();

    const exportBtn = $("rdExportBtn");
    if (exportBtn) exportBtn.disabled = true;

    setLoadingStatus("loading", "กำลังอ่านข้อมูลจากชีต REPORT_02...", "กำลังโหลด");
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

      const chartsRendered = chartAvailable ? renderCharts(STATE.filteredRows) : false;

      if (!chartAvailable) {
        setText("rdGroupChartNote", "โหลดข้อมูลแล้ว แต่โหลด Chart.js ไม่สำเร็จ");
      }

      setText("rdLastUpdated", formatDate(STATE.lastUpdated));

      const total = STATE.rawRows.length;
      const expected = result.expectedTotal;
      const totalText = total.toLocaleString("th-TH");

      if (total === 0) {
        setFinalLoadingStatus(0, "API ตอบกลับแล้ว แต่ไม่พบข้อมูลในชีต REPORT_02");
        showAlert("ไม่พบข้อมูล กรุณาตรวจสอบชื่อชีตและการตั้งค่า API ใน Code.gs", "warning");
        setStatus("เชื่อมต่อสำเร็จ แต่ไม่พบข้อมูล", "success");

      } else if (expected !== null && total < expected) {
        setFinalLoadingStatus(total, `โหลดได้ ${totalText} จาก ${expected.toLocaleString("th-TH")} รายการ`);
        showAlert(`โหลดข้อมูลได้ ${total} จาก ${expected} รายการ กรุณาตรวจสอบ pagination`, "warning");
        setStatus("โหลดข้อมูลแล้ว แต่ควรตรวจสอบจำนวนรายการ", "success");

      } else if (!chartsRendered) {
        setFinalLoadingStatus(total, "โหลดข้อมูลสำเร็จ แต่กราฟไม่พร้อมใช้งาน");
        showAlert("ข้อมูลโหลดแล้ว แต่สร้างกราฟไม่ได้ สามารถใช้ตารางได้ตามปกติ", "warning");
        setStatus(`โหลดข้อมูลสำเร็จ ${totalText} รายการ`, "success");

      } else {
        setFinalLoadingStatus(total, "เชื่อมต่อ Google Apps Script และแสดง Dashboard เรียบร้อยแล้ว");
        clearAlert();
        setStatus(`โหลดข้อมูลสำเร็จ ${totalText} รายการ`, "success");
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

      setLoadingStatus("error", STATE.loadError, "ไม่สำเร็จ");
      showAlert(STATE.loadError, "error");
      setStatus("โหลดข้อมูลไม่สำเร็จ", "error");

      if (!options.silent) renderEmptyTable("ไม่สามารถโหลดข้อมูลได้");

    } finally {
      STATE.loading = false;
    }
  }

  /* ==========================================================
     18. LOAD dashboard.html (Frontend: GitHub Pages)
  ========================================================== */

  async function loadDashboardHTML() {
    if (STATE.loadingHTML) return;

    const mount = $("dashboardMount");

    if (!mount) {
      if (root()) initDashboard();
      else console.error("[REPORT] ไม่พบ #dashboardMount และ #reportKpiDashboard");
      return;
    }

    if (mount.dataset.rdLoaded === "true" && root() && STATE.initialized) return;

    if (window.location.protocol === "file:") {
      mount.innerHTML = `
        <div class="card" role="alert">
          <h3>กรุณาเปิดเว็บไซต์ผ่านเว็บเซิร์ฟเวอร์</h3>
          <p>ไม่สามารถโหลด dashboard.html ผ่าน file:// ได้</p>
          <p>ใช้ GitHub Pages หรือ python -m http.server 8000</p>
        </div>`;
      return;
    }

    STATE.loadingHTML = true;

    mount.innerHTML = `
      <div class="card" role="status" aria-live="polite">กำลังโหลด Dashboard...</div>`;

    try {
      // ใช้ dashboard.html ตัวพิมพ์เล็ก อิงจาก URL ของหน้าที่เปิดอยู่
      const url = new URL("dashboard.html", document.baseURI);
      url.searchParams.set("_", String(Date.now()));   // กัน cache HTML เก่า

      const response = await fetch(url.href, { method: "GET", cache: "no-store" });

      if (!response.ok) {
        throw new Error(
          `โหลด dashboard.html ไม่สำเร็จ (HTTP ${response.status}) — ${url.pathname}`
        );
      }

      const html = await response.text();
      if (!html.trim()) throw new Error("ไฟล์ dashboard.html ไม่มีเนื้อหา");

      const parsed = new DOMParser().parseFromString(html, "text/html");
      const dashboardRoot = parsed.getElementById("reportKpiDashboard");

      if (!dashboardRoot) {
        throw new Error('ไม่พบ id="reportKpiDashboard" ใน dashboard.html');
      }

      mount.innerHTML = dashboardRoot.outerHTML;
      mount.dataset.rdLoaded = "true";

      initDashboard();

    } catch (error) {
      console.error("[REPORT] Dashboard HTML error:", error);

      mount.dataset.rdLoaded = "false";
      mount.innerHTML = `
        <div class="card" role="alert">
          <h3>ไม่สามารถโหลด Dashboard ได้</h3>
          <p>${escapeHTML(error.message || "เกิดข้อผิดพลาด")}</p>
          <p>ตรวจสอบตำแหน่งไฟล์ dashboard.html และการเผยแพร่ GitHub Pages</p>
          <button type="button" class="rd-btn rd-btn-light" id="rdRetryLoadHTML">
            ลองโหลดอีกครั้ง
          </button>
        </div>`;

      $("rdRetryLoadHTML")?.addEventListener("click", loadDashboardHTML);

    } finally {
      STATE.loadingHTML = false;
    }
  }

  /* ==========================================================
     19. STARTUP
  ========================================================== */

  function startDashboard() {
    if ($("dashboardMount")) {
      loadDashboardHTML();
      return;
    }

    if (root()) {
      initDashboard();
      return;
    }

    console.error("[REPORT] ไม่พบทั้ง #dashboardMount และ #reportKpiDashboard");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startDashboard, { once: true });
  } else {
    startDashboard();
  }

  /* ==========================================================
     20. PUBLIC API
  ========================================================== */

  window.REPORT_KPI_DASHBOARD = {
    refresh: () => loadDashboard(),
    reloadHTML: () => loadDashboardHTML(),
    applyFilters,
    resetFilters,

    getState: () => ({
      loading: STATE.loading,
      loadingHTML: STATE.loadingHTML,
      loadingChart: Boolean(STATE.scripts.chart),
      initialized: STATE.initialized,
      totalRows: STATE.rawRows.length,
      filteredRows: STATE.filteredRows.length,
      lastUpdated: STATE.lastUpdated,
      loadError: STATE.loadError
    })
  };

})();
