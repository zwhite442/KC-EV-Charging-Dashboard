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
    // Safe toggle — only touch elements that actually exist in the DOM
    const safe = (id, active) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('active', active);
    };
    safe('tab-3d',      tab === '3d');
    safe('tab-add',     tab === 'add');
    safe('tab-list',    tab === 'list');
    safe('tab-totals',  tab === 'totals');
    safe('panel-3d',    tab === '3d');
    safe('panel-form',  tab === 'add');
    safe('panel-list',  tab === 'list');
    safe('panel-totals',tab === 'totals');
    if (tab === '3d' && window.renderer) window.renderer.resize();
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
    const text    = (document.getElementById('paste-input').value || '').trim();
    const preview = document.getElementById('paste-preview');
    if (!text) {
      preview.textContent = 'Nothing pasted yet — copy your Excel rows first.';
      preview.className   = 'paste-preview paste-preview--error';
      return;
    }
    try {
      const parsed = window.store.parsePaste(text);
      preview.textContent = `✓ Found ${parsed.length} vehicle${parsed.length !== 1 ? 's' : ''} — importing…`;
      preview.className   = 'paste-preview paste-preview--ok';
      window.store.addVehicles(parsed).then(() => {
        document.getElementById('paste-input').value = '';
        preview.textContent = `✓ ${parsed.length} vehicle${parsed.length !== 1 ? 's' : ''} added to the lot!`;
        setTimeout(() => switchTab('3d'), 800);
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

  // ── Boot ──────────────────────────────────────────────────────────────────────
  function init() {
    window.store.on(vehicles => {
      window.ui.refresh(vehicles);
      if (window.listView) window.listView.refresh(vehicles);
      if (selectedIdx >= vehicles.length) closeDetail();
      else if (selectedIdx >= 0) window.ui.highlightCard(selectedIdx);
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
