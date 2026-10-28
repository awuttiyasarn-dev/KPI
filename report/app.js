'use strict';

// =====================================================
// REPORT DATA INTELLIGENCE
// =====================================================

const API_URL =
  'https://script.google.com/macros/s/AKfycbyDVuHOl48Fke6Sb7D-MsVSUC4lPlOpe03mw63JdNtn9OU5Y1cGW_64Ly15JUA4p4qF/exec';

const ACCESS_KEY_STORAGE = 'reportKey';
const IMPORT_BATCH_SIZE = 500;
const MAX_FILE_SIZE = 50 * 1024 * 1024;

let sheetsCache = [];
let currentSheetName = '';
let currentHeaders = [];
let currentRows = [];
let filteredRows = [];
let currentPage = 1;
let chartInstance = null;
let exportCache = null;
let importRunning = false;

// -----------------------------------------------------
// DOM HELPERS
// -----------------------------------------------------

const $ = id => document.getElementById(id);

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value == null ? '' : String(value);
}

function setHtml(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[ch]);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('th-TH');
}

function formatTime(value = new Date()) {
  return new Date(value).toLocaleString('th-TH');
}

function showMessage(id, message, type = '') {
  const el = $(id);
  if (!el) return;
  el.className = type;
  el.textContent = message || '';
}

function setConnectionStatus(online, message) {
  const dot = $('statusDot');
  if (dot) {
    dot.classList.toggle('online', Boolean(online));
    dot.classList.toggle('offline', !online);
  }
  setText('statusText', message || (online ? 'เชื่อมต่อแล้ว' : 'เชื่อมต่อไม่ได้'));
  setText('kpiConnection', online ? 'ออนไลน์' : 'ออฟไลน์');
  setText('lastUpdated', `ตรวจสอบ ${formatTime()}`);
}

function getAccessKey() {
  let key = sessionStorage.getItem(ACCESS_KEY_STORAGE);

  if (!key) {
    key = window.prompt('กรุณากรอก REPORT Access Key');
    if (!key) throw new Error('ยกเลิกการเชื่อมต่อ: ไม่ได้ระบุ Access Key');
    key = key.trim();
    if (!key) throw new Error('Access Key ต้องไม่เป็นค่าว่าง');
    sessionStorage.setItem(ACCESS_KEY_STORAGE, key);
  }

  return key;
}

function getWriteToken() {
  let token = sessionStorage.getItem('reportWriteToken');

  if (!token) {
    token = window.prompt(
      'กรุณากรอก REPORT_WRITE_TOKEN สำหรับนำเข้าข้อมูล'
    );

    if (!token || !token.trim()) {
      throw new Error(
        'ยกเลิกการนำเข้า: ไม่ได้ระบุ Write Token'
      );
    }

    token = token.trim();
    sessionStorage.setItem('reportWriteToken', token);
  }

  return token;
}

