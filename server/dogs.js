//  ============================================================
//  CONTOUR — the other side, run by the room  (B9d–B9g)
//  ============================================================
//  With two or more players in the room, the room runs everything on the
//  other side of the tear: the demodogs, the demogorgons, the mind flayers
//  that command them and VECNA, whom they all answer to — the same code a
//  player's game runs them with alone (shared/dogs.js, gorgons.js,
//  flayers.js, vecna.js) — and they hunt everyone over there, not only the
//  one whose phone ran them. Fed from what the room knows: where each player
//  is, which side of the tear, whether they are down or cloaked, which way
//  they face, how fast they move (a sprint is heard) and when they fire (a
//  shot is heard across the district). The room decides every bite, swing,
//  blow, thrown car and grip, and judges every shot at any of them. The
//  chain of command is all in here: a flayer claims its escort, VECNA his
//  court and the flayers; they learn through one another, hand targets down,
//  summon, bleed and carry each other along.
//
//  Everyone over there is sent them ('dv'), in the game's own snapshot
//  forms, ten times a second: the pack — every dog once in eight, and
//  between those the ones near someone over there and any whose health,
//  state or marks changed — every gorgon and every flayer (there are a
//  handful), VECNA and the street he holds about him, the cars in the air,
//  and where the cars they moved came to rest. Nobody on the day side is sent
//  any of it. What a player's game must do because of them — be knocked
//  down the street, be held off the ground — it is told, and does.

import DOG from '../shared/dogs.js';
import GOR from '../shared/gorgons.js';
import FL from '../shared/flayers.js';
import VC from '../shared/vecna.js';
import CITY from '../shared/city.js';
import WR from '../shared/wrecks.js';
import TF from '../shared/traffic.js';
import RULES from '../shared/rules.js';
import { theCity, theFootprints } from './combat.js';

const STEP = 0.05;                         // s: 20 Hz
const TELL_MS = 100;                       // what they are, to everyone over there
const FULL_EVERY = 8;                      // every eighth word is the whole of it
const NEAR = 110;                          // m: a dog this near someone over there goes out every time (index.html DOG_NEAR)
const BITE_GAP = 420;                      // ms: a player bitten is not bitten again sooner (index.html dogHitCd)
const CLAW_GAP = 500;                      // ms: nor struck by a gorgon (index.html gorHitCd)
//  VECNA's grip (index.html updatePsyHold): lifted 0.85 s, dragged in, hurt
//  0.9 s into the drag, thrown at 1.7 — the game plays it, the room keeps time
const GRIP_HURT = 1750, GRIP_END = 2700;   // ms after he takes hold
const CHEST = 1.0;                         // m above its feet: where a shot at a dog is aimed (the game's hit spheres)
const G_CHEST = 1.55;                      // … and at a gorgon (the second of its column of spheres)
//  … and at a flayer: the game's spheres on it (index.html fire) — the body,
//  eleven metres up, [along its heading, up, radius], and the six legs
//  [bearing off its heading, out, up, radius]. A round that could reach any
//  of them is taken as the one that did.
const MF_BODY = [[-1.7, FL.M_BODY_Y, 3.0], [1.1, FL.M_BODY_Y, 2.6], [4.4, FL.M_BODY_Y + 0.4, 1.9]];
const MF_LEGS = [0.52, 1.57, 2.62, -0.52, -1.57, -2.62].map((a) => [a, 8.5, FL.M_BODY_Y * 0.55, 1.5]);
//  … and at VECNA: hips, chest, head, up as far as he is hovering [up, radius]
const V_BODY = [[VC.V_HIP, 0.66], [VC.V_HIP + 0.98, 0.86], [VC.V_HIP + 1.94, 0.55]];

//  the city to walk in, once per isolate: its insides built as they are first needed
let ground = null;
function theGround() { if (!ground) { const L = CITY.lazyNear(theCity()); ground = CITY.ground(L.near, L.full); } return ground; }
let wreckSet = null;                       // where the wrecks lie (the same as every game: shared/wrecks.js)
function theWrecks() { return wreckSet || (wreckSet = WR.makeWrecks(TF.makeTraffic({ now: () => 0 }).cars)); }
const noop = () => {};
const r10 = (v) => Math.round(v * 10);
//  a wreck as it is said: [k, x·10, z·10, y·10, heading·1000, up (1 held, 2 in the air)]
const WRECK_N = 6;
function wreckRow(k, w) { return [k, r10(w.x), r10(w.z), r10(w.y), Math.round(w.rot * 1000), (w.held ? 1 : 0) | (w.thrown ? 2 : 0)]; }

