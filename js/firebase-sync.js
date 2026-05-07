/**
 * firebase-sync.js
 * Uses Firebase REST API directly — no SDK needed, works everywhere.
 */

(function () {
  const PROJECT_ID = 'kc-ev-charging-dashboard';
  const BASE_URL   = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const API_KEY    = 'AIzaSyCyAU39lEVEGCmiGKiirop1O1QFK0V0hzI';

  let ready = false;
  let pollInterval = null;

  function updateStatus(status) {
    const el = document.getElementById('sync-status');
    if (!el) return;
    const map = {
      connecting: ['⟳', '#f59e0b', 'Connecting…'],
      online:     ['●', '#22c55e', 'Synced'],
      offline:    ['○', '#6b7280', 'Offline'],
      error:      ['!', '#ef4444', 'Sync error'],
      saving:     ['↑', '#388bfd', 'Saving…'],
    };
    const [dot, color, text] = map[status] || map.offline;
    el.innerHTML  = `<span style="color:${color};font-size:12px">${dot}</span> <span style="color:${color}">${text}</span>`;
    el.style.display = 'block';
  }

  // ── REST helpers ─────────────────────────────────────────────────────────────
  function toFirestore(obj) {
    const fields = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined || v === null) continue;
      if (typeof v === 'string')  fields[k] = { stringValue: v };
      else if (typeof v === 'number') fields[k] = { doubleValue: v };
      else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
      else fields[k] = { stringValue: String(v) };
    }
    return { fields };
  }

  function fromFirestore(doc) {
    if (!doc || !doc.fields) return null;
    const obj = {};
    for (const [k, v] of Object.entries(doc.fields)) {
      if      (v.stringValue  !== undefined) obj[k] = v.stringValue;
      else if (v.doubleValue  !== undefined) obj[k] = v.doubleValue;
      else if (v.integerValue !== undefined) obj[k] = Number(v.integerValue);
      else if (v.booleanValue !== undefined) obj[k] = v.booleanValue;
    }
    return obj;
  }

  async function firestoreSet(collection, docId, data) {
    const url = `${BASE_URL}/${collection}/${docId}?key=${API_KEY}`;
    const res = await fetch(url, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(toFirestore(data)),
    });
    if (!res.ok) throw new Error(`Firestore write failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async function firestoreGetAll(collection) {
    const url = `${BASE_URL}/${collection}?key=${API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) return [];
      throw new Error(`Firestore read failed: ${res.status}`);
    }
    const data = await res.json();
    if (!data.documents) return [];
    return data.documents.map(doc => fromFirestore(doc)).filter(Boolean);
  }

  async function firestoreDelete(collection, docId) {
    const url = `${BASE_URL}/${collection}/${docId}?key=${API_KEY}`;
    await fetch(url, { method: 'DELETE' });
  }

  // ── Init ──────────────────────────────────────────────────────────────────────
  async function init() {
    updateStatus('connecting');
    try {
      // Test connection with a simple read
      const testUrl = `${BASE_URL}/meta/ping?key=${API_KEY}`;
      const res = await fetch(testUrl);
      // 404 is fine — means collection exists but doc doesn't
      if (res.ok || res.status === 404) {
        ready = true;
        updateStatus('online');
        console.log('✅ Firebase REST API connected');

        // Write a test doc to confirm writes work
        await firestoreSet('meta', 'ping', {
          ts:     new Date().toISOString(),
          device: navigator.userAgent.slice(0, 80),
        });
        console.log('✅ Firebase test write succeeded');
        return true;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch(err) {
      console.error('Firebase REST init error:', err);
      updateStatus('error');
      return false;
    }
  }

  // ── Vehicles ──────────────────────────────────────────────────────────────────
  async function saveVehicles(vehicles) {
    if (!ready) return;
    updateStatus('saving');
    try {
      // Save count doc first so other devices know how many to fetch
      await firestoreSet('meta', 'lotMeta', {
        count:     vehicles.length,
        updatedAt: new Date().toISOString(),
        month:     new Date().getMonth(),
        year:      new Date().getFullYear(),
      });

      // Save each vehicle as its own document
      const saves = vehicles.map((v, i) =>
        firestoreSet('vehicles', `v_${String(i).padStart(4,'0')}`, { ...v, _idx: i })
      );
      await Promise.all(saves);
      updateStatus('online');
      console.log('✅ Saved', vehicles.length, 'vehicles to Firebase');
    } catch(err) {
      console.error('saveVehicles error:', err);
      updateStatus('error');
    }
  }

  async function loadVehicles() {
    if (!ready) return [];
    try {
      const docs = await firestoreGetAll('vehicles');
      return docs
        .filter(d => d._idx !== undefined)
        .sort((a, b) => a._idx - b._idx)
        .map(d => { const v = {...d}; delete v._idx; return v; });
    } catch(err) {
      console.error('loadVehicles error:', err);
      return [];
    }
  }

  // Poll for vehicle changes every 30 seconds
  function listenVehicles(onUpdate) {
    if (!ready) return;
    // Initial load
    loadVehicles().then(vehs => { if (vehs.length) onUpdate(vehs); });
    // Poll every 30s for updates from other devices
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
      try {
        const vehs = await loadVehicles();
        if (vehs.length > 0) onUpdate(vehs);
      } catch(e) { /* silent */ }
    }, 30000);
  }

  // ── Daily Totals ──────────────────────────────────────────────────────────────
  async function saveDailyTotal(record) {
    if (!ready) return;
    try {
      await firestoreSet('daily_totals', record.dateKey, record);
      updateStatus('online');
      console.log('✅ Saved daily total:', record.dateKey);
    } catch(err) {
      console.error('saveDailyTotal error:', err);
      updateStatus('error');
    }
  }

  async function deleteDailyTotal(dateKey) {
    if (!ready) return;
    try { await firestoreDelete('daily_totals', dateKey); } catch(err) { console.error(err); }
  }

  async function loadDailyTotals() {
    if (!ready) return [];
    try {
      return await firestoreGetAll('daily_totals');
    } catch(err) {
      console.error('loadDailyTotals error:', err);
      return [];
    }
  }

  function listenDailyTotals(onUpdate) {
    if (!ready) return;
    loadDailyTotals().then(totals => { if (totals.length) onUpdate(totals); });
    // Poll every 60s
    setInterval(async () => {
      try {
        const totals = await loadDailyTotals();
        if (totals.length) onUpdate(totals);
      } catch(e) { /* silent */ }
    }, 60000);
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.firebaseSync = {
    init,
    saveVehicles,
    loadVehicles,
    listenVehicles,
    saveDailyTotal,
    deleteDailyTotal,
    loadDailyTotals,
    listenDailyTotals,
    isReady: () => ready,
  };
})();
