//  ============================================================
//  CONTOUR — the other side's wildlife, run by the room  (B9d, B9e, B9f)
//  ============================================================
//  With two or more players in the room, the room runs the demodogs, the
//  demogorgons and the mind flayers that command them — the same code a
//  player's game runs them with alone (shared/dogs.js, gorgons.js,
//  flayers.js) — and they hunt everyone over there, not only the one whose
//  phone ran them. Fed from what the room knows: where each player is, which
//  side of the tear, whether they are down or cloaked, which way they face,
//  how fast they move (a sprint is heard) and when they fire (a shot is
//  heard across the district). The room decides the bites, the swings and
//  the flayers' blows and thrown cars, and judges every shot at any of them.
//  A flayer commands its escort here, in the room: it claims them, hands
//  them what it knows, summons more, and bleeds when they are hurt.
//
//  Everyone over there is sent them ('dv'), in the game's own snapshot
//  forms, ten times a second: the pack — every dog once in eight, and
//  between those the ones near someone over there and any whose health,
//  state or marks changed — every gorgon and every flayer (there are a
//  handful), a car in the air, and where the cars the flayers threw came
//  down. Nobody on the day side is sent any of it.
//
//  Their king — VECNA — still runs in the host's game (for now). What the
//  room needs of him it reads from the host's snapshots (where he stands,
//  and whether he stands); what he does to the dogs, gorgons and flayers the
//  host's game writes down and sends ('dord': claimed, handed a target, set
//  going, carried along, summoned — orders; and the wrecks he lifts and
//  throws), and the room makes it so. The other way, the host's game is told
//  what the dogs and gorgons know ('dk': he learns through them; the flayers'
//  own rows in 'dv' say what they know).

import DOG from '../shared/dogs.js';
import GOR from '../shared/gorgons.js';
import FL from '../shared/flayers.js';
import CITY from '../shared/city.js';
import WR from '../shared/wrecks.js';
import TF from '../shared/traffic.js';
import TROOP from '../shared/troop.js';
import RULES from '../shared/rules.js';
import { theCity, theFootprints } from './combat.js';

const STEP = 0.05;                         // s: 20 Hz
const TELL_MS = 100;                       // the pack and the gorgons, to everyone over there
const KNOW_MS = 500;                       // what they know, to the host's VECNA
const FULL_EVERY = 8;                      // every eighth word is the whole pack
const NEAR = 110;                          // m: a dog this near someone over there goes out every time (index.html DOG_NEAR)
const BITE_GAP = 420;                      // ms: a player bitten is not bitten again sooner (index.html dogHitCd)
const CLAW_GAP = 500;                      // ms: nor struck by a gorgon (index.html gorHitCd)
const CHEST = 1.0;                         // m above its feet: where a shot at a dog is aimed (the game's hit spheres)
const G_CHEST = 1.55;                      // … and at a gorgon (the second of its column of spheres)
//  … and at a flayer: the game's spheres on it (index.html fire) — the body,
//  eleven metres up, [along its heading, up, radius], and the six legs
//  [bearing off its heading, out, up, radius]. A round that could reach any
//  of them is taken as the one that did.
const MF_BODY = [[-1.7, FL.M_BODY_Y, 3.0], [1.1, FL.M_BODY_Y, 2.6], [4.4, FL.M_BODY_Y + 0.4, 1.9]];
const MF_LEGS = [0.52, 1.57, 2.62, -0.52, -1.57, -2.62].map((a) => [a, 8.5, FL.M_BODY_Y * 0.55, 1.5]);
const HDQ = TROOP.HDQ;
const LIM = RULES.WORLD * 0.44;

//  the city to walk in, once per isolate: its insides built as they are first needed
let ground = null;
function theGround() { if (!ground) { const L = CITY.lazyNear(theCity()); ground = CITY.ground(L.near, L.full); } return ground; }
let wreckSet = null;                       // where the wrecks lie (the same as every game: shared/wrecks.js)
function theWrecks() { return wreckSet || (wreckSet = WR.makeWrecks(TF.makeTraffic({ now: () => 0 }).cars)); }
const noop = () => {};
const int = (v) => (Number.isFinite(+v) ? Math.round(+v) : 0);

