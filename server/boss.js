//  ============================================================
//  CONTOUR — Beelzebub, run by the room  (B9)
//  ============================================================
//  With two or more players in the room, the room runs Beelzebub itself,
//  so nobody's phone carries him for everyone else: the same mind and body
//  the game runs (lab/core/boss_runner.js), fed from what the room knows —
//  where each player is, which way they face, their health — and judged in
//  the same shared city. Everyone is sent the same account of him (the
//  game's own snapshot format), everyone's shots at him are checked and
//  land here, and each player's game still judges his blade against itself.
//
//  What he learns is kept for every room (mindstore.js): each fight the
//  room runs is run with the candidate readout the memory handed it, and
//  scored as it goes (boss_runner.js fightScore); at its end the score goes
//  back, with what he has learned of the players he fought. At the start of
//  each, what the memory knows of the players here goes into his mind.
//
//  Costs, measured (server/test/boss.test.js): a step is a few hundredths of
//  a millisecond on average; the first few calls in a fresh isolate cost
//  more while the code warms (his core, his mind, his first senses and his
//  first thought, a few ms each), so each gets a call of its own and none
//  comes near the free plan's 10 ms.

import CITY from '../shared/city.js';
import RULES from '../shared/rules.js';
import BRAIN from './brain.js';
import { theCity, theFootprints } from './combat.js';
import { fileable } from './mindstore.js';
import BR from '../lab/core/boss_runner.js';          // the lab's modules are CommonJS: each is its module.exports
import NEURAL from '../lab/core/neural.js';
import BODY from '../lab/core/boss_body.js';

const { NeuralCore } = NEURAL, { ATTACKS } = BODY;

export const MODES = ['ground', 'fly', 'attack', 'guard', 'dead'];     // as the game numbers them (index.html BZ_MODES)
export const PHASES = ['wind', 'travel', 'act', 'rec'];
export const KINDS = BR.KINDS;
const HDQ = 255 / 6.2832;                  // a heading in a byte
const STEP = 0.025;                        // s: 40 Hz, so senses (20 Hz) and thinking (10 Hz) fall on different steps, as at a phone's frame rate
const WORLD_LIM = RULES.WORLD * 0.46;
const GONE_AFTER = 9.5;                    // s he lies there before he is gone (the game's fade)
//  where he can be shot: shins, chest, head (index.html bzbRayHit)
const SPHERES = [[1.2, 0.75], [2.6, 0.85], [3.6, 0.95], [4.3, 0.42]];


export class RoomBoss {
  constructor(room) {
    this.room = room;                      // the Relay: players, names, clock
    this.ai = null;                        // his mind, made the first time he is needed
    this.st = null;                        // what everyone is told of him (as the game's `bzb`); null when he is not standing
    this.gate = null;                      // { x, z, ry, seed } the tear he guards
    this.slain = new Set();                // tears at which he has fallen (B7)
    this.acc = 0; this.t = 0; this.deadT = 0;
    const F = theFootprints();
    this.peers = new Map();                // the adapter's view of the players (refilled each step)
    this.env = {
      world: {
        blocked: (x, z, r) => Math.abs(x) > WORLD_LIM || Math.abs(z) > WORLD_LIM || !F.clearAt(x, z, r),
        ground: () => 0,
        roof: F.roof,
      },
      G: {
        now: () => this.t, p: null, MP: { id: '__room', peers: this.peers },
        rayCity: (ro, rd, max) => CITY.rayLazy(theCity(), ro, rd, max === undefined ? Infinity : max),
        clearAt: F.clearAt,
      },
      core: null, mind: null,
      seed: () => (Math.random() * 1e9) | 0,
      nameOf: (id) => { const p = room.players.get(id); return (p && p.name) || id; },
      clock: () => Date.now(),
      onHit: () => {},                     // each player's game judges his blade against itself
      onSwing: () => {},
      onDecision: () => {},
      onSave: () => this.remember(),       // half a minute of fighting
    };
    this.fightId = null;                   // the candidate this fight is run with (null: none came)
    this.savedT = -Infinity;               // his time when what he learned was last sent to the memory
  }

