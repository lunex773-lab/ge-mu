'use strict';
//  ============================================================
//  CONTOUR — the other side's dead traffic  (shared)
//  ============================================================
//  Nothing drives over there. The traffic died where it stood, and it is
//  solid: you walk around it, it stops a bullet, and the animals hide behind
//  it. The game draws the wrecks and walks and shoots among them; the room
//  server's creatures (server/dogs.js) do the same with this — the same
//  wrecks, from the same seed and the same cars (shared/traffic.js).
//
//  A wreck in the air is not a wall: the commander's throw and the king's
//  orbit pick them up (held, thrown), and while they are up nothing stops
//  against them.

const { N, PITCH, RW, mulberry32 } = require('./city.js');
const TR = require('./troop.js');
const { LANE } = require('./traffic.js');

const WORLD_SEED = 0x5eed17;
const NWRECK = 96;                         // of the day side's 140 cars: a thinner, deader city
const CWY = 0.34;                          // a car body's height off the road (index.html CWY)

//  cars: the day side's (shared/traffic.js makeTraffic), for their shapes.
//  One per car, in the cars' order; null where there is none.
function makeWrecks(cars) {
  const rnd = mulberry32(WORLD_SEED ^ 0xc4), out = [];
  for (let k = 0; k < cars.length; k++) {
    const c = cars[k];
    if (k >= NWRECK) { out.push(null); continue; }
    // strewn along the road graph: some in the lanes, some slewed onto the kerb
    let i, j, di, dj;
    do { i = ((rnd() * (2 * N + 1)) | 0) - N; j = ((rnd() * (2 * N + 1)) | 0) - N;
         const d = TR.DIRS[(rnd() * 4) | 0]; di = d[0]; dj = d[1]; } while (Math.abs(i + di) > N || Math.abs(j + dj) > N);
    const s = 0.08 + rnd() * 0.84;
    const kerb = rnd() < 0.35;
    const off = kerb ? (rnd() < 0.5 ? -1 : 1) * (RW + 1.6 + rnd() * 2.4) : (rnd() < 0.5 ? -LANE : LANE);
    const x = (i + s * di) * PITCH + dj * off, z = (j + s * dj) * PITCH - di * off;
    const head = Math.atan2(di, dj) + (rnd() - 0.5) * (kerb ? 1.9 : 0.5);
    out.push({ x, z, y: 0, rot: head, W: c.W, H: c.H, L: c.L,
               cabH: c.cabH, cabL: c.cabL, cabZ: c.cabZ, tilt: (rnd() - 0.5) * 0.10,
               hw: c.W / 2, hl: c.L / 2, wheels: rnd() < 0.55 });
  }
  return out;
}

// push a body out of a wreck (oriented box, exact)
function collide(wrecks, pos, rad) {
  for (let k = 0; k < wrecks.length; k++) {
    const w = wrecks[k]; if (!w || w.held || w.thrown) continue;
    const dx = pos.x - w.x, dz = pos.z - w.z;
    if (dx * dx + dz * dz > 36) continue;
    const ch = Math.cos(w.rot), sh = Math.sin(w.rot);
    const lz = dx * sh + dz * ch, lx = dx * ch - dz * sh;
    const ex = w.hw + rad, ez = w.hl + rad;
    if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) continue;
    const px = ex - Math.abs(lx), pz = ez - Math.abs(lz);
    let nx = 0, nz = 0;
    if (px < pz) nx = lx < 0 ? -px : px; else nz = lz < 0 ? -pz : pz;
    pos.x += nx * ch + nz * sh; pos.z += -nx * sh + nz * ch;
  }
}
// and stop a round on one: how far along the ray (Infinity: none)
function ray(wrecks, ro, rd) {
  let best = Infinity;
  for (let k = 0; k < wrecks.length; k++) {
    const w = wrecks[k]; if (!w || w.held || w.thrown) continue;
    const dx = ro.x - w.x, dz = ro.z - w.z;
    const ch = Math.cos(w.rot), sh = Math.sin(w.rot);
    const ox = dx * ch - dz * sh, oz = dx * sh + dz * ch;
    const rx = rd.x * ch - rd.z * sh, rz = rd.x * sh + rd.z * ch;
    const oy = ro.y - (w.y + CWY), ry = rd.y;
    let tmin = 0, tmax = best;
    const lo = [-w.hw, 0, -w.hl], hi = [w.hw, w.H + w.cabH, w.hl];
    const o = [ox, oy, oz], dd = [rx, ry, rz];
    let miss = false;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(dd[a]) < 1e-9) { if (o[a] < lo[a] || o[a] > hi[a]) { miss = true; break; } continue; }
      let t1 = (lo[a] - o[a]) / dd[a], t2 = (hi[a] - o[a]) / dd[a];
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) { miss = true; break; }
    }
    if (!miss && tmin > 0.05 && tmin < best) best = tmin;
  }
  return best;
}

module.exports = { WORLD_SEED, NWRECK, CWY, makeWrecks, collide, ray };
