//  ============================================================
//  CONTOUR — the day side's traffic, run by the room  (B9t)
//  ============================================================
//  With two or more players in the room, the room runs the cars, the
//  Ferraris and the crowd — the same code a player's game runs them with
//  alone (shared/traffic.js) — so everyone sees the same traffic, and no
//  phone spends its time working it out.
//
//  What each player is sent ('tv'), ten times a second at most: only what
//  their game could not work out for itself. A game carries each car and
//  walker on at the speed it was last told (dead reckoning), so the room
//  keeps, for every player, what it last told them of each one, and sends
//  it again only when that has drifted from the truth — by more the further
//  it is from them (the fog hides a metre at 300 m) — or has not been sent
//  for a while. A car cruising down a street costs nothing; one stopping at
//  a light, or turning, a few words. Nothing of this side goes to a player
//  on the other side of the tear; they are told all of it when they return.
//
//  The signals the traffic obeys run on this clock (t, s); it is sent with
//  every word, and every game shows its lights by it.

import TF from '../shared/traffic.js';
import TROOP from '../shared/troop.js';
import CITY from '../shared/city.js';
import RULES from '../shared/rules.js';
import { theCity } from './combat.js';

const STEP = 0.05;                         // s: 20 Hz
const TELL_MS = 100;
const HDQ = TROOP.HDQ;
const AGE_CAP = 10;                        // s a game carries anything on unheard (the same in index.html): only if the words stop
//  how far it may drift from what a player's game shows before they are told again (m),
//  and how long it goes unsaid at most (s), by how far it is from them
const NEAR = 120, MID = 260;
const DRIFT = [0.3, 1.0, 3.0], STALE = [4, 6, 8];
const HEAD = 0.25;                         // rad a heading may be off before it is sent again
const KINDS = ['c', 'f', 'w'];

export class RoomTraffic {
  constructor(room, onCorpse) {
    this.room = room;                      // the Relay: players
    this.onCorpse = onCorpse || (() => {});
    this.t = 0; this.acc = 0; this.last = undefined; this.tellT = 0;
    this.T = TF.makeTraffic({ now: () => this.t });
    this.all = { c: this.T.cars, f: this.T.ferraris, w: this.T.walkers };
    for (const k of KINDS) for (const a of this.all[k]) { a.vx = 0; a.vz = 0; if (a.rx === undefined) { a.rx = a.wx; a.rz = a.wz; } }
    this.told = new Map();                 // player id → { c, f, w: Float64Array(n·7) [x, z, vx, vz, t, h, slip] }, or absent: tell them everything
    this.bytes = 0; this.sent = 0;         // (for tests and for a look: what the traffic has cost to send)
  }

  //  carrying on from what the host's game had (shared/traffic.js fullState);
  //  none: as the seed has it
  adopt(s) {
    if (s && TF.fullOk(s)) { TF.adoptFull(this.T, s); this.t = s.t; }
    this.told.clear();
  }
  full() { return TF.fullState(this.T); }

  //  Time moves on (now in ms)
  step(now) {
    const dt = this.last === undefined ? 0 : Math.min(0.5, (now - this.last) / 1000);
    this.last = now;
    this.acc += dt;
    const T = this.T;
    while (this.acc >= STEP) {
      this.acc -= STEP; this.t += STEP;
      for (const k of KINDS) for (const a of this.all[k]) { a.px = a.rx; a.pz = a.rz; }
      for (const a of T.cars) TF.stepCar(T, a, STEP);
      for (const a of T.ferraris) {
        TF.stepFerrari(T, a, STEP);
        for (const e of TF.mow(T, a.rx, a.rz, a.hd, a.halfW, a.halfL, a.speed)) this.killed(e, Math.sin(a.hd), Math.cos(a.hd), a.speed * 0.5);
      }
      for (const e of T.walkers) TF.stepWalker(T, e, STEP);
      //  (how fast what is drawn is going; not more than a little over its own
      //  speed — catching up after a corner, it briefly goes faster, and a
      //  game carrying that on would overshoot)
      for (const k of KINDS) for (const a of this.all[k]) {
        let vx = (a.rx - a.px) / STEP, vz = (a.rz - a.pz) / STEP;
        const v = Math.hypot(vx, vz), top = 1.5 * Math.max(0.5, a.speed || 0);
        if (v > top && k !== 'f') { vx *= top / v; vz *= top / v; }
        a.vx = vx; a.vz = vz;
      }
    }
  }
  //  a walker is down: a body where they fell (on every screen, and for the
  //  troop), and they rejoin the crowd somewhere else
  killed(e, dirx, dirz, power) {
    const sp = Math.max(3.5, Math.min(16, power)), R = this.T.rand;
    const c = { c: (R() * 2147483646 | 0) + 1, x: Math.round(e.wx * 10), z: Math.round(e.wz * 10),
      vx: Math.round((dirx + (R() - 0.5) * 0.5) * sp * 10), vz: Math.round((dirz + (R() - 0.5) * 0.5) * sp * 10), k: e.colr };
    this.onCorpse(c);
    TF.respawn(this.T, e);
    e.vx = 0; e.vz = 0; e.respawnT = this.t;
    this.forget('w', e.hidx);
  }
  forget(kind, k) { for (const B of this.told.values()) B[kind][k * 7 + 4] = NaN; }

