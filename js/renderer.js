/**
 * renderer.js
 * Isometric 3D renderer — 200 E. Marley Rd. lot layout
 *
 * LOT STRUCTURE (west → east):
 *   Sections: 8T, 7T, 6T, 5T, 4T, 3T, 2T, 1T
 *   Each section: 15 cars wide
 *   Row pattern per section: row, row, [LANE], row, row, [LANE] ... × 15 pairs = 30 rows
 *   Rows 1, 18, 19 split into A & B sub-rows
 *   Section 1T also has: [empty gap] + RL-1, RL-2, [LANE], RL-3, RL-4
 *
 * Vehicles are placed by parsing their location string (e.g. "1T-22", "3T-1A", "1RL-3")
 * Unmatched vehicles overflow into a staging area below the main lot.
 *
 * View: enter from south facing north → lot drawn top = north, bottom = south
 * Rotation: horizontal only (Y-axis)
 */

(function () {
  const canvas = document.getElementById('lot-canvas');
  const ctx    = canvas.getContext('2d');

  // ── View state ───────────────────────────────────────────────────────────────
  let angY          = 0.3;   // slight initial angle so lot has depth
  let zoomLv        = 1.0;
  let gph           = 0;
  let raf           = null;
  let dragActive    = false;
  let dragStartX    = 0;
  let dragStartAngY = 0;
  let panActive     = false;
  let panStartX     = 0;
  let panStartY     = 0;
  let panOffX       = 0;   // world-space pan offset X
  let panOffZ       = 0;   // world-space pan offset Z
  let rotInterval   = null;

  // ── Lot constants ────────────────────────────────────────────────────────────
  const SECTIONS     = ['8T','7T','6T','5T','4T','3T','2T','1T']; // west→east (left→right in view)
  const CARS_PER_ROW = 15;
  const TOTAL_ROWS   = 30;
  const AB_ROWS      = [1, 18, 19];   // these rows split into A and B

  // Spacing units (world space)
  const CAR_W    = 1.6;   // car width (along row)
  const CAR_D    = 2.8;   // car depth (nose to tail)
  const CAR_GAP  = 0.25;  // gap between cars in same row
  const ROW_GAP  = 0.5;   // gap between rows (nose-to-nose)
  const LANE_W   = 3.2;   // drive lane width
  const SEC_GAP  = 4.0;   // gap between sections (cross-lane)

  // Build the lot grid — returns array of slot objects with world positions
  // Each slot: { sectionIdx, rowLabel, carIdx, wx, wz, facing }
  // facing: 1 = nose north, -1 = nose south (alternates per row pair)
  function buildLotGrid() {
    const slots = [];

    // For each section (0=8T ... 7=1T)
    SECTIONS.forEach((secName, secIdx) => {
      // Section X offset (east = positive X in world space)
      // Each section is 15 cars wide
      const secW     = CARS_PER_ROW * (CAR_W + CAR_GAP);
      const secOffX  = secIdx * (secW + SEC_GAP);

      // Build row list for this section
      const rowList = buildRowList(secName);

      // Z offset accumulator (north = negative Z)
      let zOff = 0;

      rowList.forEach(rowEntry => {
        if (rowEntry.type === 'lane') {
          zOff += LANE_W;
          return;
        }
        if (rowEntry.type === 'gap') {
          zOff += LANE_W * 2;
          return;
        }
        // Normal row — place CARS_PER_ROW cars
        const facing = rowEntry.pairPos === 0 ? 1 : -1; // pair pos 0 = faces north, 1 = faces south
        for (let c = 0; c < CARS_PER_ROW; c++) {
          const wx = secOffX + c * (CAR_W + CAR_GAP);
          const wz = zOff;
          slots.push({
            section:  secName,
            rowLabel: rowEntry.label,
            carIdx:   c + 1,
            spotId:   `${secName}-${rowEntry.label}`,
            wx,
            wz,
            facing,
          });
        }
        zOff += CAR_D + ROW_GAP;
      });

      // RL section only for 1T
      if (secName === '1T') {
        zOff += LANE_W * 2; // empty gap
        const rlRows = ['RL-1','RL-2',null,'RL-3','RL-4'];
        let rlPair = 0;
        rlRows.forEach(rl => {
          if (rl === null) { zOff += LANE_W; rlPair = 0; return; }
          const facing = rlPair === 0 ? 1 : -1;
          for (let c = 0; c < CARS_PER_ROW; c++) {
            slots.push({
              section:  '1RL',
              rowLabel: rl,
              carIdx:   c + 1,
              spotId:   `1RL-${rl}`,
              wx:       secOffX + c * (CAR_W + CAR_GAP),
              wz:       zOff,
              facing,
            });
          }
          zOff += CAR_D + ROW_GAP;
          rlPair = (rlPair + 1) % 2;
        });
      }
    });

    return slots;
  }

  // Build ordered row list for a section including lanes and A/B splits
  function buildRowList(secName) {
    const rows = [];
    let pairPos = 0; // 0 or 1 within each 2-row pair

    for (let r = 1; r <= TOTAL_ROWS; r++) {
      if (AB_ROWS.includes(r)) {
        // A sub-row
        rows.push({ type: 'row', label: `${r}A`, pairPos });
        pairPos = (pairPos + 1) % 2;
        if (pairPos === 0) rows.push({ type: 'lane' });
        // B sub-row
        rows.push({ type: 'row', label: `${r}B`, pairPos });
        pairPos = (pairPos + 1) % 2;
        if (pairPos === 0) rows.push({ type: 'lane' });
      } else {
        rows.push({ type: 'row', label: `${r}`, pairPos });
        pairPos = (pairPos + 1) % 2;
        if (pairPos === 0) rows.push({ type: 'lane' });
      }
    }
    return rows;
  }

  // Pre-build slot lookup: spotId → slot index in lotSlots
  let lotSlots     = [];
  let slotBySpotId = {}; // "1T-22" → [slot, slot...] (15 per row)
  let lotBounds    = { minX:0, maxX:0, minZ:0, maxZ:0 };

  function initLot() {
    lotSlots = buildLotGrid();
    slotBySpotId = {};
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    lotSlots.forEach((s, i) => {
      const key = s.spotId;
      if (!slotBySpotId[key]) slotBySpotId[key] = [];
      slotBySpotId[key].push(i);
      if (s.wx < minX) minX = s.wx;
      if (s.wx > maxX) maxX = s.wx;
      if (s.wz < minZ) minZ = s.wz;
      if (s.wz > maxZ) maxZ = s.wz;
    });
    lotBounds = { minX, maxX, minZ, maxZ };
  }

  initLot();

  // Parse a vehicle's location string into a spotId
  // "1T-22" → "1T-22", "3T-1A" → "3T-1A", "1RL-3" → "1RL-RL-3"
  function parseLocation(loc) {
    if (!loc) return null;
    const s = String(loc).trim().toUpperCase();
    // Already looks like section-row e.g. "1T-22", "3T-1A", "1RL-3"
    if (/^\d+T-/.test(s) || /^\d+RL-/.test(s)) return s;
    return null;
  }

  // Assign vehicles to slots. Returns array of {slot, vehicle, vehicleIdx}
  function assignVehicles(vehs) {
    const assigned   = [];
    const usedSlots  = new Set();
    const overflow   = [];

    vehs.forEach((v, vi) => {
      const locKey = parseLocation(v.location);
      if (locKey && slotBySpotId[locKey]) {
        // Find first unused slot in this row
        const available = slotBySpotId[locKey].find(si => !usedSlots.has(si));
        if (available !== undefined) {
          usedSlots.add(available);
          assigned.push({ slot: lotSlots[available], vehicle: v, vehicleIdx: vi });
          return;
        }
      }
      overflow.push({ vehicle: v, vehicleIdx: vi });
    });

    // Place overflow in a staging area south of main lot
    overflow.forEach((o, oi) => {
      const cols  = Math.ceil(Math.sqrt(overflow.length * 2));
      const oRow  = Math.floor(oi / cols);
      const oCol  = oi % cols;
      const stagW = (lotBounds.maxX - lotBounds.minX);
      const wx    = lotBounds.minX + oCol * (CAR_W + CAR_GAP + 0.5);
      const wz    = lotBounds.maxZ + LANE_W * 3 + oRow * (CAR_D + ROW_GAP + 0.5);
      assigned.push({
        slot: { wx, wz, facing: 1, section: 'STAGING', rowLabel: '', carIdx: oi+1, spotId: '' },
        vehicle: o.vehicle,
        vehicleIdx: o.vehicleIdx,
      });
    });

    return assigned;
  }

  // ── Isometric projection (horizontal rotation only) ──────────────────────────
  function iso(x, y, z, cx, cy, sc) {
    const cosA = Math.cos(angY);
    const sinA = Math.sin(angY);
    const rx   = x * cosA + z * sinA;
    const rz   = -x * sinA + z * cosA;
    const TILT = 0.42;
    return [cx + rx * sc, cy + rz * sc * TILT - y * sc];
  }

  // ── Color helpers ────────────────────────────────────────────────────────────
  function dk(hex, a) {
    let r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
    return `rgb(${Math.max(0,r-a)},${Math.max(0,g-a)},${Math.max(0,b-a)})`;
  }
  function lt(hex, a) {
    let r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
    return `rgb(${Math.min(255,r+a)},${Math.min(255,g+a)},${Math.min(255,b+a)})`;
  }
  function poly(pts, fill, strokeC, sw=0.4) {
    ctx.beginPath(); ctx.moveTo(...pts[0]);
    for(let i=1;i<pts.length;i++) ctx.lineTo(...pts[i]);
    ctx.closePath(); ctx.fillStyle=fill; ctx.fill();
    if(strokeC){ctx.strokeStyle=strokeC;ctx.lineWidth=sw;ctx.stroke();}
  }

  // ── 2027 Bolt EUV drawing (facing param: 1=north, -1=south) ─────────────────
  function drawBoltEUV(v, wx, wz, cx, cy, sc, facing) {
    const P   = (x,y,z) => iso(wx+x, y, wz+z*facing, cx, cy, sc);
    const pal = window.EV_COLORS.getPalette(v.color);
    const dpr = window.devicePixelRatio || 1;

    const L=1.5, W=0.72, H=0.36, WH=0.1, RH=0.58, CLADD=0.14, ri=0.055;
    const RI_F=0.34, RI_R=0.28, RW=0.64;

    const BFL=P(L/2,WH,-W/2), BFR=P(L/2,WH,W/2);
    const BRL=P(-L/2,WH,-W/2), BRR=P(-L/2,WH,W/2);
    const TFL=P(L/2,WH+H,-W/2), TFR=P(L/2,WH+H,W/2);
    const TRL=P(-L/2,WH+H,-W/2), TRR=P(-L/2,WH+H,W/2);
    const rxF=L/2-RI_F, rxR=-L/2+RI_R;
    const RF_A=P(rxF,WH+H+RH*0.82,-W/2+ri), RF_B=P(rxF,WH+H+RH*0.82,W/2-ri);
    const RM_A=P(rxF-0.28,WH+H+RH,-W/2+ri), RM_B=P(rxF-0.28,WH+H+RH,W/2-ri);
    const RR_A=P(rxR,WH+H+RH*0.42,-W/2+ri), RR_B=P(rxR,WH+H+RH*0.42,W/2-ri);
    const CFL=P(L/2,WH+CLADD,-W/2), CFR=P(L/2,WH+CLADD,W/2);
    const CRL=P(-L/2,WH+CLADD,-W/2), CRR=P(-L/2,WH+CLADD,W/2);

    // Shadow
    const shd=iso(wx,0,wz,cx,cy,sc);
    ctx.beginPath();ctx.ellipse(shd[0],shd[1]+2*dpr,sc*L*.55*dpr,sc*W*.18*dpr,0,0,Math.PI*2);
    ctx.fillStyle='rgba(0,0,0,.32)';ctx.fill();

    // Wheels
    [[L/2-.24,0,-W/2-.03],[L/2-.24,0,W/2+.03],[-L/2+.24,0,-W/2-.03],[-L/2+.24,0,W/2+.03]].forEach(([wx2,,wz2])=>{
      const wc=iso(wx+wx2,WH*.5,wz+wz2*facing,cx,cy,sc);
      const wt=iso(wx+wx2,WH,wz+wz2*facing,cx,cy,sc);
      const wr=0.13*sc*dpr;
      ctx.beginPath();ctx.arc(wc[0],wc[1],wr,0,Math.PI*2);ctx.fillStyle='#111';ctx.fill();
      ctx.beginPath();ctx.arc(wt[0],wt[1],wr*.7,0,Math.PI*2);ctx.fillStyle=pal.rim;ctx.fill();
      for(let s=0;s<5;s++){const a=s/5*Math.PI*2;ctx.beginPath();ctx.moveTo(wt[0],wt[1]);ctx.lineTo(wt[0]+Math.cos(a)*wr*.5,wt[1]+Math.sin(a)*wr*.5);ctx.strokeStyle='#555';ctx.lineWidth=dpr;ctx.stroke();}
      ctx.beginPath();ctx.arc(wt[0],wt[1],wr*.22,0,Math.PI*2);ctx.fillStyle='#777';ctx.fill();
      ctx.beginPath();ctx.arc(wc[0],wc[1],wr*1.12,Math.PI*.1,Math.PI*.9);ctx.strokeStyle='#1a1a1a';ctx.lineWidth=3*dpr;ctx.stroke();
    });

    // Cladding
    poly([BRL,BRR,CRR,CRL],'#1a1a1e','rgba(0,0,0,.5)');
    poly([BFL,BFR,CFR,CFL],'#1a1a1e','rgba(0,0,0,.5)');
    poly([BFL,BRL,CRL,CFL],'#111116','rgba(0,0,0,.4)');
    poly([BFR,BRR,CRR,CFR],'#101014','rgba(0,0,0,.4)');

    // Body
    poly([CRL,CRR,TRR,TRL],dk(pal.body,42),'rgba(0,0,0,.35)');
    poly([CFL,CFR,TFR,TFL],dk(pal.body,20),'rgba(0,0,0,.25)');
    poly([CFL,CRL,TRL,TFL],pal.body,'rgba(0,0,0,.2)');
    poly([CFR,CRR,TRR,TFR],dk(pal.body,30),'rgba(0,0,0,.2)');
    poly([TFL,TFR,TRR,TRL],pal.body,'rgba(0,0,0,.15)');

    // Roof/cabin
    poly([TFL,RF_A,RM_A,TRL],dk(pal.body,15),'rgba(0,0,0,.2)');
    poly([TFL,TFR,RF_B,RF_A],'rgba(140,200,240,.18)','rgba(200,220,255,.2)');
    poly([RF_A,RF_B,RM_B,RM_A],lt(pal.body,10),'rgba(0,0,0,.14)');
    poly([RM_A,RM_B,RR_B,RR_A],pal.body,'rgba(0,0,0,.16)');
    poly([RM_A,RR_A,TRL],'rgba(100,160,210,.2)','rgba(150,200,240,.18)');
    poly([RM_B,RR_B,TRR],'rgba(80,140,190,.18)','rgba(150,200,240,.14)');
    poly([RR_A,RR_B,TRR,TRL],'rgba(60,110,160,.22)','rgba(100,160,210,.2)');
    const WDF_L=P(L/2-0.2,WH+H,-W/2+ri+.01), WDR_L=P(-L/2+0.13,WH+H,-W/2+ri+.01);
    poly([WDF_L,RF_A,RM_A,RR_A,WDR_L],'rgba(80,150,210,.25)','rgba(160,210,250,.18)');
    const WDF_R=P(L/2-0.2,WH+H,W/2-ri-.01), WDR_R=P(-L/2+0.13,WH+H,W/2-ri-.01);
    poly([WDF_R,RF_B,RM_B,RR_B,WDR_R],'rgba(60,130,190,.22)','rgba(140,190,230,.14)');

    // Front grille hex
    const gc=iso(wx+L/2+.02,WH+CLADD+.03,wz,cx,cy,sc);
    for(let hi=-1;hi<=1;hi++){for(let vi=0;vi<=1;vi++){
      const hx=gc[0]+hi*.28*W*sc*dpr,hy=gc[1]+(vi*.38-.2)*CLADD*sc*dpr;
      ctx.beginPath();for(let s=0;s<6;s++){const a=s*Math.PI/3+Math.PI/6;ctx.lineTo(hx+Math.cos(a)*3.2*dpr,hy+Math.sin(a)*3.2*dpr);}
      ctx.closePath();ctx.fillStyle='#1a1a22';ctx.strokeStyle='#333';ctx.lineWidth=.5;ctx.fill();ctx.stroke();
    }}

    // Headlights
    [P(L/2+.02,WH+H-.05,-W/2+.05),P(L/2+.02,WH+H-.05,W/2-.05)].forEach(p=>{
      ctx.beginPath();ctx.arc(p[0],p[1],2*dpr,0,Math.PI*2);ctx.fillStyle='#ddeeff';ctx.fill();
    });
    const D1=iso(wx+L/2+.02,WH+H-.02,wz-(W/2-.1)*facing,cx,cy,sc);
    const D2=iso(wx+L/2+.02,WH+H-.02,wz+(W/2-.1)*facing,cx,cy,sc);
    ctx.strokeStyle='rgba(200,230,255,.8)';ctx.lineWidth=1.2*dpr;
    ctx.beginPath();ctx.moveTo(D1[0]-3*dpr,D1[1]);ctx.lineTo(D1[0]+3*dpr,D1[1]);ctx.stroke();
    ctx.beginPath();ctx.moveTo(D2[0]-3*dpr,D2[1]);ctx.lineTo(D2[0]+3*dpr,D2[1]);ctx.stroke();

    // Taillights
    const TL1=iso(wx-L/2-.01,WH+H-.07,wz-(W/2-.05)*facing,cx,cy,sc);
    const TL2=iso(wx-L/2-.01,WH+H-.07,wz+(W/2-.05)*facing,cx,cy,sc);
    ctx.beginPath();ctx.moveTo(...TL1);ctx.lineTo(...TL2);
    ctx.strokeStyle='rgba(255,30,20,.9)';ctx.lineWidth=1.8*dpr;ctx.stroke();

    // Roof rails
    const RA1=iso(wx+L/2-.28,WH+H+RH+.02,wz-(W/2-ri-.01)*facing,cx,cy,sc);
    const RA2=iso(wx-L/2+.18,WH+H+RH*.38+.02,wz-(W/2-ri-.01)*facing,cx,cy,sc);
    ctx.beginPath();ctx.moveTo(...RA1);ctx.lineTo(...RA2);
    ctx.strokeStyle='rgba(80,80,80,.75)';ctx.lineWidth=1.2*dpr;ctx.stroke();

    // Charge port
    const statusColor=window.EV_COLORS.getStatusColor(v.startPct,v.endPct);
    const pp=iso(wx-L/2+.32,WH+H-.11,wz-(W/2)*facing,cx,cy,sc);
    ctx.beginPath();ctx.arc(pp[0],pp[1],3.2*dpr,0,Math.PI*2);
    ctx.fillStyle=statusColor;ctx.shadowColor=statusColor;ctx.shadowBlur=7;ctx.fill();ctx.shadowBlur=0;

    // Badge + label stored for hit detection
    const topP=iso(wx,WH+H+RH+.2,wz,cx,cy,sc);
    const pct=Math.round(v.endPct);
    const bw=26*dpr,bh=11*dpr;
    ctx.fillStyle='rgba(0,0,0,.72)';ctx.beginPath();ctx.roundRect(topP[0]-bw/2,topP[1]-bh/2,bw,bh,3);ctx.fill();
    ctx.fillStyle=statusColor;ctx.font=`600 ${Math.round(7.5*dpr)}px -apple-system,sans-serif`;
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(pct+'%',topP[0],topP[1]);

    const lp=iso(wx,WH+H+RH+.35,wz,cx,cy,sc);
    ctx.fillStyle='rgba(155,180,205,.6)';ctx.font=`${Math.round(6.5*dpr)}px -apple-system,sans-serif`;
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(v.location||'',lp[0],lp[1]);

    return { hx: topP[0], hy: topP[1], hr: 16*dpr };
  }

  // ── Main draw ────────────────────────────────────────────────────────────────
  let hitAreas = []; // [{vehicleIdx, hx, hy, hr}]

  function drawScene() {
    const W   = canvas.width, H = canvas.height;
    const dpr = window.devicePixelRatio || 1;
    const vehs = window.store ? window.store.getVehicles() : [];
    ctx.clearRect(0, 0, W, H);
    hitAreas = [];

    if (!vehs.length) {
      drawEmptyLot(W, H, dpr);
      return;
    }

    // Assign each vehicle to a lot slot based on its location string
    const assignments = assignVehicles(vehs);

    // Scale to fit the full lot
    const lotW  = lotBounds.maxX - lotBounds.minX + CAR_W;
    const lotDp = lotBounds.maxZ - lotBounds.minZ + CAR_D + LANE_W * 6; // extra for RL
    const fitSc = Math.min(W * 0.92, H * 0.88) / Math.max(lotW, lotDp) * zoomLv * dpr;
    const sc    = fitSc;
    const cx    = W * 0.5;
    const cy    = H * 0.44;

    // Center offset — includes pan
    const offX = -(lotBounds.minX + lotW / 2) + panOffX;
    const offZ = -(lotBounds.minZ + lotDp / 2) + panOffZ;

    const P2 = (x, z) => iso(x + offX, 0, z + offZ, cx, cy, sc);

    // ── Draw lot surface ──────────────────────────────────────────────────────
    // Full asphalt base
    const corners = [
      P2(lotBounds.minX - 1, lotBounds.minZ - 1),
      P2(lotBounds.maxX + 1, lotBounds.minZ - 1),
      P2(lotBounds.maxX + 1, lotBounds.maxZ + LANE_W * 6),
      P2(lotBounds.minX - 1, lotBounds.maxZ + LANE_W * 6),
    ];
    ctx.beginPath(); ctx.moveTo(...corners[0]);
    corners.slice(1).forEach(p => ctx.lineTo(...p)); ctx.closePath();
    ctx.fillStyle = '#1a1f2e'; ctx.fill();

    // Section labels and dividers
    SECTIONS.forEach((secName, secIdx) => {
      const secW   = CARS_PER_ROW * (CAR_W + CAR_GAP);
      const secX   = secIdx * (secW + SEC_GAP) + secW / 2;
      const labelP = iso(secX + offX, 0.001, lotBounds.minZ - 2 + offZ, cx, cy, sc);
      ctx.fillStyle = 'rgba(255,255,255,.22)';
      ctx.font = `600 ${Math.round(9 * dpr)}px -apple-system,sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(secName, labelP[0], labelP[1]);

      // Section divider line
      if (secIdx > 0) {
        const divX = secIdx * (secW + SEC_GAP) - SEC_GAP / 2;
        const la   = iso(divX + offX, 0.001, lotBounds.minZ + offZ, cx, cy, sc);
        const lb   = iso(divX + offX, 0.001, lotBounds.maxZ + LANE_W * 5 + offZ, cx, cy, sc);
        ctx.beginPath(); ctx.moveTo(...la); ctx.lineTo(...lb);
        ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1; ctx.stroke();
      }
    });

    // ── Sort back-to-front (painter's algorithm) ──────────────────────────────
    const selectedIdx = window.lot ? window.lot.getSelectedIdx() : -1;
    const hoveredIdx  = window.lot ? window.lot.getHoveredIdx()  : -1;

    const sorted = assignments.map(a => ({
      ...a,
      depth: (a.slot.wz + offZ) * Math.cos(angY) - (a.slot.wx + offX) * Math.sin(angY),
    })).sort((a, b) => b.depth - a.depth);

    for (const { slot, vehicle: v, vehicleIdx: vi } of sorted) {
      const wx  = slot.wx + offX;
      const wz  = slot.wz + offZ;

      // Spot highlight
      const sp = [
        iso(wx - CAR_W/2*.9, .001, wz - CAR_D/2*.9, cx,cy,sc),
        iso(wx + CAR_W/2*.9, .001, wz - CAR_D/2*.9, cx,cy,sc),
        iso(wx + CAR_W/2*.9, .001, wz + CAR_D/2*.9, cx,cy,sc),
        iso(wx - CAR_W/2*.9, .001, wz + CAR_D/2*.9, cx,cy,sc),
      ];
      ctx.beginPath(); ctx.moveTo(...sp[0]); sp.slice(1).forEach(p=>ctx.lineTo(...p)); ctx.closePath();
      ctx.fillStyle = vi===selectedIdx ? 'rgba(56,139,253,.14)'
                    : vi===hoveredIdx  ? 'rgba(255,255,255,.06)'
                    : 'rgba(255,255,255,.02)';
      ctx.fill();
      ctx.strokeStyle = vi===selectedIdx ? 'rgba(56,139,253,.55)' : 'rgba(255,255,255,.06)';
      ctx.lineWidth   = vi===selectedIdx ? 0.8 : 0.25;
      ctx.stroke();

      // Charging glow
      const sc2 = window.EV_COLORS.getStatusColor(v.startPct, v.endPct);
      if (sc2 === '#22c55e') {
        const gc = iso(wx, .001, wz, cx, cy, sc);
        const gl = ctx.createRadialGradient(gc[0],gc[1],0,gc[0],gc[1],sc*2.5);
        const al = 0.04 + 0.03*Math.sin(gph + vi*0.85);
        gl.addColorStop(0, `rgba(34,197,94,${al})`); gl.addColorStop(1,'rgba(34,197,94,0)');
        ctx.beginPath(); ctx.moveTo(...sp[0]); sp.slice(1).forEach(p=>ctx.lineTo(...p)); ctx.closePath();
        ctx.fillStyle = gl; ctx.fill();
      }

      const hit = drawBoltEUV(v, wx, wz, cx, cy, sc, slot.facing);
      hitAreas.push({ vehicleIdx: vi, ...hit });
    }

    // Staging area label if any overflow
    const hasOverflow = sorted.some(a => a.slot.section === 'STAGING');
    if (hasOverflow) {
      const stagP = iso(offX, 0.001, lotBounds.maxZ + LANE_W * 3.5 + offZ, cx, cy, sc);
      ctx.fillStyle = 'rgba(245,158,11,.5)';
      ctx.font = `${Math.round(8*dpr)}px -apple-system,sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('⚠ Unmatched location — check spot ID', stagP[0], stagP[1]);
    }
  }

  function drawEmptyLot(W, H, dpr) {
    const cx = W*.5, cy = H*.46, sc = Math.min(W,H)*.012*dpr;
    const corners = [
      iso(-60,0,-20,cx,cy,sc), iso(60,0,-20,cx,cy,sc),
      iso(60,0,80,cx,cy,sc),   iso(-60,0,80,cx,cy,sc),
    ];
    ctx.beginPath(); ctx.moveTo(...corners[0]);
    corners.slice(1).forEach(p=>ctx.lineTo(...p)); ctx.closePath();
    ctx.fillStyle='#1a1f2e'; ctx.fill();
    SECTIONS.forEach((s,i)=>{
      const x = -52 + i*14.5;
      const lp = iso(x,0.001,-18,cx,cy,sc);
      ctx.fillStyle='rgba(255,255,255,.18)';
      ctx.font=`600 ${Math.round(8*dpr)}px -apple-system,sans-serif`;
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(s,lp[0],lp[1]);
    });
    const mp = iso(0,0,30,cx,cy,sc);
    ctx.fillStyle='rgba(255,255,255,.12)';
    ctx.font=`${Math.round(10*dpr)}px -apple-system,sans-serif`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('Add vehicles to populate the lot',mp[0],mp[1]);
  }

  // ── Animation loop ────────────────────────────────────────────────────────────
  function loop() { gph += 0.022; drawScene(); raf = requestAnimationFrame(loop); }

  // ── Resize ────────────────────────────────────────────────────────────────────
  function resize() {
    const dpr  = window.devicePixelRatio||1;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width  = rect.width  + 'px';
    canvas.style.height = rect.height + 'px';
    drawScene();
  }
  window.addEventListener('resize', resize);

  // ── Interaction ───────────────────────────────────────────────────────────────
  // Left drag = rotate | Shift+drag or middle-button drag = pan
  canvas.addEventListener('mousedown', e => {
    if (e.shiftKey || e.button === 1) {
      panActive  = true;
      panStartX  = e.clientX;
      panStartY  = e.clientY;
      canvas.style.cursor = 'move';
    } else {
      dragActive    = true;
      dragStartX    = e.clientX;
      dragStartAngY = angY;
      canvas.style.cursor = 'grabbing';
    }
  });

  window.addEventListener('mousemove', e => {
    if (panActive) {
      // Convert screen delta to world-space pan
      const dpr = window.devicePixelRatio||1;
      const rect = canvas.getBoundingClientRect();
      const sc = Math.min(canvas.width * 0.92, canvas.height * 0.88) /
                 Math.max(lotBounds.maxX - lotBounds.minX, lotBounds.maxZ - lotBounds.minZ) * zoomLv * dpr;
      const dx = (e.clientX - panStartX) / sc;
      const dz = (e.clientY - panStartY) / (sc * 0.42);
      panOffX += dx * Math.cos(angY) - dz * Math.sin(angY);
      panOffZ += dx * Math.sin(angY) + dz * Math.cos(angY);
      panStartX = e.clientX;
      panStartY = e.clientY;
      return;
    }
    if (dragActive) angY = dragStartAngY + (e.clientX - dragStartX) / 130;

    // Hover detection
    const rect = canvas.getBoundingClientRect();
    const dpr  = window.devicePixelRatio||1;
    const mx   = (e.clientX-rect.left)*dpr, my=(e.clientY-rect.top)*dpr;
    let found  = -1;
    for(const h of hitAreas){const dx=mx-h.hx,dy=my-h.hy;if(dx*dx+dy*dy<h.hr*h.hr*5){found=h.vehicleIdx;break;}}
    const prev = window.lot?window.lot.getHoveredIdx():-1;
    if(found!==prev){if(window.lot)window.lot.setHoveredIdx(found);canvas.style.cursor=found>=0?'pointer':(dragActive||panActive?'grabbing':'grab');}
  });

  window.addEventListener('mouseup', e => {
    if (panActive) { panActive = false; canvas.style.cursor = 'grab'; return; }
    if (!dragActive) return;
    if (Math.abs(e.clientX-dragStartX)<6) {
      const rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
      const mx=(e.clientX-rect.left)*dpr,my=(e.clientY-rect.top)*dpr;
      for(const h of hitAreas){const dx=mx-h.hx,dy=my-h.hy;if(dx*dx+dy*dy<h.hr*h.hr*8){if(window.lot)window.lot.selectVehicle(h.vehicleIdx);break;}}
    }
    dragActive=false; canvas.style.cursor='grab'; stopRot();
  });

  // Touch: one finger = rotate, two fingers = pan
  let touchStartX=0, touchStartY=0, touch2StartX=0, touch2StartY=0, isPinch=false;
  canvas.addEventListener('touchstart',e=>{
    if(e.touches.length===2){
      isPinch=true;
      touch2StartX=(e.touches[0].clientX+e.touches[1].clientX)/2;
      touch2StartY=(e.touches[0].clientY+e.touches[1].clientY)/2;
    } else {
      isPinch=false;
      touchStartX=e.touches[0].clientX;
      dragStartAngY=angY;
    }
  },{passive:true});
  canvas.addEventListener('touchmove',e=>{
    if(isPinch&&e.touches.length===2){
      const cx2=(e.touches[0].clientX+e.touches[1].clientX)/2;
      const cy2=(e.touches[0].clientY+e.touches[1].clientY)/2;
      const dpr=window.devicePixelRatio||1;
      const sc=Math.min(canvas.width*.92,canvas.height*.88)/Math.max(lotBounds.maxX-lotBounds.minX,lotBounds.maxZ-lotBounds.minZ)*zoomLv*dpr;
      panOffX+=(cx2-touch2StartX)/sc*Math.cos(angY);
      panOffZ+=(cy2-touch2StartY)/(sc*.42)*Math.cos(angY);
      touch2StartX=cx2; touch2StartY=cy2;
    } else if(!isPinch){
      angY=dragStartAngY+(e.touches[0].clientX-touchStartX)/130;
    }
  },{passive:true});

  canvas.addEventListener('wheel',e=>{e.preventDefault();zoomLv=Math.max(.2,Math.min(6,zoomLv-e.deltaY*.0006));},{passive:false});

  function startRot(dir){stopRot();rotInterval=setInterval(()=>{angY+=dir*.04;},30);}
  function stopRot(){if(rotInterval){clearInterval(rotInterval);rotInterval=null;}}

  document.getElementById('rot-left').addEventListener('mousedown',()=>startRot(-1));
  document.getElementById('rot-right').addEventListener('mousedown',()=>startRot(1));
  document.getElementById('rot-left').addEventListener('touchstart',()=>startRot(-1),{passive:true});
  document.getElementById('rot-right').addEventListener('touchstart',()=>startRot(1),{passive:true});
  window.addEventListener('mouseup',stopRot);
  window.addEventListener('touchend',stopRot);

  canvas.style.cursor='grab';

  // ── Public API ────────────────────────────────────────────────────────────────
  window.renderer = {
    resize,
    start() { if(!raf){resize();loop();} },
    redraw: drawScene,
  };

  window.lotZoom      = d => canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:d<0?-120:120,bubbles:true}));
  window.lotResetView = () => { angY=0.3; zoomLv=1.0; panOffX=0; panOffZ=0; };

  resize();
})();
