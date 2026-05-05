/**
 * store.js
 * Vehicle data store backed by IndexedDB — supports unlimited entries.
 * Falls back to localStorage only for the month-stamp (tiny metadata).
 * Auto-clears on the 1st of each new month.
 *
 * kWh delivered is ALWAYS calculated automatically:
 *   kWh = (endPct - startPct) / 100 × BOLT_BATTERY_KWH (65 kWh)
 */

(function () {
  const DB_NAME    = 'ev_lot_db';
  const DB_VERSION = 1;
  const STORE_NAME = 'vehicles';
  const META_KEY   = 'ev_lot_meta_v1';

  let db        = null;
  let vehicles  = [];
  const listeners = [];

  // ── IndexedDB bootstrap ──────────────────────────────────────────────────────
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

  // ── Month-stamp (localStorage — tiny, just 2 numbers) ───────────────────────
  function getMetaStamp() {
    try { return JSON.parse(localStorage.getItem(META_KEY)) || null; }
    catch { return null; }
  }
  function saveMetaStamp() {
    const now = new Date();
    try { localStorage.setItem(META_KEY, JSON.stringify({ m: now.getMonth(), y: now.getFullYear() })); }
    catch { /* storage full – non-critical */ }
  }
  function clearMetaStamp() {
    try { localStorage.removeItem(META_KEY); } catch { }
  }

  function showResetBanner(msg) {
    const banner = document.getElementById('reset-banner');
    if (!banner) return;
    document.getElementById('reset-msg').textContent = msg;
    banner.classList.add('show');
  }

  // ── kWh auto-calculation ─────────────────────────────────────────────────────
  function autoKwh(startPct, endPct) {
    return window.EV_COLORS.calcKwh(startPct, endPct);
  }

  // ── Sanitise ─────────────────────────────────────────────────────────────────
  function sanitize(v) {
    const start = clamp(parseNum(v.startPct, 20), 0, 100);
    const end   = clamp(parseNum(v.endPct,   90), 0, 100);
    return {
      vin:      String(v.vin   || generateVin()),
      make:     String(v.make  || 'Chevrolet'),
      model:    String(v.model || 'Bolt EUV'),
      year:     String(v.year  || '2027'),
      mileage:  parseNum(v.mileage, 0),
      color:    String(v.color || 'red'),
      startPct: start,
      endPct:   end,
      rate:     parseNum(v.rate, 11),
      kwh:      autoKwh(start, end),
    };
  }

  function clamp(val, min, max) { return Math.min(max, Math.max(min, val)); }
  function parseNum(val, def)   { const n = parseFloat(val); return isNaN(n) ? def : n; }
  function generateVin()        { return '1G1FZ6S0P' + Math.random().toString(36).slice(2, 10).toUpperCase(); }

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
  }

  async function addVehicles(list) {
    const cleaned = list.map(sanitize);
    await idbAddMany(cleaned);
    vehicles = await idbGetAll();
    saveMetaStamp();
    emit();
  }

  async function deleteVehicle(idx) {
    const v = vehicles[idx];
    if (!v) return;
    await idbDelete(v.id);
    vehicles.splice(idx, 1);
    emit();
  }

  async function clearAll() {
    await idbClear();
    vehicles = [];
    clearMetaStamp();
    emit();
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
      showResetBanner(
        `New month — the lot has been cleared automatically. ` +
        `Fresh start for ${MONTHS[now.getMonth()]} ${now.getFullYear()}.`
      );
      vehicles = [];
      emit();
      return;
    }

    if (now.getDate() >= 29) {
      showResetBanner('Heads up: the lot resets automatically at the end of this month.');
    }

    vehicles = await idbGetAll();
    // Recalculate kWh for any legacy records
    vehicles = vehicles.map(v => ({ ...v, kwh: autoKwh(v.startPct, v.endPct) }));
    emit();
  }

  // ── Excel / CSV parsing ───────────────────────────────────────────────────────
  function parseExcel(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const wb  = XLSX.read(e.target.result, { type: 'array' });
          const ws  = wb.Sheets[wb.SheetNames[0]];
          const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
          if (!raw.length) { reject(new Error('No data found in file.')); return; }
          resolve(raw.map(rowToVehicle));
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('File read failed.'));
      reader.readAsArrayBuffer(file);
    });
  }

  function getCol(row, names) {
    for (const name of names) {
      for (const key of Object.keys(row)) {
        if (key.toLowerCase().replace(/[^a-z]/g, '').includes(name)) return row[key];
      }
    }
    return '';
  }

  function rowToVehicle(row) {
    const startPct = parseFloat(getCol(row, ['start','begin','initial','startpct','start%'])) || Math.round(15 + Math.random() * 65);
    const endPct   = parseFloat(getCol(row, ['end','target','final','endpct','end%']))         || Math.round(80 + Math.random() * 20);
    return {
      vin:      String(getCol(row, ['vin']) || generateVin()),
      make:     String(getCol(row, ['make','brand','mfr','manufacturer']) || 'Chevrolet'),
      model:    String(getCol(row, ['model']) || 'Bolt EUV'),
      year:     String(getCol(row, ['year','yr']) || '2027'),
      mileage:  parseFloat(getCol(row, ['mile','odometer','odo','km'])) || 0,
      color:    String(getCol(row, ['color','colour']) || 'red'),
      startPct,
      endPct,
      rate:     parseFloat(getCol(row, ['rate','kw','power','kwrate'])) || 11,
      // kwh omitted — sanitize() calculates it
    };
  }

  // ── Sample fleet ──────────────────────────────────────────────────────────────
  const BOLT_COLORS = ['red','black','white','silver','blue','gray','midnight','green'];

  function getSampleFleet(count = 10) {
    return Array.from({ length: count }, (_, i) => {
      const color = BOLT_COLORS[i % BOLT_COLORS.length];
      const sp    = Math.round(5 + Math.random() * 80);
      const ep    = Math.min(100, sp + 5 + Math.round(Math.random() * (100 - sp)));
      return {
        vin:   '1G1FZ6S0P' + String(4000000 + i * 137),
        make:  'Chevrolet',
        model: 'Bolt EUV',
        year:  '2027',
        mileage: Math.round(Math.random() * 8000),
        color,
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
    clearAll,
    getVehicles,
    parseExcel,
    getSampleFleet,
    on,
  };
})();
