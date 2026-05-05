/**
 * app.js
 * Main application bootstrap — wires store, renderer, and UI together.
 */

(function () {
  // ── Internal state ────────────────────────────────────────────────────────────
  let selectedIdx = -1;
  let hoveredIdx  = -1;
  let activeTab   = '3d';

  // ── Tab switching ─────────────────────────────────────────────────────────────
  function switchTab(tab) {
    activeTab = tab;
    document.getElementById('tab-3d').classList.toggle('active',  tab === '3d');
    document.getElementById('tab-add').classList.toggle('active', tab === 'add');
    document.getElementById('panel-3d').classList.toggle('active',  tab === '3d');
    document.getElementById('panel-form').classList.toggle('active', tab === 'add');
    if (tab === '3d' && window.renderer) window.renderer.resize();
  }

  // ── Vehicle selection ─────────────────────────────────────────────────────────
  function selectVehicle(idx) {
    selectedIdx = idx;
    const vehs = window.store.getVehicles();
    const v    = vehs[idx];
    if (!v) return;
    window.ui.showDetail(v);
    window.ui.highlightCard(idx);
  }

  function closeDetail() {
    selectedIdx = -1;
    window.ui.hideDetail();
    window.ui.highlightCard(-1);
  }

  // ── Add vehicle from form ─────────────────────────────────────────────────────
  function addVehicle() {
    const make = (document.getElementById('f-make').value.trim())  || 'Chevrolet';
    const model = (document.getElementById('f-model').value.trim()) || 'Bolt EUV';
    const vin   = document.getElementById('f-vin').value.trim();
    const year  = document.getElementById('f-year').value  || '2027';
    const mileage = parseFloat(document.getElementById('f-mileage').value) || 0;
    const color = document.getElementById('f-color').value || 'red';
    const startPct = Math.min(100, Math.max(0, parseFloat(document.getElementById('f-start').value) || 20));
    const endPct   = Math.min(100, Math.max(0, parseFloat(document.getElementById('f-end').value)   || 90));
    const rate  = parseFloat(document.getElementById('f-rate').value) || 11;

    if (!make) { alert('Please enter at least a Make.'); return; }

    window.store.addVehicle({ vin, make, model, year, mileage, color, startPct, endPct, rate });

    // Reset form fields
    ['f-vin', 'f-mileage', 'f-start', 'f-end', 'f-rate'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('f-make').value  = 'Chevrolet';
    document.getElementById('f-model').value = 'Bolt EUV';
    document.getElementById('f-year').value  = '2027';
    document.getElementById('f-color').value = 'red';
    document.getElementById('preview-bar').style.width = '0%';
    document.getElementById('preview-pct').textContent = '—';

    switchTab('3d');
  }

  // ── Excel / CSV upload ────────────────────────────────────────────────────────
  async function handleFile(file) {
    if (!file) return;
    try {
      const parsed = await window.store.parseExcel(file);
      window.store.addVehicles(parsed);
      switchTab('3d');
    } catch (err) {
      alert('Could not read file: ' + err.message);
    }
  }

  // ── VIN auto-fill ─────────────────────────────────────────────────────────────
  function autoFillVin(val) {
    if (val.length >= 3) {
      const prefix = val.slice(0, 3).toUpperCase();
      const make   = window.VIN_MAKES[prefix];
      if (make) document.getElementById('f-make').value = make;
    }
  }

  // ── Event bindings ────────────────────────────────────────────────────────────
  function bindEvents() {
    // Tab buttons
    document.getElementById('tab-3d').addEventListener('click',  () => switchTab('3d'));
    document.getElementById('tab-add').addEventListener('click', () => switchTab('add'));

    // Add vehicle button
    document.getElementById('add-btn').addEventListener('click', addVehicle);

    // File upload inputs (both the topbar one and the form one)
    document.getElementById('file-input').addEventListener('change', e => handleFile(e.target.files[0]));

    // Sample fleet button
    document.getElementById('sample-btn').addEventListener('click', () => {
      window.store.addVehicles(window.store.getSampleFleet(10));
      switchTab('3d');
    });

    // Clear lot button
    document.getElementById('clear-btn').addEventListener('click', () => {
      if (!window.store.getVehicles().length) return;
      if (confirm('Clear all vehicles from the lot?')) {
        window.store.clearAll();
        closeDetail();
      }
    });

    // VIN auto-fill
    document.getElementById('f-vin').addEventListener('input', e => autoFillVin(e.target.value));

    // Charge preview
    document.getElementById('f-start').addEventListener('input', window.ui.updatePreview);
    document.getElementById('f-end').addEventListener('input',   window.ui.updatePreview);

    // Enter key in form submits
    ['f-vin','f-make','f-model','f-year','f-mileage','f-start','f-end','f-rate','f-kwh'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') addVehicle();
      });
    });
  }

  // ── Boot ──────────────────────────────────────────────────────────────────────
  function init() {
    // Wire store → UI refresh
    window.store.on(vehicles => {
      window.ui.refresh(vehicles);
      // Re-select if index still valid
      if (selectedIdx >= vehicles.length) closeDetail();
      else if (selectedIdx >= 0) window.ui.highlightCard(selectedIdx);
    });

    // Load persisted data (checks monthly reset)
    window.store.load();

    // Bind all DOM events
    bindEvents();
    if (window.ui.bindSearch) window.ui.bindSearch();

    // Start renderer loop
    if (window.renderer) window.renderer.start();

    // Initial UI render
    window.ui.refresh(window.store.getVehicles());
  }

  // ── Public API (used by renderer, HTML buttons, ui.js) ────────────────────────
  window.lot = {
    switchTab,
    selectVehicle,
    closeDetail,
    zoom:          (dir) => { /* handled in renderer via global scope */ window.lotZoom(dir); },
    resetView:     () => { window.lotResetView(); },
    getSelectedIdx: () => selectedIdx,
    getHoveredIdx:  () => hoveredIdx,
    setHoveredIdx:  (idx) => { hoveredIdx = idx; },
  };

  // Expose zoom + reset to renderer (late binding avoids circular dep)
  window.lotZoom = function(dir) {
    // Renderer exposes this on its own — we call it via the canvas wheel event clone
    const canvas = document.getElementById('lot-canvas');
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: dir < 0 ? -100 : 100, bubbles: true }));
  };
  window.lotResetView = function() {
    // Trigger a custom reset event the renderer listens to
    document.getElementById('lot-canvas').dispatchEvent(new CustomEvent('lotreset'));
  };

  document.addEventListener('DOMContentLoaded', init);
})();
