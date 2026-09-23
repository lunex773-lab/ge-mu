'use strict';
//  ============================================================
//  CONTOUR — the city as geometry  (shared: brief §24 SHARED)
//  ============================================================
//  The one place the city is made. The game draws it and walks in it; the
//  room server judges shots with it. Both get the same numbers because both
//  run this: the buildings come from a fixed seed, and everything inside
//  them (floors, stairs, walls, window bands) follows from the buildings.
//
//  No three.js here. What the game draws is returned as `pieces` —
//  [kind, x, y, z, sx, sy, sz, rx] in the order it used to place them — and
//  what it collides and shoots against as `recs` (one per building: bounds,
//  walls, slabs, ramps, shots, door, stair).
//
//  lab/inline.js copies this file into index.html; the server imports it.
//  lab/test/city.test.js checks the two agree with what the game built
//  before this file existed, to the last number.

const N = 5;                // road intersections at i,j in -N..N
const PITCH = 66;           // block + street pitch
const RW = 8;               // road half-width
const SWW = 5;              // sidewalk width
const HALF = RW + SWW;      // road centre → building frontage
const FH = 3.5;             // floor-to-floor height
const WGRID_H = 3.6, WGRID_V = 3.5;       // facade window grid (the facade shader uses the same)
const ACC_MAX = 5;          // accessible floors
const SEED = 0x51742C17;

// building kinds drive facade colours, roof gear and silhouette
const BTYPE = ['office', 'apartment', 'hotel', 'commercial', 'glassTower', 'warehouse', 'factory', 'parking', 'hospital', 'school'];
const TALL_T = ['glassTower', 'office', 'hotel', 'office', 'commercial'];
const MID_T  = ['office', 'hotel', 'hospital', 'commercial', 'apartment'];
const LOW_T  = ['apartment', 'school', 'warehouse', 'factory', 'parking', 'commercial'];
//  how much of a facade is glass, per kind — it sets the width of the piers
const GLASS = { office: 0.55, apartment: 0.34, hotel: 0.42, commercial: 0.60, glassTower: 0.86,
  warehouse: 0.20, factory: 0.22, parking: 0.30, hospital: 0.44, school: 0.38 };

const mulberry32 = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

//  Where the buildings stand, how big, how tall, what kind: the only part
//  that draws on the seed. About a millisecond.
function planBuildings() {
  const rrand = mulberry32(SEED);
  const buildings = [];
  for (let bi = -N; bi < N; bi++) for (let bj = -N; bj < N; bj++) {
    if (rrand() < 0.05) continue;                                  // rare vacant lot
    const x0 = bi * PITCH + HALF, x1 = (bi + 1) * PITCH - HALF;
    const z0 = bj * PITCH + HALF, z1 = (bj + 1) * PITCH - HALF;
    const central = (bi === 0 || bi === -1) && (bj === 0 || bj === -1);  // low near the crossing
    const nx = 1 + (rrand() < 0.45 ? 1 : 0), nz = 1 + (rrand() < 0.45 ? 1 : 0);
    for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
      const g = 1.3;
      const sx0 = x0 + (x1 - x0) * ix / nx + g, sx1 = x0 + (x1 - x0) * (ix + 1) / nx - g;
      const sz0 = z0 + (z1 - z0) * iz / nz + g, sz1 = z0 + (z1 - z0) * (iz + 1) / nz - g;
      const hw = (sx1 - sx0) / 2, hd = (sz1 - sz0) / 2;
      if (hw < 4.2 || hd < 4.2) continue;                          // every block must be roomy enough to enter
      const floors = central ? 2 + ((rrand() * 3) | 0) : 3 + Math.floor(Math.pow(rrand(), 1.85) * 20);
      const pool = floors >= 14 ? TALL_T : floors >= 8 ? MID_T : LOW_T;
      const type = pool[(rrand() * pool.length) | 0];
      buildings.push({ cx: (sx0 + sx1) / 2, cz: (sz0 + sz1) / 2, hw, hd, h: floors * FH, mat: BTYPE.indexOf(type), type, floors });
    }
  }
  return buildings;
}

