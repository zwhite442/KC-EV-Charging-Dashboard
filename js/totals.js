/**
 * totals.js
 * Daily Totals — stored permanently in IndexedDB, never auto-reset.
 * Matches columns from the "Daily Totals" sheet:
 *   A=Date  B=kWh's  C=Cars  D=Avg kWh  E=Notes
 */

(function () {
  const DB_NAME    = 'ev_totals_db';
  const DB_VERSION = 1;
  const STORE_NAME = 'daily_totals';

  let db     = null;
  let totals = []; // sorted ascending by date

  // ── IndexedDB ────────────────────────────────────────────────────────────────
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const idb = e.target.result;
        if (!idb.objectStoreNames.contains(STORE_NAME)) {
          const store = idb.createObjectStore(STORE_NAME, { keyPath: 'dateKey' });
          store.createIndex('dateKey', 'dateKey', { unique: true });
        }
      };
      req.onsuccess = e => { db = e.target.result; resolve(); };
      req.onerror   = e => reject(e.target.error);
    });
  }

  function idbGetAll() {
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  function idbPut(record) {
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).put(record);
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
  }

  function idbDelete(dateKey) {
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).delete(dateKey);
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
  }

  // ── Date helpers ─────────────────────────────────────────────────────────────
  // Normalize any date string to YYYY-MM-DD for use as the key
  function toDateKey(raw) {
    if (!raw) return null;
    const s = String(raw).trim();

    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    // M/D/YYYY or MM/DD/YYYY
    const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (mdy) {
      const y = mdy[3].length === 2 ? '20' + mdy[3] : mdy[3];
      return `${y}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`;
    }

    // Try native Date parse as fallback
    const d = new Date(s);
    if (!isNaN(d)) {
      return d.toISOString().slice(0, 10);
    }
    return null;
  }

  // Format YYYY-MM-DD → M/D/YYYY for display (matches your sheet format)
  function formatDisplay(dateKey) {
    if (!dateKey) return '';
    const [y, m, d] = dateKey.split('-');
    return `${parseInt(m)}/${parseInt(d)}/${y}`;
  }

  // ── Record sanitise ───────────────────────────────────────────────────────────
  function sanitize(r) {
    const dateKey = toDateKey(r.date || r.dateKey);
    if (!dateKey) return null;
    const kwh  = parseFloat(r.kwh)  || 0;
    const cars = parseInt(r.cars)   || 0;
    const avg  = cars > 0 ? Math.round((kwh / cars) * 100) / 100 : 0;
    return {
      dateKey,
      kwh,
      cars,
      avg,
      notes: String(r.notes || '').trim(),
    };
  }

  // ── Load ──────────────────────────────────────────────────────────────────────
  async function load() {
    await openDB();
    const raw = await idbGetAll();
    totals = raw.sort((a, b) => b.dateKey.localeCompare(a.dateKey)); // newest first
    renderTable();
    renderSummary();

    // Sync from Firebase when totals are empty locally
    if (window.firebaseSync && window.firebaseSync.isReady()) {
      window.firebaseSync.listenDailyTotals(async cloudTotals => {
        if (!cloudTotals.length) return;
        if (totals.length === 0 && cloudTotals.length > 0) {
          for (const t of cloudTotals) await idbPut(t);
          totals = cloudTotals.sort((a,b) => b.dateKey.localeCompare(a.dateKey));
          renderTable();
          renderSummary();
        }
      });
    }
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────────
  async function upsert(r) {
    const clean = sanitize(r);
    if (!clean) { alert('Invalid date — please check the format.'); return; }
    await idbPut(clean);
    const idx = totals.findIndex(t => t.dateKey === clean.dateKey);
    if (idx >= 0) totals[idx] = clean;
    else totals.unshift(clean);
    totals.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
    renderTable();
    renderSummary();
    if (window.firebaseSync && window.firebaseSync.isReady()) {
      window.firebaseSync.saveDailyTotal(clean);
    }
  }

  async function deleteRow(dateKey) {
    await idbDelete(dateKey);
    totals = totals.filter(t => t.dateKey !== dateKey);
    renderTable();
    renderSummary();
    if (window.firebaseSync && window.firebaseSync.isReady()) {
      window.firebaseSync.deleteDailyTotal(dateKey);
    }
  }

  function getTotals() { return totals; }

  // ── Excel / paste parsing ─────────────────────────────────────────────────────
  // Columns: A=Date  B=kWh's  C=Cars  D=Avg kWh (calculated — we ignore)  E=Notes
  function parseRow(cols) {
    const dateRaw = String(cols[0] || '').trim();
    const kwh     = parseFloat(cols[1]) || 0;
    const cars    = parseInt(cols[2])   || 0;
    // cols[3] = Avg kWh — skip, we recalculate
    const notes   = String(cols[4] || '').trim();

    // Skip header, empty, or error rows
    if (!dateRaw || dateRaw.toLowerCase().includes('date')) return null;
    if (dateRaw.includes('#')) return null;
    const dateKey = toDateKey(dateRaw);
    if (!dateKey) return null;

    return { dateKey, kwh, cars, avg: cars > 0 ? Math.round((kwh/cars)*100)/100 : 0, notes };
  }

  function parsePasteText(text) {
    const lines = text.trim().split('\n').filter(l => l.trim());
    const results = [];
    for (const line of lines) {
      const cols = line.split('\t');
      const r    = parseRow(cols);
      if (r) results.push(r);
    }
    return results;
  }

  async function importFromExcel(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async e => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
          // Look for "Daily Totals" sheet, fallback to first sheet
          const sheetName = wb.SheetNames.find(n => n.toLowerCase().includes('daily')) || wb.SheetNames[0];
          const ws  = wb.Sheets[sheetName];
          const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          const records = raw.map(row => parseRow(row)).filter(Boolean);
          for (const r of records) await idbPut(r);
          const all = await idbGetAll();
          totals = all.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
          renderTable();
          renderSummary();
          resolve(records.length);
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('File read failed.'));
      reader.readAsArrayBuffer(file);
    });
  }

  async function importFromPaste(text) {
    const records = parsePasteText(text);
    if (!records.length) throw new Error('No valid rows found. Make sure you copy the date and kWh columns.');
    for (const r of records) await idbPut(r);
    const all = await idbGetAll();
    totals = all.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
    renderTable();
    renderSummary();
    return records.length;
  }

  // ── Export CSV ────────────────────────────────────────────────────────────────
  function exportCSV() {
    if (!totals.length) { alert('No data to export.'); return; }
    const header = 'Date,kWh\'s,Cars,Avg kWh,Notes\n';
    const rows   = totals.map(t =>
      `${formatDisplay(t.dateKey)},${t.kwh},${t.cars},${t.avg},"${t.notes}"`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `daily-totals-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Render table ──────────────────────────────────────────────────────────────
  function renderTable() {
    const tbody = document.getElementById('totals-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!totals.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No daily totals yet — import from Excel or add a day above</td></tr>';
      return;
    }

    totals.forEach(t => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="date-cell">${formatDisplay(t.dateKey)}</td>
        <td class="num-cell">${t.kwh.toLocaleString()}</td>
        <td class="num-cell">${t.cars.toLocaleString()}</td>
        <td class="num-cell highlight-col">${t.avg}</td>
        <td class="notes-cell">${t.notes}</td>
        <td><button class="row-del" data-key="${t.dateKey}" aria-label="Delete">✕</button></td>
      `;
      tr.querySelector('.row-del').addEventListener('click', e => {
        const key = e.target.dataset.key;
        if (confirm(`Delete entry for ${formatDisplay(key)}?`)) deleteRow(key);
      });
      tbody.appendChild(tr);
    });
  }

  // ── Render summary cards ──────────────────────────────────────────────────────
  function renderSummary() {
    const totalKwh  = totals.reduce((s, t) => s + t.kwh, 0);
    const totalCars = totals.reduce((s, t) => s + t.cars, 0);
    const avgKwh    = totalCars > 0 ? Math.round((totalKwh / totalCars) * 100) / 100 : 0;

    const el = id => document.getElementById(id);
    if (el('sum-kwh'))  el('sum-kwh').textContent  = totalKwh.toLocaleString(undefined, {maximumFractionDigits:1});
    if (el('sum-cars')) el('sum-cars').textContent = totalCars.toLocaleString();
    if (el('sum-avg'))  el('sum-avg').textContent  = avgKwh;
    if (el('sum-days')) el('sum-days').textContent = totals.length;
  }

  // ── Wire up DOM events ────────────────────────────────────────────────────────
  function bindEvents() {
    // Manual add
    const addBtn = document.getElementById('t-add-btn');
    if (addBtn) {
      // Default date to today
      const dateInput = document.getElementById('t-date');
      if (dateInput && !dateInput.value) {
        dateInput.value = new Date().toISOString().slice(0, 10);
      }
      addBtn.addEventListener('click', () => {
        const date  = document.getElementById('t-date').value;
        const kwh   = document.getElementById('t-kwh').value;
        const cars  = document.getElementById('t-cars').value;
        const notes = document.getElementById('t-notes').value;
        if (!date) { alert('Please enter a date.'); return; }
        upsert({ date, kwh, cars, notes }).then(() => {
          document.getElementById('t-kwh').value   = '';
          document.getElementById('t-cars').value  = '';
          document.getElementById('t-notes').value = '';
          document.getElementById('t-date').value  = new Date().toISOString().slice(0,10);
        });
      });
    }

    // File import
    const fileInput = document.getElementById('totals-file-input');
    if (fileInput) {
      fileInput.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const count = await importFromExcel(file);
          alert(`✓ Imported ${count} day${count !== 1 ? 's' : ''} of totals.`);
        } catch (err) { alert('Error reading file: ' + err.message); }
      });
    }

    // Paste toggle
    const pasteBtn = document.getElementById('totals-paste-btn');
    if (pasteBtn) {
      pasteBtn.addEventListener('click', () => {
        const wrap = document.getElementById('totals-paste-wrap');
        wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
      });
    }

    // Paste import
    const pasteImportBtn = document.getElementById('totals-paste-import-btn');
    if (pasteImportBtn) {
      pasteImportBtn.addEventListener('click', async () => {
        const text    = document.getElementById('totals-paste-input').value;
        const preview = document.getElementById('totals-paste-preview');
        try {
          const count = await importFromPaste(text);
          preview.textContent = `✓ Imported ${count} day${count !== 1 ? 's' : ''}.`;
          preview.className   = 'paste-preview paste-preview--ok';
          document.getElementById('totals-paste-input').value = '';
          setTimeout(() => { document.getElementById('totals-paste-wrap').style.display = 'none'; preview.textContent = ''; }, 1500);
        } catch (err) {
          preview.textContent = '✗ ' + err.message;
          preview.className   = 'paste-preview paste-preview--error';
        }
      });
    }

    // Live paste preview
    const pasteArea = document.getElementById('totals-paste-input');
    if (pasteArea) {
      pasteArea.addEventListener('input', () => {
        const text    = pasteArea.value.trim();
        const preview = document.getElementById('totals-paste-preview');
        if (!text) { preview.textContent = ''; return; }
        try {
          const records = parsePasteText(text);
          preview.textContent = `✓ ${records.length} day${records.length !== 1 ? 's' : ''} detected`;
          preview.className   = 'paste-preview paste-preview--ok';
        } catch (err) {
          preview.textContent = '✗ ' + err.message;
          preview.className   = 'paste-preview paste-preview--error';
        }
      });
    }

    // Export
    const exportBtn = document.getElementById('export-totals-btn');
    if (exportBtn) exportBtn.addEventListener('click', exportCSV);
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.totalsStore = { load, getTotals, upsert, deleteRow, exportCSV, bindEvents };
})();