export class RoomDogs {
  constructor(room) {
    this.room = room;                      // the Relay: players
    this.t = 0; this.acc = 0; this.last = undefined; this.frame = 0; this.nowMs = 0;
    this.tellT = 0; this.knowT = 0; this.seq = 0; this.warm = 0;
    const G = theGround();
    this.F = theFootprints();
    //  (a room's own copy: its flayers, and the host's VECNA, pick them up and throw them)
    this.wrecks = theWrecks().map((w) => (w ? Object.assign({}, w) : null));
    this.mine = new Map();                 // wreck k → what the room last said of it: the ones its flayers moved
    this.who = [];                         // the players over there, as the animals see them (look)
    this.byId = new Map();
    this.vec = null;                       // the host's VECNA (hearMasters)
    const world = {
      now: () => this.t, random: Math.random,
      targets: () => this.who,
      clearAt: this.F.clearAt, supportHeight: G.supportHeight, collide: G.collide, bldAt: G.bldAt, navNext: G.navNext,
      rayCity: (ro, rd, max) => CITY.rayLazy(theCity(), ro, rd, max),
      wrecks: () => this.wrecks,
      master: (this.masterFn = (tag, slot) => this.master(tag, slot)),
      vec: () => this.vec,
    };
    const share = (x, z, dmg) => FL.shareDamage(this.M, x, z, dmg);
    this.D = DOG.makeDogs(Object.assign({}, world, {
      gorgons: () => this.G.gorgons,
      bite: (d) => this.bite(d),
      on: { call: noop, hurt: noop, death: noop, gone: noop, share },
    }));
    this.G = GOR.makeGorgons(Object.assign({}, world, {
      noises: () => this.D.noises,
      claw: (g, kind, reach, dmg) => this.claw(g, kind, reach, dmg),
      on: { wind: noop, swing: noop, growl: noop, roar: noop, hurt: noop, death: noop, gone: noop, share },
    }));
    const moved = (k) => { if (k >= 0 && !this.mine.has(k)) this.mine.set(k, null); };
    this.M = FL.makeFlayers(Object.assign({}, world, {
      dogs: () => this.D.dogs, gorgons: () => this.G.gorgons,
      spawnDog: () => DOG.spawnDog(this.D), spawnGorgon: (at) => GOR.spawnGorgon(this.G, at),
      hit: (m, t, dmg, kb, ox, oz, shake) => this.blow(t, dmg, kb, ox, oz, shake),
      //  (the crater itself everyone over there sees in the flayer's swing: 'dv')
      stomp: (m, cx, cz, hits) => { for (const h of hits) this.blow(h.t, h.dmg, h.kb, cx, cz, 0); },
      on: { roar: noop, summon: noop, wind: noop, swing: noop, launch: noop, fly: noop, far: noop, panic: noop, hurt: noop, death: noop, rift: noop, gone: noop,
        hold: (m) => moved(m.holdW), land: (T) => moved(T.k), drop: (w, k) => moved(k) },
    }));
    this.bytes = 0; this.sent = 0;         // (for tests and for a look: what they have cost to send)
  }
  get dogs() { return this.D.dogs; }
  get gorgons() { return this.G.gorgons; }
  get flayers() { return this.M.flayers; }

  //  carrying on from what the host's game had (shared/dogs.js, gorgons.js
  //  and flayers.js fullState: { k: the dogs, g: the gorgons, f: the
  //  flayers }); none: an empty district, stocked when someone is over there.
  //  The wrecks start again from where they lie in every game: the host's
  //  game says which of them are elsewhere (dord 'w'), as the room takes them.
  adopt(f) {
    this.wrecks = theWrecks().map((w) => (w ? Object.assign({}, w) : null));
    this.mine.clear();
    if (f && DOG.fullOk(f)) DOG.adoptFull(this.D, f);
    if (f && GOR.fullOk(f.g)) GOR.adoptFull(this.G, f.g);
    if (f && FL.fullOk(f.f)) FL.adoptFull(this.M, f.f);
    if (this.M.thrown) this.mine.set(this.M.thrown.k, null);
    //  (an empty district handed over is stocked at once, as it is when someone crosses)
    if (!this.D.dogs.some((d) => d.live)) this.D.spawnCd = 0;
    if (!this.G.gorgons.some((g) => g.live)) this.G.spawnCd = 0;
    this.took = this.D.dogs.filter((d) => d.live).map((d) => [d.slot, d.x, d.z]);
    this.tookG = this.G.gorgons.filter((g) => g.live).map((g) => [g.slot, g.x, g.z, g.hp]);
    this.tookF = this.M.flayers.filter((m) => m.live).map((m) => [m.slot, m.x, m.z, m.hp]);
  }
  full() { return Object.assign(DOG.fullState(this.D), { g: GOR.fullState(this.G), f: FL.fullState(this.M) }); }

