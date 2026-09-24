//  ============================================================
//  CONTOUR — whether a shot can have hit  (brief §6, §22)
//  ============================================================
//  A player's game says "I hit so-and-so". The room believes it only if it
//  could have happened: both alive and on the same side of the tear, the
//  gun ready to fire again, the target within the bullet's reach, and a
//  clear line through the city — the same city, from shared/city.js, the
//  players see.
//
//  The shooter saw the target a little in the past (the game draws other
//  players 120 ms behind, plus the network), so the target is looked for
//  anywhere along the last LAG_MS of where it has been, and at three
//  heights (legs, chest, head): a clean line to any of them is a hit.

import CITY from '../shared/city.js';
import RULES from '../shared/rules.js';

export const LAG_MS = 700;             // how far back a target is looked for
const HIST_MS = 1500;                  // how much of each player's path is kept
const HEIGHTS = [0.5, 1.1, 1.6];       // above the feet
const SLACK = 0.4;                     // m: a line that stops this short of the target still reaches it

let city = null;                       // once per isolate, and lazily (shared/city.js lazyCity)
export function theCity() { return city || (city = CITY.lazyCity()); }
let foot = null;                       // the streets' open ground and roofs (shared/city.js footprints), once per isolate
export function theFootprints() { return foot || (foot = CITY.footprints(CITY.planBuildings())); }

//  where a player has been: flat [t, x, y, z, t, x, y, z, …], y at the feet.
//  Kept in memory only: a room that sleeps (hibernation, after ~10 s with
//  nobody sending anything) wakes without it, and judges no shot at a player
//  until that player's next state — a few hundredths of a second in a game,
//  where everyone moving sends many a second.
export function remember(pl, now, x, y, z) {
  const h = pl.hist;
  h.push(now, x, y, z);
  let cut = 0;
  while (cut < h.length && h[cut] < now - HIST_MS) cut += 4;
  if (cut) h.splice(0, cut);
}

//  null if the shot stands, otherwise why not
export function whyNot(shooter, victim, now) {
  if (!shooter || !victim) return 'nobody';
  if (shooter.dead) return 'shooter is down';
  if (victim.dead) return 'target is down';
  if ((shooter.w || 0) !== (victim.w || 0)) return 'other side of the tear';
  if (now - shooter.lastHitT < RULES.FIRE_INTERVAL * 1000 * 0.75) return 'faster than the gun';
  const s = shooter.hist, v = victim.hist;
  if (s.length < 4 || v.length < 4) return 'not seen yet';
  const ex = s[s.length - 3], ey = s[s.length - 2] + RULES.EYE, ez = s[s.length - 1];
  const C = theCity(), ro = { x: ex, y: ey, z: ez }, rd = { x: 0, y: 0, z: 0 };
  let near = Infinity;
  for (let i = v.length - 4; i >= 0; i -= 4) {
    if (v[i] < now - LAG_MS && i !== v.length - 4) break;     // the latest always counts
    for (const hy of HEIGHTS) {
      const dx = v[i + 1] - ex, dy = v[i + 2] + hy - ey, dz = v[i + 3] - ez;
      const d = Math.hypot(dx, dy, dz);
      near = Math.min(near, d);
      if (d > RULES.MAX_RANGE + 5 || d < 1e-3) continue;
      rd.x = dx / d; rd.y = dy / d; rd.z = dz / d;
      if (CITY.rayLazy(C, ro, rd, d) >= d - SLACK) return null;  // a clean line
    }
  }
  return near > RULES.MAX_RANGE + 5 ? 'out of range' : 'no line of sight';
}
