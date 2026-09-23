'use strict';
//  ============================================================
//  PHASE 3 BENCHMARK  (spec §28, D8)
//  ============================================================
//  The Sensor Layer's own cost, apart from the rays it asks the game for.
//  The rays are measured in the real city by phase3.game.test.js (about
//  8 µs each on this machine); here they are free, so what is left is the
//  bookkeeping — and the thing to watch is how it grows with the number of
//  players in the room, and that the rays per tick stay capped.

const { SensorLayer } = require('../core/sensors.js');
const { toChannels } = require('../core/worldstate.js');
const { makeGameAdapter } = require('../adapter/game_adapter.js');

const pad = (s, n) => { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); };
const rp = (s, n) => { s = String(s); return ' '.repeat(Math.max(0, n - s.length)) + s; };

console.log('\n=== SENSOR + ADAPTER COST BY PLAYERS IN THE ROOM ===\n');
console.log(pad('players', 9) + rp('µs/tick', 10) + rp('max rays', 10) + rp('@10Hz', 9) + rp('KB heap/1k', 12));
for (const n of [1, 2, 4, 8, 16]) {
  const peers = new Map();
  for (let i = 1; i < n; i++) peers.set('p' + i, { cur: { x: (i - n / 2) * 6, y: 0, z: 30 + i }, yaw: Math.PI, hp: 100, dead: false, inv: false, w: 0 });
  let T = 0, rays = 0;
  const G = { now: () => T, p: { x: 0, y: 1.68, z: 25 }, EYE: 1.68, yaw: () => Math.PI, hp: () => 100, HP_MAX: 100,
    dead: () => false, cloak: () => false, world: () => 0, MP: { id: 'p0', peers },
    rayCity: () => { rays++; return Infinity; }, clearAt: (x, z) => Math.abs(x % 20) > 3 };
  const A = makeGameAdapter(G), S = new SensorLayer(), ch = {};
  const boss = { x: 0, y: 0, z: 0, hd: 0, hp: 5000, hpMax: 5000, world: 0 };
  const tick = () => {
    T += 0.1;
    for (const pr of peers.values()) { pr.cur.x += Math.sin(T + pr.cur.z) * 0.4; }
    if ((T * 10 | 0) % 7 === 0) A.noteShot('p1', 0, 0, 30);
    toChannels(S.sense(A.observe(boss, 0)), ch); A.drain();
  };
  for (let i = 0; i < 500; i++) tick();
  global.gc && global.gc();
  const h0 = process.memoryUsage().heapUsed;
  let maxRays = 0;
  const N = 20000, t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) { const r0 = rays; tick(); if (rays - r0 > maxRays) maxRays = rays - r0; }
  const us = Number(process.hrtime.bigint() - t0) / 1e3 / N;
  const kb = (process.memoryUsage().heapUsed - h0) / 1024 / (N / 1000);
  console.log(pad(n, 9) + rp(us.toFixed(2), 10) + rp(maxRays, 10) + rp((us * 10 / 1e6 * 100).toFixed(3) + '%', 9)
    + rp(kb.toFixed(1), 12));
}
console.log('\n  @10Hz = share of one second at the §28 rate. Rays are free here; in the city');
console.log('  each costs ~8 µs on this machine, so add (max rays x 8 µs) for the real worst tick.');
console.log('  KB heap/1k = heap growth per thousand ticks without a GC in between (garbage');
console.log('  created, not a leak): the sensor path is meant to create very little.\n');