//  One building's inside, from the building alone: its record (what is walked
//  on and shot at), and through put() what is drawn and into solids its
//  solid mass above the accessible floors.
function interior(b, put, solids) {
  const acc = Math.min(b.floors, ACC_MAX), accH = acc * FH;
  const openTop = b.h <= accH + 0.05;                 // short block: its top slab is the roof
  const X0 = b.cx - b.hw, X1 = b.cx + b.hw, Z0 = b.cz - b.hd, Z1 = b.cz + b.hd, WT = 0.32;
  const rec = { cx: b.cx, cz: b.cz, hw: b.hw, hd: b.hd, h: b.h, accH,
    bounds: { x0: X0 - WT, x1: X1 + WT, y0: 0, y1: b.h + 0.4, z0: Z0 - WT, z1: Z1 + WT },
    slabs: [], walls: [], ramps: [], shots: [] };
  // stair core hugging the −x edge
  const SW = Math.min(4.6, b.hw * 0.80), SL = Math.min(2 * b.hd - 1.2, 9.0);
  const sx0 = X0, sx1 = X0 + SW, sz0 = b.cz - SL / 2, sz1 = b.cz + SL / 2;
  const slab = (x0, x1, z0, z1, y) => {
    if (x1 - x0 < 0.25 || z1 - z0 < 0.25) return;
    const bx = { x0, x1, z0, z1, y0: y - 0.26, y1: y };
    rec.slabs.push(bx); rec.shots.push(bx);
    put('slab', (x0 + x1) / 2, y - 0.26, (z0 + z1) / 2, x1 - x0, 0.26, z1 - z0);
  };
  const wall = (kind, x0, x1, y0, y1, z0, z1, solid) => {
    if (x1 - x0 < 0.03 || z1 - z0 < 0.03 || y1 - y0 < 0.03) return;
    const bx = { x0, x1, y0, y1, z0, z1 };
    if (solid !== false) { rec.walls.push(bx); rec.shots.push(bx); }
    put(kind, (x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0);
  };
  // floor slabs (footprint minus the stair shaft)
  for (let L = 1; L <= acc; L++) {
    const y = L * FH;
    slab(sx1, X1, Z0, Z1, y); slab(sx0, sx1, Z0, sz0, y); slab(sx0, sx1, sz1, Z1, y);
  }
  // ---- facade ----------------------------------------------------------
  // The accessible floors wear the SAME shader material as the mass above and
  // are cut on the shader's own window grid, so the whole tower reads as one
  // building. Spandrel + header + piers are solid; the pane rectangles between
  // them are genuine holes, which is what you see through and shoot through.
  const facKey = 'fac' + (b.mat < 0 ? 0 : b.mat);
  const mrg = 0.30 + (0.06 - 0.30) * (GLASS[b.type] !== undefined ? GLASS[b.type] : 0.4);
  const PW = 2 * mrg * WGRID_H;                        // pier width on the grid
  const SILLH = 0.20 * WGRID_V, HEADY = 0.86 * WGRID_V;  // window band within a floor
  const piers = (a0, a1) => {                          // solid segments on the column grid
    const out = [];
    for (let k = Math.floor(a0 / WGRID_H) - 1; k <= Math.ceil(a1 / WGRID_H) + 1; k++) {
      const c = k * WGRID_H, q0 = Math.max(a0, c - PW / 2), q1 = Math.min(a1, c + PW / 2);
      if (q1 - q0 > 0.06) out.push([q0, q1]);
    }
    return out;
  };
  // ground floor: solid shell with a doorway on the +z face
  const DW = 3.2;
  wall(facKey, X0 - WT, X1 + WT, 0, FH, Z0 - WT, Z0);
  wall(facKey, X0 - WT, b.cx - DW / 2, 0, FH, Z1, Z1 + WT);
  wall(facKey, b.cx + DW / 2, X1 + WT, 0, FH, Z1, Z1 + WT);
  wall(facKey, X0 - WT, X0, 0, FH, Z0, Z1);
  wall(facKey, X1, X1 + WT, 0, FH, Z0, Z1);
  // upper rooms: spandrel below the glass, header above it, piers between panes
  for (let L = 1; L <= acc - 1; L++) {
    const y = L * FH;
    for (const q of [[y, y + SILLH], [y + HEADY, y + FH]]) {     // spandrel + header
      wall(facKey, X0 - WT, X1 + WT, q[0], q[1], Z0 - WT, Z0);
      wall(facKey, X0 - WT, X1 + WT, q[0], q[1], Z1, Z1 + WT);
      wall(facKey, X0 - WT, X0, q[0], q[1], Z0, Z1);
      wall(facKey, X1, X1 + WT, q[0], q[1], Z0, Z1);
    }
    for (const [q0, q1] of piers(X0 - WT, X1 + WT)) {             // ±z faces
      wall(facKey, q0, q1, y + SILLH, y + HEADY, Z0 - WT, Z0);
      wall(facKey, q0, q1, y + SILLH, y + HEADY, Z1, Z1 + WT);
    }
    for (const [q0, q1] of piers(Z0, Z1)) {                       // ±x faces
      wall(facKey, X0 - WT, X0, y + SILLH, y + HEADY, q0, q1);
      wall(facKey, X1, X1 + WT, y + SILLH, y + HEADY, q0, q1);
    }
  }
  // Parapets stop just under the shader's window row (0.20 of a floor) so the
  // roofline reads as solid coping instead of a sliced-off row of windows.
  const PARA = 0.194 * WGRID_V;
  if (openTop) {                                       // short block: parapet round the roof
    const y = acc * FH;
    wall(facKey, X0 - WT, X1 + WT, y, y + PARA, Z0 - WT, Z0);
    wall(facKey, X0 - WT, X1 + WT, y, y + PARA, Z1, Z1 + WT);
    wall(facKey, X0 - WT, X0, y, y + PARA, Z0, Z1);
    wall(facKey, X1, X1 + WT, y, y + PARA, Z0, Z1);
  }
  // ---- stairs: a proper half-turn flight ------------------------------
  // Two half-width runs per storey with a half-landing at the far end and an
  // arrival landing at the near end. Because each run sits directly above the
  // same run one storey below, headroom is a full 3.5 m the whole way up (the
  // old full-width zig-zag met itself at the turn and left none).
  const SM = (sx0 + sx1) / 2, LD = Math.min(1.8, SL * 0.26);
  const rz0 = sz0 + LD, rz1 = sz1 - LD;                // the sloped run
  const flight = (x0, x1, yA, yB) => {
    rec.ramps.push({ x0, x1, z0: rz0, z1: rz1, yA, yB });     // full half-width: no unsupported sliver
    rec.shots.push({ x0, x1, z0: rz0, z1: rz1, y0: Math.min(yA, yB) - 0.12, y1: Math.max(yA, yB) });
    const run = rz1 - rz0, rise = yB - yA;
    put('ramp', (x0 + x1) / 2, (yA + yB) / 2, (rz0 + rz1) / 2, x1 - x0 - 0.05, 0.18, Math.hypot(run, rise), -Math.atan2(rise, run));
  };
  const topStair = openTop ? acc : acc - 1;            // never climb into the solid mass
  // Enclose the stairwell: a newel spine down the middle plus walls onto the
  // floor plate. Without these you could drift a few cm sideways off a run and
  // drop straight down the shaft — with them the walls simply guide you up.
  if (topStair >= 1) {
    const STOP = topStair * FH;
    wall('wall', SM - 0.1, SM + 0.1, 0, STOP, rz0, rz1);            // newel spine between the runs
    wall('wall', sx1 - 0.1, sx1 + 0.1, 0, STOP, rz0, sz1 + 0.1);    // side onto the floor plate
    wall('wall', sx0, sx1 + 0.1, 0, STOP, sz1 - 0.1, sz1 + 0.1);    // closed end behind the turn
  }
  for (let L = 1; L <= topStair; L++) {
    const y0 = (L - 1) * FH, ym = y0 + FH / 2, y1 = L * FH;
    flight(sx0, SM, y0, ym);                           // west run, climbing toward +z
    slab(sx0, sx1, rz1, sz1, ym);                      // half landing, turn around here
    flight(SM, sx1, y1, ym);                           // east run, climbing back toward −z
    slab(sx0, sx1, sz0, rz0, y1);                      // arrival landing on the new floor
  }
  //  What an animal needs to know to use this building the way you do: where
  //  the hole in the ground floor is, and where the flights are. All of it is
  //  already implied by the geometry above — recording it here just means the
  //  AI reads the same numbers the walls were built from instead of guessing
  //  at them from the outside.
  rec.door = { x: b.cx, z: Z1 + WT, out: Z1 + WT + 2.4, in: Z1 - 1.6, w: DW };
  rec.stair = {
    x0: sx0, x1: sx1, z0: sz0, z1: sz1,
    wx: (sx0 + SM) / 2,          // centre of the west run (climbs toward +z)
    ex: (SM + sx1) / 2,          // centre of the east run (climbs toward −z)
    foot: rz0, head: rz1,        // the two ends of every run
    land: (sz0 + rz0) / 2,       // arrival landing — where a floor is joined
    half: (rz1 + sz1) / 2,       // half landing at the turn
    top: topStair,
  };
  rec.acc = acc;
  // entrance canopy + door posts
  put('canopy', b.cx, FH - 0.5, Z1 + WT + 0.75, DW + 1.6, 0.24, 1.7);
  for (const s of [-1, 1]) put('post', b.cx + s * (DW / 2 + 0.15), 0, Z1 + WT + 0.05, 0.3, FH - 0.5, 0.3);
  // solid mass above the accessible floors keeps the facade shader
  if (!openTop) {
    const mi = b.mat < 0 ? 0 : b.mat;
    solids.push([mi, b.cx, accH, b.cz, b.hw * 2, b.h - accH, b.hd * 2]);
    const bx = { x0: X0, x1: X1, y0: accH, y1: b.h, z0: Z0, z1: Z1 };
    rec.walls.push(bx); rec.shots.push(bx);
    // parapet ring on the real roof
    for (const q of [[X0 - WT, X1 + WT, Z0 - WT, Z0], [X0 - WT, X1 + WT, Z1, Z1 + WT], [X0 - WT, X0, Z0, Z1], [X1, X1 + WT, Z0, Z1]])
      put(facKey, (q[0] + q[1]) / 2, b.h, (q[2] + q[3]) / 2, q[1] - q[0], PARA, q[3] - q[2]);
  }
  // roof gear (visible from every sniping perch)
  const RY = b.h;
  for (let i = 0; i < (b.hw > 7 ? 3 : 2); i++) put('ac', b.cx - b.hw * 0.42 + i * 2.1, RY, b.cz - b.hd * 0.34, 1.4, 0.9, 1.0);
  put('tank', b.cx + b.hw * 0.44, RY, b.cz + b.hd * 0.4, 2.0, 2.3, 2.0);
  put('duct', b.cx + b.hw * 0.05, RY, b.cz + b.hd * 0.06, b.hw * 0.5, 0.6, 0.9);
  if (b.floors >= 10) put('mech', b.cx - b.hw * 0.34, RY, b.cz + b.hd * 0.36, b.hw * 0.5, 2.9, b.hd * 0.36);
  if (b.floors >= 12) put('ant', b.cx, RY, b.cz, 0.16, 6.5, 0.16);
  if (b.floors >= 15) for (const s of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    put('warn', b.cx + s[0] * (b.hw - 0.6), RY + 0.3, b.cz + s[1] * (b.hd - 0.6), 0.24, 0.24, 0.24);

  return rec;
}

//  The whole city, as the game builds it. opts.pieces === false leaves out
//  what is only drawn.
function buildCity(opts) {
  const buildings = planBuildings(), recs = [], pieces = [], solids = [];
  const put = opts && opts.pieces === false ? NOOP : (k, x, y, z, sx, sy, sz, rx) => { pieces.push([k, x, y, z, sx, sy, sz, rx || 0]); };
  for (const b of buildings) recs.push(interior(b, put, solids));
  return { buildings, recs, pieces, solids };
}
const NOOP = () => {};

//  The city as the room server holds it: every building's bounds at once
//  (a millisecond), each building's inside only when a ray first reaches it.
//  Building all of it takes some 45 ms — more than one request may spend on
//  Cloudflare's free plan — and a shot only ever crosses a few buildings.
function lazyCity() {
  const buildings = planBuildings(), recs = new Array(buildings.length), none = [];
  const WT = 0.32;
  const bounds = buildings.map((b) => { const X0 = b.cx - b.hw, X1 = b.cx + b.hw, Z0 = b.cz - b.hd, Z1 = b.cz + b.hd;
    return { x0: X0 - WT, x1: X1 + WT, y0: 0, y1: b.h + 0.4, z0: Z0 - WT, z1: Z1 + WT }; });
  return { buildings, bounds, built: () => recs.filter(Boolean).length,
    rec(i) { return recs[i] || (recs[i] = interior(buildings[i], NOOP, none)); } };
}

//  ---- rays: the same slab tests the game fires its gun with -------------
//  Slab tests, unrolled: the originals looped over axes through four small
//  arrays built per call. Same arithmetic in the same order, so the answers
//  are bit-for-bit the same (lab/test/phase11.test.js checks a million rays);
//  what changes is that nothing is built, whether or not a given engine
//  would have optimised the arrays away on its own.
function rayAabb(ro, rd, b) {
  let tmin = 0, tmax = Infinity, t1, t2;
  if (Math.abs(rd.x) < 1e-9) { if (ro.x < b.x0 || ro.x > b.x1) return Infinity; }
  else { t1 = (b.x0 - ro.x) / rd.x; t2 = (b.x1 - ro.x) / rd.x; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return Infinity; }
  if (Math.abs(rd.y) < 1e-9) { if (ro.y < b.y0 || ro.y > b.y1) return Infinity; }
  else { t1 = (b.y0 - ro.y) / rd.y; t2 = (b.y1 - ro.y) / rd.y; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return Infinity; }
  if (Math.abs(rd.z) < 1e-9) { if (ro.z < b.z0 || ro.z > b.z1) return Infinity; }
  else { t1 = (b.z0 - ro.z) / rd.z; t2 = (b.z1 - ro.z) / rd.z; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return Infinity; }
  return tmin > 0.05 ? tmin : Infinity;
}
function aabbTouch(ro, rd, b) {
  let tmin = -Infinity, tmax = Infinity, t1, t2;
  if (Math.abs(rd.x) < 1e-9) { if (ro.x < b.x0 || ro.x > b.x1) return false; }
  else { t1 = (b.x0 - ro.x) / rd.x; t2 = (b.x1 - ro.x) / rd.x; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return false; }
  if (Math.abs(rd.y) < 1e-9) { if (ro.y < b.y0 || ro.y > b.y1) return false; }
  else { t1 = (b.y0 - ro.y) / rd.y; t2 = (b.y1 - ro.y) / rd.y; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return false; }
  if (Math.abs(rd.z) < 1e-9) { if (ro.z < b.z0 || ro.z > b.z1) return false; }
  else { t1 = (b.z0 - ro.z) / rd.z; t2 = (b.z1 - ro.z) / rd.z; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return false; }
  return tmax >= Math.max(tmin, 0);
}
//  max (optional): the caller does not care past it, so a building whose
//  footprint the segment never crosses costs four compares, not a slab test.
//  Every creature's line of sight and every shot pass the distance they
//  care about; the Beelzebub's senses ask 20 times a second, and this was
//  most of their cost. Anything closer than max is exactly what it always was.
function rayCity(cityB, ro, rd, max) {
  let best = Infinity, x0 = -Infinity, x1 = Infinity, z0 = -Infinity, z1 = Infinity;
  if (max < Infinity) {
    const ex = ro.x + rd.x * max, ez = ro.z + rd.z * max;
    x0 = Math.min(ro.x, ex); x1 = Math.max(ro.x, ex); z0 = Math.min(ro.z, ez); z1 = Math.max(ro.z, ez);
  }
  for (let i = 0; i < cityB.length; i++) {
    const r = cityB[i], bb = r.bounds;
    if (bb.x1 < x0 || bb.x0 > x1 || bb.z1 < z0 || bb.z0 > z1) continue;
    if (!aabbTouch(ro, rd, bb)) continue;
    const s = r.shots;
    for (let j = 0; j < s.length; j++) { const d = rayAabb(ro, rd, s[j]); if (d < best) best = d; }
  }
  return best;
}

//  rayCity for lazyCity(): the same answer, building only what the ray reaches
function rayLazy(city, ro, rd, max) {
  let best = Infinity, x0 = -Infinity, x1 = Infinity, z0 = -Infinity, z1 = Infinity;
  if (max < Infinity) {
    const ex = ro.x + rd.x * max, ez = ro.z + rd.z * max;
    x0 = Math.min(ro.x, ex); x1 = Math.max(ro.x, ex); z0 = Math.min(ro.z, ez); z1 = Math.max(ro.z, ez);
  }
  const B = city.bounds;
  for (let i = 0; i < B.length; i++) {
    const bb = B[i];
    if (bb.x1 < x0 || bb.x0 > x1 || bb.z1 < z0 || bb.z0 > z1) continue;
    if (!aabbTouch(ro, rd, bb)) continue;
    const s = city.rec(i).shots;
    for (let j = 0; j < s.length; j++) { const d = rayAabb(ro, rd, s[j]); if (d < best) best = d; }
  }
  return best;
}

module.exports = { N, PITCH, RW, SWW, HALF, FH, WGRID_H, WGRID_V, ACC_MAX, SEED, BTYPE, GLASS, mulberry32, planBuildings, interior, buildCity, lazyCity, rayAabb, aabbTouch, rayCity, rayLazy };
