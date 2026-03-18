/* ============================================================
   app.js – DashMovilidad
   CSV format: Last Seen = "M/D/YYYY h:mm:ss AM/PM"
   Device type: Username starts with HH → Hand Held, T → Tablet, else Other
   ============================================================ */

'use strict';

/* ── DOM REFS ─── */
const formView = document.getElementById('form-view');
const dashView = document.getElementById('dash-view');
const btnGen = document.getElementById('btn-generate');
const btnBack = document.getElementById('btn-back');
const btnJpg = document.getElementById('btn-export-jpg');
const btnPdf = document.getElementById('btn-export-pdf');
const dashPage = document.getElementById('dashboard-page');
const expLoader = document.getElementById('export-loading');
const expMsg = document.getElementById('export-loading-msg');

/* Factors Critical view elements */
const factorsView = document.getElementById('factors-view');
const factorsDashView = document.getElementById('factors-dash-view');
const btnGenFactors = document.getElementById('btn-generate-factors');
const btnExpFactorsJpg = document.getElementById('btn-export-factors-jpg');
const factorsPage = document.getElementById('factors-page');


/* CSV elements */
const dropZone = document.getElementById('csv-drop-zone');
const fileInput = document.getElementById('csv-file-inp');
const emptyState = document.getElementById('csv-empty-state');
const loadedState = document.getElementById('csv-loaded-state');
const fileLabel = document.getElementById('csv-file-name-label');
const rowsLabel = document.getElementById('csv-file-rows-label');
const removeBtn = document.getElementById('btn-remove-csv');
const previewBox = document.getElementById('csv-preview');
const colsList = document.getElementById('csv-columns-list');
const csvWarning = document.getElementById('csv-warning');

/* ── STATE ─── */
let csvData = [];           // parsed rows [{lastSeen: Date, username: string, type: 'HH'|'T'|'other'}]
let csvFileName = '';
let charts = {};
let factorsRadarChart = null;

/* ── CSV PARSER ─── */
/**
 * Robust CSV parser that handles quoted fields.
 */
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  function splitLine(line) {
    const fields = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuote = !inQuote; }
      } else if (ch === ',' && !inQuote) {
        fields.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    fields.push(cur.trim());
    return fields;
  }

  const headers = splitLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = splitLine(lines[i]);
    if (vals.length < 2) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = vals[idx] ?? ''; });
    rows.push(obj);
  }
  return { headers, rows };
}

/**
 * Parse "M/D/YYYY h:mm:ss AM/PM" → Date
 * e.g. "3/5/2026 4:23:34 PM"
 */
function parseLastSeen(str) {
  if (!str) return null;
  str = str.trim().replace(/"/g, '');
  // Try native parse first (works in Chrome)
  const d = new Date(str);
  if (!isNaN(d)) return d;

  // Manual parse: M/D/YYYY h:mm:ss AM/PM  or  M/D/YYYY h:mm:ss p. m.
  // Normalize spanish "p. m." / "a. m."
  const norm = str
    .replace(/p\.\s*m\./i, 'PM')
    .replace(/a\.\s*m\./i, 'AM');

  const m = norm.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  let [, month, day, year, hour, min, sec, ampm] = m;
  hour = parseInt(hour, 10);
  if (ampm.toUpperCase() === 'PM' && hour < 12) hour += 12;
  if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;
  return new Date(year, month - 1, day, hour, parseInt(min), parseInt(sec));
}

/**
 * Detect device type from Username:
 *   HH... → Hand Held
 *   T...  → Tablet
 *   else  → other
 */
function deviceType(username) {
  if (!username) return 'other';
  const u = username.trim().toUpperCase();
  if (u.startsWith('HH')) return 'HH';
  if (u.startsWith('T')) return 'T';
  return 'other';
}

/**
 * Switch top-level navigation tabs
 */
window.switchTab = function(tabName) {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(t => t.classList.remove('active'));

  dashView.style.display = 'none';
  factorsDashView.style.display = 'none';

  if (tabName === 'movilidad') {
    document.getElementById('tab-movilidad').classList.add('active');
    formView.style.display = 'block';
    factorsView.style.display = 'none';
  } else if (tabName === 'factors') {
    document.getElementById('tab-factors').classList.add('active');
    formView.style.display = 'none';
    factorsView.style.display = 'block';
  }
};

/**
 * Classify by days offline:
 *  ≤ 1 day  → 'online'
 *  2–3 days → 'warn'
 *  > 3 days → 'offline'
 */
function classify(lastSeen, now) {
  if (!lastSeen) return 'offline';
  const diffMs = now - lastSeen;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays <= 1) return 'online';
  if (diffDays <= 3) return 'warn';
  return 'offline';
}