export class RoomDogs {
  constructor(room) {
    this.room = room;                      // the Relay: players
    this.t = 0; this.acc = 0; this.last = undefined; this.frame = 0; this.nowMs = 0;
    this.tellT = 0; this.seq = 0; this.warm = 0; this.orbitSaid = '';
    const G = theGround();
    this.F = theFootprints();
    this.wrecks = theWrecks().map((w) => (w ? Object.assign({}, w) : null));   // (a room's own copy: they are picked up and thrown)
    this.mine = new Map();                 // wreck k → what the room last said of it: the ones moved here
    this.who = [];                         // the players over there, as the animals see them (look)
    this.byId = new Map();
    const world = {
      now: () => this.t, random: Math.random,
      targets: () => this.who,
      clearAt: this.F.clearAt, supportHeight: G.supportHeight, collide: G.collide, bldAt: G.bldAt, navNext: G.navNext,
      rayCity: (ro, rd, max) => CITY.rayLazy(theCity(), ro, rd, max),
      wrecks: () => this.wrecks,
      master: (this.masterFn = (tag, slot) => this.master(tag, slot)),
      vec: () => this.V.vec,
    };
    const share = (x, z, dmg) => FL.shareDamage(this.M, x, z, dmg);
    const moved = (k) => { if (k >= 0 && !this.mine.has(k)) this.mine.set(k, null); };
    const spawnDog = () => DOG.spawnDog(this.D), spawnGorgon = (at) => GOR.spawnGorgon(this.G, at);
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
    this.M = FL.makeFlayers(Object.assign({}, world, {
      dogs: () => this.D.dogs, gorgons: () => this.G.gorgons, spawnDog, spawnGorgon,
      hit: (m, t, dmg, kb, ox, oz, shake) => this.blow(t, dmg, kb, ox, oz, shake),
      //  (the crater itself everyone over there sees in the flayer's swing: 'dv')
      stomp: (m, cx, cz, hits) => { for (const h of hits) this.blow(h.t, h.dmg, h.kb, cx, cz, 0); },
      on: { roar: noop, summon: noop, wind: noop, swing: noop, launch: noop, fly: noop, far: noop, panic: noop, hurt: noop, death: noop, rift: noop, gone: noop,
        hold: (m) => moved(m.holdW), land: (T) => moved(T.k), drop: (w, k) => moved(k) },
    }));
    this.V = VC.makeVecna(Object.assign({}, world, {
      dogs: () => this.D.dogs, gorgons: () => this.G.gorgons, flayers: () => this.M.flayers, spawnDog, spawnGorgon,
      hit: (v, t, kind, dmg, ax, az, push, up, shake) => this.vblow(v, t, kind, dmg, push, up, shake),
      grab: (v, t) => this.grip(t),
      held: (t) => this.gripped(t),
      release: (t) => this.letGo(t),
      on: { lift: (v, ks) => { for (const k of ks) moved(k); }, hurl: (v, k) => moved(k), land: (T) => moved(T.k), drop: (ks) => { for (const k of ks) moved(k); },
        charge: noop, wave: noop, limb: noop, psy: noop, phase: noop, whisper: noop, voice: noop, command: noop, grew: noop, ordered: noop,
        hurt: noop, blink: noop, death: noop, fallen: noop, rift: noop, fly: noop, gone: noop },
    }));
    this.bytes = 0; this.sent = 0;         // (for tests and for a look: what they have cost to send)
  }
  get dogs() { return this.D.dogs; }
  get gorgons() { return this.G.gorgons; }
  get flayers() { return this.M.flayers; }
  get vec() { return this.V.vec; }

