'use strict';
//  ============================================================
//  BOSS AI LAB — the arena  (spec §22)
//  ============================================================
//
//  A top-down block of city: streets between box buildings, and a tear in
//  one wall with its guardian in front of it. Heights matter only for line
//  of sight, which is a real 3D ray against the boxes — the same question
//  the city answers with rayCity — so hiding behind a building works here
//  the way it works in the game.
//
//  It offers the BossBody its world interface (blocked, ground) and the
//  Sensor Layer its (probe, solid), and nothing else.

const { makeRng } = require('../core/rng.js');

class Arena {
  constructor(opts) {
    const o = Object.assign({ half: 90, seed: 1 }, opts || {});
    this.half = o.half;
    this.boxes = [];                     // [x0, x1, y0, y1, z0, z1]
    const rng = makeRng(o.seed);
    //  a 3x3 grid of blocks with 18-22 m streets, sizes jittered
    const pitch = 56;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      if (i === 0 && j === 0) continue;                  // an open square in the middle
      const cx = i * pitch + (rng.next() - 0.5) * 6, cz = j * pitch + (rng.next() - 0.5) * 6;
      const hw = 14 + rng.next() * 6, hd = 14 + rng.next() * 6, h = 8 + rng.next() * 30;
      this.boxes.push([cx - hw, cx + hw, 0, h, cz - hd, cz + hd]);
    }
    //  a few low walls and kiosks in the square: something to duck behind
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + 0.6, r = 15 + rng.next() * 6;
      const cx = Math.sin(a) * r, cz = Math.cos(a) * r, w = 2 + rng.next() * 3;
      this.boxes.push([cx - w, cx + w, 0, 2.4, cz - 0.6, cz + 0.6]);
    }
    //  the tear, in the south face of the north-middle block
    const b = this.boxes[this.findBlock(0, 1)];
    this.gate = { x: (b[0] + b[1]) / 2, z: b[4] - 0.2 };
    this.spawnBoss = { x: this.gate.x, z: this.gate.z - 5 };
  }
  findBlock(i, j) {
    let best = 0, bd = Infinity;
    this.boxes.forEach((b, k) => {
      const d = Math.hypot((b[0] + b[1]) / 2 - i * 56, (b[4] + b[5]) / 2 - j * 56);
      if (d < bd) { bd = d; best = k; }
    });
    return best;
  }
  //  BossBody's world
  blocked(x, z, r) {
    if (Math.abs(x) > this.half - r || Math.abs(z) > this.half - r) return true;
    for (const b of this.boxes) if (x > b[0] - r && x < b[1] + r && z > b[4] - r && z < b[5] + r && b[3] > 1.0) return true;
    return false;
  }
  ground() { return 0; }
  //  the Sensor Layer's world
  solid(x, y, z) {
    for (const b of this.boxes) if (x > b[0] && x < b[1] && z > b[4] && z < b[5] && y < b[3]) return true;
    return false;
  }
  probe(ox, oy, oz, dx, dy, dz, max) {
    let best = Infinity;
    for (const b of this.boxes) {
      let t0 = 0, t1 = Infinity, ok = true;
      for (let a = 0; a < 3 && ok; a++) {
        const o = a === 0 ? ox : a === 1 ? oy : oz, d = a === 0 ? dx : a === 1 ? dy : dz;
        const lo = b[a * 2], hi = b[a * 2 + 1];
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) ok = false; continue; }
        let p = (lo - o) / d, q = (hi - o) / d; if (p > q) { const s = p; p = q; q = s; }
        if (p > t0) t0 = p; if (q < t1) t1 = q; if (t0 > t1) ok = false;
      }
      if (ok && t0 < best) best = t0;
    }
    return best < max ? best : Infinity;
  }
  los(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz) || 1e-3;
    return !(this.probe(ax, ay, az, dx / len, dy / len, dz / len, len) < len - 0.6);
  }
  //  somewhere open, a distance from a point
  openSpot(x, z, dist, rng) {
    for (let i = 0; i < 200; i++) {
      const a = rng.next() * Math.PI * 2, r = dist * (0.8 + rng.next() * 0.4);
      const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
      if (!this.blocked(px, pz, 1.5)) return { x: px, z: pz };
    }
    return { x: 0, z: 0 };
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { Arena };