/* ── CSV DRAG & DROP ─── */
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('over');
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadFile(fileInput.files[0]);
});
removeBtn.addEventListener('click', clearCSV);

function loadFile(file) {
  csvFileName = file.name;
  const reader = new FileReader();
  reader.onload = e => processCSVText(e.target.result, file.name);
  reader.readAsText(file, 'utf-8');
}

function processCSVText(text, name) {
  const { headers, rows } = parseCSV(text);

  // Show column preview
  const required = ['last_seen', 'username'];
  colsList.innerHTML = headers.map(h => {
    const isReq = required.includes(h);
    return `<span class="csv-col-tag ${isReq ? 'required' : ''}">${h.replace(/_/g, ' ')}</span>`;
  }).join('');

  // Check required columns
  const missing = required.filter(r => !headers.includes(r));
  if (missing.length) {
    csvWarning.textContent = `⚠️ Columna(s) faltante(s): ${missing.map(m => m.replace(/_/g, ' ')).join(', ')}`;
    csvWarning.style.display = 'block';
  } else {
    csvWarning.style.display = 'none';
  }

  // Parse each row
  const now = new Date(2026, 2, 5, 17, 3, 0); // reference: 2026-03-05 17:03 CST (local time at load)
  // Use actual client time for live calculation
  const nowReal = new Date();

  csvData = rows.map(r => {
    const ls = parseLastSeen(r['last_seen']);
    return {
      lastSeen: ls,
      username: r['username'] || '',
      type: deviceType(r['username']),
      status: classify(ls, nowReal),
    };
  }).filter(r => r.lastSeen !== null || r.username);

  // UI update
  fileLabel.textContent = name;
  rowsLabel.textContent = `${csvData.length} dispositivos cargados`;
  emptyState.style.display = 'none';
  loadedState.style.display = 'block';
  previewBox.style.display = 'block';
}

function clearCSV() {
  csvData = [];
  csvFileName = '';
  fileInput.value = '';
  emptyState.style.display = 'block';
  loadedState.style.display = 'none';
  previewBox.style.display = 'none';
}

