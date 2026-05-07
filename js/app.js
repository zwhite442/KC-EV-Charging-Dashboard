/**
 * app.js
 * Main application bootstrap.
 * Wires paste import, Excel upload, manual entry, store, renderer, and UI.
 */

(function () {
  let selectedIdx = -1;
  let hoveredIdx  = -1;
  let activeTab   = '3d';

  // ── Tab switching ─────────────────────────────────────────────────────────────
  function switchTab(tab) {
    activeTab = tab;

    // Toggle tab button active states
    ['tab-3d','tab-add','tab-list','tab-totals'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('active', id === 'tab-' + tab);
    });

    // Show/hide panels — use both class AND inline style for reliability
    const panels = {
      '3d':     'panel-3d',
      'add':    'panel-form',
      'list':   'panel-list',
      'totals': 'panel-totals',
    };
    Object.entries(panels).forEach(([t, panelId]) => {
      const el = document.getElementById(panelId);
      if (!el) return;
      const isActive = t === tab;
      el.classList.toggle('active', isActive);
      el.style.display = isActive ? 'flex' : 'none';
    });

    if (tab === '3d' && window.renderer) window.renderer.resize();

    // Force refresh list view with latest vehicles on every tab switch
    if (tab === 'list' && window.listView) {
      const vehs = window.store ? window.store.getVehicles() : [];
      console.log('Switching to list tab, vehicles:', vehs.length);
      window.listView.refresh(vehs);
    }
    // Also refresh totals tab
    if (tab === 'totals' && window.totalsStore) {
      window.totalsStore.bindEvents && window.totalsStore.bindEvents();
    }
  }

  // ── Vehicle selection ─────────────────────────────────────────────────────────
  function selectVehicle(idx) {
    selectedIdx = idx;
    const v = window.store.getVehicles()[idx];
    if (!v) return;
    window.ui.showDetail(v);
    window.ui.highlightCard(idx);
  }

  function closeDetail() {
    selectedIdx = -1;
    window.ui.hideDetail();
    window.ui.highlightCard(-1);
  }

  // ── Today's sheet label ───────────────────────────────────────────────────────
  function updateTodayLabel() {
    const now = new Date();
    const label = document.getElementById('today-sheet-label');
    if (label) label.textContent = `${now.getMonth()+1}/${now.getDate()} tab`;
  }

  // ── Paste import ──────────────────────────────────────────────────────────────
  function handlePaste() {
    const input   = document.getElementById('paste-input');
    const text    = (input.value || '').trim();
    const preview = document.getElementById('paste-preview');
    if (!text) {
      preview.textContent = 'Nothing pasted yet — copy your Excel rows first.';
      preview.className   = 'paste-preview paste-preview--error';
      return;
    }
    try {
      const parsed = window.store.parsePaste(text);
      preview.textContent = `⟳ Importing ${parsed.length} vehicle${parsed.length !== 1 ? 's' : ''}…`;
      preview.className   = 'paste-preview paste-preview--ok';
      window.store.addVehicles(parsed).then(() => {
        // Clear the paste box to confirm data was received
        input.value = '';
        preview.textContent = `✅ ${parsed.length} vehicle${parsed.length !== 1 ? 's' : ''} successfully added to the lot!`;
        preview.className   = 'paste-preview paste-preview--ok';
        // Switch to 3D view after short delay so user sees the success message
        setTimeout(() => {
          switchTab('3d');
          setTimeout(() => { preview.textContent = ''; }, 500);
        }, 1200);
      });
    } catch (err) {
      preview.textContent = '✗ ' + err.message;
      preview.className   = 'paste-preview paste-preview--error';
    }
  }

  // Live paste preview — shows row count as user pastes
  function onPasteInput() {
    const text    = (document.getElementById('paste-input').value || '').trim();
    const preview = document.getElementById('paste-preview');
    if (!text) { preview.textContent = ''; preview.className = 'paste-preview'; return; }
    try {
      const parsed = window.store.parsePaste(text);
      preview.textContent = `✓ ${parsed.length} vehicle${parsed.length !== 1 ? 's' : ''} detected — click Import to add`;
      preview.className   = 'paste-preview paste-preview--ok';
    } catch (err) {
      preview.textContent = '✗ ' + err.message;
      preview.className   = 'paste-preview paste-preview--error';
    }
  }

  // ── Excel upload ──────────────────────────────────────────────────────────────
  async function handleFile(file) {
    if (!file) return;
    try {
      const parsed = await window.store.parseExcel(file);
      await window.store.addVehicles(parsed);
      switchTab('3d');
    } catch (err) {
      alert('Could not read file: ' + err.message);
    }
  }

  // ── Manual single entry ───────────────────────────────────────────────────────
  async function addVehicle() {
    const vin      = document.getElementById('f-vin').value.trim();
    const location = document.getElementById('f-location').value.trim();
    const startPct = Math.min(100, Math.max(0, parseFloat(document.getElementById('f-start').value) || 20));
    const endPct   = Math.min(100, Math.max(0, parseFloat(document.getElementById('f-end').value)   || 30));

    await window.store.addVehicle({ vin, location, startPct, endPct, rate: 11 });

    ['f-vin','f-location','f-start','f-end'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('preview-bar').style.width  = '0%';
    document.getElementById('preview-pct').textContent  = '—';
    document.getElementById('f-kwh-display').textContent = '—';

    switchTab('3d');
  }

  // ── Preview update ────────────────────────────────────────────────────────────
  function updatePreview() {
    window.ui.updatePreview();
  }

  // ── Event bindings ────────────────────────────────────────────────────────────
  // Safe binder — skips silently if element missing so one bad ID can't block the rest
  function on(id, evt, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(evt, fn);
    else console.warn('EV Lot: element not found:', id);
  }

  function bindEvents() {
    on('tab-3d',     'click', () => switchTab('3d'));
    on('tab-add',    'click', () => switchTab('add'));
    on('tab-list',   'click', () => switchTab('list'));
    on('tab-totals', 'click', () => switchTab('totals'));

    // Paste
    on('paste-btn',   'click',   handlePaste);
    on('paste-input', 'input',   onPasteInput);
    on('paste-input', 'keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handlePaste(); });

    // Excel upload
    on('file-input', 'change', e => handleFile(e.target.files[0]));

    // Sample fleet
    on('sample-btn', 'click', () => {
      window.store.addVehicles(window.store.getSampleFleet(10)).then(() => switchTab('3d'));
    });

    // Manual add — the main fix
    on('add-btn', 'click', addVehicle);

    // Charge preview
    on('f-start', 'input', updatePreview);
    on('f-end',   'input', updatePreview);

    // Enter key submits manual form
    ['f-vin','f-location','f-start','f-end'].forEach(id => {
      on(id, 'keydown', e => { if (e.key === 'Enter') addVehicle(); });
    });

    // Clear lot
    on('clear-btn', 'click', () => {
      if (!window.store.getVehicles().length) return;
      if (confirm('Clear all vehicles from the lot?')) {
        window.store.clearAll();
        closeDetail();
      }
    });
  }

  // ── Sidebar resize ────────────────────────────────────────────────────────────
  function setupSidebarResize() {
    const sidebar = document.getElementById('sidebar');
    const handle  = document.getElementById('sidebar-resize');
    if (!sidebar || !handle) return;

    // Restore saved width
    try {
      const saved = localStorage.getItem('ev_sidebar_w');
      if (saved) sidebar.style.width = saved + 'px';
    } catch {}

    let dragging = false;
    let startX = 0;
    let startW = 0;

    handle.addEventListener('mousedown', e => {
      dragging = true;
      startX   = e.clientX;
      startW   = sidebar.offsetWidth;
      handle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      const newW = Math.max(180, Math.min(600, startW + (e.clientX - startX)));
      sidebar.style.width = newW + 'px';
      if (window.renderer) window.renderer.resize();
    });

    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { localStorage.setItem('ev_sidebar_w', sidebar.offsetWidth); } catch {}
    });
  }

  // ── Boot ──────────────────────────────────────────────────────────────────────
  function init() {
    setupSidebarResize();

    // Initialize Firebase — small delay ensures all scripts are ready
    setTimeout(() => {
      if (window.firebaseSync) {
        window.firebaseSync.init().then(ok => {
          if (!ok) return;
          console.log('Firebase ready — syncing data');

          // Pull vehicles from cloud if local is empty
          window.firebaseSync.listenVehicles(async cloudVehicles => {
            if (cloudVehicles.length > 0 && window.store.getVehicles().length === 0) {
              await window.store.addVehicles(cloudVehicles);
            }
          });

          // Pull daily totals from cloud
          window.firebaseSync.listenDailyTotals(async cloudTotals => {
            if (cloudTotals.length > 0 && window.totalsStore) {
              window.totalsStore.mergeFromCloud(cloudTotals);
            }
          });
        });
      } else {
        console.error('firebaseSync not found — check script load order');
      }
    }, 500);

    window.store.on(vehicles => {
      window.ui.refresh(vehicles);
      if (window.listView) window.listView.refresh(vehicles);
      if (selectedIdx >= vehicles.length) closeDetail();
      else if (selectedIdx >= 0) window.ui.highlightCard(selectedIdx);

      // Auto-save to Firebase whenever vehicles change
      if (window.firebaseSync && window.firebaseSync.isReady() && vehicles.length > 0) {
        window.firebaseSync.saveVehicles(vehicles);
      }

      // Auto-save today's totals whenever vehicles change
      if (window.totalsStore && vehicles.length > 0) {
        const totalKwh = vehicles.reduce((s, v) => {
          return s + window.EV_COLORS.calcKwh(v.startPct, v.endPct, v.batteryPack || 0.66);
        }, 0);
        const today = new Date().toISOString().slice(0, 10);
        window.totalsStore.upsert({
          date:  today,
          kwh:   Math.round(totalKwh * 10) / 10,
          cars:  vehicles.length,
          notes: '',
        });
      }
    });

    window.store.load();
    bindEvents();
    updateTodayLabel();
    if (window.ui.bindSearch) window.ui.bindSearch();
    if (window.renderer) window.renderer.start();
    window.ui.refresh(window.store.getVehicles());

    // Wire list view
    if (window.listView) {
      window.listView.bindEvents();
      window.listView.refresh(window.store.getVehicles());
    }

    // Load daily totals (permanent, never resets)
    if (window.totalsStore) {
      window.totalsStore.load();
      window.totalsStore.bindEvents();
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.lot = {
    switchTab,
    selectVehicle,
    closeDetail,
    zoom:           (dir) => { const cv = document.getElementById('lot-canvas'); cv.dispatchEvent(new WheelEvent('wheel', { deltaY: dir < 0 ? -100 : 100, bubbles: true })); },
    resetView:      () => { document.getElementById('lot-canvas').dispatchEvent(new CustomEvent('lotreset')); },
    getSelectedIdx: () => selectedIdx,
    getHoveredIdx:  () => hoveredIdx,
    setHoveredIdx:  (idx) => { hoveredIdx = idx; },
  };

  document.addEventListener('DOMContentLoaded', init);
})();
