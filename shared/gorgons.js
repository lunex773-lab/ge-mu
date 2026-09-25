'use strict';
//  ============================================================
//  CONTOUR — the other side's demogorgons  (shared)
//  ============================================================
//  The thing the dogs are afraid of: what it thinks and how it moves. A
//  player's game runs them while alone (or hosting a room that does not);
//  with two or more in a room the room server runs them (server/dogs.js,
//  beside the dogs) with this same code. Nothing here draws or makes a sound
//  — the game poses and draws a gorgon from the fields this moves, and hears
//  it through the hooks (env.on).
//
//  A demodog is clever and frightened: it bites once, breaks off, hides
//  behind a wreck, screams for help. A demogorgon has none of that. It has
//  enough intelligence to find you and to judge when it is close enough to
//  swing, and none at all for deciding that today has gone badly. There is
//  no retreat state, no hide state, no flee state and no call — not tuned
//  down, absent — so at ten percent health it is still walking at you. What
//  makes it frightening is that it does not stop.
//
//  The world it lives in comes through env, as the dogs' does (shared/dogs.js):
//    now(), random(), targets() — [{ x, z, y, ey, dead, cloak, fx, fz, yaw }]
//    clearAt, supportHeight, collide, navNext, rayCity, wrecks(), master, vec()
//    noises()             the ring of noises the dogs hear (it hears them too)
//    claw(g, kind, reach, dmg)   a swing's hit window is open: whoever is in
//                         reach, on its floor, takes dmg — true if it landed
//    on: { wind, swing, growl, roar, hurt, death, gone, share }

const CITY = require('./city.js');
const TR = require('./troop.js');
const WR = require('./wrecks.js');
const RULES = require('./rules.js');
const DG = require('./dogs.js');

//  Two of these are headroom, not district population. The stocker fills to
//  GOR_WILD and stops; the pool goes to NGOR. Without the gap a summon can
//  never land: the stocker tops the district up every twenty seconds, so by
//  the time a flayer asks for an escort there is no free slot, and the escort
//  quietly arrives as dogs only.
const NGOR = 8, GOR_WILD = 6;         // across the district, rarely two together
const GOR_HP = 420;                   // ~4.5 demodogs, ~21 rounds
const G_VIS = 42, G_VIS_COS = Math.cos(1.34), G_PERIPH = 11;   // sharper eyes than the dogs
const G_HEAR = 72;                    // and it hears the whole district
const G_MEM = 16;                     // how long it keeps hunting a place you left
const G_CLAW_R = 3.3, G_CLAW_DMG = 20;
const G_DCLAW_DMG = 27;
const G_PRED_R = 2.9, G_PRED_DMG = 34;             // heavy, never lethal from full
const G_ENRAGE = 0.30;
const G_RISE_T = 2.4;                 // s climbing out of the ground
const G_KEEP = 58, G_APART = 150;     // never spawned this near anyone, nor this near another
const RETINUE = { mf: 2, vec: 2 };    // how many a flayer, and VECNA, keep about them
const WORLD = RULES.WORLD;
//  a gorgon's state, as a snapshot numbers it (index 1…)
const G_ST = ['idle', 'wander', 'investigate', 'alert', 'chase', 'attack', 'reposition', 'search', 'enrage', 'escort', 'flank'];

// ---- attacks ------------------------------------------------------
//  Every one of them announces itself first. It hits hard enough that a
//  swing you could not have seen coming would just be unfair, so each has a
//  wind-up you can read and get out of: the arm goes back, the body drops,
//  the face starts to open.
const G_ATK = {
  claw:  { wind: 0.42, swing: 0.34, rec: 0.30, cd: 1.7, reach: G_CLAW_R, dmg: G_CLAW_DMG, arm: 0 },
  dclaw: { wind: 0.55, swing: 0.46, rec: 0.44, cd: 4.6, reach: G_CLAW_R + 0.3, dmg: G_DCLAW_DMG, arm: 2 },
  lunge: { wind: 0.55, swing: 0.50, rec: 0.36, cd: 5.2, reach: G_CLAW_R + 0.6, dmg: G_CLAW_DMG + 4, arm: 1 },
  pred:  { wind: 0.95, swing: 0.55, rec: 0.65, cd: 9.5, reach: G_PRED_R, dmg: G_PRED_DMG, arm: -1 },
};

function makeGorgons(env) { return { env, gorgons: [], spawnCd: 4, holdSpawn: false }; }