/* ── FORM HELPERS ─── */
function iv(id) { return parseInt(document.getElementById(id).value, 10) || 0; }
function sv(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

/* ── GENERATE DASHBOARD ─── */
btnGen.addEventListener('click', generateDashboard);
btnBack.addEventListener('click', () => {
  dashView.style.display = 'none';
  formView.style.display = 'block';
  destroyCharts();
});

function generateDashboard() {
  // Collect form values
  const D = {
    tiendas: iv('inp-tiendas'),
    siFolio: document.getElementById('inp-si-folio')?.value.trim() || '—',
    siEstatus: document.getElementById('inp-si-estatus')?.value || 'none',
    // Garantías
    tCon: iv('t-con'), tSin: iv('t-sin'),
    hhCon: iv('hh-con'), hhSin: iv('hh-sin'),
    impCon: iv('imp-con'), impSin: iv('imp-sin'),
    // Depreciados
    depHH: iv('dep-hh'), depT: iv('dep-t'), depImp: iv('dep-imp'),
    // Stock
    stkT: iv('stk-t'), stkHH: iv('stk-hh'), stkImp: iv('stk-imp'),
  };

  // Connectivity stats from CSV
  const conn = { online: { HH: 0, T: 0, other: 0 }, warn: { HH: 0, T: 0, other: 0 }, offline: { HH: 0, T: 0, other: 0 } };
  csvData.forEach(r => { conn[r.status][r.type]++; });
  const totOnline = conn.online.HH + conn.online.T + conn.online.other;
  const totWarn = conn.warn.HH + conn.warn.T + conn.warn.other;
  const totOffline = conn.offline.HH + conn.offline.T + conn.offline.other;
  const totCSV = csvData.length;

  // ── Fill KPIs ──
  sv('dp-stores-n', D.tiendas);
  sv('k-t-con', D.tCon); sv('k-t-sin', D.tSin); sv('k-t-dep', D.depT); sv('k-t-stk', D.stkT);
  sv('k-hh-con', D.hhCon); sv('k-hh-sin', D.hhSin); sv('k-hh-dep', D.depHH); sv('k-hh-stk', D.stkHH);
  sv('k-imp-con', D.impCon); sv('k-imp-sin', D.impSin); sv('k-imp-dep', D.depImp); sv('k-imp-stk', D.stkImp);
  document.getElementById('dp-si-folio').textContent = D.siFolio !== '' ? D.siFolio : '—';
  const badge = document.getElementById('dp-si-badge');
  const dot = document.getElementById('dp-si-dot');
  const txt = document.getElementById('dp-si-status-text');

  badge.className = 'dp-si-st';
  dot.className = 'si-st-dot';
  dot.style.display = 'block';

  if (D.siEstatus === 'auth') {
    badge.classList.add('si-st-auth');
    txt.textContent = 'En autorización';
  } else if (D.siEstatus === 'ok') {
    badge.classList.add('si-st-ok');
    txt.textContent = 'Autorizada';
  } else if (D.siEstatus === 'wait') {
    badge.classList.add('si-st-wait');
    txt.textContent = 'En espera';
  } else if (D.siEstatus === 'recv') {
    badge.classList.add('si-st-recv');
    txt.textContent = 'Recibida';
  } else {
    dot.style.display = 'none';
    txt.textContent = 'Sin estatus';
  }

  // ── Fill Connectivity ──
  sv('conn-online-n', totOnline); sv('conn-online-hh', conn.online.HH); sv('conn-online-t', conn.online.T); sv('conn-online-other', conn.online.other);
  sv('conn-warn-n', totWarn); sv('conn-warn-hh', conn.warn.HH); sv('conn-warn-t', conn.warn.T); sv('conn-warn-other', conn.warn.other);
  sv('conn-off-n', totOffline); sv('conn-off-hh', conn.offline.HH); sv('conn-off-t', conn.offline.T); sv('conn-off-other', conn.offline.other);

  // Show/hide "other" rows
  toggleOther('conn-online-other-row', conn.online.other);
  toggleOther('conn-warn-other-row', conn.warn.other);
  toggleOther('conn-off-other-row', conn.offline.other);

  // CSV metadata
  if (totCSV > 0) {
    document.getElementById('dp-csv-rows-label').textContent = `${totCSV} dispositivos`;
    // Most recent Last Seen
    const latestDate = csvData.reduce((max, r) => r.lastSeen > max ? r.lastSeen : max, csvData[0].lastSeen);
    document.getElementById('dp-csv-date').textContent = fmtDate(latestDate);
  } else {
    document.getElementById('dp-csv-rows-label').textContent = 'sin datos CSV';
    document.getElementById('dp-csv-date').textContent = 'N/A';
  }

  // Dates
  const now = new Date();
  const dateStr = fmtDate(now) + ' ' + fmtTime(now);
  document.getElementById('dp-gen-date').textContent = dateStr;
  document.getElementById('dp-footer-date').textContent = 'Generado: ' + dateStr;

  // ── Charts ──
  destroyCharts();
  buildChartGarantias(D);
  buildChartConnDonut(totOnline, totWarn, totOffline);
  buildChartByType(conn);
  buildChartMini(totOnline, totWarn, totOffline);

  // Switch views
  formView.style.display = 'none';
  dashView.style.display = 'block';
  window.scrollTo(0, 0);
}

function toggleOther(rowId, val) {
  const el = document.getElementById(rowId);
  if (el) el.classList.toggle('visible', val > 0);
}

/* ── DATE FORMAT ─── */
function fmtDate(d) {
  if (!d) return '—';
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtTime(d) {
  return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

/* ── CHART HELPERS ─── */
const CHART_DEFAULTS = {
  plugins: {
    legend: { labels: { color: '#4b5563', font: { family: 'Inter', size: 11 }, boxWidth: 10, padding: 10 } },
    tooltip: { backgroundColor: '#ffffff', titleColor: '#111827', bodyColor: '#4b5563', borderColor: '#e5e7eb', borderWidth: 1 },
  },
};
Chart.defaults.color = '#4b5563';
Chart.defaults.font.family = 'Inter';

function destroyCharts() {
  Object.values(charts).forEach(c => { if (c) c.destroy(); });
  charts = {};
}

function buildChartGarantias(D) {
  const ctx = document.getElementById('chart-garantias').getContext('2d');
  charts.garantias = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['T Con', 'T Sin', 'HH Con', 'HH Sin', 'Imp Con', 'Imp Sin'],
      datasets: [{
        data: [D.tCon, D.tSin, D.hhCon, D.hhSin, D.impCon, D.impSin],
        backgroundColor: [
          '#10b981', '#ef4444',
          '#10b981', '#ef4444',
          '#10b981', '#ef4444',
        ],
        borderWidth: 0,
        hoverOffset: 4,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      cutout: '68%',
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { ...CHART_DEFAULTS.plugins.legend, position: 'bottom' },
      },
    },
  });
}

function buildChartConnDonut(online, warn, offline) {
  const ctx = document.getElementById('chart-connectivity-donut').getContext('2d');
  charts.connDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Online', 'Advertencia', 'Offline'],
      datasets: [{
        data: [online, warn, offline],
        backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
        borderWidth: 0,
        hoverOffset: 4,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      cutout: '68%',
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { ...CHART_DEFAULTS.plugins.legend, position: 'bottom' },
      },
    },
  });
}