  //  what the host last said of him, when the room takes him over
  //  (the game's snapshot: x, z, alt, heading, hp, hpMax, mode, swings, kind, phase, seed)
  adopt(k) {
    if (!this.gate) return;
    this.mindUp(true);
    const st = { x: k[0] / 10, z: k[1] / 10, alt: k[2] / 10, hd: k[3] / HDQ, hp: k[4], hpMax: k[5], mode: MODES[k[6]] || 'ground',
      atkSeq: k[7] | 0, atkKind: KINDS[k[8]] || null, atkPhase: PHASES[k[9]] || null, seed: k[10], vx: 0, vz: 0 };
    BR.adoptBody(this.ai, this.env, st, this.gate);
    this.st = st; this.deadT = 0;
    if (st.mode !== 'dead') this.begin();
    this.took = { x: st.x, z: st.z, hp: st.hp };           // (what it was taken from: for a test, and for a look in the logs)
  }
  //  his core in one call, the rest of his mind in the next (each is a few
  //  ms the first time an isolate does it, before the code is warm)
  mindUp(all) {
    if (this.ai) return;
    if (!this.env.core) { this.env.core = NeuralCore.fromPrepared(BRAIN.core); this.env.core.trained = BRAIN.trained; if (!all) return; }
    this.ai = BR.makeMind(this.env);
  }

  //  the tear, as the host's snapshot has it; none means it has closed
  hearGate(g) {
    if (!g) { this.gate = null; return; }
    const seed = g[4];
    if (this.gate && this.gate.seed !== seed && this.st && this.st.mode === 'dead') this.st = null;   // he fell at the old one
    this.gate = { x: g[0] / 10, z: g[2] / 10, ry: g[3] / 1000, seed };
    if (this.st && this.st.mode !== 'dead') this.st.seed = seed;          // a new tear elsewhere: he goes to it
  }
  hearSlain(seed) { if (seed !== undefined && seed !== null) this.slain.add(seed); }

  //  Time moves on (now in ms). Steps him at 20 Hz; stands him up when the
  //  tear is open and he has not fallen at it; lets him go when it closes.
  step(now) {
    const dt = this.last === undefined ? 0 : Math.min(0.5, (now - this.last) / 1000);   // (a long gap is not caught up)
    this.last = now;
    if (!this.gate) { if (this.st) this.end(); this.st = null; return; }
    if (!this.st) {
      if (this.slain.has(this.gate.seed)) return;
      if (!this.ai) { this.mindUp(); return; }                       // made over two calls …
      this.standUp(); return;                                         // … stood up in the next
    }
    if (this.st.mode === 'dead') {
      this.deadT += dt;
      if (this.deadT > GONE_AFTER) this.st = null;
      return;
    }
    this.acc += dt;
    const targets = this.targets();
    while (this.acc >= STEP) {
      this.acc -= STEP; this.t += STEP;
      BR.think(this.ai, this.env, STEP, this.t, targets, this.gate, this.st);
      if (!this.ai.body.alive || this.ai.body.mode === 'dead') { this.fall(); break; }
    }
  }
  standUp() {
    const post = this.post();
    let n = 0;
    for (const p of this.room.players.values()) if (!p.dead && !p.w) n++;
    const hpMax = RULES.BZB_HP * (1 + 0.6 * (Math.max(1, n) - 1));
    const b = BR.giveBody(this.ai, this.env, post.x, post.z, post.hd, hpMax, this.gate);
    this.st = { x: b.x, z: b.z, alt: 0, hd: post.hd, vx: 0, vz: 0, hp: b.hp, hpMax: b.hpMax, mode: 'ground',
      atkSeq: 0, atkKind: null, atkPhase: null, seed: this.gate.seed };
    this.deadT = 0;
    this.begin();
  }
  fall() {
    this.st.mode = 'dead'; this.st.hp = 0; this.st.atkKind = null; this.st.atkPhase = null;
    this.slain.add(this.st.seed); this.deadT = 0;
    this.end();
  }