function startAtk(G, g, kind) {
  const A = G_ATK[kind];
  g.atk = { kind, t: 0, arm: A.arm === 0 ? (G.env.random() < 0.5 ? 0 : 1) : A.arm, arm01: 1, phase: -1, hit: 0, sfx: 0 };
  g.st = 'attack'; g.stT = 0;
  G.env.on.wind(g, kind);
}
function runAtk(G, g, dt) {
  const E = G.env, a = g.atk, A = G_ATK[a.kind];
  a.t += dt;
  //  The swing itself travels, so the range test has to be against where you
  //  are now. Reading a distance measured when the arm went back means a
  //  lunge can cross the whole gap and still register as a miss.
  if (see(G, g) > 0) { g.tx = g.tgt.x; g.tz = g.tgt.z; g.seeT = E.now(); }
  const total = A.wind + A.swing + A.rec;
  if (a.t < A.wind) {
    a.phase = -(1 - a.t / A.wind);                       // winding back
    if (a.kind === 'lunge') { g.crouch = Math.min(1, g.crouch + dt * 4); g.sp = 0; }
    if (a.kind === 'pred') g.mawWant = 1;
  } else if (a.t < A.wind + A.swing) {
    const k = (a.t - A.wind) / A.swing;
    a.phase = k;
    if (a.kind === 'lunge') {
      g.crouch = Math.max(0, g.crouch - dt * 6);
      step(G, g, g.tx, g.tz, 16.5, dt);                   // the pounce itself
    } else if (a.kind === 'pred') {
      g.mawWant = 1; g.predLean = Math.min(1, g.predLean + dt * 4);
      step(G, g, g.tx, g.tz, 8.5, dt);
    }
    //  The damage window is a slice of the swing rather than the whole
    //  attack, and it stays open for the rest of it: any step of the window
    //  in which it is actually in reach connects, so a lunge at sixteen
    //  metres a second cannot pass clean through between two samples.
    if (!a.sfx && k > 0.35) {
      a.sfx = 1;
      E.on.swing(g, a.kind);
      if (a.kind === 'dclaw') a.arm = a.arm === 2 ? 2 : 1 - a.arm;
    }
    if (!a.hit && k > 0.35 && E.claw(g, a.kind, A.reach, Math.round(A.dmg * (g.enraged ? 1.25 : 1)))) a.hit = 1;
  } else {
    a.phase = 1; a.arm01 = Math.max(0, 1 - (a.t - A.wind - A.swing) / A.rec);
    if (a.kind === 'pred') g.mawWant = 0.35;
  }
  if (a.t >= total) {
    g.atkCd = A.cd * (g.enraged ? 0.62 : 1);
    g.atk = null; g.predLean = 0;
    //  Enraged it presses straight back in; calm it gives you a beat by
    //  circling out first. That difference is the whole enrage design —
    //  not bigger numbers, a shorter leash.
    g.st = g.enraged && E.random() < 0.55 ? 'chase' : 'reposition';
    g.stT = 0;
  }
}

// ---- movement -----------------------------------------------------
const _foot = { x: 0, y: 0, z: 0 };
function step(G, g, tx, tz, speed, dt, ty) {
  const E = G.env;
  const wpt = E.navNext(g.x, g.z, g.y, tx, tz, ty === undefined ? g.ty : ty);   // it uses the door too
  if (wpt) { tx = wpt.x; tz = wpt.z; }
  const dx = tx - g.x, dz = tz - g.z, dd = Math.hypot(dx, dz);
  const ux = dd > 0.01 ? dx / dd : Math.sin(g.hd), uz = dd > 0.01 ? dz / dd : Math.cos(g.hd);
  const want = Math.atan2(ux, uz);
  const turn = TR.easeHeading(g, want, dt, 4.6, g.enraged ? 3.4 : 2.6);
  g.lean += (-turn * 0.05 - g.lean) * Math.min(1, dt * 8);
  const bx = g.x, bz = g.z;
  const full = speed * dt;
  const steps = Math.min(4 + Math.floor(dt * 24), 1 + Math.floor(full / 0.22));   // scaled with dt: see the dogs' step
  const sx2 = Math.sin(g.hd) * (full / steps), sz2 = Math.cos(g.hd) * (full / steps);
  const wrecks = E.wrecks();
  for (let q = 0; q < steps; q++) {
    _foot.x = g.x + sx2; _foot.y = g.y; _foot.z = g.z + sz2;
    E.collide(_foot, g.y + 0.05, g.y + 2.3, 0.52);      // it is tall: check head height too
    WR.collide(wrecks, _foot, 0.52);
    if (Math.abs(_foot.x) < WORLD * 0.48 && Math.abs(_foot.z) < WORLD * 0.48) { g.x = _foot.x; g.z = _foot.z; }
  }
  //  the king's ground is his own — a predator that walks through him reads as
  //  two monsters occupying one space, which is worse than either alone
  const vec = E.vec();
  if (vec && vec.live && !vec.dead) {
    const ex = g.x - vec.x, ez = g.z - vec.z, e = Math.hypot(ex, ez);
    if (e < DG.V_CLEAR && e > 1e-3) { g.x = vec.x + ex / e * DG.V_CLEAR; g.z = vec.z + ez / e * DG.V_CLEAR; }
  }
  g.sp = dt > 1e-5 ? Math.hypot(g.x - bx, g.z - bz) / dt : 0;
  g.y += (E.supportHeight(g.x, g.z, g.y + 0.6) - g.y) * Math.min(1, dt * 8);
  return dd;
}