function buildChartByType(conn) {
  const ctx = document.getElementById('chart-by-type').getContext('2d');
  charts.byType = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['HH', 'Tablet', 'Otro'],
      datasets: [
        {
          label: 'Online',
          data: [conn.online.HH, conn.online.T, conn.online.other],
          backgroundColor: '#10b981',
          borderRadius: 4,
        },
        {
          label: 'Advertencia',
          data: [conn.warn.HH, conn.warn.T, conn.warn.other],
          backgroundColor: '#f59e0b',
          borderRadius: 4,
        },
        {
          label: 'Offline',
          data: [conn.offline.HH, conn.offline.T, conn.offline.other],
          backgroundColor: '#ef4444',
          borderRadius: 4,
        },
      ],
    },
    options: {
      ...CHART_DEFAULTS,
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, grid: { color: 'rgba(0,0,0,.05)' }, ticks: { color: '#4b5563' } },
        y: { stacked: true, grid: { color: 'rgba(0,0,0,.05)' }, ticks: { color: '#4b5563' } },
      },
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { ...CHART_DEFAULTS.plugins.legend, position: 'bottom' },
      },
    },
  });
}

function buildChartMini(online, warn, offline) {
  const ctx = document.getElementById('chart-conn-mini').getContext('2d');
  charts.mini = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Online', 'Advertencia', 'Offline'],
      datasets: [{
        data: [online, warn, offline],
        backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
        borderWidth: 0,
        hoverOffset: 3,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      cutout: '72%',
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { display: false },
      },
    },
  });
}

/* ── EXPORT JPG ─── */
btnJpg.addEventListener('click', async () => {
  showLoader('Generando imagen…');
  await delay(80);
  try {
    const canvas = await html2canvas(dashPage, {
      backgroundColor: '#f4f6f8',
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false,
    });
    const link = document.createElement('a');
    link.download = `dashboard-movilidad-${dateSuffix()}.jpg`;
    link.href = canvas.toDataURL('image/jpeg', 0.95);
    link.click();
  } catch (e) { alert('Error al exportar: ' + e.message); }
  hideLoader();
});

/* ── EXPORT PDF ─── */
btnPdf.addEventListener('click', async () => {
  showLoader('Generando PDF…');
  await delay(80);
  try {
    const canvas = await html2canvas(dashPage, {
      backgroundColor: '#f4f6f8',
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false,
    });
    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width / 2, canvas.height / 2] });
    pdf.addImage(imgData, 'JPEG', 0, 0, canvas.width / 2, canvas.height / 2);
    pdf.save(`dashboard-movilidad-${dateSuffix()}.pdf`);
  } catch (e) { alert('Error al exportar PDF: ' + e.message); }
  hideLoader();
});

/* ── UTILS ─── */
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function dateSuffix() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
function showLoader(msg) {
  expMsg.textContent = msg;
  expLoader.classList.add('active');
}
function hideLoader() {
  expLoader.classList.remove('active');
}

/* ── PERSIST FORM  (localStorage) ─── */
const formFields = [
  'inp-tiendas', 'inp-si-folio', 'inp-si-estatus',
  't-con', 't-sin', 'hh-con', 'hh-sin', 'imp-con', 'imp-sin',
  'dep-hh', 'dep-t', 'dep-imp',
  'stk-t', 'stk-hh', 'stk-imp',
];
// Restore
formFields.forEach(id => {
  const el = document.getElementById(id);
  const v = localStorage.getItem('dm_' + id);
  if (el && v !== null) el.value = v;
});
// Save on change
formFields.forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', () => localStorage.setItem('dm_' + id, el.value));
});
/**
 * Logic for Factors Critical Dash (Multi-Plaza)
 */
const PLAZAS = ['CD VALLES', 'CD VICTORIA', 'MATAMOROS', 'TAMPICO'];
const FACTOR_IDS = ['resiliente', 'stp', 'telco', 'rentec', 'nps', 'aiops', 'capitanias'];
const FACTOR_LABELS = [
  'Operación Resiliente', 'Cumplimiento STP', 'Telco Tienda/Oficina',
  'Renovación (RENTEC)', 'Mejora NPS', 'Eficiencia AIOps', 'Capitanías TI'
];

const PLAZA_SUFFIXES = {
  'CD VALLES': 'valles',
  'CD VICTORIA': 'victoria',
  'MATAMOROS': 'matamoros',
  'TAMPICO': 'tampico'
};

