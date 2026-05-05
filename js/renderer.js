/**
 * renderer.js
 * Isometric 3D renderer for the 2027 Chevy Bolt EUV parking lot.
 * Rotation is horizontal-axis only (Y-axis spin).
 */

(function () {
  const canvas = document.getElementById('lot-canvas');
  const ctx    = canvas.getContext('2d');

  // ── View state ──────────────────────────────────────────────────────────────
  let angY   = 0.0;   // horizontal rotation angle (radians)
  let zoomLv = 1.0;
  let gph    = 0;     // glow phase for charge animation
  let raf    = null;

  // ── Input state ─────────────────────────────────────────────────────────────
  let dragActive = false;
  let dragStartX = 0;
  let dragStartAngY = 0;
  let rotInterval = null;

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function iso(x, y, z, cx, cy, sc) {
    const cosA = Math.cos(angY);
    const sinA = Math.sin(angY);
    const rx = x * cosA + z * sinA;
    const rz = -x * sinA + z * cosA;
    const TILT = 0.44;
    return [cx + rx * sc, cy + rz * sc * TILT - y * sc];
  }

  function darken(hex, amt) {
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${Math.max(0,r-amt)},${Math.max(0,g-amt)},${Math.max(0,b-amt)})`;
  }
  function lighten(hex, amt) {
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${Math.min(255,r+amt)},${Math.min(255,g+amt)},${Math.min(255,b+amt)})`;
  }

  function poly(pts, fill, strokeColor, sw = 0.4) {
    ctx.beginPath();
    ctx.moveTo(...pts[0]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(...pts[i]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (strokeColor) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = sw;
      ctx.stroke();
    }
  }

  // ── 2027 Bolt EUV car drawing ───────────────────────────────────────────────
  function drawBoltEUV(v, gx, gz, cx, cy, sc) {
    const P   = (x, y, z) => iso(gx + x, y, gz + z, cx, cy, sc);
    const pal = window.EV_COLORS.getPalette(v.color);
    const dpr = window.devicePixelRatio || 1;

    // Geometry constants
    const L   = 1.7,  W   = 0.78, H = 0.52;  // body length, width, height
    const WH  = 0.12;                           // wheel/ground clearance height
    const RH  = 0.62;                           // cabin roof height above body top
    const CLADD = 0.16;                         // black cladding height

    // Body vertices
    const BFL = P( L/2, WH,       -W/2), BFR = P( L/2, WH,        W/2);
    const BRL = P(-L/2, WH,       -W/2), BRR = P(-L/2, WH,        W/2);
    const TFL = P( L/2, WH+H,     -W/2), TFR = P( L/2, WH+H,      W/2);
    const TRL = P(-L/2, WH+H,     -W/2), TRR = P(-L/2, WH+H,      W/2);

    // Roof vertices (sloping fastback profile)
    const ri   = 0.06;
    const RF_A = P( L/2-0.22, WH+H+RH*0.82, -W/2+ri);
    const RF_B = P( L/2-0.22, WH+H+RH*0.82,  W/2-ri);
    const RM_A = P( L/2-0.50, WH+H+RH,       -W/2+ri);
    const RM_B = P( L/2-0.50, WH+H+RH,        W/2-ri);
    const RR_A = P(-L/2+0.15, WH+H+RH*0.45, -W/2+ri);
    const RR_B = P(-L/2+0.15, WH+H+RH*0.45,  W/2-ri);

    // Cladding top line
    const CFL = P( L/2, WH+CLADD, -W/2), CFR = P( L/2, WH+CLADD,  W/2);
    const CRL = P(-L/2, WH+CLADD, -W/2), CRR = P(-L/2, WH+CLADD,  W/2);

    // Ground shadow ellipse
    const shd = iso(gx, 0, gz, cx, cy, sc);
    ctx.beginPath();
    ctx.ellipse(shd[0], shd[1] + 3 * dpr, sc * L * 0.58 * dpr, sc * W * 0.2 * dpr, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,.38)';
    ctx.fill();

    // ── Wheels (17" dark machined alloys) ───────────────────────────────────
    const wheelPositions = [
      [ L/2 - 0.28, 0, -W/2 - 0.03],
      [ L/2 - 0.28, 0,  W/2 + 0.03],
      [-L/2 + 0.28, 0, -W/2 - 0.03],
      [-L/2 + 0.28, 0,  W/2 + 0.03],
    ];
    for (const [wx,, wz] of wheelPositions) {
      const wc  = iso(gx + wx, WH * 0.5, gz + wz, cx, cy, sc);
      const wt  = iso(gx + wx, WH,        gz + wz, cx, cy, sc);
      const wr  = 0.145 * sc * dpr;
      ctx.beginPath(); ctx.arc(wc[0], wc[1], wr,       0, Math.PI*2); ctx.fillStyle = '#111';      ctx.fill();
      ctx.beginPath(); ctx.arc(wt[0], wt[1], wr * .72, 0, Math.PI*2); ctx.fillStyle = pal.rim;     ctx.fill();
      for (let s = 0; s < 5; s++) {
        const a  = (s / 5) * Math.PI * 2;
        const sx = wt[0] + Math.cos(a) * wr * 0.52;
        const sy = wt[1] + Math.sin(a) * wr * 0.52;
        ctx.beginPath(); ctx.moveTo(wt[0], wt[1]); ctx.lineTo(sx, sy);
        ctx.strokeStyle = '#555'; ctx.lineWidth = 1.2 * dpr; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(wt[0], wt[1], wr * .22, 0, Math.PI*2); ctx.fillStyle = '#888'; ctx.fill();
      // Wheel arch cladding arc
      ctx.beginPath(); ctx.arc(wc[0], wc[1], wr * 1.14, Math.PI*0.1, Math.PI*0.9);
      ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 3.5 * dpr; ctx.stroke();
    }

    // ── Black lower cladding panels ─────────────────────────────────────────
    poly([BRL, BRR, CRR, CRL], '#1a1a1e', 'rgba(0,0,0,.5)');
    poly([BFL, BFR, CFR, CFL], '#1a1a1e', 'rgba(0,0,0,.5)');
    poly([BFL, BRL, CRL, CFL], '#111116', 'rgba(0,0,0,.4)');
    poly([BFR, BRR, CRR, CFR], '#101014', 'rgba(0,0,0,.4)');

    // ── Main body panels ────────────────────────────────────────────────────
    poly([CRL, CRR, TRR, TRL], darken(pal.body, 42), 'rgba(0,0,0,.35)');
    poly([CFL, CFR, TFR, TFL], darken(pal.body, 20), 'rgba(0,0,0,.25)');
    poly([CFL, CRL, TRL, TFL], pal.body,              'rgba(0,0,0,.2)');
    poly([CFR, CRR, TRR, TFR], darken(pal.body, 30), 'rgba(0,0,0,.2)');
    poly([TFL, TFR, TRR, TRL], pal.body,              'rgba(0,0,0,.15)');

    // ── Cabin / roof ────────────────────────────────────────────────────────
    poly([TFL, RF_A, RM_A, TRL], darken(pal.body, 15), 'rgba(0,0,0,.2)');
    // Windshield
    poly([TFL, TFR, RF_B, RF_A], 'rgba(140,200,240,.18)', 'rgba(200,220,255,.2)');
    // Roof top
    poly([RF_A, RF_B, RM_B, RM_A], lighten(pal.body, 10), 'rgba(0,0,0,.14)');
    poly([RM_A, RM_B, RR_B, RR_A], pal.body,               'rgba(0,0,0,.16)');
    // Rear window (fastback)
    poly([RM_A, RR_A, TRL], 'rgba(100,160,210,.2)',  'rgba(150,200,240,.18)');
    poly([RM_B, RR_B, TRR], 'rgba(80,140,190,.18)',  'rgba(150,200,240,.14)');
    poly([RR_A, RR_B, TRR, TRL], darken(pal.body, 38), 'rgba(0,0,0,.3)');
    // Side windows
    const WDF_L = P( L/2-0.22, WH+H, -W/2+ri+.01);
    const WDR_L = P(-L/2+0.15, WH+H, -W/2+ri+.01);
    poly([WDF_L, RF_A, RM_A, RR_A, WDR_L], 'rgba(80,150,210,.26)', 'rgba(160,210,250,.18)');
    const WDF_R = P( L/2-0.22, WH+H,  W/2-ri-.01);
    const WDR_R = P(-L/2+0.15, WH+H,  W/2-ri-.01);
    poly([WDF_R, RF_B, RM_B, RR_B, WDR_R], 'rgba(60,130,190,.22)', 'rgba(140,190,230,.14)');

    // ── Front fascia — Bolt EUV hex grille ──────────────────────────────────
    const FF_BL = P(L/2+.02, WH+CLADD-.02,  -W/2+.1);
    const FF_BR = P(L/2+.02, WH+CLADD-.02,   W/2-.1);
    const FF_TL = P(L/2+.02, WH+CLADD+.08,  -W/2+.06);
    const FF_TR = P(L/2+.02, WH+CLADD+.08,   W/2-.06);
    poly([FF_BL, FF_BR, FF_TR, FF_TL], '#0e0e0e', 'rgba(0,0,0,.5)');
    // Hex pattern
    const gc = iso(gx + L/2 + .02, WH + CLADD + 0.04, gz, cx, cy, sc);
    for (let hi = -1; hi <= 1; hi++) {
      for (let vi = 0; vi <= 1; vi++) {
        const hx = gc[0] + hi * 0.28 * W * sc * dpr;
        const hy = gc[1] + (vi * 0.38 - 0.2) * CLADD * sc * dpr;
        ctx.beginPath();
        for (let s = 0; s < 6; s++) {
          const a = s * Math.PI / 3 + Math.PI / 6;
          ctx.lineTo(hx + Math.cos(a) * 3.5 * dpr, hy + Math.sin(a) * 3.5 * dpr);
        }
        ctx.closePath();
        ctx.fillStyle = '#1a1a22';
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 0.5;
        ctx.fill(); ctx.stroke();
      }
    }
    // LED headlights
    const HLL = P(L/2+.02, WH+H-.06, -W/2+.05);
    const HLR = P(L/2+.02, WH+H-.06,  W/2-.05);
    [HLL, HLR].forEach(p => {
      ctx.beginPath(); ctx.arc(p[0], p[1], 2.2 * dpr, 0, Math.PI*2);
      ctx.fillStyle = '#ddeeff'; ctx.fill();
    });
    // DRL strips
    const DL1 = iso(gx + L/2+.02, WH+H-.03, gz - W/2+.12, cx, cy, sc);
    const DL2 = iso(gx + L/2+.02, WH+H-.03, gz + W/2-.12, cx, cy, sc);
    ctx.strokeStyle = 'rgba(200,230,255,.8)'; ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.moveTo(DL1[0]-4*dpr, DL1[1]); ctx.lineTo(DL1[0]+4*dpr, DL1[1]); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(DL2[0]-4*dpr, DL2[1]); ctx.lineTo(DL2[0]+4*dpr, DL2[1]); ctx.stroke();

    // ── Full-width rear LED bar ──────────────────────────────────────────────
    const TL1 = iso(gx - L/2-.01, WH+H-.08, gz - W/2+.05, cx, cy, sc);
    const TL2 = iso(gx - L/2-.01, WH+H-.08, gz + W/2-.05, cx, cy, sc);
    ctx.beginPath(); ctx.moveTo(...TL1); ctx.lineTo(...TL2);
    ctx.strokeStyle = 'rgba(255,30,20,.92)'; ctx.lineWidth = 2.0 * dpr; ctx.stroke();
    ctx.beginPath(); ctx.arc(TL2[0], TL2[1], 1.5 * dpr, 0, Math.PI*2);
    ctx.fillStyle = '#ffeecc'; ctx.fill();

    // ── Roof rails ──────────────────────────────────────────────────────────
    const RA1 = iso(gx + L/2-0.3,  WH+H+RH+.02,    gz - W/2+ri-.01, cx, cy, sc);
    const RA2 = iso(gx - L/2+0.2,  WH+H+RH*.4+.02, gz - W/2+ri-.01, cx, cy, sc);
    ctx.beginPath(); ctx.moveTo(...RA1); ctx.lineTo(...RA2);
    ctx.strokeStyle = 'rgba(80,80,80,.8)'; ctx.lineWidth = 1.4 * dpr; ctx.stroke();

    // ── Charge port (left rear quarter, glowing) ────────────────────────────
    const statusColor = window.EV_COLORS.getStatusColor(v.startPct);
    const pp = iso(gx - L/2+.35, WH+H-.12, gz - W/2, cx, cy, sc);
    ctx.beginPath(); ctx.arc(pp[0], pp[1], 3.5 * dpr, 0, Math.PI*2);
    ctx.fillStyle = statusColor;
    ctx.shadowColor = statusColor; ctx.shadowBlur = 9;
    ctx.fill(); ctx.shadowBlur = 0;

    // ── Charge % badge + name label ─────────────────────────────────────────
    const topP = iso(gx, WH+H+RH+.22, gz, cx, cy, sc);
    const pct  = Math.round(v.startPct);
    const bw   = 28 * dpr, bh = 12 * dpr;
    ctx.fillStyle = 'rgba(0,0,0,.72)';
    ctx.beginPath(); ctx.roundRect(topP[0]-bw/2, topP[1]-bh/2, bw, bh, 3); ctx.fill();
    ctx.fillStyle = statusColor;
    ctx.font = `600 ${Math.round(8 * dpr)}px -apple-system,sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(pct + '%', topP[0], topP[1]);

    const lp = iso(gx, WH+H+RH+.38, gz, cx, cy, sc);
    ctx.fillStyle = 'rgba(160,185,210,.65)';
    ctx.font = `${Math.round(7 * dpr)}px -apple-system,sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(v.make + ' ' + v.model, lp[0], lp[1]);

    // Store hit area for click detection
    v._hitX = topP[0];
    v._hitY = topP[1];
    v._hitR = 18 * dpr;
  }

  // ── Main draw scene ──────────────────────────────────────────────────────────
  function drawScene() {
    const W  = canvas.width;
    const H  = canvas.height;
    const dpr = window.devicePixelRatio || 1;
    const vehs = window.store ? window.store.getVehicles() : [];

    ctx.clearRect(0, 0, W, H);

    // Empty lot placeholder
    if (vehs.length === 0) {
      ctx.fillStyle = '#1c2130';
      ctx.beginPath();
      const cxE = W * 0.5, cyE = H * 0.48;
      const p0 = iso(-3, 0,  0, cxE, cyE, 30 * dpr);
      const p1 = iso( 3, 0,  0, cxE, cyE, 30 * dpr);
      const p2 = iso( 3, 0,  4, cxE, cyE, 30 * dpr);
      const p3 = iso(-3, 0,  4, cxE, cyE, 30 * dpr);
      ctx.moveTo(...p0); ctx.lineTo(...p1); ctx.lineTo(...p2); ctx.lineTo(...p3);
      ctx.closePath(); ctx.fill();
      return;
    }

    const cols = Math.max(2, Math.ceil(Math.sqrt(vehs.length * 1.3)));
    const SW   = 4.0, SD = 7.0, G = 0.85;
    const rows = Math.ceil(vehs.length / cols);
    const sc   = Math.min(W * 0.88, H * 0.8) / (Math.max(cols, rows) * 9) * zoomLv * dpr;
    const cx   = W * 0.5;
    const cy   = H * 0.42;

    // ── Lot surface ────────────────────────────────────────────────────────
    const lotW = cols * (SW + G);
    const lotD = rows * (SD + G);
    const corner = (x, z) => iso(x - lotW/2, 0, z, cx, cy, sc);
    ctx.beginPath();
    ctx.moveTo(...corner(0, 0));
    ctx.lineTo(...corner(lotW, 0));
    ctx.lineTo(...corner(lotW, lotD));
    ctx.lineTo(...corner(0, lotD));
    ctx.closePath();
    ctx.fillStyle = '#1c2130'; ctx.fill();

    // Lane stripes
    for (let c = 0; c <= cols; c++) {
      const x = c * (SW + G);
      const la = iso(x - lotW/2, 0.001, 0,     cx, cy, sc);
      const lb = iso(x - lotW/2, 0.001, lotD,   cx, cy, sc);
      ctx.beginPath(); ctx.moveTo(...la); ctx.lineTo(...lb);
      ctx.strokeStyle = 'rgba(255,255,255,.055)'; ctx.lineWidth = 0.4; ctx.stroke();
    }
    for (let r = 0; r <= rows; r++) {
      const z = r * (SD + G);
      const la = iso(-lotW/2, 0.001, z, cx, cy, sc);
      const lb = iso( lotW/2, 0.001, z, cx, cy, sc);
      ctx.beginPath(); ctx.moveTo(...la); ctx.lineTo(...lb);
      ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.lineWidth = 0.4; ctx.stroke();
    }

    // ── Sort back-to-front (painter's algorithm) ───────────────────────────
    const selectedIdx = window.lot ? window.lot.getSelectedIdx() : -1;
    const hoveredIdx  = window.lot ? window.lot.getHoveredIdx()  : -1;

    const order = vehs.map((v, i) => {
      const r  = Math.floor(i / cols);
      const c  = i % cols;
      const gx = (c - (cols - 1) / 2) * (SW + G);
      const gz = r * (SD + G) + SD / 2;
      return { v, i, gx, gz, depth: gz - gx };
    }).sort((a, b) => b.depth - a.depth);

    for (const { v, i, gx, gz } of order) {
      const SW2 = SW * 0.85, SD2 = SD * 0.88;
      const sp = [
        iso(gx-SW2/2, .001, gz-SD2/2, cx,cy,sc),
        iso(gx+SW2/2, .001, gz-SD2/2, cx,cy,sc),
        iso(gx+SW2/2, .001, gz+SD2/2, cx,cy,sc),
        iso(gx-SW2/2, .001, gz+SD2/2, cx,cy,sc),
      ];

      // Parking spot fill
      ctx.beginPath();
      ctx.moveTo(...sp[0]); sp.slice(1).forEach(p => ctx.lineTo(...p)); ctx.closePath();
      ctx.fillStyle = i === selectedIdx ? 'rgba(56,139,253,.12)'
                    : i === hoveredIdx  ? 'rgba(255,255,255,.05)'
                    : 'rgba(255,255,255,.02)';
      ctx.fill();
      ctx.strokeStyle = i === selectedIdx ? 'rgba(56,139,253,.5)' : 'rgba(255,255,255,.07)';
      ctx.lineWidth   = i === selectedIdx ? 0.8 : 0.3;
      ctx.stroke();

      // Spot number
      const np = iso(gx - SW2/2 + .12, .002, gz - SD2/2 + .14, cx, cy, sc);
      ctx.fillStyle = 'rgba(255,255,255,.14)';
      ctx.font = `${Math.round(6 * dpr)}px -apple-system,sans-serif`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(i + 1, np[0], np[1]);

      // Charging glow
      const sc2 = window.EV_COLORS.getStatusColor(v.startPct);
      if (sc2 === '#22c55e') {
        const gc = iso(gx, .001, gz, cx, cy, sc);
        const gl = ctx.createRadialGradient(gc[0], gc[1], 0, gc[0], gc[1], sc * 3.2);
        const al = 0.05 + 0.04 * Math.sin(gph + i * 0.85);
        gl.addColorStop(0, `rgba(34,197,94,${al})`);
        gl.addColorStop(1, 'rgba(34,197,94,0)');
        ctx.beginPath();
        ctx.moveTo(...sp[0]); sp.slice(1).forEach(p => ctx.lineTo(...p)); ctx.closePath();
        ctx.fillStyle = gl; ctx.fill();
      }

      drawBoltEUV(v, gx, gz, cx, cy, sc);
    }
  }

  // ── Animation loop ───────────────────────────────────────────────────────────
  function loop() {
    gph += 0.024;
    drawScene();
    raf = requestAnimationFrame(loop);
  }

  // ── Resize handling ──────────────────────────────────────────────────────────
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width  = rect.width  + 'px';
    canvas.style.height = rect.height + 'px';
    drawScene();
  }
  window.addEventListener('resize', resize);

  // ── Mouse / touch input ──────────────────────────────────────────────────────
  canvas.addEventListener('mousedown', e => {
    dragActive   = true;
    dragStartX   = e.clientX;
    dragStartAngY = angY;
  });
  window.addEventListener('mousemove', e => {
    if (dragActive) {
      angY = dragStartAngY + (e.clientX - dragStartX) / 130;
    }
    // Hover detection
    if (!window.store) return;
    const vehs = window.store.getVehicles();
    if (!vehs.length) return;
    const rect = canvas.getBoundingClientRect();
    const dpr  = window.devicePixelRatio || 1;
    const mx   = (e.clientX - rect.left) * dpr;
    const my   = (e.clientY - rect.top)  * dpr;
    let found  = -1;
    for (let i = 0; i < vehs.length; i++) {
      const v = vehs[i];
      if (!v._hitX) continue;
      const dx = mx - v._hitX, dy = my - v._hitY;
      if (dx*dx + dy*dy < v._hitR * v._hitR * 6) { found = i; break; }
    }
    if (found !== (window.lot ? window.lot.getHoveredIdx() : -1)) {
      if (window.lot) window.lot.setHoveredIdx(found);
      canvas.style.cursor = found >= 0 ? 'pointer' : (dragActive ? 'grabbing' : 'grab');
    }
  });
  window.addEventListener('mouseup', e => {
    if (!dragActive) return;
    // Click vs drag
    if (Math.abs(e.clientX - dragStartX) < 6 && window.store) {
      const vehs = window.store.getVehicles();
      const rect = canvas.getBoundingClientRect();
      const dpr  = window.devicePixelRatio || 1;
      const mx   = (e.clientX - rect.left) * dpr;
      const my   = (e.clientY - rect.top)  * dpr;
      for (let i = 0; i < vehs.length; i++) {
        const v = vehs[i];
        if (!v._hitX) continue;
        const dx = mx - v._hitX, dy = my - v._hitY;
        if (dx*dx + dy*dy < v._hitR * v._hitR * 9) {
          if (window.lot) window.lot.selectVehicle(i);
          break;
        }
      }
    }
    dragActive = false;
    canvas.style.cursor = 'grab';
    stopRot();
  });

  // Touch support
  canvas.addEventListener('touchstart', e => {
    dragStartX    = e.touches[0].clientX;
    dragStartAngY = angY;
  }, { passive: true });
  canvas.addEventListener('touchmove', e => {
    angY = dragStartAngY + (e.touches[0].clientX - dragStartX) / 130;
  }, { passive: true });

  // Scroll zoom
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    zoomLv = Math.max(0.3, Math.min(5, zoomLv - e.deltaY * 0.0007));
  }, { passive: false });

  // ── Button controls ──────────────────────────────────────────────────────────
  function startRot(dir) {
    stopRot();
    rotInterval = setInterval(() => { angY += dir * 0.04; }, 30);
  }
  function stopRot() {
    if (rotInterval) { clearInterval(rotInterval); rotInterval = null; }
  }

  document.getElementById('rot-left').addEventListener('mousedown',  () => startRot(-1));
  document.getElementById('rot-right').addEventListener('mousedown', () => startRot( 1));
  document.getElementById('rot-left').addEventListener('touchstart',  () => startRot(-1), { passive: true });
  document.getElementById('rot-right').addEventListener('touchstart', () => startRot( 1), { passive: true });
  window.addEventListener('mouseup', stopRot);
  window.addEventListener('touchend', stopRot);

  // ── Public API ───────────────────────────────────────────────────────────────
  window.renderer = {
    resize,
    start() {
      if (!raf) { resize(); loop(); }
    },
    redraw: drawScene,
  };

  canvas.style.cursor = 'grab';
  resize();
})();