// ---- perception ---------------------------------------------------
//  As the dogs': the best seen of the targets, and whether it sees anyone or
//  not, g.tdist, g.ty and g.tyaw are then of the one it is looking at — or
//  of the nearest, if none.
const _eye = { x: 0, y: 0, z: 0 }, _dir = { x: 0, y: 0, z: 0 };
function see(G, g) {
  const E = G.env, who = E.targets();
  let best = 0, bt = null, nd = Infinity, nt = null;
  const fx = Math.sin(g.hd), fz = Math.cos(g.hd);
  for (let i = 0; i < who.length; i++) {
    const t = who[i];
    const dx = t.x - g.x, dz = t.z - g.z, dist = Math.hypot(dx, dz);
    if (dist < nd) { nd = dist; nt = t; }
    if (t.dead || dist > G_VIS) continue;
    const dotf = dist > 0.01 ? (dx / dist) * fx + (dz / dist) * fz : 1;
    if (dotf < G_VIS_COS && dist > G_PERIPH) continue;
    _eye.x = g.x; _eye.y = g.y + 2.45; _eye.z = g.z;
    _dir.x = t.x - _eye.x; _dir.y = (t.ey - 0.5) - _eye.y; _dir.z = t.z - _eye.z;
    const len = Math.sqrt(_dir.x * _dir.x + _dir.y * _dir.y + _dir.z * _dir.z), inv = 1 / len;   // (three.js's length() and multiplyScalar)
    _dir.x *= inv; _dir.y *= inv; _dir.z *= inv;
    if (Math.min(E.rayCity(_eye, _dir, len), WR.ray(E.wrecks(), _eye, _dir)) < len - 0.6) continue;
    const s = (t.cloak ? 0.45 : 1) * Math.max(0.15, 1 - dist / G_VIS);
    if (s > best) { best = s; bt = t; }
  }
  const on = bt || nt;
  if (on) { g.tdist = Math.hypot(on.x - g.x, on.z - g.z); g.ty = on.y; g.tyaw = on.yaw; g.tgt = bt; }
  return best;
}