let multiFactorsData = {}; // { plaza: { yyyy-mm: { id: val } } }

const INDICATOR_DETAILS = {
  'resiliente': {
    title: 'Operación Resiliente',
    desc: 'Evolucionar e implementar mejores prácticas, procesos y procedimientos para la estabilidad de servicios en tienda.',
    metrics: [
      'SLA ATI: 20%',
      'SLA PFS: 35%',
      'Optimización Tiempo Cierre Tickets: 15%',
      'Eficiencia en resultado de auditoría de AF vs AA: 10%',
      '% Cumplimiento Mttos Preventivos Tienda: 20%'
    ],
    goals: [
      'Mejora SLA vs AA',
      'Mejora Tiempo de Atención de Tickets vs AA',
      'Plaza sin Backlog (5 días mes anterior) en cat crítica y alta'
    ]
  },
  'stp': {
    title: 'Cumplimiento STP',
    desc: 'Asegurar basado en el cumplimiento de los puntos del STP la salud de los procesos internos de TI de la Plaza.',
    metrics: [
      'Calificación promedio de las 3 autoverificaciones y 1 verificación funcional: 100%'
    ],
    goals: [
      'Consciencia del espiritu del STP y su beneficio',
      'Propuestas de cambio a Hoja de Control',
      'Compartir buenas prácticas con otras plazas'
    ]
  },
  'telco': {
    title: 'Telco Tienda/Oficina',
    desc: 'Salud de conectividad de tiendas, aseguramiento de disponibilidad de enlaces y equipos para la operación.',
    metrics: [
      'Disponibilidad total enlace tiendas: 30% (Obj: 99% - 100%)',
      'Disp. comunicación en tienda (switch y AP): 30% (Obj: 99% - 100%)',
      'Tiendas operativas redundancias: 10% (Obj: 99%)',
      'Mejora de infraest. en tienda actual: 10% (Obj: 100%)',
      '% De Cumplimiento Plan de Eficiencias de Telco: 20%'
    ],
    goals: [
      'Disponibilidad real de enlaces',
      'Disponibilidad de AP y Switches'
    ]
  },
  'rentec': {
    title: 'Renovación tecnológica (RENTEC)',
    desc: 'Garantizar una actualización constante y eficaz de nuestros activos tecnológicos.',
    metrics: [
      '% Apego a PRT 2026 (Tienda, Telco, Cómputo, CCTV, Telefonía, Oficinas): 100%'
    ],
    goals: [
      'Ejecución de Estrategias para cumplimiento del ciclo al 100%',
      'Desincorporación y entrega de formato hacia Activo Fijo',
      'Cartas de Recepción de Usuario',
      'Asegurar el proceso de plaqueo'
    ]
  },
  'nps': {
    title: 'Mejora NPS',
    desc: 'Mejorar la experiencia del cliente interno y externo enfocada en temas de Frictionless y servicio.',
    metrics: [
      'Índice resultado de las encuestas realizadas a clientes y colaboradores',
      'Ejecución de Plan de Mejora'
    ],
    goals: [
      'NPS igual o mayor al año anterior',
      'Ejecución Plan Plaza Homologado de buenas prácticas'
    ]
  },
  'aiops': {
    title: 'Eficiencia/Productividad AIOps',
    desc: 'Optimización de gente, procesos y tecnología para ser la TI más confiable y rentable.',
    metrics: [
      'Rentec Movilidad y Telefonía ($), plan de trabajo y eficiencia: 30%',
      'Apego a las claves contables de TI: 30%',
      'Generación e Implantación de automatizaciones/IA: 40% (Obj: 10% eficiencia)'
    ],
    goals: [
      'Facturacion de tickets de Excedentes a PFS',
      'Iniciativas locales que abonen a la baja de incidencias',
      'Optimización de Tiempo en Cierre de Tickets',
      'Iniciativas de productividad en hrs/hombre o $'
    ]
  },
  'capitanias': {
    title: 'Capitanías TI',
    desc: 'Seguimiento a las capitanías de cada Asesor TI de temas diversos de la Región y Plaza.',
    metrics: [
      'Resultado de la capitanía anual: 100%'
    ],
    goals: [
      'Estrategia General',
      'Sesiones de Seguimiento',
      'Plan de Trabajo',
      'Resultado Final'
    ]
  }
};

