/**
 * listview.js — Full List View tab
 * Shows every vehicle in the lot in a sortable, searchable table.
 * Right-click or ⋯ button to Edit / Change Color / Remove.
 * Also manages hover tooltips on the 3 topbar stat pills.
 */

(function () {
  const BOLT_COLORS = ['red','black','white','silver','blue','gray','midnight','green'];
  const COLOR_LABELS = {
    red:'Radiant Red', black:'Mosaic Black', white:'Summit White',
    silver:'Sterling Gray', blue:'Riptide Blue', gray:'Gray',
    midnight:'Midnight Blue', green:'Cacti Green',
  };

  let ctxIdx    = -1;
  let editIdx   = -1;
  let query     = '';
  let sortCol   = 'location';
  let sortAsc   = true;

  function updateSummaryBar(vehicles) {
    let ready=0, charging=0, critical=0, totalKwh=0, totalStart=0;
    vehicles.forEach(v => {
      if      (v.endPct >= 30) ready++;
      else if (v.endPct < 10)  critical++;
      else                     charging++;
      totalKwh   += window.EV_COLORS.calcKwh(v.startPct, v.endPct, v.batteryPack||0.66);
      totalStart += (v.startPct||0);
    });
    const n = vehicles.length;
    const set = (id,val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
    set('ls-total',     n);
    set('ls-ready',     ready);
    set('ls-charging',  charging);
    set('ls-critical',  critical);
    set('ls-kwh',       Math.round(totalKwh*10)/10);
    set('ls-avg-kwh',   n>0 ? Math.round((totalKwh/n)*10)/10 : '—');
    set('ls-avg-start', n>0 ? Math.round((totalStart/n)*100)/100+'%' : '—');
  }

  function filterAndSort(vehicles) {
    const q = query.toLowerCase().trim();
    let list = q ? vehicles.filter(v =>
      (v.vin||'').toLowerCase().includes(q) ||
      (v.location||'').toLowerCase().includes(q) ||
      (v.color||'').toLowerCase().includes(q) ||
      String(v.startPct).includes(q) ||
      String(v.endPct).includes(q)
    ) : [...vehicles];

    list.sort((a,b) => {
      let va, vb;
      switch(sortCol) {
        case 'location':    va=a.location||'';  vb=b.location||''; break;
        case 'vin':         va=a.vin||'';        vb=b.vin||''; break;
        case 'color':       va=a.color||'';      vb=b.color||''; break;
        case 'startPct':    va=a.startPct||0;    vb=b.startPct||0; break;
        case 'endPct':      va=a.endPct||0;      vb=b.endPct||0; break;
        case 'kwh':
          va=window.EV_COLORS.calcKwh(a.startPct,a.endPct,a.batteryPack||0.66);
          vb=window.EV_COLORS.calcKwh(b.startPct,b.endPct,b.batteryPack||0.66);
          break;
        case 'batteryPack': va=a.batteryPack||0.66; vb=b.batteryPack||0.66; break;
        case 'status':
          va=a.endPct>=30?0:a.endPct<10?2:1;
          vb=b.endPct>=30?0:b.endPct<10?2:1;
          break;
        case 'inputDate':
          va=a.inputDate||'';
          vb=b.inputDate||'';
          break;
        default: va=''; vb='';
      }
      if (typeof va==='string') return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortAsc ? va-vb : vb-va;
    });
    return list;
  }

  function buildList(vehicles) {
    const tbody   = document.getElementById('list-tbody');
    const countEl = document.getElementById('list-count');
    if (!tbody) return;

    // Always pull from store directly so inputDate and all fields are current
    const vehs = (window.store && window.store.getVehicles().length > 0)
      ? window.store.getVehicles()
      : (vehicles || []);

    updateSummaryBar(vehs);

    const filtered = filterAndSort(vehs);
    if (countEl) countEl.textContent = `${filtered.length.toLocaleString()} vehicle${filtered.length!==1?'s':''}`;

    document.querySelectorAll('.list-table th.sortable').forEach(th => {
      const col = th.dataset.col;
      const labels = {location:'Spot',vin:'VIN',color:'Color',startPct:'Start %',endPct:'End %',kwh:'kWh',batteryPack:'Pack',status:'Status',inputDate:'Date Added'};
      th.textContent = (labels[col]||col) + (col===sortCol ? (sortAsc?' ↑':' ↓') : ' ↕');
    });

    tbody.innerHTML = '';
    if (!filtered.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="9">${vehicles.length?'No vehicles match search':'No vehicles yet — paste from Excel or upload a file'}</td></tr>`.replace('colspan="9"','colspan="10"');
      return;
    }

    const frag = document.createDocumentFragment();
    filtered.forEach(v => {
      const realIdx = vehs.indexOf(v);
      const pal     = window.EV_COLORS.getPalette(v.color);
      const sc      = v.endPct>=30?'#818cf8':v.endPct<10?'#ef4444':'#22c55e';
      const status  = v.endPct>=30?'Ready':v.endPct<10?'Critical':'Charging';
      const kwh     = window.EV_COLORS.calcKwh(v.startPct, v.endPct, v.batteryPack||0.66);
      const pack    = Math.round((v.batteryPack||0.66)*100)+'%';

      const tr = document.createElement('tr');
      tr.dataset.idx = realIdx;
      tr.innerHTML = `
        <td class="lv-spot">${v.location||'—'}</td>
        <td class="lv-vin">${v.vin||'—'}</td>
        <td class="lv-color"><span class="lv-swatch" style="background:${pal.body}"></span>${COLOR_LABELS[v.color]||v.color||'—'}</td>
        <td class="lv-num">${Math.round(v.startPct)}%</td>
        <td class="lv-num">${Math.round(v.endPct)}%</td>
        <td class="lv-num">${kwh} kWh</td>
        <td class="lv-num">${pack}</td>
        <td><span class="lv-status" style="color:${sc}">${status}</span></td>
        <td class="lv-date">${v.inputDate ? new Date(v.inputDate).toLocaleDateString('en-US',{month:'numeric',day:'numeric',year:'numeric'}) : '—'}</td>
        <td><button class="lv-menu-btn" data-idx="${realIdx}" title="Options">⋯</button></td>
      `;
      tr.addEventListener('contextmenu', e => { e.preventDefault(); showCtx(e.clientX, e.clientY, realIdx); });
      tr.querySelector('.lv-menu-btn').addEventListener('click', e => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        showCtx(r.left, r.bottom+4, realIdx);
      });
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
  }

  function showCtx(x, y, idx) {
    ctxIdx = idx;
    const menu = document.getElementById('ctx-menu');
    if (!menu) return;
    menu.style.display = 'block';
    menu.style.left = Math.min(x, window.innerWidth-165)+'px';
    menu.style.top  = Math.min(y, window.innerHeight-125)+'px';
  }
  function hideCtx() {
    const m=document.getElementById('ctx-menu');
    if(m) m.style.display='none';
    ctxIdx=-1;
  }

  function openEdit(idx) {
    const v = window.store.getVehicles()[idx];
    if (!v) return;
    editIdx = idx;
    document.getElementById('edit-location').value = v.location||'';
    document.getElementById('edit-start').value    = Math.round(v.startPct);
    document.getElementById('edit-end').value      = Math.round(v.endPct);
    const picker = document.getElementById('color-picker');
    if (picker) {
      picker.innerHTML = '';
      BOLT_COLORS.forEach(col => {
        const pal = window.EV_COLORS.getPalette(col);
        const btn = document.createElement('div');
        btn.className = 'color-swatch-btn'+(v.color===col?' selected':'');
        btn.title = COLOR_LABELS[col]||col;
        btn.style.background = pal.body;
        btn.dataset.color = col;
        btn.addEventListener('click', () => {
          picker.querySelectorAll('.color-swatch-btn').forEach(b=>b.classList.remove('selected'));
          btn.classList.add('selected');
        });
        picker.appendChild(btn);
      });
    }
    const modal = document.getElementById('edit-modal');
    if (modal) modal.style.display = 'flex';
  }

  function closeEdit() {
    const modal = document.getElementById('edit-modal');
    if (modal) modal.style.display = 'none';
    editIdx = -1;
  }

  async function saveEdit() {
    if (editIdx < 0) return;
    const v = window.store.getVehicles()[editIdx];
    if (!v) return;
    const loc  = document.getElementById('edit-location').value.trim();
    const sp   = parseFloat(document.getElementById('edit-start').value)||v.startPct;
    const ep   = parseFloat(document.getElementById('edit-end').value)||v.endPct;
    const cBtn = document.querySelector('#color-picker .color-swatch-btn.selected');
    const col  = cBtn ? cBtn.dataset.color : v.color;
    await window.store.updateVehicle(editIdx, {...v, location:loc, startPct:sp, endPct:ep, color:col});
    closeEdit();
  }

  function exportCSV() {
    const vehs = window.store.getVehicles();
    if (!vehs.length) { alert('No vehicles to export.'); return; }
    const header = 'Spot,VIN,Color,Start %,End %,kWh Delivered,Battery Pack,Status,Date Added\n';
    const rows = vehs.map(v => {
      const kwh    = window.EV_COLORS.calcKwh(v.startPct, v.endPct, v.batteryPack||0.66);
      const status = v.endPct>=30?'Ready':v.endPct<10?'Critical':'Charging';
      const dateAdded = v.inputDate ? new Date(v.inputDate).toLocaleDateString('en-US') : '';
      return `${v.location||''},${v.vin||''},${COLOR_LABELS[v.color]||v.color||''},${Math.round(v.startPct)},${Math.round(v.endPct)},${kwh},${Math.round((v.batteryPack||0.66)*100)}%,${status},${dateAdded}`;
    }).join('\n');
    const blob = new Blob([header+rows],{type:'text/csv'});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href=url; a.download=`ev-lot-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function buildTooltips(vehicles) {
    const kwhList   = document.getElementById('tt-kwh-list');
    const avgList   = document.getElementById('tt-avg-list');
    const startList = document.getElementById('tt-start-list');
    if (!kwhList||!avgList||!startList) return;

    if (!vehicles.length) {
      const empty = '<div class="tt-row"><span class="tt-loc" style="color:var(--text-hint)">No vehicles yet</span></div>';
      kwhList.innerHTML = avgList.innerHTML = startList.innerHTML = empty;
      return;
    }

    const withData = vehicles.map(v=>({
      loc:   v.location||'?',
      kwh:   window.EV_COLORS.calcKwh(v.startPct,v.endPct,v.batteryPack||0.66),
      start: Math.round(v.startPct||0),
    }));
    const byKwh   = [...withData].sort((a,b)=>b.kwh-a.kwh);
    const byStart = [...withData].sort((a,b)=>a.start-b.start);
    const totalKwh = byKwh.reduce((s,v)=>s+v.kwh,0);
    const avg      = vehicles.length>0 ? Math.round((totalKwh/vehicles.length)*10)/10 : 0;
    const avgSt    = vehicles.length>0 ? Math.round(byStart.reduce((s,v)=>s+v.start,0)/vehicles.length*100)/100 : 0;

    const row   = (loc,val) => `<div class="tt-row"><span class="tt-loc">${loc}</span><span class="tt-val">${val}</span></div>`;
    const total = (lbl,val) => `<div class="tt-row tt-total"><span class="tt-loc">${lbl}</span><span class="tt-val">${val}</span></div>`;

    kwhList.innerHTML   = byKwh.map(v=>row(v.loc,v.kwh+' kWh')).join('')+total('Total',Math.round(totalKwh*10)/10+' kWh');
    avgList.innerHTML   = byKwh.map(v=>row(v.loc,v.kwh+' kWh')).join('')+total('Average',avg+' kWh/car');
    startList.innerHTML = byStart.map(v=>row(v.loc,v.start+'%')).join('')+total('Average',avgSt+'%');
  }

  function initTooltips() {
    const PAIRS=[
      {triggerId:'pill-kwh',   tooltipId:'tooltip-kwh'},
      {triggerId:'pill-avg',   tooltipId:'tooltip-avg'},
      {triggerId:'pill-start', tooltipId:'tooltip-start'},
    ];
    let active = null;

    function show(trigger, tooltip) {
      if (active && active!==tooltip) active.classList.remove('visible');
      const r = trigger.getBoundingClientRect();
      let left = r.right-260;
      if (left<8) left=8;
      if (left+260>window.innerWidth-8) left=window.innerWidth-268;
      tooltip.style.left = left+'px';
      tooltip.style.top  = (r.bottom+6)+'px';
      tooltip.classList.add('visible');
      active = tooltip;
    }
    function hide(t) { t.classList.remove('visible'); if(active===t) active=null; }

    PAIRS.forEach(({triggerId,tooltipId}) => {
      const trigger = document.getElementById(triggerId);
      const tooltip = document.getElementById(tooltipId);
      if (!trigger||!tooltip) return;
      trigger.addEventListener('mouseenter', () => show(trigger,tooltip));
      trigger.addEventListener('mouseleave', () => setTimeout(()=>{ if(!tooltip.matches(':hover')) hide(tooltip); },120));
      tooltip.addEventListener('mouseleave', () => hide(tooltip));
    });
    document.addEventListener('click', () => {
      PAIRS.forEach(({tooltipId})=>{ const t=document.getElementById(tooltipId); if(t) t.classList.remove('visible'); });
      active=null;
    });
  }

  function refresh(vehicles) {
    // Always pull directly from store to guarantee freshest data including inputDate
    const vehs = window.store ? window.store.getVehicles() : (vehicles || []);
    buildList(vehs);
    buildTooltips(vehs);
  }

  function bindEvents() {
    // Sort headers
    document.querySelectorAll('.list-table th.sortable').forEach(th => {
      th.style.cursor='pointer';
      th.addEventListener('click', () => {
        const col=th.dataset.col;
        if(sortCol===col) sortAsc=!sortAsc; else { sortCol=col; sortAsc=true; }
        buildList(window.store.getVehicles());
      });
    });

    // Search
    const search=document.getElementById('list-search');
    if(search) search.addEventListener('input', e=>{ query=e.target.value; buildList(window.store.getVehicles()); });

    // Export
    const exportBtn=document.getElementById('list-export-btn');
    if(exportBtn) exportBtn.addEventListener('click', exportCSV);

    // Context menu
    const ctxEdit=document.getElementById('ctx-edit');
    const ctxColor=document.getElementById('ctx-color');
    const ctxDelete=document.getElementById('ctx-delete');
    if(ctxEdit)   ctxEdit.addEventListener('click',  ()=>{ openEdit(ctxIdx); hideCtx(); });
    if(ctxColor)  ctxColor.addEventListener('click', ()=>{ openEdit(ctxIdx); hideCtx(); });
    if(ctxDelete) ctxDelete.addEventListener('click', async ()=>{
      const idx=ctxIdx; hideCtx();
      if(idx<0) return;
      const v=window.store.getVehicles()[idx];
      if(confirm(`Remove ${v?.location||'this vehicle'} (${v?.vin||''})?`)) {
        await window.store.deleteVehicle(idx);
        if(window.lot) window.lot.closeDetail();
      }
    });
    document.addEventListener('click', e=>{ const m=document.getElementById('ctx-menu'); if(m&&!m.contains(e.target)) hideCtx(); });

    // Edit modal
    const modalClose=document.getElementById('modal-close');
    const saveBtn=document.getElementById('edit-save-btn');
    const overlay=document.getElementById('edit-modal');
    if(modalClose) modalClose.addEventListener('click', closeEdit);
    if(saveBtn)    saveBtn.addEventListener('click', saveEdit);
    if(overlay)    overlay.addEventListener('click', e=>{ if(e.target===overlay) closeEdit(); });

    initTooltips();
  }

  window.listView = { refresh, buildList, buildTooltips, bindEvents };
})();