// ---- the population -----------------------------------------------
//  Spread across the district, and kept apart from each other — the point of
//  a rare thing is that you do not turn a corner into two of them. Never
//  within G_KEEP of anyone, and heavily biased out of their line of sight
//  when it does land nearby, because this is an encounter you should hear
//  coming before you ever see it.
function spawnSpot(G) {
  const E = G.env, rnd = E.random, who = E.targets();
  let best = null, bestS = -1;
  for (let i = 0; i < 60; i++) {
    const x = (rnd() * 2 - 1) * WORLD * 0.44, z = (rnd() * 2 - 1) * WORLD * 0.44;
    if (!E.clearAt(x, z, 1.4)) continue;
    let keep = false;
    for (const t of who) if ((Math.hypot(x - t.x, z - t.z) || 1) < G_KEEP) { keep = true; break; }
    if (keep) continue;
    let apart = true;
    for (const o of G.gorgons) {
      if (!o.live || o.dead) continue;
      if (Math.hypot(o.x - x, o.z - z) < G_APART) { apart = false; break; }
    }
    if (!apart) continue;
    let s = 8;
    for (const t of who) {
      const dx = x - t.x, dz = z - t.z, d = Math.hypot(dx, dz) || 1;
      if (d < 160) {
        const facing = (dx / d) * t.fx + (dz / d) * t.fz;
        if (facing > 0) s -= facing * 16;
      }
    }
    const bi = Math.round(x / CITY.PITCH), bj = Math.round(z / CITY.PITCH);
    if (Math.min(Math.abs(x - bi * CITY.PITCH), Math.abs(z - bj * CITY.PITCH)) > CITY.RW + CITY.SWW) s += 6;
    s += rnd() * 4;
    if (s > bestS) { bestS = s; best = { x, z }; }
  }
  return best;
}
//  (slot: this one, when a snapshot says which — else the first free)
function spawnGorgon(G, at, slot) {
  const E = G.env, rnd = E.random, gorgons = G.gorgons;
  if (slot !== undefined) while (gorgons.length <= slot) gorgons.push({ slot: gorgons.length, live: false });
  let g = slot === undefined ? gorgons.find((o) => !o.live) : gorgons[slot];
  if (!g && gorgons.length >= NGOR) return null;
  const spot = at || spawnSpot(G); if (!spot) return null;
  if (!g) { g = { slot: gorgons.length, live: false }; gorgons.push(g); }
  Object.assign(g, {
    live: true, x: spot.x, z: spot.z, y: E.supportHeight(spot.x, spot.z, 1), hd: rnd() * 6.2832,
    sp: 0, hp: GOR_HP, st: 'wander', stT: 0, gaitPh: rnd(), gait: 'walk', lean: 0,
    maw: 0, mawWant: 0, headYaw: 0, headPitch: 0, crouch: 0, lunge: 0, predLean: 0, armTwist: 0,
    stagger: 0, atk: null, atkCd: 2, enraged: false, dead: false, deadT: 0,
    see: 0, seeT: -99, tx: spot.x, tz: spot.z, tdist: 999, hasT: false,
    wx: spot.x, wz: spot.z, wanderT: 0, strafe: rnd() < 0.5 ? 1 : -1,
    stepBeat: -1, breath: rnd() * 4, noise: null, noiseS: 0,
    netX: spot.x, netZ: spot.z, netH: 0, rx: spot.x, rz: spot.z, hpHold: 0, lod: 0,
    spawnD: DG.nearestTo(E.targets(), spot.x, spot.z).d,
    lord: null, lordSlot: -1, lordFar: 0, taint: 0, rise: 1, riseY: 0,
    weave: rnd() * 6.2832, burstT: 0, bursting: true, flankCd: 0,
  });
  return g;
}
function despawnGorgon(G, g) { g.live = false; g.dead = false; g.atk = null; g.lord = null; G.env.on.gone(g); }
function clearGorgons(G) { for (const g of G.gorgons) if (g.live) despawnGorgon(G, g); }

