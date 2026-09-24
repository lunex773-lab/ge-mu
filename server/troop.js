//  ============================================================
//  CONTOUR — the monkey troop, run by the room  (B9c)
//  ============================================================
//  With two or more players in the room, the room runs the troop itself —
//  the same code a player's game runs it with alone (shared/troop.js) — fed
//  from what the room knows: where each player is, whether they are down.
//  Everyone is sent the same account of it (the game's own snapshot form),
//  every shot at a monkey is checked and lands here, the room says who took
//  one down (and so whose it counts towards the tear), and it decides the
//  swipes: a raging monkey within reach of a player takes 11 off them.
//
//  The signals the troop crosses by run on the room's own clock; each phone
//  runs its walkers and cars on its own — as a follower's always have.

import TROOP from '../shared/troop.js';
import CITY from '../shared/city.js';
import RULES from '../shared/rules.js';
import { theCity, theFootprints } from './combat.js';

const STEP = 0.05;                         // s: 20 Hz (a monkey runs 23 cm a step)
const LIM = RULES.WORLD * 0.46;
const CHEST = 1.05;                        // m: where a shot at a monkey is aimed (the game's hit sphere)
//  a swipe (index.html monkeyMelee): within reach, once per SWIPE_CD s a monkey,
//  and a player takes one at most every HIT_GAP ms (a swarm cannot shred anyone)
const REACH2 = 1.9 * 1.9, SWIPE = 11, SWIPE_CD = 0.7, HIT_GAP = 400;

export class RoomTroop {
  //  clock(): the city's clock the signals run on (the traffic's, traffic.js)
  constructor(room, clock) {
    this.room = room;                      // the Relay: players
    this.t = 0; this.acc = 0; this.last = undefined;
    this.F = theFootprints();
    this.T = TROOP.makeTroop({
      now: clock || (() => this.t),
      nearest: (x, z) => this.nearest(x, z),
      spot: () => this.spot(),
    });
    this.tgt = { x: 0, z: 0 };
  }

  //  where each player is (their last state), for the troop
  at(p) { const h = p.hist; return h.length < 4 ? null : { x: h[h.length - 3], z: h[h.length - 1] }; }
  //  the player a raging monkey goes for: the nearest one on their feet
  //  (on either side of the tear, as the game's troop does)
  nearest(x, z) {
    let bd = Infinity, ok = false;
    for (const p of this.room.players.values()) {
      if (p.dead) continue;
      const q = this.at(p); if (!q) continue;
      const d = (q.x - x) ** 2 + (q.z - z) ** 2;
      if (d < bd) { bd = d; this.tgt.x = q.x; this.tgt.z = q.z; ok = true; }
    }
    return ok ? this.tgt : null;
  }
  //  a clear bit of street 20–38 m from one of the players, for the reserve
  spot() {
    const who = [];
    for (const p of this.room.players.values()) { if (p.dead) continue; const q = this.at(p); if (q) who.push(q); }
    if (!who.length) return null;
    const c = who[Math.random() * who.length | 0];
    for (let i = 0; i < 80; i++) {
      const a = Math.random() * 6.2832, d = 20 + Math.random() * 18;
      const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      if (Math.abs(x) > LIM || Math.abs(z) > LIM) continue;
      if (this.F.clearAt(x, z, 1.2)) return { x, z };
    }
    return null;
  }

  //  carrying on from what the host last said of the troop (its snapshot's
  //  m, c, r), or — having heard nothing of it — as a fresh troop
  //  a snapshot's troop the room will carry on from: [mi, x, z, hp, heading,
  //  flags] for monkeys that exist, and bodies [cid, x, z, look] — anything
  //  else is not the game's, and is not taken (a troop wiped out by one bad
  //  word would stay wiped out)
  static valid(m, c) {
    const n = TROOP.NUM + TROOP.POOL, fin = (a) => a.every(Number.isFinite);
    if (!Array.isArray(m) || m.length % 6 || m.length > n * 6 || !fin(m)) return false;
    for (let i = 0; i < m.length; i += 6) if (m[i] < 0 || m[i] >= n || Math.abs(m[i + 1]) > 20000 || Math.abs(m[i + 2]) > 20000 || m[i + 3] <= 0 || m[i + 3] > TROOP.HP) return false;
    return c === undefined || (Array.isArray(c) && c.length % 4 === 0 && c.length <= TROOP.NUM_CORPSE * 4 && fin(c));
  }
  adopt(m, c, r) {
    if (Array.isArray(m)) TROOP.adopt(this.T, m, Array.isArray(c) ? c : [], +r || 0);
    //  (what it was taken from: for a test, and for a look in the logs)
    this.took = this.T.monkeys.filter(TROOP.inPlay).map((q) => [q.mi, q.wx, q.wz]);
  }

