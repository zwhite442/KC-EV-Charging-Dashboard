/**
 * firebase-sync.js
 * Real-time cross-device sync using Firebase Firestore.
 * Syncs: vehicles (monthly lot) and daily totals (permanent).
 *
 * Collections:
 *   /vehicles/{id}     — current month's lot vehicles
 *   /daily_totals/{dateKey} — permanent daily totals history
 *   /meta/lotMeta      — monthly reset tracking
 */

(function () {
  // ── Firebase config (kc-ev-charging-dashboard) ────────────────────────────────
  const FIREBASE_CONFIG = {
    apiKey:            "AIzaSyCyAU39lEVEGCmiGKiirop1O1QFK0V0hzI",
    authDomain:        "kc-ev-charging-dashboard.firebaseapp.com",
    projectId:         "kc-ev-charging-dashboard",
    storageBucket:     "kc-ev-charging-dashboard.firebasestorage.app",
    messagingSenderId: "883706784039",
    appId:             "1:883706784039:web:089dbe02ad7e851c07e102",
  };

  // ── State ─────────────────────────────────────────────────────────────────────
  let db          = null;
  let initialized = false;
  let syncStatus  = 'connecting'; // connecting | online | offline | error
  const listeners = [];

  // ── Load Firebase SDK dynamically ────────────────────────────────────────────
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.type = 'module';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────────
  async function init() {
    try {
      updateStatus('connecting');

      // Load Firebase via CDN (compat version works without bundler)
      await Promise.all([
        loadFirebaseCompat('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js'),
        loadFirebaseCompat('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js'),
      ]);

      if (!firebase.apps.length) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }
      db = firebase.firestore();

      // Enable offline persistence so it works even without internet
      await db.enablePersistence({ synchronizeTabs: true }).catch(err => {
        if (err.code === 'failed-precondition') {
          console.warn('Firebase: multiple tabs open, persistence in one tab only');
        } else if (err.code === 'unimplemented') {
          console.warn('Firebase: offline persistence not supported in this browser');
        }
      });

      initialized = true;
      updateStatus('online');
      console.log('✅ Firebase Firestore connected');
      return true;
    } catch (err) {
      console.error('Firebase init failed:', err);
      updateStatus('error');
      return false;
    }
  }

  function loadFirebaseCompat(src) {
    return new Promise((resolve, reject) => {
      // Check if already loaded
      if (src.includes('firebase-app') && typeof firebase !== 'undefined') { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // ── Status indicator ──────────────────────────────────────────────────────────
  function updateStatus(status) {
    syncStatus = status;
    const el = document.getElementById('sync-status');
    if (!el) return;
    const configs = {
      connecting: { dot: '⟳', text: 'Connecting…', color: '#f59e0b' },
      online:     { dot: '●', text: 'Synced',       color: '#22c55e' },
      offline:    { dot: '○', text: 'Offline',       color: '#6b7280' },
      error:      { dot: '!', text: 'Sync error',    color: '#ef4444' },
    };
    const cfg = configs[status] || configs.offline;
    el.innerHTML = `<span style="color:${cfg.color}">${cfg.dot}</span> ${cfg.text}`;
    el.title = status === 'online' ? 'All data synced to cloud' :
               status === 'offline' ? 'Working offline — will sync when reconnected' :
               'Could not connect to cloud sync';
  }

  // ── Vehicles ──────────────────────────────────────────────────────────────────
  // Save all vehicles (full replace — called after any change to the lot)
  async function saveVehicles(vehicles) {
    if (!initialized || !db) return;
    try {
      const batch = db.batch();
      const col   = db.collection('vehicles');

      // Delete all existing docs first
      const existing = await col.get();
      existing.docs.forEach(doc => batch.delete(doc.ref));

      // Add current vehicles
      vehicles.forEach((v, i) => {
        const ref = col.doc(`v_${i}`);
        batch.set(ref, { ...v, _idx: i });
      });

      // Save meta (month stamp)
      const now = new Date();
      batch.set(db.collection('meta').doc('lotMeta'), {
        month: now.getMonth(),
        year:  now.getFullYear(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      await batch.commit();
      updateStatus('online');
    } catch (err) {
      console.error('Firebase saveVehicles error:', err);
      updateStatus('error');
    }
  }

  // Listen for vehicle changes from other devices
  function listenVehicles(onUpdate) {
    if (!initialized || !db) return;
    db.collection('vehicles').orderBy('_idx').onSnapshot(snapshot => {
      const vehicles = snapshot.docs.map(doc => {
        const d = doc.data();
        delete d._idx;
        return d;
      });
      onUpdate(vehicles);
      updateStatus('online');
    }, err => {
      console.error('Firebase vehicles listener error:', err);
      updateStatus('offline');
    });
  }

  // ── Daily Totals ──────────────────────────────────────────────────────────────
  async function saveDailyTotal(record) {
    if (!initialized || !db) return;
    try {
      await db.collection('daily_totals').doc(record.dateKey).set(record);
      updateStatus('online');
    } catch (err) {
      console.error('Firebase saveDailyTotal error:', err);
      updateStatus('error');
    }
  }

  async function deleteDailyTotal(dateKey) {
    if (!initialized || !db) return;
    try {
      await db.collection('daily_totals').doc(dateKey).delete();
    } catch (err) {
      console.error('Firebase deleteDailyTotal error:', err);
    }
  }

  function listenDailyTotals(onUpdate) {
    if (!initialized || !db) return;
    db.collection('daily_totals').orderBy('dateKey', 'desc').onSnapshot(snapshot => {
      const totals = snapshot.docs.map(doc => doc.data());
      onUpdate(totals);
    }, err => {
      console.error('Firebase totals listener error:', err);
      updateStatus('offline');
    });
  }

  // ── Monthly reset check ───────────────────────────────────────────────────────
  async function checkMonthlyReset() {
    if (!initialized || !db) return false;
    try {
      const meta = await db.collection('meta').doc('lotMeta').get();
      if (!meta.exists) return false;
      const { month, year } = meta.data();
      const now = new Date();
      if (year !== now.getFullYear() || month !== now.getMonth()) {
        // New month — clear vehicles in Firestore
        const batch   = db.batch();
        const existing = await db.collection('vehicles').get();
        existing.docs.forEach(doc => batch.delete(doc.ref));
        batch.set(db.collection('meta').doc('lotMeta'), {
          month: now.getMonth(),
          year:  now.getFullYear(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        await batch.commit();
        return true; // was reset
      }
      return false;
    } catch (err) {
      console.error('Firebase monthly reset check error:', err);
      return false;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.firebaseSync = {
    init,
    saveVehicles,
    listenVehicles,
    saveDailyTotal,
    deleteDailyTotal,
    listenDailyTotals,
    checkMonthlyReset,
    isReady: () => initialized,
    getStatus: () => syncStatus,
  };
})();