// ---- the decision -------------------------------------------------
//  Short on purpose. There is no scoring contest here because there is
//  nothing to weigh: it is not deciding whether to fight, only which swing
//  fits the distance it is standing at.
function think(G, g, dt) {
  const E = G.env, rnd = E.random, now = E.now();
  g.stT += dt;
  g.atkCd = Math.max(0, g.atkCd - dt);
  g.flankCd = Math.max(0, (g.flankCd || 0) - dt);
  g.stagger = Math.max(0, g.stagger - dt * 2.0);
  if (g.dead) { g.deadT += dt; g.sp = 0; g.mawWant = 0.55; return; }
  if (g.rise < 1) { g.sp = 0; g.mawWant = 1; g.crouch = 0.7; g.hd += dt * 0.6; return; }
  if (g.atk) { runAtk(G, g, dt); return; }

  const s = see(G, g);
  if (s > 0) { g.see = s; g.seeT = now; g.hasT = true; g.tx = g.tgt.x; g.tz = g.tgt.z; }
  else g.see = 0;
  let h = null, bestI = 0;
  const noises = E.noises();
  for (let i = noises.length - 1; i >= 0; i--) {
    const n = noises[i];
    if (now - n.t > 7) continue;
    const dist = Math.hypot(n.x - g.x, n.z - g.z), reach = G_HEAR * n.i;
    if (dist > reach) continue;
    const sc = n.i * (1 - dist / Math.max(1, reach));
    if (sc > bestI) { bestI = sc; h = n; }
  }
  if (h) { g.noise = h; g.noiseS = bestI; }
  const known = g.hasT && now - g.seeT < G_MEM;      // it remembers where you were
  const dist = g.tdist;
  const fx = dist > 0.01 ? (g.tx - g.x) / dist : 0, fz = dist > 0.01 ? (g.tz - g.z) / dist : 1;
  let lookX = g.tx, lookZ = g.tz;

  switch (g.st) {
    case 'enrage':                                    // a beat of pure display, then straight back in
      g.sp = 0; g.mawWant = 1;
      if (g.stT > 1.25) { g.st = known ? 'chase' : 'wander'; g.stT = 0; g.mawWant = 0.2; }
      break;
    case 'escort': {
      //  Same station-keeping as the dog, at a heavier animal's spacing. It is
      //  not a state it fights from: the moment it knows where you are it
      //  drops out of formation and goes back to being a demogorgon.
      const L = DG.lordOf(g, dt, E.master);
      if (!L) { g.st = 'wander'; g.stT = 0; break; }
      const sp = DG.escortSpot(g, L, g.lord === 'vec' ? 6 : 13, 3, 4.5, E.clearAt);
      const behind = Math.hypot(L.x - g.x, L.z - g.z);
      //  as with the dog: the master's own pace, plus what it takes to close
      const pace = (!sp.ok || behind < sp.ring - 2) ? 0
        : Math.min(7.8, (L.sp || 0) * 1.2 + Math.max(0, behind - sp.ring) * 0.9);
      step(G, g, sp.x, sp.z, pace, dt, L.y);
      lookX = g.x + Math.sin(sp.bear) * 12; lookZ = g.z + Math.cos(sp.bear) * 12;
      g.mawWant = 0.06;
      if (known) { g.st = 'alert'; g.stT = 0; }
      else if (g.noise && now - g.noise.t < 7 && g.noiseS > 0.5) { g.st = 'investigate'; g.stT = 0; }
      break;
    }
    case 'wander': {
      if (!known && DG.lordOf(g, dt, E.master)) { g.st = 'escort'; g.stT = 0; break; }
      g.wanderT -= dt;
      if (g.wanderT <= 0 || Math.hypot(g.wx - g.x, g.wz - g.z) < 3) {
        for (let i = 0; i < 10; i++) {
          const a = g.hd + (rnd() - 0.5) * 2.2, r = 16 + rnd() * 34;
          const nx = g.x + Math.sin(a) * r, nz = g.z + Math.cos(a) * r;
          if (Math.abs(nx) > WORLD * 0.44 || Math.abs(nz) > WORLD * 0.44) continue;
          if (E.clearAt(nx, nz, 1.3)) { g.wx = nx; g.wz = nz; break; }
        }
        g.wanderT = 6 + rnd() * 8;
      }
      step(G, g, g.wx, g.wz, 1.9, dt);
      lookX = g.x + Math.sin(g.hd + Math.sin(now * 0.35 + g.slot) * 0.7) * 8;
      lookZ = g.z + Math.cos(g.hd + Math.sin(now * 0.35 + g.slot) * 0.7) * 8;
      g.mawWant = 0;
      if (known) { g.st = 'alert'; g.stT = 0; }
      else if (g.noise && now - g.noise.t < 7) { g.st = 'investigate'; g.stT = 0; }
      break;
    }
    case 'investigate': {
      const n = g.noise;
      if (!n) { g.st = 'wander'; g.stT = 0; break; }
      const dd = step(G, g, n.x, n.z, 3.4, dt);
      lookX = n.x; lookZ = n.z; g.mawWant = 0.12;
      if (known) { g.st = 'alert'; g.stT = 0; }
      else if (dd < 4 || g.stT > 14) { g.noise = null; g.st = 'wander'; g.stT = 0; }
      break;
    }
    case 'alert':                                     // stop, turn the head, decide it is you
      step(G, g, g.x, g.z, 0, dt); g.sp = 0;
      g.mawWant = 0.25;
      if (g.stT > 0.15 && !g.growled) { g.growled = 1; E.on.growl(g); }
      if (g.stT > 1.0) { g.growled = 0; g.st = known ? 'chase' : 'wander'; g.stT = 0; }
      break;
    case 'flank': {
      //  It goes round. A predator that only ever closes on the shortest line
      //  is a predator you shoot down the shortest line. It breaks off, runs
      //  out to a bearing behind whoever it hunts (where they are not
      //  looking), and comes back at their back — so holding one firing angle
      //  stops being enough and you have to keep turning.
      if (!known) { g.st = 'search'; g.stT = 0; break; }
      const yw = g.tyaw || 0;
      const behind = Math.atan2(Math.sin(yw), Math.cos(yw));   // where they are not looking
      const want = 22 + (g.slot % 3) * 5;
      const bear = behind + g.strafe * (0.9 - Math.min(0.7, g.stT * 0.2));
      const gx = g.tx + Math.sin(bear) * want, gz = g.tz + Math.cos(bear) * want;
      if (!E.clearAt(gx, gz, 1.0)) g.strafe = -g.strafe;
      step(G, g, gx, gz, g.enraged ? 9.2 : 7.4, dt);
      g.mawWant = 0.1;
      lookX = g.tx; lookZ = g.tz;
      //  and it commits the moment it is round, or the moment it runs out of
      //  patience — circling forever is its own kind of harmless
      const rel0 = Math.atan2(g.x - g.tx, g.z - g.tz) - behind;
      let rr = rel0; while (rr > Math.PI) rr -= 6.2832; while (rr < -Math.PI) rr += 6.2832;
      if (g.stT > 4.5 || dist < 13 || Math.abs(rr) < 0.55) { g.st = 'chase'; g.stT = 0; }
      break;
    }
    case 'chase': {
      if (!known) { g.st = 'search'; g.stT = 0; break; }
      //  Serpentine, and not at one speed: a body travelling in a straight
      //  line at a constant rate is a body you lead once and hit every time
      //  after. The weave shrinks as it closes, so the last few metres are
      //  still a committed charge.
      g.weave = (g.weave || 0) + dt * (1.8 + (g.slot % 4) * 0.35);
      const wob = Math.sin(g.weave) * Math.min(1, dist / 30) * 10.5 * g.strafe;
      const ax = g.tx - fz * wob, az = g.tz + fx * wob;
      g.burstT = (g.burstT || 0) - dt;
      if (g.burstT <= 0) { g.burstT = 0.55 + rnd() * 1.0; g.bursting = !g.bursting; }
      const base = g.enraged ? 9.6 : 7.8;
      step(G, g, ax, az, g.bursting || dist < 14 ? base : base * 0.42, dt);
      g.mawWant = g.enraged ? 0.45 : 0.18;
      //  Being shot at from across the street is what sends it round the side.
      //  Not every time — a predator that always flanks is as readable as one
      //  that never does.
      if (dist > 17 && g.stT > 0.9 && rnd() < dt * 0.9) { g.st = 'flank'; g.stT = 0; break; }
      //  pick the swing that fits the distance it has arrived at
      if (g.atkCd <= 0 && g.see > 0) {
        if (dist < G_CLAW_R) {
          const r = rnd();
          //  and sometimes it arrives and does not swing: a predator that
          //  attacks the instant it is in reach can be timed off the moment it
          //  gets there; one that occasionally circles once first cannot
          if (!g.enraged && r < 0.18) { g.st = 'reposition'; g.stT = 0; break; }
          if (g.enraged && r < 0.30) startAtk(G, g, 'pred');
          else if (r < (g.enraged ? 0.55 : 0.34)) startAtk(G, g, 'dclaw');
          else startAtk(G, g, 'claw');
        } else if (dist < 12 && dist > 5.5) {
          startAtk(G, g, rnd() < (g.enraged ? 0.45 : 0.3) && dist < 9 ? 'pred' : 'lunge');
        }
      }
      break;
    }
    case 'reposition': {
      //  It circles — but it circles *in*, never out. There is no state in
      //  which this animal increases the distance between you on purpose.
      const sx = -fz * g.strafe, sz = fx * g.strafe;
      const want = Math.max(2.6, G_CLAW_R - 0.6);
      const gx = g.tx - fx * want + sx * 3.6, gz = g.tz - fz * want + sz * 3.6;
      if (!E.clearAt(gx, gz, 0.9)) g.strafe = -g.strafe;
      step(G, g, gx, gz, g.enraged ? 7.0 : 5.2, dt);
      g.mawWant = 0.2;
      if (g.stT > (g.enraged ? 0.5 : 1.0) || g.atkCd <= 0) { g.st = known ? 'chase' : 'search'; g.stT = 0; }
      break;
    }
    case 'search': {
      //  the last place it saw you, then a spiral around it — and then it
      //  gives up and goes back to walking the streets
      const dd = step(G, g, g.tx, g.tz, 4.4, dt);
      g.mawWant = 0.1;
      if (known) { g.st = 'chase'; g.stT = 0; }
      else if (dd < 4) {
        const a = g.stT * 1.1;
        g.tx += Math.sin(a) * 6; g.tz += Math.cos(a) * 6;
      }
      if (g.stT > G_MEM) { g.hasT = false; g.st = 'wander'; g.stT = 0; }
      break;
    }
    default: g.st = 'wander'; g.stT = 0;
  }

  { const rel = Math.atan2(lookX - g.x, lookZ - g.z) - g.hd;
    let a = rel; while (a > Math.PI) a -= 6.2832; while (a < -Math.PI) a += 6.2832;
    g.headYawWant = Math.max(-1.15, Math.min(1.15, a));
    const dz2 = Math.hypot(lookX - g.x, lookZ - g.z);
    g.headPitchWant = Math.max(-0.85, Math.min(0.6, Math.atan2(1.2 - 2.5, Math.max(1.5, dz2))));
  }
}

