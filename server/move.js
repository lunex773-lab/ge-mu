//  ============================================================
//  CONTOUR — whether a player can have got where they say  (brief §6, §22)
//  ============================================================
//  A player's game says where it is, fifteen times a second. The room checks
//  that each step could have been walked, on its own clock: moving earns
//  distance at a little over running speed, up to a few seconds' worth, and
//  every step spends what it covers. So a network stall — steps held up and
//  then delivered all at once — is fine, a jump across the map is not, and
//  a sped-up game cannot outrun the room's clock for long.
//
//  What the room cannot see — a creature's shove, VECNA's pull, a car — is
//  paid from a second store that refills more slowly: small in daylight
//  (a car, 2.4 m; the guardian, 5.5 m), large on the other side (the mind
//  flayer's stamp, 11 m; VECNA drags you in from as far as 34 m).
//
//  Free: the first step after joining (or after the room wakes from sleep,
//  having forgotten), the first after getting back up, and crossing the
//  tear (the game puts you beside it on the other side, and a storm room
//  starts you there) — but not twice within a second and a half. The room
//  does not know where the tear is (any player may announce it), so how
//  far that step goes is not checked; that waits for the tear to be the
//  room's own.
//
//  A step that could not have been walked is not passed on, is not where
//  shots or pickups are judged from, and the player is told where the room
//  last had them (relay.js sends 'pos'); the game puts them back there.

import RULES from '../shared/rules.js';

export const SPEED = RULES.RUN * 1.25;     // m/s a player earns: running, and some slack for frame timing
const BANK_S = 4;                          // seconds of it a player can have in hand (a stall up to about this)
const EXTRA = [12, 40];                    // m for what the room cannot see, [daylight, the other side]
const EXTRA_RATE = [3, 8];                 // m/s that refills
const FLIP_MS = 1500;                      // no two crossings of the tear closer than this
export const LIMIT = RULES.WORLD * 0.48 + 2;   // the game keeps everyone inside ±this (index.html: WORLD * 0.48)

//  null if the step stands (and it is taken), otherwise why not
export function step(pl, x, y, z, w, now) {
  if (Math.abs(x) > LIMIT || Math.abs(z) > LIMIT) return 'outside the city';
  const m = pl.mv;
  if (!m || m.free) { pl.mv = fresh(x, y, z, w, now, m ? m.flipT : -1e9); return null; }
  if (w !== m.w) {                               // through the tear
    if (now - m.flipT < FLIP_MS) return 'crossed again too soon';
    pl.mv = fresh(x, y, z, w, now, now);
    return null;
  }
  const dt = Math.max(0, now - m.t) / 1000, side = w ? 1 : 0;
  const bank = Math.min(SPEED * BANK_S, m.bank + SPEED * dt);
  const extra = Math.min(EXTRA[side], m.extra + EXTRA_RATE[side] * dt);
  const d = Math.hypot(x - m.x, z - m.z);
  if (d > bank + extra) {
    m.bank = bank; m.extra = extra; m.t = now;   // what was earned stays earned
    return 'too far (' + d.toFixed(1) + ' m, ' + (bank + extra).toFixed(1) + ' m in hand)';
  }
  const fromBank = Math.min(d, bank);
  m.bank = bank - fromBank; m.extra = extra - (d - fromBank);
  m.x = x; m.y = y; m.z = z; m.t = now;
  return null;
}
function fresh(x, y, z, w, now, flipT) {
  return { x, y, z, w, t: now, bank: SPEED * BANK_S, extra: EXTRA[w ? 1 : 0], flipT, free: false };
}
//  the next step may be anywhere (getting back up)
export function freeStep(pl) { if (pl.mv) pl.mv.free = true; }