  //  ---- what he learns (mindstore.js) -------------------------------------------
  //  A fight begins: with the memory's candidate if one has come (else the
  //  readout as the memory last had it, else the lab's), knowing what the
  //  memory knows of whoever is here, and scored from now on.
  begin() {
    const C = this.room.creatures, c = C.cand;
    C.cand = null;
    this.fightId = c && this.env.core.setReadout(c) ? c.id : null;
    if (this.fightId === null && C.ro) this.env.core.setReadout(C.ro);
    this.recall();
    BR.fightStart(this.ai);
    C.wantMind();                          // (the next fight's candidate)
  }
  //  It ends — he falls, the tear closes, or the room gives him back: how it
  //  went goes to the memory (a fight too short to say: the candidate is
  //  handed out again), with what he learned of the players.
  end() {
    const ai = this.ai;
    if (!ai || !ai.tally) return;
    const sc = BR.fightScore(ai);
    ai.tally = null;
    if (this.fightId !== null) this.room.ask({ k: 'report', id: this.fightId, s: sc ? sc.s : null, n: sc ? sc.n : 0 });
    this.fightId = null;
    this.remember();
  }
  //  What the memory has of the players here, into his mind: each one's
  //  model, unless he has learned something newer of them himself; and
  //  where the fairness had settled for them, on average.
  recall() {
    const ai = this.ai, C = this.room.creatures;
    let fs = 0, fn = 0;
    for (const p of this.room.players.values()) {
      const e = C.known.get(p.name);
      if (!e) continue;
      const had = ai.bank.models.get(p.name);
      if (!had || this.wallOf(had.lastT) < e.t) ai.bank.restore({ v: 1, players: { [p.name]: { t: -1, m: e.m } } }, ai.fair.mind);
      if (ai.pmName === p.name) { ai.pm = null; ai.pmName = ''; }      // (picked up afresh)
      if (Number.isFinite(e.f)) { fs += e.f; fn++; }
    }
    if (fn) ai.fair.setLevel(fs / fn);
  }
  //  What he has learned of the players he has seen since it was last sent
  remember() {
    const ai = this.ai;
    if (!ai) return;
    const players = {}, C = this.room.creatures;
    let any = false;
    //  (a model's time is when he last turned to them; whoever he is on now, he sees now)
    const cur = ai.pmName && ai.bank.models.get(ai.pmName);
    if (cur) cur.lastT = Math.max(cur.lastT, ai.now);
    for (const [name, e] of ai.bank.models) {
      if (e.lastT < 0 || e.lastT <= this.savedT || !fileable(name)) continue;
      const ent = { t: this.wallOf(e.lastT), m: e.model.serialize(), f: +ai.fair.level.toFixed(4) };
      players[name] = ent; C.learnt(name, ent); any = true;
    }
    this.savedT = this.t;
    if (any) this.room.ask({ k: 'save', players });
  }
  //  his time (s) as the time of day (ms), for the memory
  wallOf(t) { return t < 0 ? -Infinity : Math.round((this.last || 0) - (this.t - t) * 1000); }
  //  Where he stands: in the street in front of the tear, or the nearest open
  //  street to it (index.html bzbPost, in the shared city)
  post() {
    const g = this.gate, w = this.env.world, fx = Math.sin(g.ry), fz = Math.cos(g.ry);
    for (const r of [5, 7, 10, 14]) for (const a of [0, 0.5, -0.5, 1, -1]) {
      const x = g.x + (fx * Math.cos(a) - fz * Math.sin(a)) * r, z = g.z + (fz * Math.cos(a) + fx * Math.sin(a)) * r;
      if (!w.blocked(x, z, 2.2) && w.roof(x, z) <= 0) return { x, z, hd: Math.atan2(fx, fz) };
    }
    for (let r = 8; r < 60; r += 4) for (let k = 0; k < 16; k++) {
      const a = k * Math.PI / 8, x = g.x + Math.sin(a) * r, z = g.z + Math.cos(a) * r;
      if (!w.blocked(x, z, 2.2) && w.roof(x, z) <= 0) return { x, z, hd: Math.atan2(g.x - x, g.z - z) + Math.PI };
    }
    return { x: g.x + fx * 6, z: g.z + fz * 6, hd: Math.atan2(fx, fz) };
  }
  //  the players he can reach, and what his senses read of everyone
  targets() {
    const list = this.tlist || (this.tlist = []);
    list.length = 0;
    this.peers.clear();
    for (const [id, p] of this.room.players) {
      const h = p.hist; if (h.length < 4) continue;
      const x = h[h.length - 3], y = h[h.length - 2], z = h[h.length - 1];
      this.peers.set(id, { cur: { x, y, z }, yaw: p.yaw || 0, hp: p.hp, dead: p.dead, inv: !!p.inv, w: p.w || 0 });
      if (!p.dead && !p.w) list.push({ id, x, z, y, alive: true });
    }
    return list;
  }