// ---- damage -------------------------------------------------------
//  It does not flinch at small arms the way a dog does. A single round is a
//  twitch; it takes a real hit to move it, and nothing at all makes it turn
//  around. There is no health threshold in here that leads anywhere except
//  further into you.
function hurt(G, g, dmg, fromX, fromZ) {
  if (!g.live || g.dead) return;
  const E = G.env;
  E.on.share(g.x, g.z, dmg);          // a linked minion bleeds upward (the flayer's link)
  g.hp -= dmg;
  g.hasT = true; g.tx = fromX; g.tz = fromZ; g.seeT = E.now();
  if (g.hp <= 0) { kill(G, g); return; }
  //  §27: it does not flinch at small arms. Absolute figures, not fractions of
  //  its health: what matters is the size of the hit that landed. A rifle
  //  round is 20 and sits well inside "barely noticed", as the document wants.
  if (dmg > 70) { g.stagger = 1; if (g.atk) { g.atk = null; g.atkCd = 0.7; } }     // heavy: the swing is broken
  else if (dmg > 30) g.stagger = Math.max(g.stagger, 0.55);                        // medium: a real rock back
  else g.stagger = Math.max(g.stagger, 0.16);                                      // light: barely noticed
  //  Shot from across the street — the exact situation it used to die in,
  //  head down, straight up the firing line. Being hit at range *is* the
  //  signal, so it is what breaks it off.
  if (!g.enraged && !g.atk && g.st !== 'flank' &&
      Math.hypot(fromX - g.x, fromZ - g.z) > 19 && (g.flankCd || 0) <= 0) {
    g.flankCd = 3.4;
    g.strafe = E.random() < 0.5 ? 1 : -1;
    g.st = 'flank'; g.stT = 0;
  }
  if (!g.enraged && g.hp <= GOR_HP * G_ENRAGE) {
    g.enraged = true; g.atk = null; g.st = 'enrage'; g.stT = 0; g.mawWant = 1;
    E.on.roar(g);
  }
  E.on.hurt(g);
  if (g.st === 'wander' || g.st === 'investigate' || g.st === 'search') { g.st = 'chase'; g.stT = 0; }
}
function kill(G, g) {
  g.dead = true; g.deadT = 0; g.hp = 0; g.sp = 0; g.atk = null; g.maw = 0.6;
  G.env.on.death(g);
}