  //  ---- who is over there -----------------------------------------------------
  //  every player on the other side, as a target: where (their last state),
  //  their floor and eyes, down or not, cloaked, facing; and the noise their
  //  feet make (a walk carries a sixth of a shot, a sprint nearly half)
  look(now) {
    const who = this.who; who.length = 0;
    for (const [id, p] of this.room.players) {
      const h = p.hist;
      if (!p.w || h.length < 4) { this.byId.delete(id); continue; }
      let t = this.byId.get(id);
      if (!t) this.byId.set(id, t = { id, pl: p, x: 0, z: 0, y: 0, ey: 0, dead: false, cloak: false, fx: 0, fz: -1, yaw: 0, noiseT: 0 });
      const n = h.length;
      t.x = h[n - 3]; t.y = h[n - 2]; t.z = h[n - 1]; t.ey = t.y + RULES.EYE;
      t.dead = !!p.dead; t.cloak = !!p.inv;
      const yaw = Number.isFinite(p.yaw) ? p.yaw : 0;
      t.yaw = yaw; t.fx = -Math.sin(yaw); t.fz = -Math.cos(yaw);
      //  how fast, over the last quarter second or so
      let k = n - 4;
      while (k >= 4 && h[n - 4] - h[k] < 250) k -= 4;
      const dtm = (h[n - 4] - h[k]) / 1000;
      const spd = dtm > 0.05 ? Math.hypot(h[n - 3] - h[k + 1], h[n - 1] - h[k + 3]) / dtm : 0;
      if (!t.dead && spd > 1.2 && now >= t.noiseT) {
        t.noiseT = now + (spd > 7 ? 450 : 800);
        DOG.noise(this.D, t.x, t.z, spd > 7 ? 0.42 : 0.16, 'step');
      }
      who.push(t);
    }
    return who.length;
  }
  //  a shot fired over there: everything in the district hears it
  heard(from) {
    const t = this.byId.get(from);
    if (t && !t.dead) DOG.noise(this.D, t.x, t.z, 1.0, 'shot');
  }