  //  a round from player `from`; returns what it took (0: none)
  shot(from, now) {
    if (!this.st || this.st.mode === 'dead' || !this.ai || !this.ai.body) return 0;
    const me = this.room.players.get(from);
    const why = this.whyNot(me, now);
    if (why) { this.room.refused++; this.room.lastRefusal = 'at Beelzebub: ' + why; return 0; }
    me.lastBossHitT = now;
    const h = me.hist, x = h[h.length - 3], z = h[h.length - 1];
    const got = BR.hurt(this.ai, RULES.DMG, x, z, from, this.t);
    this.st.hp = this.ai.body.hp;
    if (!this.ai.body.alive) this.fall();
    return got;
  }
  whyNot(me, now) {
    if (!me || me.dead) return 'shooter is down';
    if (me.w) return 'other side of the tear';
    if (now - (me.lastBossHitT || -1e9) < RULES.FIRE_INTERVAL * 1000 * 0.75) return 'faster than the gun';
    const h = me.hist; if (h.length < 4) return 'not seen yet';
    const ro = { x: h[h.length - 3], y: h[h.length - 2] + RULES.EYE, z: h[h.length - 1] }, rd = { x: 0, y: 0, z: 0 };
    let near = Infinity;
    for (const [hy, rr] of SPHERES) {
      const dx = this.st.x - ro.x, dy = this.st.alt + hy - ro.y, dz = this.st.z - ro.z, d = Math.hypot(dx, dy, dz);
      near = Math.min(near, d);
      if (d > RULES.MAX_RANGE + 5) continue;
      rd.x = dx / d; rd.y = dy / d; rd.z = dz / d;
      if (CITY.rayLazy(theCity(), ro, rd, d) >= d - rr - 0.4) return null;
    }
    return near > RULES.MAX_RANGE + 5 ? 'out of range' : 'no line of sight';
  }
  heard(from) {
    if (!this.ai || !this.ai.body) return;
    const me = this.room.players.get(from), h = me && me.hist;
    if (h && h.length >= 4) BR.heard(this.ai, from, h[h.length - 3], h[h.length - 2], h[h.length - 1]);
  }

  //  what everyone is told: the game's own snapshot of him (bzbSnapshot), or null
  snapshot() {
    const s = this.st; if (!s) return null;
    const h = (((s.hd || 0) % 6.2832) + 6.2832) % 6.2832;
    return [Math.round(s.x * 10), Math.round(s.z * 10), Math.round(s.alt * 10), Math.round(h * HDQ),
      Math.max(0, Math.round(s.hp)), Math.round(s.hpMax), MODES.indexOf(s.mode),
      s.atkSeq, KINDS.indexOf(s.atkKind), PHASES.indexOf(s.atkPhase), s.seed];
  }
}
export { ATTACKS };