function showIndicatorDetail(id) {
  const info = INDICATOR_DETAILS[id];
  if (!info) return;

  document.getElementById('modal-title').textContent = info.title;
  
  let html = `
    <p><b>Descripción:</b><br>${info.desc}</p>
    <p><b>Métricas y Objetivos:</b></p>
    <ul>
      ${info.metrics.map(m => `<li>${m}</li>`).join('')}
    </ul>
    <p><b>Estrategias Clave:</b></p>
    <ul>
      ${info.goals.map(g => `<li>${g}</li>`).join('')}
    </ul>
  `;
  
  document.getElementById('modal-body').innerHTML = html;
  
  const modal = document.getElementById('factor-modal');
  modal.classList.add('active');
}

function hideFactorModal() {
  const modal = document.getElementById('factor-modal');
  modal.classList.remove('active');
}

function setupFactorsLogic() {
  const plazaSelector = document.getElementById('factors-plaza-select');
  const monthSelector = document.getElementById('factors-month-select');
  const formContainer = document.getElementById('factors-form-container');
  const regionalView = document.getElementById('factors-regional-view');
  
  const modalClose = document.getElementById('modal-close');
  const modalOverlay = document.getElementById('factor-modal');

  if (modalClose) {
    modalClose.addEventListener('click', hideFactorModal);
  }
  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) hideFactorModal();
    });
  }

  // 1. Populate Months (current + previous 6)
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }).toUpperCase();
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    monthSelector.appendChild(opt);
  }

  // 2. Load and Initial State
  loadMultiFactorsData();
  
  // Set defaults from storage if available
  const savedPlaza = localStorage.getItem('dm_current_plaza') || 'CD VALLES';
  const savedMonth = localStorage.getItem('dm_current_month') || monthSelector.value;
  plazaSelector.value = savedPlaza;
  monthSelector.value = savedMonth;

  // 3. Event Listeners
  plazaSelector.addEventListener('change', () => {
    localStorage.setItem('dm_current_plaza', plazaSelector.value);
    updateFactorsView();
  });
  monthSelector.addEventListener('change', () => {
    localStorage.setItem('dm_current_month', monthSelector.value);
    updateFactorsView();
  });

  // Save data on any input change in the grid
  PLAZAS.forEach(plaza => {
    const suffix = PLAZA_SUFFIXES[plaza];
    FACTOR_IDS.forEach(fid => {
      const inputEl = document.getElementById(`f-${fid}-${suffix}`);
      const naEl = document.getElementById(`na-${fid}-${suffix}`);
      
      if (inputEl) {
        inputEl.addEventListener('input', () => {
          saveCurrentFactorData();
        });
      }
      
      if (naEl) {
        naEl.addEventListener('change', () => {
          if (naEl.checked) {
            inputEl.disabled = true;
          } else {
            inputEl.disabled = false;
          }
          saveCurrentFactorData();
        });
      }
    });
  });

  if (btnGenFactors) {
    btnGenFactors.addEventListener('click', generateFactorsOnePage);
  }
  if (btnExpFactorsJpg) {
    btnExpFactorsJpg.addEventListener('click', exportFactorsJPG);
  }

  // Initial Update
  updateFactorsView();
}

function loadMultiFactorsData() {
  const saved = localStorage.getItem('dm_multi_factors_data');
  if (saved) {
    try {
      multiFactorsData = JSON.parse(saved);
    } catch (e) {
      multiFactorsData = {};
    }
  }
}

function saveCurrentFactorData() {
  const month = document.getElementById('factors-month-select').value;
  
  PLAZAS.forEach(plaza => {
    if (!multiFactorsData[plaza]) multiFactorsData[plaza] = {};
    if (!multiFactorsData[plaza][month]) multiFactorsData[plaza][month] = {};

    const suffix = PLAZA_SUFFIXES[plaza];
    FACTOR_IDS.forEach(fid => {
      const inputEl = document.getElementById(`f-${fid}-${suffix}`);
      const naEl = document.getElementById(`na-${fid}-${suffix}`);
      
      if (naEl && naEl.checked) {
        multiFactorsData[plaza][month][fid] = null; // N/A status
      } else if (inputEl) {
        multiFactorsData[plaza][month][fid] = parseFloat(inputEl.value) || 0;
      }
    });
  });

  localStorage.setItem('dm_multi_factors_data', JSON.stringify(multiFactorsData));
  
  // Update live preview after saving
  refreshFactorsPreview();
}