  //  ---- time moves on (now in ms) ------------------------------------------------
  step(now) {
    const dt = this.last === undefined ? 0 : Math.min(0.5, (now - this.last) / 1000);
    this.last = now; this.nowMs = now;
    //  nobody over there: none of them (a game clears its own as it leaves) —
    //  and the next to cross finds the district filling at once, not after the
    //  last top-up's wait
    if (!this.look(now)) {
      if (this.D.dogs.some((d) => d.live)) DOG.clearDogs(this.D);
      if (this.G.gorgons.some((g) => g.live)) GOR.clearGorgons(this.G);
      if (this.M.flayers.some((m) => m.live)) FL.clearFlayers(this.M);   // (its wait for the next goes on: it is rare)
      this.letFall();
      this.D.spawnCd = 0; this.G.spawnCd = 0; this.acc = 0;
      return;
    }
    this.acc += dt;
    const D = this.D, G = this.G, M = this.M;
    //  One more building's inside, each time, until the room has them all.
    //  Built only when first needed, a dog running along a street would now
    //  and then need several at once (a few tenths of a ms each) — the one
    //  call that paid for them all near the 10 ms a call has.
    const C = theCity();
    if (this.warm < C.buildings.length) C.rec(this.warm++);
    while (this.acc >= STEP) {
      this.acc -= STEP; this.t += STEP;
      DOG.stock(D, STEP);
      GOR.stock(G, STEP);
      this.frame++;
      for (const d of D.dogs) {
        if (!d.live) continue;
        if (d.rise < 1) d.rise = Math.min(1, d.rise + STEP / DOG.D_RISE_T);
        //  close by, a dog thinks every step; further off every third, eighth,
        //  twenty-fourth (40 / 90 / 200 m from the nearest player over there)
        const q = DOG.nearestTo(this.who, d.x, d.z).d, lod = q < 40 ? 0 : q < 90 ? 1 : q < 200 ? 2 : 3;
        const every = lod === 0 ? 1 : lod === 1 ? 3 : lod === 2 ? 8 : 24;
        if ((this.frame + d.slot) % every === 0) DOG.tick(D, d, STEP * every);
      }
      for (const g of G.gorgons) {
        if (!g.live) continue;
        if (g.rise < 1) g.rise = Math.min(1, g.rise + STEP / GOR.G_RISE_T);
        //  a fight always every step; otherwise by distance (50 / 110 / 220 m), as the game does
        const q = DOG.nearestTo(this.who, g.x, g.z).d, lod = q < 50 ? 0 : q < 110 ? 1 : q < 220 ? 2 : 3;
        const every = (GOR.fighting(g) || lod === 0) ? 1 : lod === 1 ? 3 : lod === 2 ? 8 : 24;
        if ((this.frame + g.slot) % every === 0) GOR.think(G, g, STEP * every);
      }
      //  the flayers: a car in the air; one at a time, rare, never alone; a fight
      //  every step, otherwise every third or eighth past 120 / 250 m (as the game)
      FL.flight(M, STEP);
      FL.stock(M, STEP);
      for (const m of M.flayers) {
        if (!m.live) continue;
        const q = DOG.nearestTo(this.who, m.x, m.z).d, lod = q < 120 ? 0 : q < 250 ? 1 : 2;
        const every = (FL.fighting(m) || lod === 0) ? 1 : lod === 1 ? 3 : 8;
        if ((this.frame + m.slot) % every === 0) FL.think(M, m, STEP * every);
        DOG.lordOf(m, STEP, this.masterFn);             // (VECNA's, while he is up and near)
      }
      //  and the dogs get out of the gorgons' way
      for (const g of G.gorgons) if (g.live && !g.dead) DOG.shove(D, g, STEP);
    }
  }
  //  a car in the air as they go comes down where it is
  letFall() {
    const T = this.M.thrown; if (!T) return;
    const w = this.wrecks[T.k];
    if (w) { w.x = T.x; w.z = T.z; w.y = theGround().supportHeight(T.x, T.z, T.y + 1); w.thrown = false; this.mine.set(T.k, null); }
    this.M.thrown = null;
  }
  //  whoever is in reach of a lunge, on its floor, and not bitten a moment ago
  bite(d) {
    let best = null, bd = DOG.D_BITE_R;
    for (const t of this.who) {
      if (t.dead || this.nowMs < (t.pl.bittenT || 0)) continue;
      const e = Math.hypot(t.x - d.x, t.z - d.z);
      if (e < bd && CITY.onSameLevel(d.y, t.y)) { bd = e; best = t; }
    }
    if (!best) return;
    best.pl.bittenT = this.nowMs + BITE_GAP;
    this.room.damage(best.id, DOG.D_BITE_DMG, null, this.nowMs, 'dog');
  }
  //  a gorgon's swing, its window open: whoever is in reach, on its floor, and
  //  not struck a moment ago takes it (the face — 'pred' — they feel as such)
  claw(g, kind, reach, dmg) {
    let best = null, bd = reach;
    for (const t of this.who) {
      if (t.dead || this.nowMs < (t.pl.clawedT || 0)) continue;
      const e = Math.hypot(t.x - g.x, t.z - g.z);
      if (e < bd && CITY.onSameLevel(g.y, t.y)) { bd = e; best = t; }
    }
    if (!best) return false;
    best.pl.clawedT = this.nowMs + CLAW_GAP;
    this.room.damage(best.id, dmg, null, this.nowMs, kind === 'pred' ? 'gorpred' : 'gor');
    return true;
  }
  //  a flayer's blow (or a car it threw) on player t: the damage, and — for the
  //  game to do, the room cannot move them — how far they are knocked, from
  //  where, and how hard it shakes ('hp' { src: 'mf', kb: [x·10, z·10, m·10], sh: ·100 })
  blow(t, dmg, kb, ox, oz, shake) {
    const x = { sh: Math.round(shake * 100) };
    if (kb) x.kb = [Math.round(ox * 10), Math.round(oz * 10), Math.round(kb * 10)];
    this.room.damage(t.id, dmg, null, this.nowMs, 'mf', x);
  }

