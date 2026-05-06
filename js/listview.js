/**
 * listview.js
 * List View tab — spreadsheet-style table of all vehicles.
 * Features:
 *  - Search/filter
 *  - Right-click context menu: Edit, Change Color, Remove
 *  - Edit modal with spot, start%, end%, color picker
 *  - Hover tooltips on the 3 topbar stat pills
 */

(function () {
  const BOLT_COLORS = ['red','black','white','silver','blue','gray','midnight','green'];
  const COLOR_LABELS = {
    red:'Radiant Red', black:'Mosaic Black', white:'Summit White', silver:'Sterling Gray',
    blue:'Riptide Blue', gray:'Gray', midnight:'Midnight Blue', green:'Cacti Green',
  };

  let ctxVehicleIdx = -1;
  let editVehicleIdx = -1;
  let listQuery = '';

  // ── Build list table ──────────────────────────────────────────────────────────
  function buildList(vehicles) {
    const tbody = document.getElementById('list-tbody');
    const countEl = document.getElementById('list-count');
    if (!tbody) return;

    const q = listQuery.toLowerCase().trim();
    const filtered = q
      ? vehicles.filter(v =>
          (v.vin||'').toLowerCase().includes(q) ||
          (v.location||'').toLowerCase().includes(q) ||
          (v.color||'').toLowerCase().includes(q) ||
          String(v.startPct).includes(q) ||
          String(v.endPct).includes(q)
        )
      : vehicles;

    if (countEl) countEl.textContent = `${filtered.length} vehicle${filtered.length!==1?'s':''}`;
    tbody.innerHTML = '';

    if (!filtered.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="8">No vehicles match your search</td></tr>';
      return;
    }

    filtered.forEach((v, localIdx) => {
      const realIdx = vehicles.indexOf(v);
      const pal     = window.EV_COLORS.getPalette(v.color);
      const sc      = window.EV_COLORS.getStatusColor(v.startPct, v.endPct);
      const statusLabel = sc==='#818cf8'?'Ready':sc==='#ef4444'?'Critical':'Charging';
      const tr = document.createElement('tr');
      tr.dataset.idx = realIdx;
      tr.innerHTML = `
        <td class="lv-spot">${v.location||'—'}</td>
        <td class="lv-vin">${v.vin||'—'}</td>
        <td class="lv-color">
          <span class="lv-swatch" style="background:${pal.body}"></span>
          ${COLOR_LABELS[v.color]||v.color||'—'}
        </td>
        <td class="lv-num">${Math.round(v.startPct)}%</td>
        <td class="lv-num">${Math.round(v.endPct)}%</td>
        <td class="lv-num">${v.kwh||0} kWh</td>
        <td><span class="lv-status" style="color:${sc}">${statusLabel}</span></td>
        <td>
          <button class="lv-menu-btn" data-idx="${realIdx}" title="Options">⋯</button>
        </td>
      `;

      // Right-click
      tr.addEventListener('contextmenu', e => {
        e.preventDefault();
        showCtxMenu(e.clientX, e.clientY, realIdx);
      });

      // ⋯ button click
      tr.querySelector('.lv-menu-btn').addEventListener('click', e => {
        e.stopPropagation();
        const btn = e.currentTarget;
        const r   = btn.getBoundingClientRect();
        showCtxMenu(r.left, r.bottom + 4, realIdx);
      });

      tbody.appendChild(tr);
    });
  }

  // ── Context menu ──────────────────────────────────────────────────────────────
  function showCtxMenu(x, y, idx) {
    ctxVehicleIdx = idx;
    const menu = document.getElementById('ctx-menu');
    if (!menu) return;
    menu.style.display = 'block';
    // Keep on screen
    const vw = window.innerWidth, vh = window.innerHeight;
    menu.style.left = Math.min(x, vw - 160) + 'px';
    menu.style.top  = Math.min(y, vh - 120) + 'px';
  }

  function hideCtxMenu() {
    const menu = document.getElementById('ctx-menu');
    if (menu) menu.style.display = 'none';
    ctxVehicleIdx = -1;
  }

  // ── Edit modal ────────────────────────────────────────────────────────────────
  function openEditModal(idx) {
    const vehs = window.store.getVehicles();
    const v    = vehs[idx];
    if (!v) return;
    editVehicleIdx = idx;

    document.getElementById('edit-location').value = v.location || '';
    document.getElementById('edit-start').value    = Math.round(v.startPct);
    document.getElementById('edit-end').value      = Math.round(v.endPct);

    // Build color picker
    const picker = document.getElementById('color-picker');
    picker.innerHTML = '';
    BOLT_COLORS.forEach(col => {
      const pal = window.EV_COLORS.getPalette(col);
      const btn = document.createElement('div');
      btn.className = 'color-swatch-btn' + (v.color === col ? ' selected' : '');
      btn.title     = COLOR_LABELS[col]||col;
      btn.style.background = pal.body;
      btn.dataset.color    = col;
      btn.addEventListener('click', () => {
        picker.querySelectorAll('.color-swatch-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
      picker.appendChild(btn);
    });

    document.getElementById('edit-modal').style.display = 'flex';
  }

  function closeEditModal() {
    document.getElementById('edit-modal').style.display = 'none';
    editVehicleIdx = -1;
  }

  async function saveEdit() {
    if (editVehicleIdx < 0) return;
    const vehs     = window.store.getVehicles();
    const v        = vehs[editVehicleIdx];
    if (!v) return;

    const location = document.getElementById('edit-location').value.trim();
    const startPct = parseFloat(document.getElementById('edit-start').value) || v.startPct;
    const endPct   = parseFloat(document.getElementById('edit-end').value)   || v.endPct;
    const colorBtn = document.querySelector('#color-picker .color-swatch-btn.selected');
    const color    = colorBtn ? colorBtn.dataset.color : v.color;

    // Update via store — delete old, insert updated at same position
    const updated = { ...v, location, startPct, endPct, color,
      kwh: window.EV_COLORS.calcKwh(startPct, endPct, v.batteryPack) };

    // Direct IDB update
    await window.store.updateVehicle(editVehicleIdx, updated);
    closeEditModal();
  }

  // ── Hover tooltips ────────────────────────────────────────────────────────────
  function buildTooltips(vehicles) {
    // kWh list — sorted high to low
    const kwhList = document.getElementById('tt-kwh-list');
    const avgList = document.getElementById('tt-avg-list');
    const startList = document.getElementById('tt-start-list');
    if (!kwhList || !avgList || !startList) return;

    const sorted = [...vehicles].sort((a,b) => (b.kwh||0) - (a.kwh||0));

    kwhList.innerHTML = sorted.map(v =>
      `<div class="tt-row"><span class="tt-loc">${v.location||'?'}</span><span class="tt-val">${v.kwh||0} kWh</span></div>`
    ).join('');

    avgList.innerHTML = sorted.map(v =>
      `<div class="tt-row"><span class="tt-loc">${v.location||'?'}</span><span class="tt-val">${v.kwh||0} kWh</span></div>`
    ).join('');

    const sortedStart = [...vehicles].sort((a,b) => (a.startPct||0) - (b.startPct||0));
    startList.innerHTML = sortedStart.map(v =>
      `<div class="tt-row"><span class="tt-loc">${v.location||'?'}</span><span class="tt-val">${Math.round(v.startPct||0)}%</span></div>`
    ).join('');
  }

  // ── Refresh (called on every store change) ────────────────────────────────────
  function refresh(vehicles) {
    buildList(vehicles);
    buildTooltips(vehicles);
  }

  // ── Wire events ───────────────────────────────────────────────────────────────
  function bindEvents() {
    // Context menu actions
    const ctxEdit = document.getElementById('ctx-edit');
    const ctxColor = document.getElementById('ctx-color');
    const ctxDelete = document.getElementById('ctx-delete');

    if (ctxEdit)   ctxEdit.addEventListener('click',   () => { openEditModal(ctxVehicleIdx); hideCtxMenu(); });
    if (ctxColor)  ctxColor.addEventListener('click',  () => { openEditModal(ctxVehicleIdx); hideCtxMenu(); });
    if (ctxDelete) ctxDelete.addEventListener('click', async () => {
      const idx = ctxVehicleIdx;
      hideCtxMenu();
      if (idx < 0) return;
      const v = window.store.getVehicles()[idx];
      if (confirm(`Remove ${v?.location||'this vehicle'} (${v?.vin||''})?`)) {
        await window.store.deleteVehicle(idx);
        if (window.lot) window.lot.closeDetail();
      }
    });

    // Close ctx menu on any outside click
    document.addEventListener('click', e => {
      const menu = document.getElementById('ctx-menu');
      if (menu && !menu.contains(e.target)) hideCtxMenu();
    });

    // Edit modal
    const modalClose = document.getElementById('modal-close');
    const saveBtn    = document.getElementById('edit-save-btn');
    if (modalClose) modalClose.addEventListener('click', closeEditModal);
    if (saveBtn)    saveBtn.addEventListener('click', saveEdit);

    // Close modal on overlay click
    const modalOverlay = document.getElementById('edit-modal');
    if (modalOverlay) modalOverlay.addEventListener('click', e => {
      if (e.target === modalOverlay) closeEditModal();
    });

    // List search
    const listSearch = document.getElementById('list-search');
    if (listSearch) {
      listSearch.addEventListener('input', e => {
        listQuery = e.target.value;
        buildList(window.store.getVehicles());
      });
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.listView = { refresh, buildList, buildTooltips, bindEvents };
})();

// ── Tooltip hover logic (JS-based for cross-browser reliability) ────────────
(function initTooltips() {
  const pills = [
    { triggerId: 'pill-kwh',   tooltipId: 'tooltip-kwh'   },
    { triggerId: 'pill-avg',   tooltipId: 'tooltip-avg'   },
    { triggerId: 'pill-start', tooltipId: 'tooltip-start' },
  ];

  function positionTooltip(trigger, tooltip) {
    const r  = trigger.getBoundingClientRect();
    const tw = 260;
    let left = r.right - tw;
    if (left < 8) left = 8;
    const top = r.bottom + 8;
    tooltip.style.left = left + 'px';
    tooltip.style.top  = top  + 'px';
  }

  document.addEventListener('DOMContentLoaded', () => {
    pills.forEach(({ triggerId, tooltipId }) => {
      const trigger = document.getElementById(triggerId);
      const tooltip = document.getElementById(tooltipId);
      if (!trigger || !tooltip) return;

      trigger.addEventListener('mouseenter', () => {
        positionTooltip(trigger, tooltip);
        tooltip.classList.add('visible');
      });
      trigger.addEventListener('mouseleave', e => {
        // Small delay so cursor can move into tooltip
        setTimeout(() => {
          if (!tooltip.matches(':hover') && !trigger.matches(':hover')) {
            tooltip.classList.remove('visible');
          }
        }, 80);
      });
      tooltip.addEventListener('mouseleave', () => {
        tooltip.classList.remove('visible');
      });
    });
  });
})();