// -----------------------------------------------------
// API
// -----------------------------------------------------
async function api(action, params = {}) {
  const key = getAccessKey();

  if (!key || !String(key).trim()) {
    throw new Error('กรุณาระบุ REPORT_ACCESS_KEY');
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify({
      action,
      key: String(key).trim(),
      params
    })
  });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: เรียก API ไม่สำเร็จ`
    );
  }

  let result;

  try {
    result = await response.json();
  } catch (error) {
    throw new Error(
      'Apps Script ไม่ได้ส่งผลลัพธ์ JSON กลับมา'
    );
  }

  if (
    result &&
    (result.ok === false || result.success === false)
  ) {
    throw new Error(
      result.message ||
      result.error ||
      'ไม่มีสิทธิ์เข้าถึง API'
    );
  }

  return result;
}


function unwrapData(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.sheets)) return result.sheets;
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
}

// -----------------------------------------------------
// NAVIGATION
// -----------------------------------------------------

function initNavigation() {
  document.querySelectorAll('.nav-btn[data-view]').forEach(button => {
    button.addEventListener('click', () => {
      const target = button.dataset.view;

      document.querySelectorAll('.nav-btn[data-view]').forEach(nav => {
        nav.classList.toggle('active', nav === button);
      });

      document.querySelectorAll('.view').forEach(view => {
        view.classList.toggle('active', view.id === `view-${target}`);
      });

      setText('pageTitle', target === 'dashboard' ? 'ภาพรวมข้อมูล' : 'ฐานข้อมูล');
      setText(
        'pageSubtitle',
        target === 'dashboard'
          ? 'ภาพรวม Google Spreadsheet และข้อมูลทั้งหมด'
          : 'ค้นหา นำเข้า และส่งออกข้อมูล'
      );

      $('sidebar')?.classList.remove('open');

      if (target === 'database') {
        loadSheets().catch(handleError);
      }
    });
  });

  $('mobileMenu')?.addEventListener('click', () => {
    $('sidebar')?.classList.toggle('open');
  });

  const tabs = [...document.querySelectorAll('[data-db-tab]')];

  function activateTab(name, focus = false) {
    tabs.forEach(tab => {
      const active = tab.dataset.dbTab === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });

    document.querySelectorAll('[data-db-panel]').forEach(panel => {
      panel.hidden = panel.dataset.dbPanel !== name;
    });

    if (focus) {
      tabs.find(tab => tab.dataset.dbTab === name)?.focus();
    }

    if (name === 'upload') updateUploadTarget();
    if (name === 'export') updateExportSelection();
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.dbTab));

    tab.addEventListener('keydown', event => {
      let next = index;

      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        next = (index + 1) % tabs.length;
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        next = (index - 1 + tabs.length) % tabs.length;
      } else if (event.key === 'Home') {
        next = 0;
      } else if (event.key === 'End') {
        next = tabs.length - 1;
      } else {
        return;
      }

      event.preventDefault();
      activateTab(tabs[next].dataset.dbTab, true);
    });
  });

  window.activateDatabaseTab = activateTab;
}

// -----------------------------------------------------
// HEALTH CHECK
// -----------------------------------------------------

async function checkHealth() {
  setText('healthService', 'กำลังตรวจสอบ...');

  try {
    const result = await api('health');

    setConnectionStatus(true, 'เชื่อมต่อแล้ว');
    setText('healthService', 'พร้อมใช้งาน');
    setText(
      'healthSpreadsheet',
      result.spreadsheetName || result.name || 'เชื่อมต่อแล้ว'
    );
    setText('healthSheets', formatNumber(result.sheetCount ?? sheetsCache.length));
    setText('healthTime', formatTime());

    setText('sideVersion', result.version || 'API Connected');
    return result;
  } catch (error) {
    setConnectionStatus(false, 'เชื่อมต่อไม่ได้');
    setText('healthService', 'ผิดพลาด');
    setText('healthSpreadsheet', '—');
    setText('healthTime', formatTime());
    throw error;
  }
}

// -----------------------------------------------------
// SHEETS
// -----------------------------------------------------

function getSheetName(item) {
  if (typeof item === 'string') return item;
  return item?.name || item?.sheetName || item?.title || '';
}

function getSheetRows(item) {
  return Number(item?.rows ?? item?.rowCount ?? item?.numRows ?? 0);
}

function getSheetColumns(item) {
  return Number(item?.columns ?? item?.columnCount ?? item?.numColumns ?? 0);
}

function populateSheetSelect(id, includeAll = false) {
  const select = $(id);
  if (!select) return;

  const previous = select.value;
  select.replaceChildren();

  if (includeAll) {
    select.add(new Option('ทุก Sheet', ''));
  } else {
    select.add(new Option('เลือก Sheet', ''));
  }

  sheetsCache.forEach(item => {
    const name = getSheetName(item);
    if (name) select.add(new Option(name, name));
  });

  if ([...select.options].some(option => option.value === previous)) {
    select.value = previous;
  } else if (!includeAll && currentSheetName) {
    select.value = currentSheetName;
  }
}

function renderSheetCards() {
  const container = $('dashboardSheetList');
  if (!container) return;

  if (!sheetsCache.length) {
    container.innerHTML = '<div class="table-empty">ไม่พบ Sheet</div>';
    return;
  }

  container.innerHTML = sheetsCache.map(item => {
    const name = getSheetName(item);
    const rows = getSheetRows(item);
    const columns = getSheetColumns(item);

    return `
      <button class="sheet-item" type="button" data-open-sheet="${escapeHtml(name)}">
        <div>
          <div class="sheet-item-name">${escapeHtml(name)}</div>
          <div class="sheet-item-meta">${formatNumber(rows)} แถว · ${formatNumber(columns)} คอลัมน์</div>
        </div>
        <span class="sheet-item-arrow">›</span>
      </button>`;
  }).join('');

  container.querySelectorAll('[data-open-sheet]').forEach(button => {
    button.addEventListener('click', async () => {
      selectSheet(button.dataset.openSheet);
      document.querySelector('.nav-btn[data-view="database"]')?.click();
      await loadTableData(button.dataset.openSheet);
    });
  });
}

async function loadSheets() {
  const result = await api('sheets');
  sheetsCache = unwrapData(result);

  populateSheetSelect('dataSheet');
  populateSheetSelect('exportSheet', true);
  renderSheetCards();
  renderDashboardStats();

  if (!currentSheetName && sheetsCache.length) {
    const firstName = getSheetName(sheetsCache[0]);
    selectSheet(firstName);
  }

  updateUploadTarget();
  updateExportSelection();

  return sheetsCache;
}

function renderDashboardStats() {
  setText('kpiSheets', formatNumber(sheetsCache.length));

  const totalRows = sheetsCache.reduce((sum, item) => sum + getSheetRows(item), 0);
  const totalColumns = sheetsCache.reduce((sum, item) => sum + getSheetColumns(item), 0);

  setText('kpiRows', formatNumber(totalRows));
  setText('kpiColumns', formatNumber(totalColumns));
  setText('healthSheets', formatNumber(sheetsCache.length));

  if (!window.Chart || !$('sheetChart')) return;

  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart($('sheetChart'), {
    type: 'bar',
    data: {
      labels: sheetsCache.map(getSheetName),
      datasets: [{
        label: 'จำนวนแถว',
        data: sheetsCache.map(getSheetRows),
        backgroundColor: '#75c58d',
        borderColor: '#3d9661',
        borderWidth: 1,
        borderRadius: 7
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true },
        y: { ticks: { autoSkip: false } }
      }
    }
  });
}

function selectSheet(name) {
  currentSheetName = name || '';

  if ($('dataSheet')) $('dataSheet').value = currentSheetName;

  setText('dataSheetBadge', currentSheetName || 'ยังไม่เลือก Sheet');
  updateUploadTarget();
}

function updateUploadTarget() {
  const target = document.getElementById('uploadTargetName');
  if (target) {
    target.textContent = 'ทุก Sheet ในไฟล์';
  }
}

function updateExportSelection() {
  if ($('exportSheet') && $('exportSheet').value) {
    setText('exportStatus', 'เลือก Sheet แล้ว');
  }
}

// -----------------------------------------------------
// TABLE DATA
// -----------------------------------------------------

async function loadTableData(sheetName = currentSheetName) {
  if (!sheetName) {
    showMessage('importResult', 'กรุณาเลือก Sheet ก่อนใช้งาน', 'error');
    return;
  }

  selectSheet(sheetName);
  setText('tableInfo', 'กำลังโหลดข้อมูล...');

  const result = await api('data', { sheet: sheetName });
  const data = result.data || result;

  currentHeaders = data.header || data.headers || data.columns || [];
  currentRows = data.rows || [];

  if (!currentHeaders.length && currentRows.length && Array.isArray(currentRows[0])) {
    currentHeaders = currentRows[0].map((_, index) => `คอลัมน์ ${index + 1}`);
  }

  filteredRows = [...currentRows];
  currentPage = 1;

  renderTable();
}

function renderTable() {
  const table = $('dataTable');
  if (!table) return;

  const pageSize = Number($('pageSize')?.value || 25);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));

  currentPage = Math.min(Math.max(1, currentPage), totalPages);

  const start = (currentPage - 1) * pageSize;
  const pageRows = filteredRows.slice(start, start + pageSize);

  const headers = currentHeaders.length
    ? currentHeaders
    : (pageRows[0] || []).map((_, index) => `คอลัมน์ ${index + 1}`);

  table.innerHTML = `
    <thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
    <tbody>
      ${pageRows.length
        ? pageRows.map(row => `<tr>${headers.map((_, i) => `<td>${escapeHtml(row[i] ?? '')}</td>`).join('')}</tr>`).join('')
        : `<tr><td class="table-empty" colspan="${Math.max(1, headers.length)}">ไม่พบข้อมูล</td></tr>`
      }
    </tbody>`;

  setText('tableInfo', `แสดง ${formatNumber(pageRows.length)} จาก ${formatNumber(filteredRows.length)} แถว`);
  setText('pageInfo', `หน้า ${currentPage} / ${totalPages}`);

  if ($('btnPrev')) $('btnPrev').disabled = currentPage <= 1;
  if ($('btnNext')) $('btnNext').disabled = currentPage >= totalPages;
}

function searchTable() {
  const query = ($('searchInput')?.value || '').trim().toLowerCase();

  filteredRows = query
    ? currentRows.filter(row => row.some(value => String(value ?? '').toLowerCase().includes(query)))
    : [...currentRows];

  currentPage = 1;
  renderTable();
}

// -----------------------------------------------------
// AUTO IMPORT
// -----------------------------------------------------

function setImportProgress(percent, loaded, total, message) {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));

  const track = $('importProgressTrack');
  if (track) track.hidden = false;

  if ($('importProgress')) $('importProgress').style.width = `${safePercent}%`;

  setText('progressPercent', `${safePercent}%`);
  setText('progressText', message || 'กำลังนำเข้าข้อมูล...');
  setText('progressRows', `นำเข้าแล้ว ${formatNumber(loaded)} แถว`);
  setText('progressTotal', `ทั้งหมด ${formatNumber(total)} แถว`);
}

function setImportBusy(busy) {
  importRunning = busy;

  if ($('btnChooseFile')) $('btnChooseFile').disabled = busy;
  if ($('fileInput')) $('fileInput').disabled = busy;
  if ($('dropZone')) $('dropZone').classList.toggle('uploading', busy);
}


function parseFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));

    reader.onload = event => {
      try {
        const workbook = XLSX.read(new Uint8Array(event.target.result), {
          type: 'array',
          cellDates: false
        });

        if (!workbook.SheetNames.length) {
          throw new Error('ไม่พบ Sheet ในไฟล์');
        }

        const sheets = [];

        for (const sourceSheet of workbook.SheetNames) {
          const worksheet = workbook.Sheets[sourceSheet];

          const matrix = XLSX.utils.sheet_to_json(worksheet, {
            header: 1,
            defval: '',
            raw: false,
            blankrows: false
          });

          // ข้าม Sheet ที่ไม่มีข้อมูลเลย
          if (!matrix.length) continue;

          // ตรวจสอบชื่อ Sheet ที่ Google Sheets รองรับ
          if (
            !sourceSheet.trim() ||
            sourceSheet.length > 100 ||
            /[:\\/?*\[\]]/.test(sourceSheet)
          ) {
            throw new Error(
              `ชื่อ Sheet "${sourceSheet}" ไม่ถูกต้องสำหรับ Google Sheets`
            );
          }

          const header = matrix[0].map(value =>
            String(value ?? '').trim()
          );

          if (!header.length || header.some(value => !value)) {
            throw new Error(
              `Sheet "${sourceSheet}" มีหัวคอลัมน์ว่าง`
            );
          }

          if (header.length > 200) {
            throw new Error(
              `Sheet "${sourceSheet}" มีคอลัมน์เกิน 200 คอลัมน์`
            );
          }

          // ไม่อนุญาตให้มีชื่อคอลัมน์ซ้ำ
          const normalizedHeaders = header.map(value => value.toLowerCase());

          if (new Set(normalizedHeaders).size !== header.length) {
            throw new Error(
              `Sheet "${sourceSheet}" มีชื่อคอลัมน์ซ้ำกัน`
            );
          }

          const rows = matrix.slice(1)
            .filter(row =>
              row.some(value => String(value ?? '').trim() !== '')
            )
            .map(row =>
              header.map((_, index) => row[index] == null ? '' : row[index])
            );

          sheets.push({
            name: sourceSheet,
            header,
            rows
          });
        }

        if (!sheets.length) {
          throw new Error('ไม่พบ Sheet ที่มีข้อมูลในไฟล์');
        }

        resolve({ sheets });
      } catch (error) {
        reject(error);
      }
    };

    reader.readAsArrayBuffer(file);
  });
}




async function startAutoImport(file) {
  if (importRunning || !file) return;

  try {
    // =====================================================
    // 1. ตรวจสอบความพร้อม
    // =====================================================
    if (!window.XLSX) {
      throw new Error(
        'ไม่พบไลบรารี XLSX กรุณารีเฟรชหน้าเว็บแล้วลองใหม่'
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new Error(
        'ไฟล์มีขนาดเกินขีดจำกัด ' +
        formatFileSize(MAX_FILE_SIZE)
      );
    }

    const extension = file.name
      .split('.')
      .pop()
      .toLowerCase();

    if (!['xlsx', 'xls', 'csv'].includes(extension)) {
      throw new Error(
        'รองรับเฉพาะไฟล์ .xlsx, .xls และ .csv'
      );
    }

    // =====================================================
    // 2. ขอสิทธิ์ก่อนเริ่มนำเข้า
    // =====================================================
    const accessKey = getAccessKey();

    if (!accessKey || !String(accessKey).trim()) {
      throw new Error(
        'ไม่พบ Access Key สำหรับเชื่อมต่อระบบ'
      );
    }

    const writeToken = getWriteToken();

    if (!writeToken || !String(writeToken).trim()) {
      throw new Error(
        'ไม่พบ Write Token สำหรับนำเข้าข้อมูล'
      );
    }

    importRunning = true;
    setImportBusy(true);

    showMessage('importResult', '');

    setText('fileName', file.name);

    setImportProgress(
      0,
      0,
      0,
      'กำลังอ่านไฟล์...'
    );

    // แสดงแถบความคืบหน้า
    const progressTrack = document.getElementById(
      'importProgressTrack'
    );

    if (progressTrack) {
      progressTrack.hidden = false;
      progressTrack.setAttribute('aria-valuenow', '0');
    }

    // =====================================================
    // 3. อ่านทุก Sheet จากไฟล์
    // parseFile(file) ต้องคืนค่า { sheets: [...] }
    // =====================================================
    const parsed = await parseFile(file);

    if (!parsed || !Array.isArray(parsed.sheets)) {
      throw new Error(
        'รูปแบบข้อมูลจาก parseFile ไม่ถูกต้อง ' +
        'ต้องคืนค่าเป็น { sheets: [...] }'
      );
    }

    const sheets = parsed.sheets;

    if (!sheets.length) {
      throw new Error(
        'ไม่พบ Sheet ที่มีหัวคอลัมน์ในไฟล์'
      );
    }

    // ตรวจสอบ Sheet และจำนวนข้อมูลก่อนเริ่มเขียน
    for (const sheet of sheets) {
      if (!sheet || !sheet.name) {
        throw new Error(
          'พบ Sheet ที่ไม่มีชื่อ'
        );
      }

      if (
        !Array.isArray(sheet.header) ||
        !sheet.header.length
      ) {
        throw new Error(
          'Sheet "' + sheet.name +
          '" ไม่มีหัวคอลัมน์'
        );
      }

      if (!Array.isArray(sheet.rows)) {
        throw new Error(
          'ข้อมูลแถวของ Sheet "' +
          sheet.name + '" ไม่ถูกต้อง'
        );
      }

      if (sheet.header.length > 200) {
        throw new Error(
          'Sheet "' + sheet.name +
          '" มีคอลัมน์เกิน 200 คอลัมน์'
        );
      }

      const normalizedHeaders = sheet.header.map(
        value => String(value ?? '').trim().toLowerCase()
      );

      if (normalizedHeaders.some(value => !value)) {
        throw new Error(
          'Sheet "' + sheet.name +
          '" มีชื่อหัวคอลัมน์ว่าง'
        );
      }

      if (
        new Set(normalizedHeaders).size !==
        normalizedHeaders.length
      ) {
        throw new Error(
          'Sheet "' + sheet.name +
          '" มีชื่อหัวคอลัมน์ซ้ำกัน'
        );
      }
    }

    // =====================================================
    // 4. คำนวณจำนวนงานทั้งหมด
    // =====================================================
    const totalRows = sheets.reduce(
      (sum, sheet) => sum + sheet.rows.length,
      0
    );

    const totalBatches = sheets.reduce(
      (sum, sheet) =>
        sum + Math.max(
          1,
          Math.ceil(sheet.rows.length / IMPORT_BATCH_SIZE)
        ),
      0
    );

    let completedRows = 0;
    let completedBatches = 0;
    let failedSheet = '';
    let importedSheets = 0;

    const importResults = [];

    setImportProgress(
      0,
      0,
      totalRows,
      'ตรวจสอบไฟล์สำเร็จ พบ ' +
      sheets.length + ' Sheet'
    );

    // =====================================================
    // 5. นำเข้าทุก Sheet ทีละ Sheet
    // =====================================================
    for (
      let sheetIndex = 0;
      sheetIndex < sheets.length;
      sheetIndex++
    ) {
      const sheet = sheets[sheetIndex];

      failedSheet = sheet.name;

      const batchCount = Math.max(
        1,
        Math.ceil(
          sheet.rows.length / IMPORT_BATCH_SIZE
        )
      );

      for (
        let batchIndex = 0;
        batchIndex < batchCount;
        batchIndex++
      ) {
        const start = batchIndex * IMPORT_BATCH_SIZE;

        const rows = sheet.rows.slice(
          start,
          start + IMPORT_BATCH_SIZE
        );

        // ตรวจสอบจำนวนแถวต่อคำขอ
        if (rows.length > 500) {
          throw new Error(
            'จำนวนแถวในชุดข้อมูลเกิน 500 แถว'
          );
        }

        // =================================================
        // 6. ส่งข้อมูลไปยัง Google Apps Script
        // batch แรก replace:true
        // batch ต่อไป replace:false
        // =================================================
        const result = await api('import', {
          token: writeToken,
          payload: {
            sheet: sheet.name,
            header: sheet.header,
            rows: rows,
            replace: batchIndex === 0
          }
        });

        // API ควร throw เมื่อ ok:false อยู่แล้ว
        // ตรวจซ้ำเพื่อป้องกัน response ที่ไม่คาดคิด
        if (
          !result ||
          result.ok === false ||
          result.success === false
        ) {
          throw new Error(
            result?.error ||
            result?.message ||
            'นำเข้า Sheet "' +
            sheet.name + '" ไม่สำเร็จ'
          );
        }

        completedRows += rows.length;
        completedBatches++;

        const percent = Math.min(
          100,
          Math.round(
            completedBatches / totalBatches * 100
          )
        );

        setImportProgress(
          percent,
          completedRows,
          totalRows,
          'Sheet ' +
          (sheetIndex + 1) + '/' + sheets.length +
          ': ' + sheet.name +
          ' · ชุดข้อมูล ' +
          (batchIndex + 1) + '/' + batchCount
        );

        if (progressTrack) {
          progressTrack.setAttribute(
            'aria-valuenow',
            String(percent)
          );
        }
      }

      importedSheets++;

      importResults.push({
        sheet: sheet.name,
        rows: sheet.rows.length,
        status: 'success'
      });
    }

    // =====================================================
    // 7. แสดงผลสำเร็จ
    // =====================================================
    setImportProgress(
      100,
      totalRows,
      totalRows,
      'นำเข้าสำเร็จครบ ' + importedSheets + ' Sheet'
    );

    if (progressTrack) {
      progressTrack.setAttribute(
        'aria-valuenow',
        '100'
      );
    }

    const successMessage =
      'นำเข้าสำเร็จ ' + importedSheets +
      ' Sheet · ' + formatNumber(totalRows) +
      ' แถว จากไฟล์ ' + file.name;

    showMessage(
      'importResult',
      successMessage,
      'success'
    );

    // =====================================================
    // 8. รีเฟรชรายชื่อ Sheet
    // =====================================================
    await loadSheets();

    // เลือก Sheet แรกจากไฟล์เพื่อให้ผู้ใช้ตรวจสอบได้
    const firstImportedSheet = sheets[0].name;

    if (typeof selectSheet === 'function') {
      await selectSheet(firstImportedSheet);
    }

    // โหลดข้อมูลล่าสุดของ Sheet แรก
    if (typeof loadTableData === 'function') {
      await loadTableData(firstImportedSheet);
    }

    if (typeof updateUploadTarget === 'function') {
      updateUploadTarget();
    }

    // คืนสถานะหน้าจอ
    setText(
      'fileName',
      'นำเข้าสำเร็จ: ' + file.name
    );

  } catch (error) {
    console.error(
      '[REPORT IMPORT ERROR]',
      error
    );

    const message = error && error.message
      ? error.message
      : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';

    showMessage(
      'importResult',
      'นำเข้าไม่สำเร็จ: ' + message,
      'error'
    );

    setText(
      'progressText',
      'เกิดข้อผิดพลาดระหว่างนำเข้า'
    );

  } finally {
    importRunning = false;
    setImportBusy(false);
  }
}



function initAutoImport() {
  const input = $('fileInput');
  const choose = $('btnChooseFile');
  const zone = $('dropZone');

  if (!input || !choose || !zone) return;

  choose.addEventListener('click', event => {
    event.stopPropagation();
    if (!importRunning) input.click();
  });

  zone.addEventListener('click', event => {
    if (event.target.closest('button') || importRunning) return;
    input.click();
  });

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;

    setText('fileName', file.name);
    await startAutoImport(file);
    input.value = '';
  });

  zone.addEventListener('dragover', event => {
    event.preventDefault();
    if (!importRunning) zone.classList.add('dragover');
  });

  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));

  zone.addEventListener('drop', async event => {
    event.preventDefault();
    zone.classList.remove('dragover');

    if (importRunning) return;

    const file = event.dataTransfer?.files?.[0];
    if (!file) return;

    setText('fileName', file.name);
    await startAutoImport(file);
  });
}

// -----------------------------------------------------
// EXPORT
// -----------------------------------------------------

async function loadExportData() {
  const selectedSheet = $('exportSheet')?.value || '';
  setText('exportStatus', 'กำลังโหลด...');
  showMessage('exportWarnings', '');

  try {
    const result = await api('export', selectedSheet ? { sheet: selectedSheet } : {});
    exportCache = result.data || result.sheets || result;

    const sheets = Array.isArray(exportCache)
      ? exportCache
      : [exportCache];

    const rowCount = sheets.reduce((sum, sheet) => {
      return sum + (sheet.rows?.length || 0);
    }, 0);

    setText('exportSheetCount', formatNumber(sheets.length));
    setText('exportRowCount', formatNumber(rowCount));
    setText('exportStatus', 'พร้อมส่งออก');

    ['btnExportXlsx', 'btnExportJson'].forEach(id => {
      if ($(id)) $(id).disabled = false;
    });

    if ($('btnExportCsv')) {
      $('btnExportCsv').disabled = !selectedSheet || sheets.length !== 1;
    }
  } catch (error) {
    setText('exportStatus', 'ผิดพลาด');
    showMessage('exportWarnings', error.message, 'error');
  }
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportXlsx() {
  if (!exportCache || !window.XLSX) return;

  const sheets = Array.isArray(exportCache) ? exportCache : [exportCache];
  const workbook = XLSX.utils.book_new();

  sheets.forEach((sheet, index) => {
    const name = String(sheet.name || sheet.sheetName || `Sheet${index + 1}`).slice(0, 31);
    const rows = [sheet.header || sheet.headers || [], ...(sheet.rows || [])];
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, name || `Sheet${index + 1}`);
  });

  XLSX.writeFile(workbook, 'REPORT_export.xlsx');
}

function exportCsv() {
  if (!exportCache) return;

  const sheet = Array.isArray(exportCache) ? exportCache[0] : exportCache;
  const rows = [sheet.header || sheet.headers || [], ...(sheet.rows || [])];
  const csv = rows.map(row => row.map(value => {
    const text = String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n');

  downloadBlob('\uFEFF' + csv, 'REPORT_export.csv', 'text/csv;charset=utf-8');
}

function exportJson() {
  if (!exportCache) return;

  downloadBlob(
    JSON.stringify(exportCache, null, 2),
    'REPORT_export.json',
    'application/json;charset=utf-8'
  );
}

// -----------------------------------------------------
// EVENT BINDING
// -----------------------------------------------------

function bindEvents() {
  $('btnCheckHealth')?.addEventListener('click', () => {
    checkHealth().catch(handleError);
  });

  $('btnReloadSheets')?.addEventListener('click', async () => {
    try {
      await loadSheets();
      await checkHealth();
    } catch (error) {
      handleError(error);
    }
  });

  $('btnRefreshDb')?.addEventListener('click', () => {
    if (currentSheetName) loadTableData(currentSheetName).catch(handleError);
    else loadSheets().catch(handleError);
  });

  $('dataSheet')?.addEventListener('change', event => {
    selectSheet(event.target.value);
    if (currentSheetName) loadTableData(currentSheetName).catch(handleError);
  });

  $('btnSearch')?.addEventListener('click', searchTable);

  $('searchInput')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') searchTable();
  });

  $('pageSize')?.addEventListener('change', () => {
    currentPage = 1;
    renderTable();
  });

  $('btnPrev')?.addEventListener('click', () => {
    currentPage--;
    renderTable();
  });

  $('btnNext')?.addEventListener('click', () => {
    currentPage++;
    renderTable();
  });

  $('btnLoadExport')?.addEventListener('click', loadExportData);
  $('exportSheet')?.addEventListener('change', updateExportSelection);
  $('btnExportXlsx')?.addEventListener('click', exportXlsx);
  $('btnExportCsv')?.addEventListener('click', exportCsv);
  $('btnExportJson')?.addEventListener('click', exportJson);

  $('exportSheet')?.addEventListener('change', () => {
    if ($('btnExportCsv')) $('btnExportCsv').disabled = true;
    if ($('btnExportXlsx')) $('btnExportXlsx').disabled = true;
    if ($('btnExportJson')) $('btnExportJson').disabled = true;
    exportCache = null;
  });
}
// -----------------------------------------------------
// ERROR HANDLER AND INIT
// -----------------------------------------------------
function handleError(error) {
  console.error('[REPORT]', error);
  setConnectionStatus(false, 'เกิดข้อผิดพลาด');
  showMessage('importResult', error?.message || 'เกิดข้อผิดพลาด', 'error');
}

async function init() {
  initNavigation();
  initAutoImport();
  bindEvents();

  try {
    await checkHealth();
    await loadSheets();

    // โหลด Dashboard โดยใช้ฟังก์ชันจาก app_dashboard.js (REPORT_KPI_DASHBOARD)
    // เพื่อป้องกันการโหลดซ้ำซ้อน
    if (
      typeof window.REPORT_KPI_DASHBOARD !== 'undefined' &&
      typeof window.REPORT_KPI_DASHBOARD.reloadHTML === 'function'
    ) {
      await window.REPORT_KPI_DASHBOARD.reloadHTML();
    }

    // โหลดข้อมูลตาราง หากมี Sheet ที่เลือกไว้
    if (currentSheetName) {
      await loadTableData(currentSheetName);
    }
  } catch (error) {
    handleError(error);
  }
}

document.addEventListener('DOMContentLoaded', init);