  //  ---- what everyone over there is told ---------------------------------------
  tell(now) {
    if (!this.who.length) return;
    if (now - this.tellT >= TELL_MS) {
      this.tellT = now;
      const full = this.seq++ % FULL_EVERY === 0, who = this.who;
      const k = DOG.snapRows(this.D, full, (d) => who.some((t) => Math.abs(t.x - d.x) < NEAR && Math.abs(t.z - d.z) < NEAR));
      const p = { q: GOR.snapRows(this.G), f: FL.snapRows(this.M) };
      if (k) { p.k = k; p.kf = full ? 1 : 0; }
      const fly = FL.flightRow(this.M), w = this.wreckRows(full);
      if (fly) p.fly = fly;
      if (w.length) p.w = w;
      this.say('dv', p);
    }
    //  and the host's game, whose VECNA learns through them: what each knows
    //  (the flayers say so in their own rows)
    if (this.vec && now - this.knowT >= KNOW_MS) {
      this.knowT = now;
      const host = this.room.host(), rows = [], grows = [];
      for (const d of this.D.dogs) {
        if (!d.live || d.dead || !d.hasT) continue;
        const age = this.t - d.seeT;
        if (age < 9) rows.push(d.slot, Math.round(d.tx * 10), Math.round(d.tz * 10), Math.round(age * 10));
      }
      for (const g of this.G.gorgons) {
        if (!g.live || g.dead || !g.hasT) continue;
        const age = this.t - g.seeT;
        if (age < GOR.G_MEM) grows.push(g.slot, Math.round(g.tx * 10), Math.round(g.tz * 10), Math.round(age * 10));
      }
      if (host && this.byId.has(host)) this.room.send(host, 'dk', { k: rows, g: grows });
    }
  }
  //  The wrecks the flayers here moved, per wreck [k, x·10, z·10, y·10,
  //  heading·1000, up (1 held, 2 in the air)]: those that changed since last
  //  said, or all of them (full). What VECNA moves is the host's own to say.
  wreckRows(full) {
    const rows = [];
    for (const [k, was] of this.mine) {
      const w = this.wrecks[k]; if (!w) continue;
      const up = (w.held ? 1 : 0) | (w.thrown ? 2 : 0);
      const r = [k, Math.round(w.x * 10), Math.round(w.z * 10), Math.round(w.y * 10), Math.round(w.rot * 1000), up];
      if (full || !was || r.some((v, i) => v !== was[i])) { rows.push(...r); this.mine.set(k, r); }
    }
    return rows;
  }
  //  the same word to everyone over there
  say(s, p) {
    let text = null;
    for (const t of this.who) {
      if (text === null) text = this.room.send(t.id, s, p);
      else this.room.out.push([t.id, text]);
      this.bytes += text.length; this.sent++;
    }
  }

  //  ---- the host's VECNA ------------------------------------------------------------
  //  from its snapshot: v [x·10, z·10, heading, hp, state, marks (1 dead, 2
  //  awake), …]. How fast he moves (an escort keeps pace) is how far he went
  //  since the last.
  hearMasters(p, now) {
    const v = p.v;
    if (Array.isArray(v) && Number.isFinite(+v[0]) && Number.isFinite(+v[1])) {
      const x = +v[0] / 10, z = +v[1] / 10, was = this.vec;
      let sp = was ? was.sp : 0;
      if (was && was.at) { const dt = (now - was.at) / 1000; if (dt > 0.02) sp = Math.min(12, Math.hypot(x - was.x, z - was.z) / dt) * 0.5 + was.sp * 0.5; }
      this.vec = { live: true, dead: !!(v[5] & 1), awake: !!(v[5] & 2), x, z, y: 0, hd: +v[2] / HDQ || 0, sp, at: now };
    } else this.vec = null;
  }
  //  the flayer (the room's own) or VECNA (the host's) one is sworn to, if it stands
  master(tag, slot) {
    if (tag === 'vec') { const v = this.vec; return v && v.live && !v.dead && v.awake ? v : null; }
    const f = this.M.flayers[slot]; return f && f.live && !f.dead ? f : null;
  }