function updateFactorsView() {
  const plazaSelect = document.getElementById('factors-plaza-select').value;
  const month = document.getElementById('factors-month-select').value;
  const formContainer = document.getElementById('factors-form-container');
  const regionalView = document.getElementById('factors-regional-view');
  const subtitle = document.getElementById('factors-subtitle');

  if (plazaSelect === 'REGIONAL') {
    formContainer.style.display = 'none';
    regionalView.style.display = 'block';
    subtitle.textContent = 'Panel Consolidado Regional';
    renderRegionalDashboard(month);
  } else {
    formContainer.style.display = 'block';
    regionalView.style.display = 'none';
    subtitle.textContent = `Captura Multiplaza - Mes: ${month}`;
    
    // Fill all inputs in the grid
    PLAZAS.forEach(plaza => {
      const suffix = PLAZA_SUFFIXES[plaza];
      const data = (multiFactorsData[plaza] && multiFactorsData[plaza][month]) || {};
      FACTOR_IDS.forEach(fid => {
        const inputEl = document.getElementById(`f-${fid}-${suffix}`);
        const naEl = document.getElementById(`na-${fid}-${suffix}`);
        
        if (inputEl) {
          const val = data[fid];
          if (val === null) {
            inputEl.value = '';
            inputEl.disabled = true;
            if (naEl) naEl.checked = true;
          } else {
            inputEl.value = val !== undefined ? val : '';
            inputEl.disabled = false;
            if (naEl) naEl.checked = false;
          }
        }
      });
    });

    // Also update the radar and summary for the *selected* plaza in the dropdown
    // so the live preview below the grid shows the currently selected plaza's state
    refreshFactorsPreview(); 
  }
}

function renderRegionalDashboard(month) {
  const grid = document.getElementById('regional-content-grid');
  grid.innerHTML = '';

  PLAZAS.forEach(plaza => {
    const currentData = (multiFactorsData[plaza] && multiFactorsData[plaza][month]) || {};
    
    // Calculate Trend vs Previous Month
    const [year, mon] = month.split('-').map(Number);
    const prevDate = new Date(year, mon - 2, 1);
    const prevMonthStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    const prevData = (multiFactorsData[plaza] && multiFactorsData[plaza][prevMonthStr]) || {};

    let currentSum = 0;
    let currentCount = 0;
    let prevSum = 0;
    let prevCount = 0;

    FACTOR_IDS.forEach(id => {
      const cVal = currentData[id];
      const pVal = prevData[id];
      
      if (cVal !== null && cVal !== undefined) {
        currentSum += cVal;
        currentCount++;
      }
      if (pVal !== null && pVal !== undefined) {
        prevSum += pVal;
        prevCount++;
      }
    });

    let currentAvg = currentCount > 0 ? currentSum / currentCount : 0;
    let prevAvg = prevCount > 0 ? prevSum / prevCount : 0;

    let trendClass = 'trend-equal';
    let trendIcon = '●';
    if (currentAvg > prevAvg + 0.1) { trendClass = 'trend-up'; trendIcon = '▲'; }
    else if (currentAvg < prevAvg - 0.1) { trendClass = 'trend-down'; trendIcon = '▼'; }

    const card = document.createElement('div');
    card.className = 'reg-plaza-card';
    card.innerHTML = `
      <div class="reg-plaza-title">
        <span>${plaza}</span>
        <span class="reg-trend-badge ${trendClass}">${trendIcon} ${currentAvg.toFixed(1)}%</span>
      </div>
      <div class="reg-factors-list">
        ${FACTOR_IDS.map((id, idx) => {
          const val = currentData[id] || 0;
          return `
            <div class="reg-factor-item">
              <span class="reg-factor-name">${FACTOR_LABELS[idx]}</span>
              <span class="reg-factor-score">${val === null ? 'N/A' : val + '%'}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
    grid.appendChild(card);
  });
}