  //  Time moves on (now in ms): every monkey, every body, the rage clock
  step(now) {
    const dt = this.last === undefined ? 0 : Math.min(0.5, (now - this.last) / 1000);
    this.last = now;
    this.acc += dt;
    const T = this.T;
    while (this.acc >= STEP) {
      this.acc -= STEP; this.t += STEP;
      for (const m of T.monkeys) {
        if (m.pooled && !m.active) continue;
        if (m.hp <= 0) { if (m.corpseT > 0 || !m.deadFx) TROOP.fallen(m, STEP); continue; }
        TROOP.stepMonkey(T, m, STEP);
        m.meleeCd = Math.max(0, (m.meleeCd || 0) - STEP);
        if (m.aggro && m.meleeCd <= 0) this.swipe(m, now);
      }
      for (const c of T.corpses) if (c.active) TROOP.stepCorpse(T, c, STEP, true);
      TROOP.assignFeeders(T);
      TROOP.stepRage(T, STEP);
    }
  }

  //  the nearest player within reach, if any, takes a swipe
  swipe(m, now) {
    for (const [id, p] of this.room.players) {
      if (p.dead || p.w || now < (p.swipedT || 0)) continue;
      const q = this.at(p); if (!q) continue;
      if ((q.x - m.wx) ** 2 + (q.z - m.wz) ** 2 >= REACH2) continue;
      m.meleeCd = SWIPE_CD; p.swipedT = now + HIT_GAP;
      this.room.damage(id, SWIPE, null, now, 'monkey');
      return;
    }
  }

  //  A round from player `from` at monkey i: checked (the gun ready, the
  //  shooter up and on this side of the tear, the monkey in reach and in
  //  sight), and if it stands it lands here. Returns true when it took the
  //  monkey down (the room says whose it was: 'mdeath').
  shot(from, i, now) {
    const T = this.T, m = T.monkeys[i], me = this.room.players.get(from);
    const why = this.whyNot(me, m, now);
    if (why) { this.room.refused++; this.room.lastRefusal = 'at a monkey: ' + why; return false; }
    me.lastMobHitT = now;
    if (!TROOP.hurt(T, m, RULES.DMG)) return false;
    m.dseq = (m.dseq || 0) + 1;
    this.room.send('all', 'mdeath', { i, by: from, s: 'r' + m.dseq });   // ('r': not to be taken for one a host announced)
    return true;
  }
  whyNot(me, m, now) {
    if (!me || me.dead) return 'shooter is down';
    if (me.w) return 'other side of the tear';
    if (!m || !TROOP.inPlay(m)) return 'no such monkey';
    if (now - (me.lastMobHitT || -1e9) < RULES.FIRE_INTERVAL * 1000 * 0.75) return 'faster than the gun';
    const h = me.hist; if (h.length < 4) return 'not seen yet';
    const ro = { x: h[h.length - 3], y: h[h.length - 2] + RULES.EYE, z: h[h.length - 1] };
    const dx = m.wx - ro.x, dy = CHEST - ro.y, dz = m.wz - ro.z, d = Math.hypot(dx, dy, dz);
    if (d > RULES.MAX_RANGE + 5) return 'out of range';
    //  (it moves while the shot is on its way here: a wall within a couple of
    //  metres of where the room has it is not taken as in the way)
    if (d > 2.5 && CITY.rayLazy(theCity(), ro, { x: dx / d, y: dy / d, z: dz / d }, d) < d - 2.5) return 'no line of sight';
    return null;
  }

  //  a body a player's game threw (a walker run over or shot): it flies and
  //  lands here too, and the troop comes to eat it
  corpse(p) {
    const cid = Math.round(+p.c), x = +p.x / 10, z = +p.z / 10, vx = +p.vx / 10, vz = +p.vz / 10;
    if (!Number.isFinite(cid) || ![x, z, vx, vz].every(Number.isFinite) || Math.abs(x) > RULES.WORLD || Math.abs(z) > RULES.WORLD) return;
    const { c, had } = TROOP.corpseSlot(this.T, cid);
    if (!had) TROOP.placeCorpse(c, cid, x, z, Math.max(-20, Math.min(20, vx)), Math.max(-20, Math.min(20, vz)), Math.round(+p.k) || 0, true);
  }

  //  what everyone is told: the game's own snapshot of the troop
  snapshot() { return TROOP.troopArrays(this.T); }
}