  //  What the host's VECNA did to the dogs, gorgons and flayers (index.html
  //  dogOrdersSend), each [what, …] — for a gorgon the same with a 'g' before,
  //  for a flayer with an 'f':
  //    ['l', dog, lord (0 none, 1 flayer, 2 VECNA), the flayer's slot]   claimed, or let go
  //    ['t', dog, x·10, z·10, seen ago·10]                             handed a target
  //    ['s', dog, state (, flee time·10: a flayer)]                    told what to do
  //    ['p', dog, x·10, z·10]                                          carried (VECNA's blink)
  //    ['n', x·10, z·10, lord, slot, knows, x·10, z·10, ago·10, state]  summoned
  //    ['fk', flayer, panicked (1/0)]                                  steadied, or broken
  //    ['w', wreck, x·10, z·10, heading·1000, up (1 held, 2 thrown)]  a wreck picked up, or where it came down
  //  A summons past a master's retinue (shared/dogs.js, gorgons.js RETINUE) or
  //  the district's number is not made; one carried into a wall is not moved;
  //  a wreck a flayer here has in its hand, or in the air, is its own.
  orders(p) {
    const list = Array.isArray(p.o) ? p.o.slice(0, 96) : [];
    const lordOf = (c, s) => (c === 1 ? ['mf', s === 1 ? 1 : 0] : c === 2 ? ['vec', -1] : [null, -1]);
    const at = (x, z) => { x = +x / 10; z = +z / 10; return Number.isFinite(x) && Number.isFinite(z) && Math.abs(x) < LIM && Math.abs(z) < LIM ? [x, z] : null; };
    for (const o of list) {
      if (!Array.isArray(o) || typeof o[0] !== 'string') continue;
      if (o[0] === 'w') {
        const k = int(o[1]), w = this.wrecks[k], q = at(o[2], o[3]), up = int(o[5]);
        if (!w || !q || this.flayerHas(k)) continue;
        w.x = q[0]; w.z = q[1]; if (Number.isFinite(+o[4])) w.rot = +o[4] / 1000; w.held = !!(up & 1); w.thrown = !!(up & 2);
        this.mine.delete(k);
        continue;
      }
      const pre = o[0].length === 2 ? o[0][0] : '', op = pre ? o[0][1] : o[0];
      const gor = pre === 'g', fl = pre === 'f';
      if (pre && !gor && !fl) continue;
      if (op === 'n') { if (!fl) this.summon(o, gor, lordOf, at); continue; }
      const a = fl ? this.M.flayers[int(o[1])] : gor ? this.G.gorgons[int(o[1])] : this.D.dogs[int(o[1])];
      if (!a || !a.live || a.dead) continue;
      if (op === 'l') {
        const [l, s] = lordOf(int(o[2]), int(o[3]));
        if (fl && l === 'mf') continue;                // (a flayer answers to VECNA or nobody)
        a.lord = l; a.lordSlot = s; a.lordFar = 0;
      } else if (op === 't') { const q = at(o[2], o[3]); if (q) { a.hasT = true; a.tx = q[0]; a.tz = q[1]; a.seeT = this.t - Math.max(0, +o[4] / 10 || 0); } }
      else if (op === 's') {
        const st = (fl ? FL.MF_ST : gor ? GOR.G_ST : DOG.D_ST)[int(o[2])];
        //  (a gorgon or a flayer mid-swing finishes it: it is not told out of one)
        if (st && st !== a.st && !((gor || fl) && a.atk) && st !== 'attack') {
          a.st = st; a.stT = 0; a.hasHide = false;
          if (fl && st === 'flee') { a.fleeT = Math.max(1, Math.min(60, +o[3] / 10 || 30)); a.fleeX = 0; }
        }
      } else if (op === 'k') { if (fl) a.panicked = !!int(o[2]); }
      else if (op === 'p' && !fl) {
        const q = at(o[2], o[3]);
        if (q && this.F.clearAt(q[0], q[1], 1.2)) { a.x = a.rx = q[0]; a.z = a.rz = q[1]; a.y = theGround().supportHeight(q[0], q[1], 1); a.stuck = 0; }
      }
    }
  }
  //  is wreck k in a flayer's hand here, or in the air?
  flayerHas(k) {
    if (this.M.thrown && this.M.thrown.k === k) return true;
    for (const m of this.M.flayers) if (m.live && m.atk && m.atk.kind === 'throw' && m.holdW === k) return true;
    return false;
  }
  summon(o, gor, lordOf, at) {
    const q = at(o[1], o[2]), [l, s] = lordOf(int(o[3]), int(o[4]));
    if (!q || !l || !this.F.clearAt(q[0], q[1], 1.0)) return;
    const all = gor ? this.G.gorgons : this.D.dogs;
    const have = all.reduce((n, a) => n + (a.live && !a.dead && a.lord === l && (l === 'vec' || a.lordSlot === s) ? 1 : 0), 0);
    if (have >= (gor ? GOR.RETINUE : DOG.RETINUE)[l]) return;
    const a = gor ? GOR.spawnGorgon(this.G, { x: q[0], z: q[1] }) : DOG.spawnDog(this.D);
    if (!a) return;
    a.x = a.rx = q[0]; a.z = a.rz = q[1]; a.y = theGround().supportHeight(q[0], q[1], 1);
    a.lord = l; a.lordSlot = s;
    const tq = at(o[6], o[7]);
    if (int(o[5]) && tq) { a.hasT = true; a.tx = tq[0]; a.tz = tq[1]; a.seeT = this.t - Math.max(0, +o[8] / 10 || 0); }
    const st = (gor ? GOR.G_ST : DOG.D_ST)[int(o[9])];
    a.st = st && st !== 'attack' ? st : a.hasT ? 'chase' : 'escort'; a.stT = 0;
    a.rise = 0; a.taint = 0.5;
  }

