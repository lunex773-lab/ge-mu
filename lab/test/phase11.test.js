'use strict';
//  ============================================================
//  PHASE 11 TESTS — the optimisations change nothing but the cost
//  ============================================================
//  rayAabb and aabbTouch were rewritten not to allocate. They sit under
//  every mob's line of sight and every bullet, so "the same answers" is
//  checked exactly, not approximately: the originals (kept verbatim in
//  fixtures/ray_original.js) against the versions now in shared/city.js, a
//  million random rays against random boxes, including rays parallel to a
//  face and rays starting inside. rayCity also learned to skip buildings
//  past the caller's max: whatever it returns below max must be exactly what
//  the unbounded walk returns.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

//  the slab tests and rayCity now live in shared/city.js (the game and the
//  room server both use them); the originals stay in fixtures/ray_original.js
const C = require('../../shared/city.js');
const NEW = (cityB) => ({ rayAabb: C.rayAabb, aabbTouch: C.aabbTouch, rayCity: (ro, rd, max) => C.rayCity(cityB, ro, rd, max) });
const OLD = new Function(fs.readFileSync(path.join(__dirname, 'fixtures', 'ray_original.js'), 'utf8') + '\nreturn { rayAabb, aabbTouch };')();

let pass = 0, fail = 0;
const results = [];
function test(name, fn) {
  try { fn(); pass++; results.push('  ok   ' + name); }
  catch (e) { fail++; results.push('  FAIL ' + name + '\n         ' + e.message); }
}

let seed = 1;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
function box() {
  const x0 = (rnd() - 0.5) * 100, y0 = rnd() * 20, z0 = (rnd() - 0.5) * 100;
  return { x0, y0, z0, x1: x0 + rnd() * 30, y1: y0 + rnd() * 30, z1: z0 + rnd() * 30 };
}
function ray() {
  const ro = { x: (rnd() - 0.5) * 140, y: rnd() * 40, z: (rnd() - 0.5) * 140 };
  let dx = rnd() - 0.5, dy = rnd() - 0.5, dz = rnd() - 0.5;
  const k = rnd();
  if (k < 0.1) dx = 0; else if (k < 0.2) dy = 0; else if (k < 0.25) { dx = 0; dz = 0; }     // parallel to faces
  const l = Math.hypot(dx, dy, dz) || 1;
  return [ro, { x: dx / l, y: dy / l, z: dz / l }];
}

const city = [];
const SLAB = NEW(city);
test('rayAabb: a million rays, identical answers', () => {
  for (let i = 0; i < 1e6; i++) {
    const b = box(), [ro, rd] = ray();
    if (i % 7 === 0) { ro.x = (b.x0 + b.x1) / 2; ro.y = (b.y0 + b.y1) / 2; ro.z = (b.z0 + b.z1) / 2; }   // from inside
    const a = OLD.rayAabb(ro, rd, b), c = SLAB.rayAabb(ro, rd, b);
    if (!Object.is(a, c)) throw new Error('ray ' + i + ': ' + a + ' vs ' + c);
  }
});
test('aabbTouch: a million rays, identical answers', () => {
  for (let i = 0; i < 1e6; i++) {
    const b = box(), [ro, rd] = ray();
    if (i % 7 === 0) { ro.x = (b.x0 + b.x1) / 2; ro.y = (b.y0 + b.y1) / 2; ro.z = (b.z0 + b.z1) / 2; }
    if (OLD.aabbTouch(ro, rd, b) !== SLAB.aabbTouch(ro, rd, b)) throw new Error('ray ' + i);
  }
});
test('and it is no slower (timing is noisy; measured 1.1-1.7x faster here)', () => {
  const boxes = [], rays = [];
  for (let i = 0; i < 2000; i++) { boxes.push(box()); rays.push(ray()); }
  const time = (f) => { const t0 = process.hrtime.bigint(); let s = 0; for (let r = 0; r < 200; r++) for (let i = 0; i < 2000; i++) { const t = f(rays[i][0], rays[i][1], boxes[i]); if (t < Infinity) s += t; } return Number(process.hrtime.bigint() - t0) / 1e6; };
  time(OLD.rayAabb); time(SLAB.rayAabb);
  const o = time(OLD.rayAabb), n = time(SLAB.rayAabb);
  //  400,000 calls each: ms * 1e6 / 4e5 = ns per call
  results.push('         (rayAabb: ' + (o * 2.5).toFixed(1) + ' → ' + (n * 2.5).toFixed(1) + ' ns per box, ' + (o / n).toFixed(1) + '× faster)');
  assert.ok(n < o * 1.15, 'new ' + n.toFixed(1) + ' ms vs old ' + o.toFixed(1) + ' ms');
});

test('rayCity with max: below max, exactly the unbounded answer; never a hit that is not there', () => {
  //  a city of 200 buildings on a 66 m grid, each a few boxes inside its bounds
  for (let i = 0; i < 200; i++) {
    const cx = ((i % 15) - 7) * 66, cz = (Math.floor(i / 15) - 7) * 66, shots = [];
    const w = 8 + rnd() * 20, d = 8 + rnd() * 20, h = 6 + rnd() * 40;
    for (let k = 0, n = 1 + Math.floor(rnd() * 4); k < n; k++) {
      const x0 = cx - w + rnd() * w, z0 = cz - d + rnd() * d, y0 = rnd() * h * 0.5;
      shots.push({ x0, z0, y0, x1: Math.min(cx + w, x0 + 2 + rnd() * w), z1: Math.min(cz + d, z0 + 2 + rnd() * d), y1: Math.min(h, y0 + 2 + rnd() * h) });
    }
    city.push({ bounds: { x0: cx - w, x1: cx + w, z0: cz - d, z1: cz + d, y0: 0, y1: h }, shots });
  }
  let near = 0, far = 0;
  for (let i = 0; i < 100000; i++) {
    const ro = { x: (rnd() - 0.5) * 1000, y: rnd() * 30, z: (rnd() - 0.5) * 1000 };
    const [, rd] = ray();
    const max = 1 + rnd() * 200;
    const u = SLAB.rayCity(ro, rd), b = SLAB.rayCity(ro, rd, max);
    if (u < max) { near++; if (!Object.is(u, b)) throw new Error('ray ' + i + ': ' + u + ' unbounded, ' + b + ' with max ' + max); }
    else { far++; if (b < max) throw new Error('ray ' + i + ': a hit at ' + b + ' that the unbounded walk puts at ' + u); }
  }
  results.push('         (' + near + ' rays hit within max, ' + far + ' did not)');
});

console.log('\nPHASE 11 — optimisations that must change nothing\n');
console.log(results.join('\n'));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
