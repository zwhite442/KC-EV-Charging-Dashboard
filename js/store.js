/**
 * store.js
 * Vehicle data store backed by IndexedDB — unlimited entries.
 * 
 * NEW:
 *  - parsePaste()      : parses tab-separated text copied directly from Excel
 *  - parseExcel()      : auto-detects today's date sheet (M/D format like "5/5")
 *  - location field    : parking spot (e.g. "1T-24") stored on every vehicle
 *  - color             : randomly assigned from Bolt EUV palette (not from data)
 *  - kWh               : always auto-calculated from SOC delta × 65 kWh battery
 */

(function () {
  const DB_NAME    = 'ev_lot_db';
  const DB_VERSION = 2;           // bumped so upgrade runs on existing installs
  const STORE_NAME = 'vehicles';
  const META_KEY   = 'ev_lot_meta_v1';

  let db       = null;
  let vehicles = [];
  const listeners = [];

  const BOLT_COLORS = ['red','black','white','silver','blue','gray','midnight','green'];
  function randomColor() { return BOLT_COLORS[Math.floor(Math.random() * BOLT_COLORS.length)]; }

  // ── IndexedDB ────────────────────────────────────────────────────────────────
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const idb = e.target.result;
        if (!idb.objectStoreNames.contains(STORE_NAME)) {
          idb.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = e => { db = e.target.result; resolve(db); };
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

  function idbAdd(record) {
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).add(record);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  function idbAddMany(records) {
    return new Promise((resolve, reject) => {
      if (!records.length) { resolve(); return; }
      const tx    = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      let pending = records.length;
      records.forEach(r => {
        const req = store.add(r);
        req.onsuccess = () => { if (--pending === 0) resolve(); };
        req.onerror   = e => reject(e.target.error);
      });
    });
  }

  function idbDelete(id) {
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).delete(id);
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
  }

  function idbClear() {
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).clear();
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
  }

  // ── Month stamp ──────────────────────────────────────────────────────────────
  function getMetaStamp() {
    try { return JSON.parse(localStorage.getItem(META_KEY)) || null; } catch { return null; }
  }
  function saveMetaStamp() {
    const now = new Date();
    try { localStorage.setItem(META_KEY, JSON.stringify({ m: now.getMonth(), y: now.getFullYear() })); } catch {}
  }
  function clearMetaStamp() { try { localStorage.removeItem(META_KEY); } catch {} }

  function showResetBanner(msg) {
    const banner = document.getElementById('reset-banner');
    if (!banner) return;
    document.getElementById('reset-msg').textContent = msg;
    banner.classList.add('show');
  }

  // ── kWh auto-calc ────────────────────────────────────────────────────────────
  // batteryPack = degradation multiplier from column D (e.g. 0.66)
  // Actual usable kWh = 65 × batteryPack
  // kWh delivered = (endPct - startPct) / 100 × (65 × batteryPack)
  function autoKwh(startPct, endPct, batteryPack) {
    const pack     = (batteryPack && batteryPack > 0 && batteryPack <= 1) ? batteryPack : 0.66;
    const capacity = 65 * pack;
    const delta    = Math.max(0, endPct - startPct);
    return Math.round((delta / 100) * capacity * 10) / 10;
  }

  // ── Sanitise ─────────────────────────────────────────────────────────────────
  function sanitize(v) {
    const start = clamp(parseNum(v.startPct, 20), 0, 100);
    const end   = clamp(parseNum(v.endPct,   30), 0, 100);
    const pack  = parseNum(v.batteryPack, 0.66);
    return {
      vin:         String(v.vin      || generateVin()),
      make:        'Chevrolet',
      model:       'Bolt EUV',
      year:        '2027',
      location:    String(v.location || ''),
      color:       randomColor(),
      startPct:    start,
      endPct:      end,
      batteryPack: pack,
      rate:        parseNum(v.rate, 11),
      kwh:         autoKwh(start, end, pack),
      inputDate:   v.inputDate || new Date().toISOString(),
    };
  }

  function clamp(val, min, max) { return Math.min(max, Math.max(min, val)); }
  function parseNum(val, def)   { const n = parseFloat(val); return isNaN(n) ? def : n; }
  function generateVin()        { return '1G1FZ6S0P' + Math.random().toString(36).slice(2,10).toUpperCase(); }

  // ── Event bus ────────────────────────────────────────────────────────────────
  function on(fn)  { listeners.push(fn); }
  function emit()  { listeners.forEach(fn => fn(vehicles)); }

  // ── CRUD ─────────────────────────────────────────────────────────────────────
  async function addVehicle(v) {
    const clean = sanitize(v);
    const id    = await idbAdd(clean);
    clean.id    = id;
    vehicles.push(clean);
    saveMetaStamp();
    emit();
    if (window.firebaseSync && window.firebaseSync.isReady()) {
      window.firebaseSync.saveVehicles(vehicles);
    }
  }

  async function addVehicles(list) {
    const cleaned = list.map(sanitize);
    await idbAddMany(cleaned);
    vehicles = await idbGetAll();
    saveMetaStamp();
    emit();
    if (window.firebaseSync && window.firebaseSync.isReady()) {
      window.firebaseSync.saveVehicles(vehicles);
    }
  }

  async function deleteVehicle(idx) {
    const v = vehicles[idx];
    if (!v) return;
    await idbDelete(v.id);
    vehicles.splice(idx, 1);
    emit();
    if (window.firebaseSync && window.firebaseSync.isReady()) {
      window.firebaseSync.saveVehicles(vehicles);
    }
  }

  async function updateVehicle(idx, updated) {
    const v = vehicles[idx];
    if (!v) return;
    // Keep the same IDB id
    const record = { ...sanitize(updated), id: v.id };
    await new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).put(record);
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
    vehicles[idx] = record;
    emit();
  }

  async function clearAll() {
    await idbClear();
    vehicles = [];
    clearMetaStamp();
    emit();
    if (window.firebaseSync && window.firebaseSync.isReady()) {
      window.firebaseSync.saveVehicles([]);
    }
  }

  function getVehicles() { return vehicles; }

  // ── Load on boot ─────────────────────────────────────────────────────────────
  async function load() {
    await openDB();
    const now    = new Date();
    const stamp  = getMetaStamp();
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    if (stamp && (stamp.y !== now.getFullYear() || stamp.m !== now.getMonth())) {
      await idbClear();
      clearMetaStamp();
      showResetBanner(`New month — the lot has been cleared. Fresh start for ${MONTHS[now.getMonth()]} ${now.getFullYear()}.`);
      vehicles = [];
      emit();
      return;
    }

    if (now.getDate() >= 29) {
      showResetBanner('Heads up: the lot resets automatically at the end of this month.');
    }

    vehicles = await idbGetAll();
    vehicles = vehicles.map(v => ({ ...v, kwh: autoKwh(v.startPct, v.endPct, v.batteryPack) }));
    emit();

    // Start Firebase sync
    if (window.firebaseSync) {
      window.firebaseSync.init().then(ok => {
        if (!ok) return;
        // Use onReady to ensure DB is available before listening
        window.firebaseSync.listenVehicles(async cloudVehicles => {
          // Pull from cloud if it has data and local is empty
          if (cloudVehicles.length > 0 && vehicles.length === 0) {
            await idbClear();
            await idbAddMany(cloudVehicles.map(v => ({...v})));
            vehicles = await idbGetAll();
            vehicles = vehicles.map(v => ({ ...v, kwh: autoKwh(v.startPct, v.endPct, v.batteryPack) }));
            emit();
          }
        });
      });
    }
  }

  // ── Today's sheet name helpers ────────────────────────────────────────────────
  // Your sheets are named M/D (e.g. "5/5", "11/6")
  // We try several formats to find today's sheet
  function getTodaySheetNames() {
    const now = new Date();
    const m   = now.getMonth() + 1;   // 1-based
    const d   = now.getDate();
    return [
      `${m}/${d}`,                    // 5/5  ← your format
      `${m}-${d}`,                    // 5-5
      `0${m}/${d}`,                   // 05/5
      `${m}/0${d}`,                   // 5/05
      `0${m}/0${d}`,                  // 05/05
    ];
  }

  function findTodaySheet(wb) {
    const candidates = getTodaySheetNames();
    for (const name of candidates) {
      if (wb.SheetNames.includes(name)) return wb.Sheets[name];
    }
    // Fallback: last sheet that looks like a date (M/D pattern)
    const datePattern = /^\d{1,2}\/\d{1,2}$/;
    const dateSheets  = wb.SheetNames.filter(n => datePattern.test(n));
    if (dateSheets.length) return wb.Sheets[dateSheets[dateSheets.length - 1]];
    // Last resort: last sheet in the workbook
    return wb.Sheets[wb.SheetNames[wb.SheetNames.length - 1]];
  }

  // ── Excel upload parser ───────────────────────────────────────────────────────
  // Columns from your sheet:
  //   A: VIN  B: Location  C: Vehicle  D:(hidden)  E: Starting SOC  F: Ending SOC  G: %Added  H: KWH D...
  function parseExcel(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const wb  = XLSX.read(e.target.result, { type: 'array' });
          const ws  = findTodaySheet(wb);
          const raw = XLSX.utils.sheet_to_json(ws, { defval: '', header: 1 });

          // Find the header row (contains "VIN")
          let headerIdx = 0;
          for (let i = 0; i < Math.min(raw.length, 5); i++) {
            if (raw[i].some(cell => String(cell).toLowerCase().includes('vin'))) {
              headerIdx = i; break;
            }
          }

          const headers = raw[headerIdx].map(h => String(h).toLowerCase().trim());
          const rows    = raw.slice(headerIdx + 1).filter(r => r.some(c => c !== ''));

          resolve(rows.map(row => rowArrayToVehicle(headers, row)).filter(Boolean));
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('File read failed.'));
      reader.readAsArrayBuffer(file);
    });
  }

  function colIdx(headers, names) {
    for (const name of names) {
      const idx = headers.findIndex(h => h.includes(name));
      if (idx >= 0) return idx;
    }
    return -1;
  }

  function rowArrayToVehicle(headers, row) {
    const get = (names) => {
      const i = colIdx(headers, names);
      return i >= 0 ? row[i] : '';
    };
    const startPct    = parseFloat(get(['starting soc','start soc','starting','soc start','start%','startpct'])) || 0;
    const endPct      = parseFloat(get(['ending soc','end soc','ending','soc end','end%','endpct']))             || 30;
    const batteryPack = parseFloat(get(['battery pack','battery','pack','batt'])) || 0.66;
    const vin         = String(get(['vin']) || '');
    // Skip empty / warning rows
    if (!vin || vin.length < 10 || vin.toLowerCase().includes('fill') || vin.toLowerCase().includes('select')) return null;
    return {
      vin,
      location:    String(get(['location','loc','spot','stall']) || ''),
      batteryPack,
      startPct,
      endPct,
      rate:        11,
    };
  }

  // ── Paste parser ─────────────────────────────────────────────────────────────
  // Handles text copied straight from Excel (tab-separated, newline rows).
  // YOUR column order:
  //   A=VIN | B=Location | C=Vehicle | D=Battery Pack | E=Starting SOC | F=Ending SOC | G=%Added | H=KWH
  //   0       1             2           3                4                 5               6          7
  //
  // Skips: header rows, empty rows, rows with "FILL IN SOC" / "SELECT VEHICLE" / "#N/A"
  function parsePaste(text) {
    const lines = text.trim().split('\n').filter(l => l.trim());
    if (!lines.length) throw new Error('Nothing to paste — copy your rows from Excel first.');

    const SKIP_PATTERNS = ['fill in soc', 'select vehicle', '#n/a', '#ref', '#value', '#name'];

    const results = [];
    for (const line of lines) {
      const cols    = line.split('\t').map(c => c.trim());
      const lineStr = line.toLowerCase();

      // Skip header rows
      if (lineStr.includes('vin') && lineStr.includes('location')) continue;
      if (lineStr.includes('starting soc') || lineStr.includes('ending soc')) continue;

      // Skip warning / empty / formula-error rows
      if (SKIP_PATTERNS.some(p => lineStr.includes(p))) continue;
      if (cols.length < 4) continue;

      const vin = cols[0] || '';

      // Must look like a real VIN (starts with 1G1, letters/numbers, at least 10 chars)
      if (!vin || vin.length < 10 || !/^[A-Z0-9]+$/i.test(vin)) continue;
      if (vin.toLowerCase() === 'vin') continue;

      const location    = cols[1] || '';
      // col 2 = Vehicle (BOLT) — skip
      const batteryPack = parseFloat(cols[3]) || 0.66;  // col D
      const startPct    = parseFloat(cols[4]) || 0;     // col E Starting SOC
      const endPct      = parseFloat(cols[5]) || 30;    // col F Ending SOC

      results.push({ vin, location, batteryPack, startPct, endPct, rate: 11 });
    }

    if (!results.length) throw new Error('No valid vehicles found. Select your data rows in Excel (including header) and try again.');
    return results;
  }

  // ── Sample fleet ──────────────────────────────────────────────────────────────
  function getSampleFleet(count = 10) {
    const locations = ['1T-22','1T-24','2T-22','2T-24','3T-22','3T-24','4T-22','4T-24'];
    return Array.from({ length: count }, (_, i) => {
      const sp = Math.round(5 + Math.random() * 80);
      const ep = Math.min(100, sp + 5 + Math.round(Math.random() * (100 - sp)));
      return {
        vin:      '1G1FZ6S0P' + String(4000000 + i * 137),
        location: locations[i % locations.length],
        startPct: sp,
        endPct:   ep,
        rate:     11,
      };
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.store = {
    load,
    addVehicle,
    addVehicles,
    deleteVehicle,
    updateVehicle,
    clearAll,
    getVehicles,
    parseExcel,
    parsePaste,
    getSampleFleet,
    on,
  };
})();