  //  ---- a round at one of them -------------------------------------------------------
  //  From player `from` at dog (or gorgon) i: checked (the gun ready, the
  //  shooter up and over there, it in reach and in sight), and if it stands it
  //  lands here, as it would in the game that ran them. Returns whether it stood.
  shot(from, i, now, gor) {
    const a = gor ? this.G.gorgons[i] : this.D.dogs[i], me = this.room.players.get(from);
    const why = this.whyNot(me, a, now, a ? [[a.x, a.y + (gor ? G_CHEST : CHEST), a.z, 0]] : null);
    if (why) { this.room.refused++; this.room.lastRefusal = 'at a ' + (gor ? 'gorgon' : 'dog') + ': ' + why; return false; }
    me.lastMobHitT = now;
    const h = me.hist;
    if (gor) GOR.hurt(this.G, a, RULES.DMG, h[h.length - 3], h[h.length - 1]);
    else DOG.hurt(this.D, a, RULES.DMG, h[h.length - 3], h[h.length - 1]);
    return true;
  }
  //  … and at flayer i: anywhere on it (its body up there, or a leg)
  mfShot(from, i, now) {
    const m = this.M.flayers[i], me = this.room.players.get(from);
    let pts = null;
    if (m) {
      const s = Math.sin(m.hd), c = Math.cos(m.hd);
      pts = MF_BODY.map(([off, up, r]) => [m.x + s * off, m.y + up, m.z + c * off, r])
        .concat(MF_LEGS.map(([b, out, up, r]) => [m.x + Math.sin(m.hd + b) * out, m.y + up, m.z + Math.cos(m.hd + b) * out, r]));
    }
    const why = this.whyNot(me, m, now, pts);
    if (why) { this.room.refused++; this.room.lastRefusal = 'at a flayer: ' + why; return false; }
    me.lastMobHitT = now;
    const h = me.hist;
    FL.hurt(this.M, m, RULES.DMG, h[h.length - 3], h[h.length - 1]);
    return true;
  }
  //  pts: where on it a round could land, [x, y, z, radius] — one of them in reach and in sight will do
  whyNot(me, a, now, pts) {
    if (!me || me.dead) return 'shooter is down';
    if (!me.w) return 'other side of the tear';
    if (!a || !a.live || a.dead) return 'no such one';
    if (now - (me.lastMobHitT || -1e9) < RULES.FIRE_INTERVAL * 1000 * 0.75) return 'faster than the gun';
    const h = me.hist; if (h.length < 4) return 'not seen yet';
    const ro = { x: h[h.length - 3], y: h[h.length - 2] + RULES.EYE, z: h[h.length - 1] };
    let why = 'out of range';
    for (const [x, y, z, r] of pts) {
      const dx = x - ro.x, dy = y - ro.y, dz = z - ro.z, dist = Math.hypot(dx, dy, dz);
      if (dist - r > RULES.MAX_RANGE + 5) continue;
      //  (it moves while the shot is on its way here: a wall within a couple of
      //  metres of where the room has it is not taken as in the way)
      const slack = 2.5 + r;
      if (dist > slack && CITY.rayLazy(theCity(), ro, { x: dx / dist, y: dy / dist, z: dz / dist }, dist) < dist - slack) { why = 'no line of sight'; continue; }
      return null;
    }
    return why;
  }
}