// ---- keeping the district stocked -----------------------------------
//  A handful across the whole district, kept apart, and never removed for
//  being far away — one you walked away from is still out there walking its
//  own streets. Only a body is ever cleared.
function stock(G, dt) {
  G.spawnCd -= dt;
  let live = 0;
  for (const g of G.gorgons) {
    if (!g.live) continue;
    if (g.dead) { if (g.deadT > 14) despawnGorgon(G, g); continue; }
    live++;
  }
  if (G.spawnCd <= 0 && live < GOR_WILD && !G.holdSpawn) {
    //  stock the district on arrival, then top up slowly
    G.spawnCd = live < GOR_WILD - 1 ? 2.5 + G.env.random() * 2.5 : 22 + G.env.random() * 26;
    spawnGorgon(G);
  }
}
//  a fight always runs at full rate; otherwise every 1 / 3 / 8 / 24 frames at 50 / 110 / 220 m on
function fighting(g) { return !!(g.atk || g.st === 'chase' || g.st === 'attack' || g.st === 'reposition' || g.st === 'enrage'); }

// ---- over the wire ----------------------------------------------------
const HDQ = TR.HDQ;
//  a gorgon's marks, as a snapshot carries them: 1 dead, 2 enraged, 4 mid-swing,
//  8 sworn to someone (16: to VECNA, else a flayer — 32: the second), 64 still climbing out
function marks(g) {
  return (g.dead ? 1 : 0) | (g.enraged ? 2 : 0) | (g.atk ? 4 : 0) | (g.lord ? 8 : 0) | (g.lord === 'vec' ? 16 : 0) | (g.lord === 'mf' && g.lordSlot === 1 ? 32 : 0) | (g.rise < 1 ? 64 : 0);
}
//  per gorgon [slot, x·10, z·10, heading byte, hp, state (G_ST index + 1), marks]
function snapRows(G) {
  const k = [];
  for (const g of G.gorgons) {
    if (!g.live) continue;
    const h = (((g.hd || 0) % 6.2832) + 6.2832) % 6.2832;
    k.push(g.slot, Math.round(g.x * 10), Math.round(g.z * 10), Math.round(h * HDQ), Math.max(0, g.hp), G_ST.indexOf(g.st) + 1, marks(g));
  }
  return k;
}
//  The whole of it, to carry on from: per live gorgon [slot, x·100, z·100,
//  y·100, heading·1000, hp·10, state, time in it·10, dead time·10 (−1: alive),
//  enraged, target (1/0), tx·10, tz·10, seen ago·10, lord (0, 1 flayer, 2
//  VECNA), its slot, swing ready in·10, climbing·100, wander x·10, z·10,
//  wander time·10, strafe (±1)] — a swing in the air is let go
const FULL_N = 22;
function fullState(G) {
  const now = G.env.now(), rows = [];
  for (const g of G.gorgons) {
    if (!g.live) continue;
    rows.push(g.slot, Math.round(g.x * 100), Math.round(g.z * 100), Math.round(g.y * 100), Math.round((g.hd || 0) * 1000), Math.round(Math.max(0, g.hp) * 10),
      G_ST.indexOf(g.st === 'attack' ? 'chase' : g.st), Math.round(Math.min(600, g.stT) * 10), g.dead ? Math.round(g.deadT * 10) : -1, g.enraged ? 1 : 0,
      g.hasT ? 1 : 0, Math.round(g.tx * 10), Math.round(g.tz * 10), Math.round(Math.min(600, Math.max(0, now - g.seeT)) * 10),
      g.lord === 'mf' ? 1 : g.lord === 'vec' ? 2 : 0, g.lord === 'mf' ? g.lordSlot : -1,
      Math.round(g.atkCd * 10), Math.round(Math.min(1, g.rise === undefined ? 1 : g.rise) * 100),
      Math.round(g.wx * 10), Math.round(g.wz * 10), Math.round(Math.min(600, g.wanderT) * 10), g.strafe < 0 ? -1 : 1);
  }
  return rows;
}
function fullOk(r) {
  if (!Array.isArray(r) || r.length % FULL_N || r.length > NGOR * FULL_N || !r.every(Number.isFinite)) return false;
  for (let i = 0; i < r.length; i += FULL_N) if (r[i] < 0 || r[i] >= NGOR || Math.abs(r[i + 1]) > 50000 || Math.abs(r[i + 2]) > 50000 || r[i + 6] < 0 || r[i + 6] >= G_ST.length) return false;
  return true;
}
//  (the gorgons there now are cleared first: this is all of them)
function adoptFull(G, r) {
  clearGorgons(G);
  const now = G.env.now();
  for (let i = 0; i < r.length; i += FULL_N) {
    const slot = r[i];
    while (G.gorgons.length <= slot) G.gorgons.push({ slot: G.gorgons.length, live: false });
    const g = G.gorgons[slot], x = r[i + 1] / 100, z = r[i + 2] / 100, lord = r[i + 14];
    Object.assign(g, {
      live: true, x, z, y: r[i + 3] / 100, hd: r[i + 4] / 1000, sp: 0, hp: Math.min(GOR_HP, r[i + 5] / 10),
      st: G_ST[r[i + 6]], stT: r[i + 7] / 10, gaitPh: 0, gait: 'walk', lean: 0,
      maw: 0, mawWant: 0, headYaw: 0, headPitch: 0, crouch: 0, lunge: 0, predLean: 0, armTwist: 0,
      stagger: 0, atk: null, atkCd: r[i + 16] / 10, enraged: !!r[i + 9], dead: r[i + 8] >= 0, deadT: r[i + 8] >= 0 ? r[i + 8] / 10 : 0,
      see: 0, seeT: now - r[i + 13] / 10, tx: r[i + 11] / 10, tz: r[i + 12] / 10, tdist: 999, hasT: !!r[i + 10],
      wx: r[i + 18] / 10, wz: r[i + 19] / 10, wanderT: r[i + 20] / 10, strafe: r[i + 21] < 0 ? -1 : 1,
      stepBeat: -1, breath: 2, noise: null, noiseS: 0,
      netX: x, netZ: z, netH: r[i + 4] / 1000, rx: x, rz: z, hpHold: 0, lod: 0,
      lord: lord === 1 ? 'mf' : lord === 2 ? 'vec' : null, lordSlot: lord === 1 ? r[i + 15] : -1, lordFar: 0, taint: lord ? 1 : 0,
      rise: r[i + 17] / 100, riseY: 0, weave: 0, burstT: 0, bursting: true, flankCd: 0, growled: 0,
    });
    if (g.dead) g.hp = 0;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    NGOR, GOR_WILD, GOR_HP, RETINUE, G_VIS, G_HEAR, G_MEM, G_CLAW_R, G_CLAW_DMG, G_DCLAW_DMG, G_PRED_R, G_PRED_DMG, G_ENRAGE, G_RISE_T, G_KEEP, G_APART, G_ST, G_ATK, FULL_N,
    makeGorgons, startAtk, runAtk, step, see, spawnSpot, spawnGorgon, despawnGorgon, clearGorgons, think, hurt, kill, stock, fighting,
    marks, snapRows, fullState, fullOk, adoptFull,
  };
}
