/**
 * renderer.js
 * Isometric 3D renderer — 200 E. Marley Rd. lot layout
 *
 * LOT STRUCTURE (west → east):
 *   Sections: 8T, 7T, 6T, 5T, 4T, 3T, 2T, 1T
 *   Sections 2T–8T: 15 cars wide, 30 rows each
 *   Section 1T:     10 cars wide, 31 rows, then [empty gap], then RL-1, RL-2, [LANE], RL-3
 *   Row pattern:    row, row, [LANE], row, row, [LANE] ...
 *   Rows 1, 18, 19 split into A & B sub-rows
 *   Row numbering:  1 = south entrance, 31 = north end (rows render south→north)
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
  let angY          = 0.3;
  let zoomLv        = window.innerWidth < 480 ? 2.5 : 1.0;
  let gph           = 0;
  let raf           = null;
  let dragActive    = false;
  let dragStartX    = 0;
  let dragStartAngY = 0;
  let panActive     = false;
  let panStartX     = 0;
  let panStartY     = 0;
  let panOffX       = 0;
  let panOffZ       = 0;
  let isPanMode     = false;
  let rotInterval   = null;

  // ── Lot constants ────────────────────────────────────────────────────────────
  const SECTIONS      = ['8T','7T','6T','5T','4T','3T','2T','1T']; // west→east
  const RL_ROWS       = ['RL-1','RL-2','RL-3'];   // 1T extension rows, north of 1T-31
  const CARS_PER_ROW  = 15;   // sections 2T–8T
  const CARS_1T       = 10;   // section 1T (and its RL extension)
  const TOTAL_ROWS    = 30;   // sections 2T–8T
  const TOTAL_ROWS_1T = 31;   // section 1T
  const AB_ROWS       = [1, 18, 19]; // rows that split into A and B sub-rows

  // Spacing units (world space)
  // Z increases going north. Row 1 is at the south (high Z), row 31 at north (low Z).
  const CAR_W   = 1.6;   // car width (along row)
  const CAR_D   = 2.8;   // car depth (nose to tail)
  const CAR_GAP = 0.25;  // gap between cars in same row
  const ROW_GAP = 0.5;   // gap between rows (nose-to-nose)
  const LANE_W  = 3.2;   // drive lane width
  const SEC_GAP = 4.0;   // gap between sections (cross-lane)

  // ── Helper: section X offset ─────────────────────────────────────────────────
  // Accumulates the widths of all sections west of secIdx to get the X start.
  function getSectionOffX(secIdx) {
    let offX = 0;
    for (let i = 0; i < secIdx; i++) {
      const prevCars = SECTIONS[i] === '1T' ? CARS_1T : CARS_PER_ROW;
      offX += prevCars * (CAR_W + CAR_GAP) + SEC_GAP;
    }
    return offX;
  }

  // ── Build ordered row list (south → north = row 1 first, highest row last) ──
  // Returns entries in south-to-north order so that Z accumulates northward.
  // Each entry: { type:'row'|'lane'|'gap', label, pairPos }
  function buildRowList(rowCount) {
    const rows = [];
    let pairPos = 0;

    // Rows are numbered 1 (south) → rowCount (north).
    // We render from south to north, so we iterate 1 → rowCount.
    for (let r = 1; r <= rowCount; r++) {
      if (AB_ROWS.includes(r)) {
        // A sub-row (south half of this numbered row)
        rows.push({ type: 'row', label: `${r}A`, pairPos });
        pairPos = (pairPos + 1) % 2;
        if (pairPos === 0) rows.push({ type: 'lane' });
        // B sub-row (north half of this numbered row)
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

  // ── Build RL row list from RL_ROWS constant ───────────────────────────────────
  // Pattern: RL-1, RL-2, [LANE], RL-3
  // RL_ROWS = ['RL-1','RL-2','RL-3'] — lane is inserted after every 2nd row
  function buildRLRowList() {
    const rows = [];
    let pairPos = 0;
    RL_ROWS.forEach(label => {
      rows.push({ type: 'row', label, pairPos });
      pairPos = (pairPos + 1) % 2;
      if (pairPos === 0) rows.push({ type: 'lane' });
    });
    return rows;
  }

  // ── Build full lot grid ───────────────────────────────────────────────────────
  function buildLotGrid() {
    const slots = [];

    SECTIONS.forEach((secName, secIdx) => {
      const carsThisSec = secName === '1T' ? CARS_1T : CARS_PER_ROW;
      const rowsThisSec = secName === '1T' ? TOTAL_ROWS_1T : TOTAL_ROWS;
      const secOffX     = getSectionOffX(secIdx);

      // Build main row list for this section (south → north)
      const rowList = buildRowList(rowsThisSec);

      // Z starts at 0 for the southernmost row and increases northward
      let zOff = 0;

      rowList.forEach(rowEntry => {
        if (rowEntry.type === 'lane') { zOff += LANE_W; return; }
        if (rowEntry.type === 'gap')  { zOff += LANE_W * 2; return; }

        const facing = rowEntry.pairPos === 0 ? 1 : -1;
        for (let c = 0; c < carsThisSec; c++) {
          slots.push({
            section:  secName,
            rowLabel: rowEntry.label,
            carIdx:   c + 1,
            spotId:   `${secName}-${rowEntry.label}`,
            wx:       secOffX + c * (CAR_W + CAR_GAP),
            wz:       zOff,
            facing,
          });
        }
        zOff += CAR_D + ROW_GAP;
      });

      // ── RL extension — only for 1T, north of 1T-31 ────────────────────────
      if (secName === '1T') {
        // One empty/unused row gap between 1T-31 and RL-1
        zOff += (CAR_D + ROW_GAP) + LANE_W; // one unused row + lane space

        const rlList = buildRLRowList();
        rlList.forEach(rowEntry => {
          if (rowEntry.type === 'lane') { zOff += LANE_W; return; }

          const facing = rowEntry.pairPos === 0 ? 1 : -1;
          for (let c = 0; c < CARS_1T; c++) {
            slots.push({
              section:  '1RL',
              rowLabel: rowEntry.label,
              carIdx:   c + 1,
              spotId:   `1RL-${rowEntry.label}`,
              wx:       secOffX + c * (CAR_W + CAR_GAP),
              wz:       zOff,
              facing,
            });
          }
          zOff += CAR_D + ROW_GAP;
        });
      }
    });

    return slots;
  }

  // ── Slot index ────────────────────────────────────────────────────────────────
  let lotSlots     = [];
  let slotBySpotId = {}; // spotId → [slotIndex, ...] (10 per row for 1T/1RL, 15 for others)
  let lotBounds    = { minX:0, maxX:0, minZ:0, maxZ:0 };

  function initLot() {
    lotSlots = buildLotGrid();
    slotBySpotId = {};
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    lotSlots.forEach((s, i) => {
      if (!slotBySpotId[s.spotId]) slotBySpotId[s.spotId] = [];
      slotBySpotId[s.spotId].push(i);
      if (s.wx < minX) minX = s.wx;
      if (s.wx > maxX) maxX = s.wx;
      if (s.wz < minZ) minZ = s.wz;
      if (s.wz > maxZ) maxZ = s.wz;
    });
    lotBounds = { minX, maxX, minZ, maxZ };
  }

  initLot();

  // ── Location parser ───────────────────────────────────────────────────────────
  function parseLocation(loc) {
    if (!loc) return null;
    let s = String(loc).trim().toUpperCase().replace(/\s+/g, '');
    if (/^\d+T-\S+/.test(s) || /^\d+RL-\S+/.test(s)) return s;
    const noDash = s.match(/^(\d+T|1RL)(\S+)$/);
    if (noDash) return noDash[1] + '-' + noDash[2];
    return null;
  }

  function getValidSpotIds() {
    return Object.keys(slotBySpotId);
  }

  // ── Vehicle assignment ────────────────────────────────────────────────────────
  function assignVehicles(vehs) {
    const assigned      = [];
    const usedSlots     = new Set();
    const overflow      = [];
    const unmatchedLocs = new Set();

    vehs.forEach((v, vi) => {
      const locKey = parseLocation(v.location);
      if (locKey && slotBySpotId[locKey]) {
        const available = slotBySpotId[locKey].find(si => !usedSlots.has(si));
        if (available !== undefined) {
          usedSlots.add(available);
          assigned.push({ slot: lotSlots[available], vehicle: v, vehicleIdx: vi });
          return;
        }
      }
      if (v.location) unmatchedLocs.add(v.location);
      overflow.push({ vehicle: v, vehicleIdx: vi });
    });

    if (unmatchedLocs.size > 0) {
      console.warn('EV Lot: unmatched locations:', [...unmatchedLocs].slice(0, 10));
      console.info('Valid spot IDs sample:', getValidSpotIds().slice(0, 10));
    }

    overflow.forEach((o, oi) => {
      const cols = Math.ceil(Math.sqrt(overflow.length * 2));
      const oRow = Math.floor(oi / cols);
      const oCol = oi % cols;
      assigned.push({
        slot: {
          wx: lotBounds.minX + oCol * (CAR_W + CAR_GAP + 0.5),
          wz: lotBounds.maxZ + LANE_W * 3 + oRow * (CAR_D + ROW_GAP + 0.5),
          facing: 1, section: 'STAGING', rowLabel: '', carIdx: oi + 1, spotId: '',
        },
        vehicle: o.vehicle,
        vehicleIdx: o.vehicleIdx,
      });
    });

    return assigned;
  }

  // ── Isometric projection ──────────────────────────────────────────────────────
  function iso(x, y, z, cx, cy, sc) {
    const cosA = Math.cos(angY);
    const sinA = Math.sin(angY);
    const rx   = x * cosA + z * sinA;
    const rz   = -x * sinA + z * cosA;
    const TILT = 0.42;
    return [cx + rx * sc, cy + rz * sc * TILT - y * sc];
  }

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
    for (let i=1;i<pts.length;i++) ctx.lineTo(...pts[i]);
    ctx.closePath(); ctx.fillStyle=fill; ctx.fill();
    if (strokeC) { ctx.strokeStyle=strokeC; ctx.lineWidth=sw; ctx.stroke(); }
  }

  // ── 2027 Bolt EUV drawing ─────────────────────────────────────────────────────
  function drawBoltEUV(v, wx, wz, cx, cy, sc, facing) {
    const P   = (x,y,z) => iso(wx+x, y, wz+z*facing, cx, cy, sc);
    const pal = window.EV_COLORS.getPalette(v.color);
    const dpr = window.devicePixelRatio || 1;

    // ── Proportions (world units) ─────────────────────────────────────────────
    const L    = 1.72;   // length (longer than before — Bolt EUV is ~4.3m)
    const W    = 0.78;   // width
    const WH   = 0.10;   // wheel hub height (ground clearance)
    const BH   = 0.22;   // body side height (bottom of greenhouse)
    const RH   = 0.52;   // full roof height above body top
    const CLAD = 0.06;   // lower cladding strip height
    const ri   = 0.04;   // roof inset from body edges

    // Key X positions along body length
    const xFront  =  L / 2;         // front bumper face
    const xFHood  =  L / 2 - 0.18;  // hood start / A-pillar base
    const xARoof  =  L / 2 - 0.32;  // A-pillar top / front windscreen top
    const xMRoof  =  0.08;          // roof peak (slightly forward of center)
    const xCPillar= -L / 2 + 0.28;  // C-pillar top
    const xRHatch = -L / 2 + 0.10;  // rear hatch top (fastback kick)
    const xRear   = -L / 2;         // rear bumper face

    // Y heights
    const yGround = WH;
    const yBody   = WH + BH;
    const yRoof   = WH + BH + RH;
    const yHood   = WH + BH + 0.06; // hood surface (slight rise)
    const yARoof  = WH + BH + RH * 0.88;
    const yMRoof  = WH + BH + RH;
    const yCRoof  = WH + BH + RH * 0.72;
    const yHatch  = WH + BH + RH * 0.28;

    // ── Shadow ────────────────────────────────────────────────────────────────
    const shd = iso(wx, 0, wz, cx, cy, sc);
    ctx.beginPath();
    ctx.ellipse(shd[0], shd[1] + 1.5*dpr, sc*L*0.52*dpr, sc*W*0.16*dpr, 0, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(0,0,0,.38)'; ctx.fill();

    // ── Wheels ────────────────────────────────────────────────────────────────
    const wheelPositions = [
      [ L/2 - 0.28,  W/2 + 0.03],   // front right
      [ L/2 - 0.28, -W/2 - 0.03],   // front left
      [-L/2 + 0.28,  W/2 + 0.03],   // rear right
      [-L/2 + 0.28, -W/2 - 0.03],   // rear left
    ];
    wheelPositions.forEach(([wx2, wz2]) => {
      const wGround = iso(wx+wx2, WH*0.4, wz+wz2*facing, cx, cy, sc);
      const wHub    = iso(wx+wx2, WH,     wz+wz2*facing, cx, cy, sc);
      const wr      = 0.145 * sc * dpr;

      // Tyre
      ctx.beginPath(); ctx.arc(wGround[0], wGround[1], wr*1.08, 0, Math.PI*2);
      ctx.fillStyle = '#111'; ctx.fill();
      // Wheel arch highlight
      ctx.beginPath(); ctx.arc(wGround[0], wGround[1], wr*1.15, Math.PI, Math.PI*2);
      ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1.2*dpr; ctx.stroke();
      // Rim base
      ctx.beginPath(); ctx.arc(wHub[0], wHub[1], wr*0.78, 0, Math.PI*2);
      ctx.fillStyle = pal.rim; ctx.fill();
      // Spoke pattern (5 spokes)
      for (let s=0; s<5; s++) {
        const a = s / 5 * Math.PI * 2 - 0.3;
        ctx.beginPath();
        ctx.moveTo(wHub[0] + Math.cos(a)*wr*0.18, wHub[1] + Math.sin(a)*wr*0.18);
        ctx.lineTo(wHub[0] + Math.cos(a)*wr*0.65, wHub[1] + Math.sin(a)*wr*0.65);
        ctx.strokeStyle = 'rgba(160,160,170,.9)'; ctx.lineWidth = 2.2*dpr; ctx.stroke();
      }
      // Centre cap
      ctx.beginPath(); ctx.arc(wHub[0], wHub[1], wr*0.18, 0, Math.PI*2);
      ctx.fillStyle = '#888'; ctx.fill();
      ctx.beginPath(); ctx.arc(wHub[0], wHub[1], wr*0.08, 0, Math.PI*2);
      ctx.fillStyle = '#555'; ctx.fill();
      // Brake rotor hint
      ctx.beginPath(); ctx.arc(wGround[0], wGround[1], wr*1.1, Math.PI*0.1, Math.PI*0.9);
      ctx.strokeStyle = '#0a0a0a'; ctx.lineWidth = 3.5*dpr; ctx.stroke();
    });

    // ── Lower body cladding ───────────────────────────────────────────────────
    const cladY0 = WH, cladY1 = WH + CLAD;
    poly([
      P(xRear,  cladY0, -W/2), P(xFront, cladY0, -W/2),
      P(xFront, cladY1, -W/2), P(xRear,  cladY1, -W/2),
    ], '#222228', 'rgba(0,0,0,.4)');
    poly([
      P(xRear,  cladY0,  W/2), P(xFront, cladY0,  W/2),
      P(xFront, cladY1,  W/2), P(xRear,  cladY1,  W/2),
    ], '#1e1e24', 'rgba(0,0,0,.35)');
    // Rear cladding
    poly([
      P(xRear, cladY0, -W/2), P(xRear, cladY0,  W/2),
      P(xRear, cladY1,  W/2), P(xRear, cladY1, -W/2),
    ], '#1a1a20', 'rgba(0,0,0,.3)');

    // ── Body sides ────────────────────────────────────────────────────────────
    // Left side (driver) — facing camera at default angle
    poly([
      P(xRear,   cladY1,  -W/2), P(xFront,  cladY1,  -W/2),
      P(xFHood,  yBody,   -W/2), P(xRear,   yBody,   -W/2),
    ], pal.body, 'rgba(0,0,0,.2)');
    // Right side
    poly([
      P(xRear,   cladY1,   W/2), P(xFront,  cladY1,   W/2),
      P(xFHood,  yBody,    W/2), P(xRear,   yBody,    W/2),
    ], dk(pal.body, 28), 'rgba(0,0,0,.2)');

    // ── Hood ─────────────────────────────────────────────────────────────────
    poly([
      P(xFront, yGround+CLAD, -W/2), P(xFront, yGround+CLAD,  W/2),
      P(xFHood, yHood,         W/2), P(xFHood, yHood,        -W/2),
    ], lt(pal.body, 12), 'rgba(0,0,0,.18)');

    // Hood top panel
    poly([
      P(xFHood, yHood,  -W/2+ri), P(xFHood, yHood,   W/2-ri),
      P(xARoof, yARoof,  W/2-ri), P(xARoof, yARoof, -W/2+ri),
    ], lt(pal.body, 8), 'rgba(0,0,0,.12)');

    // ── Windscreen (front glass) ──────────────────────────────────────────────
    poly([
      P(xFHood, yBody,   -W/2+ri+0.02), P(xFHood, yBody,    W/2-ri-0.02),
      P(xARoof, yARoof,   W/2-ri-0.02), P(xARoof, yARoof,  -W/2+ri+0.02),
    ], pal.glass, 'rgba(180,220,255,.25)');

    // ── Roof panel ────────────────────────────────────────────────────────────
    poly([
      P(xARoof, yARoof, -W/2+ri), P(xARoof, yARoof,  W/2-ri),
      P(xMRoof, yMRoof,  W/2-ri), P(xMRoof, yMRoof, -W/2+ri),
    ], lt(pal.body, 18), 'rgba(0,0,0,.1)');
    poly([
      P(xMRoof,   yMRoof,  -W/2+ri), P(xMRoof,   yMRoof,   W/2-ri),
      P(xCPillar, yCRoof,   W/2-ri), P(xCPillar, yCRoof,  -W/2+ri),
    ], lt(pal.body, 10), 'rgba(0,0,0,.14)');

    // ── Rear hatch glass (fastback slope) ─────────────────────────────────────
    poly([
      P(xCPillar, yCRoof,  -W/2+ri+0.02), P(xCPillar, yCRoof,   W/2-ri-0.02),
      P(xRHatch,  yHatch,   W/2-ri-0.02), P(xRHatch,  yHatch,  -W/2+ri+0.02),
    ], dk(pal.glass, 15), 'rgba(120,180,230,.2)');

    // Rear hatch panel below glass
    poly([
      P(xRHatch, yHatch,  -W/2+ri), P(xRHatch, yHatch,   W/2-ri),
      P(xRear,   yBody,    W/2),    P(xRear,   yBody,   -W/2),
    ], dk(pal.body, 18), 'rgba(0,0,0,.22)');

    // ── Rear panel ────────────────────────────────────────────────────────────
    poly([
      P(xRear, cladY1, -W/2), P(xRear, cladY1,  W/2),
      P(xRear, yBody,   W/2), P(xRear, yBody,  -W/2),
    ], dk(pal.body, 35), 'rgba(0,0,0,.4)');

    // ── Front fascia ──────────────────────────────────────────────────────────
    poly([
      P(xFront, yGround+CLAD, -W/2), P(xFront, yGround+CLAD,  W/2),
      P(xFront, yBody,         W/2), P(xFront, yBody,        -W/2),
    ], dk(pal.body, 22), 'rgba(0,0,0,.3)');

    // Lower front bumper intake (dark)
    const intakeY0 = WH + CLAD;
    const intakeY1 = WH + CLAD + 0.07;
    poly([
      P(xFront+0.01, intakeY0, -W/2+0.08), P(xFront+0.01, intakeY0,  W/2-0.08),
      P(xFront+0.01, intakeY1,  W/2-0.12), P(xFront+0.01, intakeY1, -W/2+0.12),
    ], '#0d0d12', 'rgba(0,0,0,.6)', 0.3);

    // Charging port door (flush panel, front left quarter)
    poly([
      P(xFront-0.08, yBody-0.04, -W/2-0.01),
      P(xFront-0.04, yBody-0.04, -W/2-0.01),
      P(xFront-0.04, yBody-0.12, -W/2-0.01),
      P(xFront-0.08, yBody-0.12, -W/2-0.01),
    ], dk(pal.body, 8), 'rgba(100,160,220,.35)', 0.5);

    // ── DRL / headlight strip (full-width LED bar) ────────────────────────────
    const hlY = yBody - 0.03;
    const hl1 = iso(wx + xFront + 0.01, hlY, wz - (W/2-0.04)*facing, cx, cy, sc);
    const hl2 = iso(wx + xFront + 0.01, hlY, wz + (W/2-0.04)*facing, cx, cy, sc);
    // Outer glow
    ctx.beginPath(); ctx.moveTo(hl1[0], hl1[1]); ctx.lineTo(hl2[0], hl2[1]);
    ctx.strokeStyle = 'rgba(210,235,255,.25)'; ctx.lineWidth = 4*dpr; ctx.stroke();
    // Inner bright strip
    ctx.beginPath(); ctx.moveTo(hl1[0], hl1[1]); ctx.lineTo(hl2[0], hl2[1]);
    ctx.strokeStyle = 'rgba(230,245,255,.9)'; ctx.lineWidth = 1.4*dpr; ctx.stroke();
    // Individual LED dots
    const numLEDs = 7;
    for (let i=0; i<numLEDs; i++) {
      const t    = (i / (numLEDs-1)) * 2 - 1;          // -1 to +1
      const lz   = wz + t * (W/2 - 0.06) * facing;
      const ledP = iso(wx + xFront + 0.01, hlY, lz, cx, cy, sc);
      ctx.beginPath(); ctx.arc(ledP[0], ledP[1], 1.4*dpr, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(245,250,255,.95)'; ctx.fill();
    }

    // ── Tail light bar (full-width LED) ───────────────────────────────────────
    const tlY  = yBody - 0.04;
    const tl1  = iso(wx + xRear - 0.01, tlY, wz - (W/2-0.03)*facing, cx, cy, sc);
    const tl2  = iso(wx + xRear - 0.01, tlY, wz + (W/2-0.03)*facing, cx, cy, sc);
    ctx.beginPath(); ctx.moveTo(...tl1); ctx.lineTo(...tl2);
    ctx.strokeStyle = 'rgba(255,20,20,.9)'; ctx.lineWidth = 2.2*dpr; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(...tl1); ctx.lineTo(...tl2);
    ctx.strokeStyle = 'rgba(255,80,80,.3)'; ctx.lineWidth = 5*dpr; ctx.stroke();

    // ── Side windows ─────────────────────────────────────────────────────────
    // Front door window (left/visible side)
    poly([
      P(xFHood+0.04, yBody+0.01, -W/2-0.01),
      P(xMRoof-0.05, yBody+0.01, -W/2-0.01),
      P(xMRoof-0.05, yCRoof-0.08,-W/2-0.01),
      P(xARoof+0.02, yARoof-0.04,-W/2-0.01),
    ], 'rgba(30,70,110,.62)', 'rgba(120,180,240,.2)', 0.4);
    // Rear door window
    poly([
      P(xMRoof-0.04, yBody+0.01, -W/2-0.01),
      P(xCPillar+0.04,yBody+0.01,-W/2-0.01),
      P(xCPillar+0.04,yCRoof-0.06,-W/2-0.01),
      P(xMRoof-0.04, yCRoof-0.08,-W/2-0.01),
    ], 'rgba(25,60,100,.58)', 'rgba(110,170,230,.18)', 0.4);

    // ── Door lines (panel gaps) ───────────────────────────────────────────────
    const doorX = xMRoof - 0.04;
    const dgTop = iso(wx+doorX, yBody+0.01, wz-W/2*facing, cx, cy, sc);
    const dgBot = iso(wx+doorX, WH+CLAD,   wz-W/2*facing, cx, cy, sc);
    ctx.beginPath(); ctx.moveTo(...dgTop); ctx.lineTo(...dgBot);
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.8*dpr; ctx.stroke();

    // ── Roof rails ────────────────────────────────────────────────────────────
    const rr1 = iso(wx+xARoof, yMRoof+0.025, wz-(W/2-ri-0.02)*facing, cx, cy, sc);
    const rr2 = iso(wx+xCPillar, yCRoof+0.015, wz-(W/2-ri-0.02)*facing, cx, cy, sc);
    ctx.beginPath(); ctx.moveTo(...rr1); ctx.lineTo(...rr2);
    ctx.strokeStyle = 'rgba(90,90,100,.8)'; ctx.lineWidth = 1.4*dpr; ctx.stroke();

    // ── Antenna (rear roof) ───────────────────────────────────────────────────
    const antBase = iso(wx+xCPillar+0.04, yMRoof,      wz, cx, cy, sc);
    const antTip  = iso(wx+xCPillar+0.04, yMRoof+0.12, wz, cx, cy, sc);
    ctx.beginPath(); ctx.moveTo(...antBase); ctx.lineTo(...antTip);
    ctx.strokeStyle = 'rgba(40,40,45,.9)'; ctx.lineWidth = 1.8*dpr; ctx.stroke();

    // ── Charge port status glow ───────────────────────────────────────────────
    const statusColor = window.EV_COLORS.getStatusColor(v.startPct, v.endPct);
    const cpP = iso(wx + xFront - 0.06, yBody - 0.08, wz - (W/2)*facing, cx, cy, sc);
    ctx.beginPath(); ctx.arc(cpP[0], cpP[1], 3.5*dpr, 0, Math.PI*2);
    ctx.fillStyle = statusColor;
    ctx.shadowColor = statusColor; ctx.shadowBlur = 9;
    ctx.fill(); ctx.shadowBlur = 0;

    // ── SOC badge ─────────────────────────────────────────────────────────────
    const topP = iso(wx, yMRoof + 0.22, wz, cx, cy, sc);
    const pct  = Math.round(v.endPct);
    const bw=28*dpr, bh=12*dpr;
    ctx.fillStyle = 'rgba(0,0,0,.75)';
    ctx.beginPath(); ctx.roundRect(topP[0]-bw/2, topP[1]-bh/2, bw, bh, 3); ctx.fill();
    ctx.fillStyle = statusColor;
    ctx.font = `600 ${Math.round(7.5*dpr)}px -apple-system,sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(pct + '%', topP[0], topP[1]);

    // ── Location label ────────────────────────────────────────────────────────
    const lp = iso(wx, yMRoof + 0.38, wz, cx, cy, sc);
    ctx.fillStyle = 'rgba(155,180,205,.65)';
    ctx.font = `${Math.round(6.5*dpr)}px -apple-system,sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(v.location || '', lp[0], lp[1]);

    return { hx: topP[0], hy: topP[1], hr: 18*dpr };
  }

  // ── Main draw ─────────────────────────────────────────────────────────────────
  let hitAreas = [];

  function drawScene() {
    const W   = canvas.width, H = canvas.height;
    const dpr = window.devicePixelRatio || 1;
    const vehs = window.store ? window.store.getVehicles() : [];
    ctx.clearRect(0, 0, W, H);
    hitAreas = [];

    if (!vehs.length) { drawEmptyLot(W, H, dpr); return; }

    const assignments = assignVehicles(vehs);

    const lotW  = lotBounds.maxX - lotBounds.minX + CAR_W;
    const lotDp = lotBounds.maxZ - lotBounds.minZ + CAR_D + LANE_W * 6;
    const sc    = Math.min(W * 0.92, H * 0.88) / Math.max(lotW, lotDp) * zoomLv * dpr;
    const cx    = W * 0.5;
    const cy    = H * 0.44;

    const offX = -(lotBounds.minX + lotW / 2) + panOffX;
    const offZ = -(lotBounds.minZ + lotDp / 2) + panOffZ;

    const P2 = (x, z) => iso(x + offX, 0, z + offZ, cx, cy, sc);

    // Asphalt base
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
      const carsThisSec = secName === '1T' ? CARS_1T : CARS_PER_ROW;
      const secOffX     = getSectionOffX(secIdx);
      const secW        = carsThisSec * (CAR_W + CAR_GAP);
      const labelP      = iso(secOffX + secW / 2 + offX, 0.001, lotBounds.minZ - 2 + offZ, cx, cy, sc);

      ctx.fillStyle = 'rgba(255,255,255,.22)';
      ctx.font = `600 ${Math.round(9 * dpr)}px -apple-system,sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(secName, labelP[0], labelP[1]);

      if (secIdx > 0) {
        const divX = secOffX - SEC_GAP / 2;
        const la   = iso(divX + offX, 0.001, lotBounds.minZ + offZ, cx, cy, sc);
        const lb   = iso(divX + offX, 0.001, lotBounds.maxZ + LANE_W * 5 + offZ, cx, cy, sc);
        ctx.beginPath(); ctx.moveTo(...la); ctx.lineTo(...lb);
        ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1; ctx.stroke();
      }
    });

    // Sort back-to-front (painter's algorithm)
    const selectedIdx = window.lot ? window.lot.getSelectedIdx() : -1;
    const hoveredIdx  = window.lot ? window.lot.getHoveredIdx()  : -1;

    const sorted = assignments.map(a => ({
      ...a,
      depth: (a.slot.wz + offZ) * Math.cos(angY) - (a.slot.wx + offX) * Math.sin(angY),
    })).sort((a, b) => b.depth - a.depth);

    for (const { slot, vehicle: v, vehicleIdx: vi } of sorted) {
      const wx = slot.wx + offX;
      const wz = slot.wz + offZ;

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
  function getPanSc() {
    const dpr  = window.devicePixelRatio||1;
    const lotW = lotBounds.maxX - lotBounds.minX;
    const lotD = lotBounds.maxZ - lotBounds.minZ;
    return Math.min(canvas.width * 0.92, canvas.height * 0.88) / Math.max(lotW, lotD) * zoomLv * dpr;
  }

  function applyPanDelta(dx, dy) {
    const sc = getPanSc();
    const wx = dx / sc;
    const wz = dy / (sc * 0.42);
    panOffX += wx * Math.cos(angY) - wz * Math.sin(angY);
    panOffZ += wx * Math.sin(angY) + wz * Math.cos(angY);
  }

  canvas.addEventListener('mousedown', e => {
    if (isPanMode || e.button === 1) {
      panActive = true; panStartX = e.clientX; panStartY = e.clientY;
      canvas.style.cursor = 'move';
    } else {
      dragActive = true; dragStartX = e.clientX; dragStartAngY = angY;
      canvas.style.cursor = 'grabbing';
    }
  });

  window.addEventListener('mousemove', e => {
    if (panActive) {
      applyPanDelta(e.clientX - panStartX, e.clientY - panStartY);
      panStartX = e.clientX; panStartY = e.clientY; return;
    }
    if (dragActive) angY = dragStartAngY + (e.clientX - dragStartX) / 130;

    const rect = canvas.getBoundingClientRect();
    const dpr  = window.devicePixelRatio||1;
    const mx   = (e.clientX-rect.left)*dpr, my=(e.clientY-rect.top)*dpr;
    let found  = -1;
    for (const h of hitAreas) {
      const dx=mx-h.hx, dy=my-h.hy;
      if (dx*dx+dy*dy < h.hr*h.hr*5) { found=h.vehicleIdx; break; }
    }
    const prev = window.lot ? window.lot.getHoveredIdx() : -1;
    if (found !== prev) {
      if (window.lot) window.lot.setHoveredIdx(found);
      canvas.style.cursor = found>=0 ? 'pointer' : (isPanMode?'move':(dragActive?'grabbing':'grab'));
    }
  });

  window.addEventListener('mouseup', e => {
    if (panActive) { panActive=false; canvas.style.cursor=isPanMode?'move':'grab'; return; }
    if (!dragActive) return;
    if (Math.abs(e.clientX-dragStartX) < 6) {
      const rect=canvas.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
      const mx=(e.clientX-rect.left)*dpr, my=(e.clientY-rect.top)*dpr;
      for (const h of hitAreas) {
        const dx=mx-h.hx, dy=my-h.hy;
        if (dx*dx+dy*dy < h.hr*h.hr*8) { if(window.lot) window.lot.selectVehicle(h.vehicleIdx); break; }
      }
    }
    dragActive=false; canvas.style.cursor=isPanMode?'move':'grab'; stopRot();
  });

  let touchStartX=0, touch2StartX=0, touch2StartY=0, isPinch=false;
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length===2) {
      isPinch=true;
      touch2StartX=(e.touches[0].clientX+e.touches[1].clientX)/2;
      touch2StartY=(e.touches[0].clientY+e.touches[1].clientY)/2;
    } else {
      isPinch=false; touchStartX=e.touches[0].clientX; dragStartAngY=angY;
      panStartX=e.touches[0].clientX; panStartY=e.touches[0].clientY;
    }
  }, { passive:true });

  canvas.addEventListener('touchmove', e => {
    if (isPinch && e.touches.length===2) {
      const cx2=(e.touches[0].clientX+e.touches[1].clientX)/2;
      const cy2=(e.touches[0].clientY+e.touches[1].clientY)/2;
      applyPanDelta(cx2-touch2StartX, cy2-touch2StartY);
      touch2StartX=cx2; touch2StartY=cy2;
    } else if (!isPinch) {
      if (isPanMode) {
        applyPanDelta(e.touches[0].clientX-panStartX, e.touches[0].clientY-panStartY);
        panStartX=e.touches[0].clientX; panStartY=e.touches[0].clientY;
      } else {
        angY=dragStartAngY+(e.touches[0].clientX-touchStartX)/130;
      }
    }
  }, { passive:true });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    zoomLv = Math.max(.2, Math.min(6, zoomLv - e.deltaY * .0006));
  }, { passive:false });

  const modeToggleBtn = document.getElementById('mode-toggle');
  if (modeToggleBtn) {
    modeToggleBtn.addEventListener('click', () => {
      isPanMode = !isPanMode;
      modeToggleBtn.textContent = isPanMode ? '✋ Pan' : '🔄 Rotate';
      modeToggleBtn.classList.toggle('mode-toggle--active', isPanMode);
      canvas.style.cursor = isPanMode ? 'move' : 'grab';
    });
  }

  function startRot(dir) { stopRot(); rotInterval=setInterval(()=>{angY+=dir*.04;},30); }
  function stopRot()      { if(rotInterval){clearInterval(rotInterval);rotInterval=null;} }

  document.getElementById('rot-left').addEventListener('mousedown',  ()=>startRot(-1));
  document.getElementById('rot-right').addEventListener('mousedown', ()=>startRot(1));
  document.getElementById('rot-left').addEventListener('touchstart',  ()=>startRot(-1), {passive:true});
  document.getElementById('rot-right').addEventListener('touchstart', ()=>startRot(1),  {passive:true});
  window.addEventListener('mouseup',  stopRot);
  window.addEventListener('touchend', stopRot);

  canvas.style.cursor = 'grab';

  // ── Public API ────────────────────────────────────────────────────────────────
  window.renderer = {
    resize,
    start() { if (!raf) { resize(); loop(); } },
    redraw: drawScene,
  };

  window.lotZoom      = d => canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:d<0?-120:120,bubbles:true}));
  window.lotResetView = () => {
    angY=0.3; zoomLv=1.0; panOffX=0; panOffZ=0; isPanMode=false;
    const btn=document.getElementById('mode-toggle');
    if(btn){btn.textContent='🔄 Rotate';btn.classList.remove('mode-toggle--active');}
    canvas.style.cursor='grab';
  };

  resize();
})();