  //  A round from player `from` at walker k: checked as a shot at a player
  //  is (up, on this side, the gun's rate, in range, in sight), and if it
  //  stands, they are down. Their game has already thrown the body.
  shot(from, k, now) {
    const e = this.T.walkers[k], me = this.room.players.get(from);
    const why = this.whyNot(me, e, now);
    if (why) { this.room.refused++; this.room.lastRefusal = 'at a walker: ' + why; return false; }
    me.lastPedHitT = now;
    TF.respawn(this.T, e); e.vx = 0; e.vz = 0; e.respawnT = this.t;
    this.forget('w', k);
    return true;
  }
  whyNot(me, e, now) {
    if (!me || me.dead) return 'shooter is down';
    if (me.w) return 'other side of the tear';
    if (!e) return 'no such walker';
    if (now - (me.lastPedHitT || -1e9) < RULES.FIRE_INTERVAL * 1000 * 0.75) return 'faster than the gun';
    const h = me.hist; if (h.length < 4) return 'not seen yet';
    const ro = { x: h[h.length - 3], y: h[h.length - 2] + RULES.EYE, z: h[h.length - 1] };
    const dx = e.wx - ro.x, dy = 1.15 - ro.y, dz = e.wz - ro.z, d = Math.hypot(dx, dy, dz);
    if (d > RULES.MAX_RANGE + 5) return 'out of range';
    if (d > 2.5 && CITY.rayLazy(theCity(), ro, { x: dx / d, y: dy / d, z: dz / d }, d) < d - 2.5) return 'no line of sight';
    return null;
  }

  //  Each player's word ('tv'), at most every TELL_MS: what has drifted
  //  from what their game shows, near them first to be told
  tell(now) {
    if (now - this.tellT < TELL_MS) return;
    this.tellT = now;
    const ts = now / 1000;
    for (const [id, p] of this.room.players) {
      const h = p.hist;
      if (p.w || h.length < 4) { this.told.delete(id); continue; }        // over there: all of it again on return
      let B = this.told.get(id);
      if (!B) { B = {}; for (const k of KINDS) B[k] = new Float64Array(this.all[k].length * 7).fill(NaN); this.told.set(id, B); }
      const qx = h[h.length - 3], qz = h[h.length - 1];
      const msg = { t: +this.t.toFixed(2) };
      let any = false;
      for (const kind of KINDS) {
        const out = [], b = B[kind], list = this.all[kind];
        for (let k = 0; k < list.length; k++) {
          const a = list[k], o = k * 7;
          const d = Math.hypot(a.rx - qx, a.rz - qz), band = d < NEAR ? 0 : d < MID ? 1 : 2;
          if (b[o + 4] === b[o + 4]) {                                      // (told before: not NaN)
            const age = ts - b[o + 4], ag = Math.min(age, AGE_CAP);
            const ex = b[o] + b[o + 2] * ag - a.rx, ez = b[o + 1] + b[o + 3] * ag - a.rz;
            let dh = Math.abs((a.hd || 0) - b[o + 5]) % 6.2832; if (dh > Math.PI) dh = 6.2832 - dh;
            const ds = Math.abs((a.slip || 0) - b[o + 6]);           // (a Ferrari's tail: out, or back in)
            //  (and by the next word: a car braking drifts faster than it has so far)
            const drift = Math.hypot(ex, ez) + Math.hypot(b[o + 2] - a.vx, b[o + 3] - a.vz) * TELL_MS / 1000;
            if (drift < DRIFT[band] && age < STALE[band] && dh < HEAD && !(ds > 0.08)) continue;
          }
          const x = Math.round(a.rx * 10), z = Math.round(a.rz * 10), vx = Math.round(a.vx * 10), vz = Math.round(a.vz * 10);
          const hb = Math.round(((((a.hd || 0) % 6.2832) + 6.2832) % 6.2832) * HDQ) % 256;
          //  (what their game will carry on from: what was sent, as it was sent)
          const sl = Math.round((a.slip || 0) * 100);
          b[o] = x / 10; b[o + 1] = z / 10; b[o + 2] = vx / 10; b[o + 3] = vz / 10; b[o + 4] = ts; b[o + 5] = hb / HDQ; b[o + 6] = sl / 100;
          out.push(k, x, z, vx, vz, hb);
          if (kind === 'f') out.push(sl);
        }
        if (out.length) { msg[kind] = out; any = true; }
      }
      if (!any && now - (B.quietT || 0) < 1000) continue;                  // (the clock, at least once a second)
      B.quietT = now;
      const text = this.room.send(id, 'tv', msg);
      this.sent++; if (text) this.bytes += text.length;
    }
  }
}
