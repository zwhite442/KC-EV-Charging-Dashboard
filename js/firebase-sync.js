/**
 * firebase-sync.js
 * Firebase scripts are loaded in index.html — this just initializes and uses them.
 */

(function () {
  const FIREBASE_CONFIG = {
    apiKey:            "AIzaSyCyAU39lEVEGCmiGKiirop1O1QFK0V0hzI",
    authDomain:        "kc-ev-charging-dashboard.firebaseapp.com",
    projectId:         "kc-ev-charging-dashboard",
    storageBucket:     "kc-ev-charging-dashboard.firebasestorage.app",
    messagingSenderId: "883706784039",
    appId:             "1:883706784039:web:089dbe02ad7e851c07e102",
  };

  let db    = null;
  let ready = false;

  function updateStatus(status) {
    const el = document.getElementById('sync-status');
    if (!el) return;
    const map = {
      connecting: ['⟳', '#f59e0b', 'Connecting…'],
      online:     ['●', '#22c55e', 'Synced'],
      offline:    ['○', '#6b7280', 'Offline'],
      error:      ['!', '#ef4444', 'Sync error'],
    };
    const [dot, color, text] = map[status] || map.offline;
    el.innerHTML = `<span style="color:${color}">${dot}</span> ${text}`;
  }

  async function init() {
    try {
      updateStatus('connecting');

      // Firebase scripts are already loaded via <script> tags in index.html
      if (typeof firebase === 'undefined') {
        console.error('Firebase SDK not loaded');
        updateStatus('error');
        return false;
      }

      if (!firebase.apps.length) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }

      db = firebase.firestore();

      // Enable offline persistence
      try {
        await db.enablePersistence({ synchronizeTabs: true });
      } catch(e) {
        // ok — multiple tabs or not supported
      }

      ready = true;
      updateStatus('online');
      console.log('✅ Firebase Firestore ready');

      // Test write to confirm rules allow access
      try {
        await db.collection('_test').doc('ping').set({
          ts: firebase.firestore.FieldValue.serverTimestamp(),
          from: navigator.userAgent.slice(0, 50),
        });
        console.log('✅ Firebase test write succeeded — rules are open');
        await db.collection('_test').doc('ping').delete();
      } catch(err) {
        console.error('❌ Firebase test write FAILED:', err.code, err.message);
        updateStatus('error');
        // Show visible error to user
        const el = document.getElementById('sync-status');
        if (el) el.innerHTML = '<span style="color:#ef4444">❌ Firebase blocked: ' + err.code + '</span>';
      }

      return true;
    } catch(err) {
      console.error('Firebase init failed:', err);
      updateStatus('error');
      return false;
    }
  }

  // ── Vehicles ──────────────────────────────────────────────────────────────────
  async function saveVehicles(vehicles) {
    if (!ready || !db) return;
    try {
      const batch = db.batch();
      const col   = db.collection('vehicles');

      const snap = await col.get();
      snap.docs.forEach(doc => batch.delete(doc.ref));

      vehicles.forEach((v, i) => {
        const clean = {};
        Object.keys(v).forEach(k => {
          if (v[k] !== undefined) clean[k] = v[k];
        });
        batch.set(col.doc('v_' + String(i).padStart(4, '0')), { ...clean, _idx: i });
      });

      batch.set(db.collection('meta').doc('lotMeta'), {
        month:     new Date().getMonth(),
        year:      new Date().getFullYear(),
        count:     vehicles.length,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      await batch.commit();
      updateStatus('online');
      console.log('✅ Saved', vehicles.length, 'vehicles to Firebase');
    } catch(err) {
      console.error('saveVehicles error:', err);
      updateStatus('error');
    }
  }

  function listenVehicles(onUpdate) {
    if (!ready || !db) return;
    db.collection('vehicles').orderBy('_idx').onSnapshot(snap => {
      const vehs = snap.docs.map(d => {
        const v = { ...d.data() };
        delete v._idx;
        return v;
      });
      onUpdate(vehs);
      updateStatus('online');
    }, err => {
      console.error('listenVehicles error:', err);
      updateStatus('offline');
    });
  }

  // ── Daily Totals ──────────────────────────────────────────────────────────────
  async function saveDailyTotal(record) {
    if (!ready || !db) return;
    try {
      await db.collection('daily_totals').doc(record.dateKey).set(record);
      updateStatus('online');
      console.log('✅ Saved daily total:', record.dateKey);
    } catch(err) {
      console.error('saveDailyTotal error:', err);
      updateStatus('error');
    }
  }

  async function deleteDailyTotal(dateKey) {
    if (!ready || !db) return;
    try {
      await db.collection('daily_totals').doc(dateKey).delete();
    } catch(err) {
      console.error('deleteDailyTotal error:', err);
    }
  }

  function listenDailyTotals(onUpdate) {
    if (!ready || !db) return;
    db.collection('daily_totals').orderBy('dateKey', 'desc').onSnapshot(snap => {
      const totals = snap.docs.map(d => d.data());
      onUpdate(totals);
    }, err => {
      console.error('listenDailyTotals error:', err);
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.firebaseSync = {
    init,
    saveVehicles,
    listenVehicles,
    saveDailyTotal,
    deleteDailyTotal,
    listenDailyTotals,
    isReady: () => ready,
  };
})();