function refreshFactorsPreview() {
  const plaza = document.getElementById('factors-plaza-select').value;
  const month = document.getElementById('factors-month-select').value;
  
  if (plaza === 'REGIONAL') return;

  const currentData = (multiFactorsData[plaza] && multiFactorsData[plaza][month]) || {};
  
  // Handle N/A in data for radar (radar needs numbers, so we treat N/A as 0 for visual, or skip?)
  // Better: radar skip or show 0. Let's show 0 but adjust the average display.
  const dataForRadar = FACTOR_IDS.map(id => {
    const val = currentData[id];
    return (val === null || val === undefined) ? 0 : val;
  });
  
  let validSum = 0;
  let validCount = 0;
  FACTOR_IDS.forEach(id => {
    const val = currentData[id];
    if (val !== null && val !== undefined) {
      validSum += val;
      validCount++;
    }
  });
  
  const avg = validCount > 0 ? (validSum / validCount).toFixed(1) : "0.0";
  
  document.getElementById('f-avg-val').textContent = avg + '%';

  // Header Info
  const [year, mon] = month.split('-').map(Number);
  const d = new Date(year, mon - 1, 1);
  const periodStr = d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }).toUpperCase();
  
  document.getElementById('f-period-val').textContent = periodStr;
  document.getElementById('f-avg-label').textContent = `Promedio Plaza ${plaza}`;
  
  // Footer Date
  const now = new Date();
  const dateStr = now.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
  document.getElementById('f-gen-date-val').textContent = dateStr;
  document.getElementById('f-footer-date').textContent = dateStr;

  // Injection Summary Cards
  const grid = document.getElementById('factors-summary-grid');
  grid.innerHTML = '';
  FACTOR_IDS.forEach((id, i) => {
    const rawVal = currentData[id];
    const isNA = rawVal === null;
    const val = isNA ? 0 : rawVal || 0;
    const color = isNA ? 'var(--t3)' : (val >= 90 ? '#10b981' : (val >= 80 ? '#f59e0b' : '#ef4444'));
    const displayVal = isNA ? 'N/A' : `${val}%`;
    
    grid.innerHTML += `
      <div class="dp-conn-card">
        <div class="dp-conn-label">${FACTOR_LABELS[i]}</div>
        <div class="dp-conn-val" style="color: ${color}">${displayVal}</div>
      </div>
    `;
  });

  // Top Stats Highlights
  const topStats = document.getElementById('f-top-stats');
  const validFactors = FACTOR_IDS.map((id, i) => ({ 
    v: currentData[id], 
    l: FACTOR_LABELS[i] 
  })).filter(f => f.v !== null && f.v !== undefined);

  if (validFactors.length > 0) {
    const sorted = [...validFactors].sort((a, b) => b.v - a.v);
    topStats.innerHTML = `
      <div style="background: rgba(139, 92, 246, 0.1); padding: 12px; border-radius: 8px;">
        <div style="font-size: 11px; color: var(--text-dim);">FORTALEZA CLAVE</div>
        <div style="font-weight: 700; color: var(--purple);">${sorted[0].l} (${sorted[0].v}%)</div>
      </div>
      <div style="background: rgba(239, 68, 68, 0.05); padding: 12px; border-radius: 8px;">
        <div style="font-size: 11px; color: var(--text-dim);">ÁREA DE OPORTUNIDAD</div>
        <div style="font-weight: 700; color: #ef4444;">${sorted[sorted.length - 1].l} (${sorted[sorted.length - 1].v}%)</div>
      </div>
    `;
  } else {
    topStats.innerHTML = '<p style="color:var(--t3); font-size:0.8rem; text-align:center; width:100%">Sin datos para mostrar estadísticas.</p>';
  }

  // Radar Chart
  const ctx = document.getElementById('chart-factors-radar').getContext('2d');
  if (factorsRadarChart) factorsRadarChart.destroy();

  factorsRadarChart = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: FACTOR_LABELS,
      datasets: [{
        label: 'Cumplimiento %',
        data: dataForRadar,
        backgroundColor: 'rgba(139, 92, 246, 0.2)',
        borderColor: '#8b5cf6',
        pointBackgroundColor: '#8b5cf6',
        pointBorderColor: '#fff',
        borderWidth: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          min: 0,
          max: 100,
          ticks: { stepSize: 20, display: false },
          grid: { color: 'rgba(255, 255, 255, 0.1)' },
          angleLines: { color: 'rgba(255, 255, 255, 0.1)' },
          pointLabels: { color: '#e5e7eb', font: { size: 10 } }
        }
      },
      plugins: { legend: { display: false } }
    }
  });
}

function generateFactorsOnePage() {
  const plaza = document.getElementById('factors-plaza-select').value;
  if (plaza === 'REGIONAL') {
    alert('Seleccione una plaza específica para generar el reporte individual OnePage.');
    return;
  }

  // Ensure preview is updated
  refreshFactorsPreview();

  // Switch View
  factorsView.style.display = 'none';
  factorsDashView.style.display = 'block';
  window.scrollTo(0, 0);
}

window.closeFactorsDash = function() {
  factorsDashView.style.display = 'none';
  factorsView.style.display = 'block';
};

async function exportFactorsJPG() {
  if (!factorsPage) return;
  expLoader.style.display = 'flex';
  expMsg.textContent = 'Generando imagen de Factores Críticos...';

  try {
    const canvas = await html2canvas(factorsPage, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#0f172a'
    });
    const link = document.createElement('a');
    const plaza = document.getElementById('factors-plaza-select').value;
    const month = document.getElementById('factors-month-select').value;
    link.download = `OnePage_Factores_${plaza}_${month}.jpg`;
    link.href = canvas.toDataURL('image/jpeg', 0.9);
    link.click();
  } catch (err) {
    console.error('Export failed', err);
    alert('Error al exportar imagen');
  } finally {
    expLoader.style.display = 'none';
  }
}

// Initialize Factors logic
setupFactorsLogic();