  //  Carrying on from what the host's game had (shared/dogs.js, gorgons.js,
  //  flayers.js and vecna.js fullState: { k: the dogs, g: the gorgons, f:
  //  the flayers, v: VECNA, w: the wrecks that are not where they lay }); none:
  //  an empty district, stocked when someone is over there.
  adopt(f) {
    this.wrecks = theWrecks().map((w) => (w ? Object.assign({}, w) : null));
    this.mine.clear(); this.orbitSaid = '';
    if (f && Array.isArray(f.w)) this.wreckFrom(f.w);
    if (f && DOG.fullOk(f)) DOG.adoptFull(this.D, f);
    if (f && GOR.fullOk(f.g)) GOR.adoptFull(this.G, f.g);
    if (f && FL.fullOk(f.f)) FL.adoptFull(this.M, f.f);
    if (f && VC.fullOk(f.v)) VC.adoptFull(this.V, f.v);
    if (this.M.thrown) this.mine.set(this.M.thrown.k, null);
    for (const o of this.V.vec.orbit) this.mine.set(o.k, null);
    for (const T of this.V.thrown) this.mine.set(T.k, null);
    //  (an empty district handed over is stocked at once, as it is when someone crosses)
    if (!this.D.dogs.some((d) => d.live)) this.D.spawnCd = 0;
    if (!this.G.gorgons.some((g) => g.live)) this.G.spawnCd = 0;
    this.took = this.D.dogs.filter((d) => d.live).map((d) => [d.slot, d.x, d.z]);
    this.tookG = this.G.gorgons.filter((g) => g.live).map((g) => [g.slot, g.x, g.z, g.hp]);
    this.tookF = this.M.flayers.filter((m) => m.live).map((m) => [m.slot, m.x, m.z, m.hp]);
    this.tookV = this.V.vec.live ? [this.V.vec.x, this.V.vec.z, this.V.vec.hp] : null;
  }
  //  the wrecks the host's game had moved (wreckRow each): where they lie, and
  //  the room says so to whoever crosses later
  wreckFrom(rows) {
    for (let i = 0; i + WRECK_N - 1 < rows.length && i < 96 * WRECK_N; i += WRECK_N) {
      const k = rows[i], w = this.wrecks[k], x = rows[i + 1] / 10, z = rows[i + 2] / 10;
      if (!w || !Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > RULES.WORLD * 0.5 || Math.abs(z) > RULES.WORLD * 0.5) continue;
      w.x = x; w.z = z; if (Number.isFinite(rows[i + 3])) w.y = rows[i + 3] / 10; if (Number.isFinite(rows[i + 4])) w.rot = rows[i + 4] / 1000;
      w.held = false; w.thrown = false;      // (in a hand or in the air: VECNA's and the flayers' own say so)
      this.mine.set(k, null);
    }
  }
  full() {
    const w = [];
    for (const k of this.mine.keys()) { const q = this.wrecks[k]; if (q) w.push(...wreckRow(k, q)); }
    return Object.assign(DOG.fullState(this.D), { g: GOR.fullState(this.G), f: FL.fullState(this.M), v: VC.fullState(this.V), w });
  }

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
    //  last top-up's wait (the flayers' and VECNA's go on: they are rare)
    if (!this.look(now)) {
      if (this.D.dogs.some((d) => d.live)) DOG.clearDogs(this.D);
      if (this.G.gorgons.some((g) => g.live)) GOR.clearGorgons(this.G);
      if (this.M.flayers.some((m) => m.live)) FL.clearFlayers(this.M);
      if (this.V.vec.live) VC.clearVecna(this.V);
      this.letFall();
      this.D.spawnCd = 0; this.G.spawnCd = 0; this.acc = 0;
      return;
    }
    this.acc += dt;
    const D = this.D, G = this.G, M = this.M, V = this.V, v = V.vec;
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
      //  and VECNA: the cars he threw; one, and he takes his time; a fight every
      //  step, otherwise every third or eighth past 150 / 300 m (as the game);
      //  what he holds circles him, and his body eases (his arm's reach is its length)
      VC.flights(V, STEP);
      VC.stock(V, STEP);
      if (v.live && v.dead && v.deadT > 26) VC.clearVecna(V);
      else if (v.live) {
        const q = DOG.nearestTo(this.who, v.x, v.z).d, lod = q < 150 ? 0 : q < 300 ? 1 : 2;
        const every = (VC.fighting(v) || lod === 0) ? 1 : lod === 1 ? 3 : 8;
        if (this.frame % every === 0) VC.think(V, STEP * every);
        VC.orbitStep(V, STEP);
        VC.ease(V, STEP);
      }
      //  and the dogs get out of the gorgons' way
      for (const g of G.gorgons) if (g.live && !g.dead) DOG.shove(D, g, STEP);
    }
    this.grips(now);
  }
  //  cars in the air as they go come down where they are
  letFall() {
    const fall = (T) => {
      const w = this.wrecks[T.k];
      if (w) { w.x = T.x; w.z = T.z; w.y = theGround().supportHeight(T.x, T.z, T.y + 1); w.thrown = false; w.held = false; this.mine.set(T.k, null); }
    };
    if (this.M.thrown) { fall(this.M.thrown); this.M.thrown = null; }
    for (const T of this.V.thrown) fall(T);
    this.V.thrown.length = 0;
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
    if (kb) x.kb = [r10(ox), r10(oz), r10(kb)];
    this.room.damage(t.id, dmg, null, this.nowMs, 'mf', x);
  }
  //  VECNA's (the wave, his arm, a car he threw): as a flayer's, and how hard
  //  it throws them up ('hp' { src: 'vec', k: what, kb: [his x·10, z·10, m·10],
  //  up: m/s·10, sh }). The wave breaks his grip on whoever it catches.
  vblow(v, t, kind, dmg, push, up, shake) {
    const x = { k: kind, sh: Math.round(shake * 100) };
    if (push || up) { x.kb = [r10(v.x), r10(v.z), r10(push)]; x.up = r10(up); }
    if (kind === 'wave' && t.pl.grip) t.pl.grip = null;
    this.room.damage(t.id, dmg, null, this.nowMs, 'vec', x);
  }
  //  ---- VECNA's grip: the player's game lifts, drags and throws them ('grip'
  //  { x·10, z·10 }: where he stands; { off: 1 }: let go), the room keeps time,
  //  does the damage the drag does, and knows who he has hold of
  grip(t) {
    if (this.gripped(t) || t.dead) return false;
    t.pl.grip = { at: this.nowMs, hurt: false };
    this.room.send(t.id, 'grip', { x: r10(this.V.vec.x), z: r10(this.V.vec.z) });
    return true;
  }
  gripped(t) { const g = t.pl.grip; return !!(g && this.nowMs - g.at < GRIP_END); }
  letGo(t) {
    for (const q of t ? [t] : this.who) if (q.pl.grip) { q.pl.grip = null; this.room.send(q.id, 'grip', { off: 1 }); }
  }
  grips(now) {
    const v = this.V.vec;
    for (const t of this.who) {
      const g = t.pl.grip; if (!g) continue;
      if (now - g.at >= GRIP_END) { t.pl.grip = null; continue; }
      //  (as the game lets go: he is gone, or they are dragged too far from him)
      if (!v.live || v.dead || Math.hypot(v.x - t.x, v.z - t.z) > VC.V_GRAB_R * 1.6 + 8) { this.letGo(t); continue; }
      if (!g.hurt && now - g.at >= GRIP_HURT) { g.hurt = true; this.room.damage(t.id, VC.V_GRAB_DMG, null, now, 'vecgrip'); }
    }
  }

  //  ---- what everyone over there is told ---------------------------------------
  tell(now) {
    if (!this.who.length || now - this.tellT < TELL_MS) return;
    this.tellT = now;
    const full = this.seq++ % FULL_EVERY === 0, who = this.who;
    const k = DOG.snapRows(this.D, full, (d) => who.some((t) => Math.abs(t.x - d.x) < NEAR && Math.abs(t.z - d.z) < NEAR));
    const p = { q: GOR.snapRows(this.G), f: FL.snapRows(this.M), v: VC.snapRow(this.V) };
    if (k) { p.k = k; p.kf = full ? 1 : 0; }
    const fly = FL.flightRow(this.M), vf = VC.flightRows(this.V), w = this.wreckRows(full);
    if (fly) p.fly = fly;
    if (vf.length) p.vf = vf;
    if (w.length) p.w = w;
    //  what he holds: when it changes (a car taken up, thrown, flung out), and with every whole word
    const o = this.V.vec.live ? this.V.vec.orbit : [];
    const said = o.map((q) => q.k + ':' + r10(q.r)).join(',');
    if (full || said !== this.orbitSaid) { p.vo = VC.orbitRows(this.V); this.orbitSaid = said; }
    this.say('dv', p);
  }
  //  The wrecks moved here, per wreck (wreckRow): those that changed since
  //  last said, or all of them (full: for whoever crossed since)
  wreckRows(full) {
    const rows = [];
    for (const [k, was] of this.mine) {
      const w = this.wrecks[k]; if (!w) continue;
      const r = wreckRow(k, w);
      if (full || !was || r.some((q, i) => q !== was[i])) { rows.push(...r); this.mine.set(k, r); }
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
  //  the flayer or VECNA one is sworn to, if it stands (and he is awake)
  master(tag, slot) {
    if (tag === 'vec') { const v = this.V.vec; return v && v.live && !v.dead && v.awake ? v : null; }
    const f = this.M.flayers[slot]; return f && f.live && !f.dead ? f : null;
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
  //  … and at VECNA (in a window, a round counts two and a half: shared/vecna.js hurt)
  vecShot(from, now) {
    const v = this.V.vec, me = this.room.players.get(from);
    const lift = (v.hover || 0) * 1.45;
    const why = this.whyNot(me, v, now, v.live ? V_BODY.map(([up, r]) => [v.x, v.y + up + lift, v.z, r]) : null);
    if (why) { this.room.refused++; this.room.lastRefusal = 'at VECNA: ' + why; return false; }
    me.lastMobHitT = now;
    const h = me.hist;
    VC.hurt(this.V, RULES.DMG, h[h.length - 3], h[h.length - 1]);
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
