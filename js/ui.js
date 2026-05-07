/**
 * ui.js
 * Handles all DOM updates: sidebar (with search + virtual scroll for unlimited
 * entries), detail card, stat pills, month badge, and entry list in the form.
 *
 * Stat definitions (dealership):
 *   Ready (≥30%)  → indigo
 *   Charging      → green
 *   Critical      → red
 */

(function () {
  const CARD_HEIGHT   = 82;   // px — height of one vehicle card (for virtual scroll)
  const RENDER_BUFFER = 8;    // extra cards rendered above/below viewport

  let allVehicles   = [];
  let filteredVehs  = [];
  let filterQuery   = '';

  // ── Stat pills ────────────────────────────────────────────────────────────────
  // All values auto-calculated from vehicle data — no manual input needed
  function updateStats(vehicles) {
    let ready = 0, charging = 0, critical = 0;
    let totalKwh = 0, totalStart = 0, count = vehicles.length;

    vehicles.forEach(v => {
      // Status based on endPct (charged/target state)
      if (v.endPct >= 30)      ready++;
      else if (v.endPct < 10)  critical++;
      else                     charging++;

      // Auto-accumulate kWh and starting SOC
      const pack = v.batteryPack || 0.66;
      const kwh  = window.EV_COLORS.calcKwh(v.startPct, v.endPct, pack);
      totalKwh  += kwh;
      totalStart += (v.startPct || 0);
    });

    const avgKwh  = count > 0 ? Math.round((totalKwh / count) * 10) / 10 : 0;
    const avgStart = count > 0 ? Math.round((totalStart / count) * 100) / 100 : 0;
    const totalKwhRounded = Math.round(totalKwh * 10) / 10;

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('stat-charging',  charging);
    set('stat-full',      ready);
    set('stat-low',       critical);
    set('stat-total',     count);
    set('vehicle-count',  count);
    set('entry-count',    count);
    set('stat-total-kwh', totalKwhRounded);
    set('stat-avg-kwh',   count > 0 ? avgKwh : '—');
    set('stat-avg-start', count > 0 ? avgStart : '—');
  }

  // ── Search filtering ──────────────────────────────────────────────────────────
  function applyFilter(vehicles) {
    const q = filterQuery.toLowerCase().trim();
    if (!q) return vehicles;
    return vehicles.filter(v =>
      (v.vin   || '').toLowerCase().includes(q) ||
      (v.make  || '').toLowerCase().includes(q) ||
      (v.model || '').toLowerCase().includes(q) ||
      (v.color || '').toLowerCase().includes(q) ||
      (v.year  || '').toString().includes(q)
    );
  }

  // ── Virtual-scroll sidebar ────────────────────────────────────────────────────
  // Renders only the visible slice of cards — handles unlimited entries smoothly.
  let listEl       = null;
  let spacerTop    = null;
  let spacerBottom = null;
  let scrollBound  = false;

  function ensureVirtualDOM() {
    listEl = document.getElementById('vehicle-list');
    if (listEl._virtualSetup) return;
    listEl._virtualSetup = true;

    // Clear and insert sentinel spacers
    listEl.innerHTML = '';
    spacerTop    = document.createElement('div');
    spacerBottom = document.createElement('div');
    spacerTop.className    = 'v-spacer';
    spacerBottom.className = 'v-spacer';
    listEl.appendChild(spacerTop);
    listEl.appendChild(spacerBottom);

    if (!scrollBound) {
      listEl.addEventListener('scroll', () => renderVisibleCards(), { passive: true });
      scrollBound = true;
    }
  }

  function renderVisibleCards() {
    if (!listEl) return;
    const viewH    = listEl.clientHeight;
    const scrollY  = listEl.scrollTop;
    const total    = filteredVehs.length;
    const startIdx = Math.max(0, Math.floor(scrollY / CARD_HEIGHT) - RENDER_BUFFER);
    const endIdx   = Math.min(total, Math.ceil((scrollY + viewH) / CARD_HEIGHT) + RENDER_BUFFER);

    spacerTop.style.height    = (startIdx * CARD_HEIGHT) + 'px';
    spacerBottom.style.height = ((total - endIdx) * CARD_HEIGHT) + 'px';

    // Remove old cards (between spacers)
    const existing = listEl.querySelectorAll('.vehicle-card');
    existing.forEach(el => el.remove());

    const frag = document.createDocumentFragment();
    for (let i = startIdx; i < endIdx; i++) {
      frag.appendChild(makeCard(filteredVehs[i], i));
    }
    // Insert before bottom spacer
    listEl.insertBefore(frag, spacerBottom);
  }

  function makeCard(v, localIdx) {
    // localIdx is position in filteredVehs; we need real index for selectVehicle
    const realIdx = allVehicles.indexOf(v);
    const pal  = window.EV_COLORS.getPalette(v.color);
    const sc   = v.endPct >= 30 ? '#818cf8' : v.endPct < 10 ? '#ef4444' : '#22c55e';
    const pct  = Math.round(v.endPct);   // show ending/charged SOC
    const card = document.createElement('div');
    card.className = 'vehicle-card';
    card.style.height = CARD_HEIGHT + 'px';
    card.dataset.realIndex = realIdx;
    card.innerHTML = `
      <div class="vc-row">
        <div class="vc-swatch" style="background:${pal.body}"></div>
        <div class="vc-name">${v.location ? v.location + ' · ' : ''}${v.make} ${v.model}</div>
      </div>
      <div class="vc-vin">${v.vin}</div>
      <div class="vc-bar-track">
        <div class="vc-bar-fill" style="width:${pct}%;background:${sc}"></div>
      </div>
      <div class="vc-meta">
        <span>${pct}% → ${Math.round(v.endPct)}%</span>
        <span>${v.kwh !== undefined ? v.kwh + ' kWh' : ''}</span>
      </div>
    `;
    card.addEventListener('click', () => {
      window.lot.switchTab('3d');
      window.lot.selectVehicle(realIdx);
    });
    return card;
  }

  function buildSidebar(vehicles) {
    allVehicles  = vehicles;
    filteredVehs = applyFilter(vehicles);

    ensureVirtualDOM();

    if (!vehicles.length) {
      listEl.innerHTML = '<div class="empty-state">Add vehicles to see them here</div>';
      return;
    }

    // Reset scroll, re-render
    listEl.scrollTop = 0;
    renderVisibleCards();
  }

  // ── Entry list in form panel (paginated — show last 200 for perf) ─────────────
  function buildEntryList(vehicles) {
    const list  = document.getElementById('entry-list');
    list.innerHTML = '';

    // Show at most 200 most-recent entries in the form list
    // (the lot view always shows all)
    const slice = vehicles.slice(-200).reverse();
    if (vehicles.length > 200) {
      const note = document.createElement('div');
      note.className = 'entry-overflow-note';
      note.textContent = `Showing last 200 of ${vehicles.length} entries. All vehicles appear in the 3D lot.`;
      list.appendChild(note);
    }

    slice.forEach((v, localI) => {
      const realIdx = vehicles.length - 1 - localI;
      const pal  = window.EV_COLORS.getPalette(v.color);
      const item = document.createElement('div');
      item.className = 'entry-item';
      item.innerHTML = `
        <div class="entry-swatch" style="background:${pal.body}"></div>
        <div class="entry-info">
          <div class="entry-name">${v.year} ${v.make} ${v.model}</div>
          <div class="entry-sub">${v.location ? v.location + ' &nbsp;·&nbsp; ' : ''}${v.vin} &nbsp;·&nbsp; ${Math.round(v.startPct)}%→${Math.round(v.endPct)}% &nbsp;·&nbsp; ${v.kwh} kWh</div>
        </div>
        <button class="entry-del" aria-label="Remove vehicle">✕</button>
      `;
      item.querySelector('.entry-del').addEventListener('click', () => {
        window.store.deleteVehicle(realIdx);
        window.lot.closeDetail();
      });
      list.appendChild(item);
    });
  }

  // ── Detail card ───────────────────────────────────────────────────────────────
  function showDetail(v) {
    const sc      = window.EV_COLORS.getStatusColor(v.startPct, v.endPct);
    const palette = window.EV_COLORS.getPalette(v.color);
    const label   = palette.label || v.color;

    document.getElementById('detail-title').textContent   = `${v.year} ${v.make} ${v.model}`;
    document.getElementById('detail-vin').textContent     = v.vin      || '—';
    document.getElementById('detail-year').textContent    = v.year     || '—';
    document.getElementById('detail-color').textContent   = label;
    document.getElementById('detail-mileage').textContent = v.location || '—';
    document.getElementById('detail-rate').textContent    = v.rate   ? v.rate + ' kW/h' : '—';
    const packPct = v.batteryPack ? Math.round(v.batteryPack * 100) + '%' : '66%';
    const capacity = v.batteryPack ? Math.round(65 * v.batteryPack * 10) / 10 : 42.9;
    document.getElementById('detail-kwh').textContent     = v.kwh !== undefined
      ? `${v.kwh} kWh (${capacity} kWh cap · pack ${packPct})`
      : '—';

    const s  = Math.round(v.startPct);
    const en = Math.round(v.endPct);
    document.getElementById('detail-pct').textContent    = `${s}% → ${en}%`;
    document.getElementById('detail-bar').style.width    = s + '%';
    document.getElementById('detail-bar').style.background = sc;
    document.getElementById('detail-start').textContent  = s  + '%';
    document.getElementById('detail-end').textContent    = en + '%';

    document.getElementById('detail-card').classList.add('visible');
  }

  function hideDetail() {
    document.getElementById('detail-card').classList.remove('visible');
  }

  // ── Month badge ───────────────────────────────────────────────────────────────
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function updateMonthBadge(count) {
    const now      = new Date();
    const day      = now.getDate();
    const resetMsg = day >= 29 ? 'Resets at end of month' : 'Resets on the 30th';
    const badge    = document.getElementById('month-badge');
    badge.innerHTML = `
      ${MONTHS[now.getMonth()]} ${now.getFullYear()} &nbsp;·&nbsp; ${count.toLocaleString()} vehicle${count !== 1 ? 's' : ''}
      <div class="reset-hint">${resetMsg}</div>
    `;
    badge.classList.toggle('visible', count > 0);
  }

  // ── Overlays ─────────────────────────────────────────────────────────────────
  function updateOverlays(count) {
    const set = (id, visible) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (visible) {
        el.classList.add('visible');
        el.style.display = '';
      } else {
        el.classList.remove('visible');
        el.style.display = 'none';
      }
    };
    set('legend',   count > 0);
    set('rot-bar',  count > 0);
    set('zoom-bar', count > 0);
    // Always show controls even with 0 vehicles so pan toggle is accessible
    const rotBar = document.getElementById('rot-bar');
    if (rotBar) { rotBar.classList.add('visible'); rotBar.style.display = 'flex'; }
    const zoomBar = document.getElementById('zoom-bar');
    if (zoomBar) { zoomBar.classList.add('visible'); zoomBar.style.display = 'flex'; }
    // Drag hint only when no vehicles
    const hint = document.getElementById('drag-hint');
    if (hint) hint.classList.toggle('hidden', count > 0);
  }

  // ── Highlight selected card ───────────────────────────────────────────────────
  function highlightCard(idx) {
    document.querySelectorAll('.vehicle-card').forEach(el => {
      el.classList.toggle('selected', Number(el.dataset.realIndex) === idx);
    });
  }

  // ── kWh auto-preview in form ──────────────────────────────────────────────────
  function updatePreview() {
    const s  = parseFloat(document.getElementById('f-start').value) || 0;
    const e  = parseFloat(document.getElementById('f-end').value)   || 0;
    const sc = e >= 30 ? '#818cf8' : e < 10 ? '#ef4444' : '#22c55e'; // color based on target (end) SOC

    const bar = document.getElementById('preview-bar');
    const pct = document.getElementById('preview-pct');
    if (bar) { bar.style.width = Math.min(100, Math.max(0, s)) + '%'; bar.style.background = sc; }
    if (pct) pct.textContent = Math.round(s) + '% → ' + Math.round(e) + '%';

    const kwh     = window.EV_COLORS.calcKwh(s, e);
    const display = document.getElementById('f-kwh-display');
    if (display) display.textContent = (s || e) ? kwh + ' kWh' : '—';
  }

  // ── Search wire-up ────────────────────────────────────────────────────────────
  function bindSearch() {
    const input = document.getElementById('fleet-search');
    if (!input) return;
    input.addEventListener('input', e => {
      filterQuery  = e.target.value;
      filteredVehs = applyFilter(allVehicles);
      // Reset virtual scroll
      if (listEl) listEl.scrollTop = 0;
      renderVisibleCards();
    });
  }

  // ── Master refresh ────────────────────────────────────────────────────────────
  function refresh(vehicles) {
    updateStats(vehicles);
    buildSidebar(vehicles);
    buildEntryList(vehicles);
    updateMonthBadge(vehicles.length);
    updateOverlays(vehicles.length);
    if (window.renderer) window.renderer.redraw();
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.ui = {
    refresh,
    showDetail,
    hideDetail,
    highlightCard,
    updatePreview,
    bindSearch,
  };
})();
