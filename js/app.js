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
    document.getElementById('tab-3d').classList.toggle('active',   tab === '3d');
    document.getElementById('tab-add').classList.toggle('active',  tab === 'add');
    document.getElementById('panel-3d').classList.toggle('active',  tab === '3d');
    document.getElementById('panel-form').classList.toggle('active', tab === 'add');
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
  function bindEvents() {
    document.getElementById('tab-3d').addEventListener('click',  () => switchTab('3d'));
    document.getElementById('tab-add').addEventListener('click', () => switchTab('add'));

    // Paste
    document.getElementById('paste-btn').addEventListener('click', handlePaste);
    document.getElementById('paste-input').addEventListener('input', onPasteInput);
    // Also handle Ctrl+Enter / Cmd+Enter in paste box
    document.getElementById('paste-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handlePaste();
    });

    // Excel upload
    document.getElementById('file-input').addEventListener('change', e => handleFile(e.target.files[0]));

    // Sample
    document.getElementById('sample-btn').addEventListener('click', () => {
      window.store.addVehicles(window.store.getSampleFleet(10)).then(() => switchTab('3d'));
    });

    // Manual add
    document.getElementById('add-btn').addEventListener('click', addVehicle);

    // Preview inputs
    document.getElementById('f-start').addEventListener('input', updatePreview);
    document.getElementById('f-end').addEventListener('input',   updatePreview);

    // Enter in manual fields
    ['f-vin','f-location','f-start','f-end'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') addVehicle(); });
    });

    // Clear lot
    document.getElementById('clear-btn').addEventListener('click', () => {
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
      if (selectedIdx >= vehicles.length) closeDetail();
      else if (selectedIdx >= 0) window.ui.highlightCard(selectedIdx);
    });

    window.store.load();
    bindEvents();
    updateTodayLabel();
    if (window.ui.bindSearch) window.ui.bindSearch();
    if (window.renderer) window.renderer.start();
    window.ui.refresh(window.store.getVehicles());
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
