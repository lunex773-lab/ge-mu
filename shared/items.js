'use strict';
//  ============================================================
//  CONTOUR — the pickups: where they lie, what they do, when they return
//  ============================================================
//  Shared (brief §24): the game places and draws them, the room server
//  decides who took one and when it comes back, so everyone in a room
//  fights over the same bananas. The fresh bananas used to lie wherever
//  each player's own dice put them; they now come from a seed, like the
//  rotten ones and the compasses always have.
//
//  layout() returns one list, in a fixed order the game and the server
//  both index into: the fresh bananas, then the rotten ones, then the
//  compasses. w is the side of the tear it lies on (0 here, 1 over there).

const { N, PITCH, RW, SWW, mulberry32, planBuildings } = require('./city.js');

const WORLD = 700, WORLD_SEED = 0x5eed17;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const NUM_BANANA = 8, NUM_ROT = 12;
const COMPASS_SPOTS = [[0, 0], [-0.64, -0.64], [0.64, -0.64], [-0.64, 0.64], [0.64, 0.64]];
const RESPAWN = { banana: 22, rot: 22, compass: 45 };   // s before it lies there again
const REACH = 1.8;                                      // m: close enough to pick one up
const AMMO = 90;                                        // rounds a banana gives (three magazines)
const REVEAL_TIME = 30;                                 // s a compass shows the others

function layout(buildings) {
  const B = buildings || planBuildings();
  const clear = (x, z, m) => B.every((b) => !(Math.abs(x - b.cx) < b.hw + m && Math.abs(z - b.cz) < b.hd + m));
  const items = [];
  //  fresh: on the pavement of a street, somewhere along it
  const rnd = mulberry32(WORLD_SEED ^ 0xf7e5);
  for (let n = 0; n < NUM_BANANA; n++) {
    let i, j, d;
    do { i = (rnd() * (2 * N + 1) | 0) - N; j = (rnd() * (2 * N + 1) | 0) - N; d = DIRS[rnd() * 4 | 0]; } while (Math.abs(i + d[0]) > N || Math.abs(j + d[1]) > N);
    const s = 0.2 + rnd() * 0.6, side = rnd() < 0.5 ? 1 : -1, off = side * (RW + SWW * 0.5);
    items.push({ k: 'banana', w: 0, x: (i + s * d[0]) * PITCH + d[1] * off, z: (j + s * d[1]) * PITCH - d[0] * off, y: 0.7, ph: rnd() * 6 });
  }
  //  rotten: anywhere in the open, over the tear (as the game always placed them)
  const rr = mulberry32(WORLD_SEED ^ 0xba7a);
  for (let n = 0; n < NUM_ROT; n++) {
    let x = 0, z = 0;
    for (let t = 0; t < 80; t++) {
      const cx = (rr() * 2 - 1) * WORLD * 0.42, cz = (rr() * 2 - 1) * WORLD * 0.42;
      if (!clear(cx, cz, 1.2)) continue;
      x = cx; z = cz; break;
    }
    items.push({ k: 'rot', w: 1, x, z, y: 0.7, ph: rr() * 6 });
  }
  //  compasses: five, spread wide, each on a street's pavement
  for (let n = 0; n < COMPASS_SPOTS.length; n++) {
    const R = N * PITCH, a = COMPASS_SPOTS[n];
    const axis = n % 2, side = n < 3 ? 1 : -1, off = side * (RW + SWW * 0.5);
    const di = axis ? 0 : 1, dj = axis ? 1 : 0;
    const i = Math.max(-N, Math.min(N - 1, Math.round(a[0] * R / PITCH)));
    const j = Math.max(-N, Math.min(N - 1, Math.round(a[1] * R / PITCH)));
    items.push({ k: 'compass', w: 0, x: (i + 0.5 * di) * PITCH + dj * off, z: (j + 0.5 * dj) * PITCH - di * off, y: 0.8, ph: n * 1.3 });
  }
  return items;
}

module.exports = { layout, RESPAWN, REACH, AMMO, REVEAL_TIME, NUM_BANANA, NUM_ROT };
