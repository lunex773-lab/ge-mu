'use strict';
//  ============================================================
//  CONTOUR — the other side's mind flayers  (shared)
//  ============================================================
//  The thing the dogs and the gorgons answer to: what it thinks, how it
//  walks, how it strikes and throws, and how it commands. A player's game
//  runs them while alone (or hosting a room that does not); with two or more
//  in a room the room server runs them (server/dogs.js, beside the dogs and
//  the gorgons it commands) with this same code. Nothing here draws or makes
//  a sound — the game poses and draws one from the fields this moves, and
//  hears it through the hooks (env.on).
//
//  It is not a bigger demogorgon: what makes it a commander is that it is
//  wired into everything around it. Any dog or gorgon standing inside its
//  reach is *linked* — it sees what they see, hears what they hear, hands
//  them a shared target, and takes a share of every wound they take. So the
//  fight has two ways through it: climb the body, or cut the escort out from
//  under it and watch the damage arrive anyway; ignore the escort and it
//  simply calls more and you get surrounded. It is the only one of them that
//  will decide the day has gone badly: below a third of its health it calls
//  everything it is allowed to call, and walks away — on its legs, through
//  the streets, no vanishing.
//
//  The world it lives in comes through env, as the dogs' and gorgons' does:
//    now(), random(), targets() — [{ x, z, y, ey, dead, cloak, fx, fz, yaw }]
//    clearAt, supportHeight, rayCity, wrecks(), master
//    dogs(), gorgons()        the ones it commands (and releases)
//    spawnDog(), spawnGorgon(at)   one more, for its escort (null: none to be had)
//    hit(m, t, dmg, kb, ox, oz, shake)   a blow lands on target t: dmg, and
//                             knocked kb m away from (ox, oz) (kb 0: not moved)
//    stomp(m, cx, cz, hits)   a foreleg comes down at (cx, cz): hits is
//                             [{ t, dmg, kb }] — who was under it, as it fell
//    on: { roar, summon, wind, swing, launch, hold, fly, land, drop, far,
//          panic, hurt, death, rift, gone }

const CITY = require('./city.js');
const TR = require('./troop.js');
const WR = require('./wrecks.js');
const RULES = require('./rules.js');
const DG = require('./dogs.js');
const GR = require('./gorgons.js');

const NMF = 2;
const MF_HP = GR.GOR_HP * 10;            // 4200 — ten gorgons
const MF_VIS = 90, MF_VIS_COS = Math.cos(1.5);
const MF_LINK = DG.MF_LINK;              // how far its command reaches
const MF_SHARE = 0.28;                   // of a minion's wound that reaches it
const MF_SHARE_S = 55;                   // …but never more than this per second
const MF_SUMMON = 120, MF_PANIC_CD = 95;
const MF_ESC_GOR = GR.RETINUE.mf, MF_ESC_DOG = DG.RETINUE.mf;
const MF_TAKE = DG.MF_TAKE;
const MF_MEM = 22;                       // how long it keeps hunting what it knew
const MF_SWIPE_R = 15.5, MF_SWIPE_DMG = 30;
//  §21 wanted "distance decides", and two attacks is not a decision. Each of
//  these punishes a different habit: the sweep punishes strafing round it,
//  the stomp punishes standing under it, and the lash punishes sitting at the
//  range where the swipe cannot reach and the throw has no car to pick up.
const MF_STOMP_R = 12.5, MF_STOMP_DMG = 34, MF_STOMP_OFF = 10;
const MF_SWEEP_R = 19.5, MF_SWEEP_DMG = 24;
const MF_LASH_R = 26, MF_LASH_DMG = 19;
const MF_THROW_MIN = 17, MF_THROW_MAX = 62, MF_THROW_DMG = 34;
const MF_PANIC = 0.30;
const M_BODY_Y = 13.4, M_FOOT_R = 13.6;  // its ride height, and how far out its feet stand
const WORLD = RULES.WORLD;
//  a flayer's state, as a snapshot numbers it (index 1…)
const MF_ST = ['idle', 'wander', 'alert', 'track', 'attack', 'summon', 'flee'];

// ---- attacks ------------------------------------------------------
const MF_ATK = {
  swipe: { wind: 0.72, swing: 0.42, rec: 0.60, cd: 3.4 },
  throw: { wind: 1.25, swing: 0.30, rec: 0.75, cd: 6.0 },
  //  slow and enormous: you are meant to see it coming and leave
  stomp: { wind: 1.05, swing: 0.24, rec: 0.78, cd: 5.4 },
  //  long and flat, so backing straight off does not clear it — you go round
  sweep: { wind: 0.86, swing: 0.58, rec: 0.70, cd: 4.4 },
  //  the one quick thing it owns, and the only reason mid range is not safe
  lash:  { wind: 0.46, swing: 0.26, rec: 0.42, cd: 2.6 },
};
const ATK_KINDS = ['swipe', 'throw', 'stomp', 'sweep', 'lash'];     // (a snapshot numbers them 1…)

function makeFlayers(env) { return { env, flayers: [], spawnCd: 70, holdSpawn: false, shareAcc: 0, shareT: 0, thrown: null }; }

// ---- the population -----------------------------------------------
//  Somewhere with room: a wide place far from everyone, because a thing this
//  big arriving inside someone's field of view would be absurd and it needs a
//  street it can actually stand across.
function spawnSpot(F) {
  const E = F.env, rnd = E.random, who = E.targets();
  let best = null, bestS = -1;
  for (let i = 0; i < 70; i++) {
    const x = (rnd() * 2 - 1) * WORLD * 0.40, z = (rnd() * 2 - 1) * WORLD * 0.40;
    const d = DG.nearestTo(who, x, z).d;
    if (d < 120 || d > 300) continue;
    let room = true;                            // its feet need clear ground all round
    for (let a = 0; a < 6 && room; a++) {
      const t = (a / 6) * 6.2832;
      if (!E.clearAt(x + Math.sin(t) * M_FOOT_R, z + Math.cos(t) * M_FOOT_R, 1.5)) room = false;
    }
    if (!room || !E.clearAt(x, z, 2.5)) continue;
    let s = d * 0.02 + rnd() * 3;
    const bi = Math.round(x / CITY.PITCH), bj = Math.round(z / CITY.PITCH);
    if (Math.abs(x - bi * CITY.PITCH) < CITY.RW && Math.abs(z - bj * CITY.PITCH) < CITY.RW) s += 8;   // an intersection
    if (s > bestS) { bestS = s; best = { x, z }; }
  }
  return best;
}
//  (slot: this one, when a snapshot says which — else the first free)
function spawnFlayer(F, at, slot) {
  const E = F.env, rnd = E.random, fl = F.flayers;
  if (slot !== undefined) while (fl.length <= slot) fl.push({ slot: fl.length, live: false });
  let m = slot === undefined ? fl.find((o) => !o.live) : fl[slot];
  if (!m && fl.length >= NMF) return null;
  const spot = at || spawnSpot(F); if (!spot) return null;
  if (!m) { m = { slot: fl.length, live: false }; fl.push(m); }
  Object.assign(m, {
    live: true, x: spot.x, z: spot.z, y: E.supportHeight(spot.x, spot.z, 1), hd: rnd() * 6.2832,
    sp: 0, hp: MF_HP, st: 'wander', stT: 0, gaitPh: rnd(), lean: 0,
    maw: 0, mawWant: 0, headYaw: 0, headPitch: 0, crouch: 0, rear: 0, lunge: 0, swell: 0,
    stagger: 0, atk: null, atkCd: 4, panicked: false, dead: false, deadT: 0,
    see: 0, seeT: -99, tx: spot.x, tz: spot.z, tdist: 999, hasT: false,
    wx: spot.x, wz: spot.z, wanderT: 0, summonT: MF_SUMMON * 0.35, panicCd: 0,
    stepBeat: -1, pulse: rnd() * 5, fleeT: 0,
    netX: spot.x, netZ: spot.z, netH: 0, rx: spot.x, rz: spot.z, hpHold: 0, lod: 0,
    spawnD: DG.nearestTo(E.targets(), spot.x, spot.z).d, escorted: false,
    lord: null, lordSlot: -1, lordFar: 0, taint: 0,
  });
  return m;
}
function despawnFlayer(F, m) {
  drop(F, m);
  m.live = false; m.dead = false; m.atk = null; F.env.on.gone(m);
  //  Release the retinue by hand rather than leaving it to expire on the next
  //  lordOf. Slots are reused, and a follower that has not looked at its bond
  //  for a few seconds would otherwise wake up owned by whatever spawned into
  //  this slot next — a dog inheriting a stranger for a master.
  for (const d of F.env.dogs()) if (d.lord === 'mf' && d.lordSlot === m.slot) d.lord = null;
  for (const g of F.env.gorgons()) if (g.lord === 'mf' && g.lordSlot === m.slot) g.lord = null;
}
function clearFlayers(F) { for (const m of F.flayers) if (m.live) despawnFlayer(F, m); }
//  A wreck it had picked up and not yet let go of goes back on the road —
//  cut short (killed, cleared, handed on) mid-lift, it used to stay up there.
function drop(F, m) {
  if (!m.atk || m.atk.kind !== 'throw' || !(m.holdW >= 0)) return;
  const k = m.holdW, w = F.env.wrecks()[k];
  m.holdW = -1;
  if (!w || (F.thrown && F.thrown.k === k)) return;
  w.thrown = false;
  F.env.on.drop(w, k);
}

// ---- the retinue ----------------------------------------------------
//  Who follows whom, written down: a minion knows its lord, a lord counts its
//  own (proximity does not survive the master walking away). The caps are the
//  point: a king who drags forty bodies around with him is a king you cannot
//  fight. §21/§55: a claim only ever takes something loose — the wild get
//  taken, the owned stay owned, and only distance or a death frees one.
function claimNear(arr, mx, mz, take, want, tag, slot) {
  if (want <= 0) return 0;
  let best = null, took = 0;
  for (let n = 0; n < want; n++) {
    best = null;
    let bestD = take;
    for (const o of arr) {
      if (!o.live || o.dead || o.lord) continue;
      const dr = Math.hypot(o.x - mx, o.z - mz);
      if (dr < bestD) { bestD = dr; best = o; }
    }
    if (!best) break;
    best.lord = tag; best.lordSlot = slot;
    //  It stops whatever it was privately doing and falls in. Without this it
    //  keeps running out its current wander timer and the bond looks broken
    //  for the several seconds before the next decision.
    if (best.st === 'wander' || best.st === 'idle' || best.st === 'search') { best.st = 'escort'; best.stT = 0; }
    took++;
  }
  return took;
}
function retinueOf(arr, tag, slot) {
  let n = 0;
  for (const o of arr) if (o.live && !o.dead && o.lord === tag && (tag === 'vec' || o.lordSlot === slot)) n++;
  return n;
}

// ---- the command network -------------------------------------------
//  Separate from the retinue and deliberately so. *Following* needs an
//  owner, because it has to survive the master moving. *Knowing* and
//  *bleeding* do not: anything of its kind standing inside MF_LINK is wired
//  in whether it follows the thing or not, and the link breaks the moment
//  either of them walks off.
function linkedTo(F, x, z) {
  for (const m of F.flayers) {
    if (!m.live || m.dead) continue;
    if (Math.hypot(m.x - x, m.z - z) <= MF_LINK) return m;
  }
  return null;
}
//  The escort cap is counted over what actually follows it, not over what
//  happens to be standing nearby.
function counts(F, m) {
  return { dogs: retinueOf(F.env.dogs(), 'mf', m.slot), gors: retinueOf(F.env.gorgons(), 'mf', m.slot) };
}
//  Two-way, and deliberately blunt: it hands down a target and an alert, and
//  it takes up sightings and wounds. No formations, no roles — the escort
//  keeps its own behaviour, it is just told what to look at.
function command(F, m, dt) {
  const E = F.env, now = E.now(), dogs = E.dogs(), gorgons = E.gorgons();
  const known = m.hasT && now - m.seeT < MF_MEM;
  //  §6/§7: the escort is topped up out of whatever is already loose nearby
  //  before it is ever topped up by summoning.
  m.claimT = (m.claimT || 0) - dt;
  if (m.claimT <= 0) {
    m.claimT = 1.4;
    claimNear(dogs, m.x, m.z, MF_TAKE, MF_ESC_DOG - retinueOf(dogs, 'mf', m.slot), 'mf', m.slot);
    claimNear(gorgons, m.x, m.z, MF_TAKE, MF_ESC_GOR - retinueOf(gorgons, 'mf', m.slot), 'mf', m.slot);
  }
  for (const d of dogs) {
    if (!d.live || d.dead) continue;
    if (Math.hypot(d.x - m.x, d.z - m.z) > MF_LINK) continue;
    if (d.hasT && now - d.seeT < 4 && d.tdist < 40) {          // §23: it learns through them
      m.hasT = true; m.tx = d.tx; m.tz = d.tz; m.seeT = Math.max(m.seeT, d.seeT);
      m.senseT = now;
    }
    if (known && (!d.hasT || now - d.seeT > 3)) {              // §25: and hands the target back
      d.hasT = true; d.tx = m.tx; d.tz = m.tz; d.seeT = now - 1.5;
      if (d.st === 'wander' || d.st === 'idle' || d.st === 'escort') { d.st = 'alert'; d.stT = 0; }
    }
  }
  for (const g of gorgons) {
    if (!g.live || g.dead) continue;
    if (Math.hypot(g.x - m.x, g.z - m.z) > MF_LINK) continue;
    if (g.hasT && now - g.seeT < 4 && g.tdist < 55) {
      m.hasT = true; m.tx = g.tx; m.tz = g.tz; m.seeT = Math.max(m.seeT, g.seeT);
      m.senseT = now;
    }
    if (known && (!g.hasT || now - g.seeT > 3)) {
      g.hasT = true; g.tx = m.tx; g.tz = m.tz; g.seeT = now - 1.5;
      if (g.st === 'wander' || g.st === 'search' || g.st === 'escort') { g.st = 'chase'; g.stT = 0; }
    }
  }
}
//  §12/§52/§53: a share of a minion's wound, rate-limited so that mowing down
//  an escort is a real second route into the body without being the only one.
function shareDamage(F, x, z, dmg) {
  const m = linkedTo(F, x, z);
  if (!m || m.dead) return;
  const now = F.env.now();
  if (now - F.shareT > 1) { F.shareT = now; F.shareAcc = 0; }
  const room = Math.max(0, MF_SHARE_S - F.shareAcc);
  const share = Math.min(dmg * MF_SHARE, room);
  if (share <= 0) return;
  F.shareAcc += share;
  m.hp -= share;
  m.swell = Math.min(1, m.swell + 0.35);          // §26: it registers it, quietly
  m.senseT = now;
  if (m.hp <= 0) kill(F, m);
}
//  §7/§29: capped, and never a faucet. The head count is taken again before
//  every single body, not once at the top: anything that changes it mid-loop
//  would otherwise drift the arithmetic and the cap quietly leaks.
function summon(F, m, dogWant, gorWant) {
  const E = F.env, rnd = E.random;
  let made = 0;
  for (let i = 0; i < gorWant; i++) {
    if (counts(F, m).gors >= MF_ESC_GOR) break;
    const spot = ring(F, m, 26 + rnd() * 16); if (!spot) break;
    const g = E.spawnGorgon(spot); if (!g) break;
    g.hasT = m.hasT; g.tx = m.tx; g.tz = m.tz; g.seeT = m.seeT;
    g.lord = 'mf'; g.lordSlot = m.slot; if (!m.hasT) { g.st = 'escort'; g.stT = 0; }
    g.rise = 0; g.taint = 0.5; E.on.rift(spot.x, spot.z, 4.4, 3.4);
    made++;
  }
  for (let i = 0; i < dogWant; i++) {
    if (counts(F, m).dogs >= MF_ESC_DOG) break;
    const spot = ring(F, m, 20 + rnd() * 18); if (!spot) break;
    const d = E.spawnDog(); if (!d) break;
    d.x = d.rx = spot.x; d.z = d.rz = spot.z; d.y = E.supportHeight(spot.x, spot.z, 1);
    d.hasT = m.hasT; d.tx = m.tx; d.tz = m.tz; d.seeT = m.seeT;
    d.lord = 'mf'; d.lordSlot = m.slot;
    d.st = m.hasT ? 'chase' : 'escort'; d.stT = 0;
    d.rise = 0; d.taint = 0.5; E.on.rift(spot.x, spot.z, 2.9, 2.8);
    made++;
  }
  if (made) { m.mawWant = 1; m.summonFx = 0.9; E.on.summon(m); }
  return made;
}
function ring(F, m, r) {
  const E = F.env;
  for (let i = 0; i < 20; i++) {
    const a = E.random() * 6.2832;
    const x = m.x + Math.sin(a) * r, z = m.z + Math.cos(a) * r;
    if (Math.abs(x) > WORLD * 0.44 || Math.abs(z) > WORLD * 0.44) continue;
    if (E.clearAt(x, z, 1.3)) return { x, z };
  }
  return null;
}

// ---- throwing -------------------------------------------------------
//  It picks up one of the dead cars and throws it. The wreck is the real
//  one — it is flown along the arc and its collision box goes with it — so
//  the street is genuinely rearranged by the fight and the thing it threw is
//  still lying there afterwards.
function pickWreck(F, m) {
  const wrecks = F.env.wrecks();
  let best = -1, bestD = 1e9;
  for (let k = 0; k < wrecks.length; k++) {
    const w = wrecks[k];
    if (!w || w.thrown) continue;
    const d = Math.hypot(w.x - m.x, w.z - m.z);
    if (d > 34) continue;
    const toPlayer = Math.hypot(w.x - m.tx, w.z - m.tz);
    if (toPlayer < 14) continue;                       // not one already at their feet
    if (d < bestD) { bestD = d; best = k; }
  }
  return best;
}
function launch(F, m) {
  const E = F.env, wrecks = E.wrecks();
  const k = m.holdW;
  if (k < 0 || !wrecks[k]) return;
  const w = wrecks[k];
  const dx = m.tx - w.x, dz = m.tz - w.z, d = Math.max(4, Math.hypot(dx, dz));
  const t = Math.max(0.9, d / 26);                     // flight time, then solve the arc for it
  F.thrown = { k, x: w.x, y: w.y + 9, z: w.z, ty: E.supportHeight(m.tx, m.tz, 2),
               vx: dx / t, vz: dz / t, vy: (0 - (w.y + 9 - E.supportHeight(m.tx, m.tz, 2)) + 0.5 * 26 * t * t) / t,
               spin: (E.random() - 0.5) * 5, roll: 0, t: 0, hit: 0, got: [] };
  w.thrown = true;
  E.on.launch(m);
  m.holdW = -1;
}
//  the car in the air: it falls, it may land on someone, and it comes down
//  where it comes down (judge false: only drawn here — someone else decides
//  who it hits)
function flight(F, dt, judge) {
  const T = F.thrown;
  if (!T) return;
  const E = F.env;
  T.t += dt;
  T.vy -= 26 * dt;
  T.x += T.vx * dt; T.y += T.vy * dt; T.z += T.vz * dt;
  T.roll += T.spin * dt;
  const w = E.wrecks()[T.k];
  if (judge !== false) for (const t of E.targets()) {
    if (T.got.indexOf(t) >= 0 || !(Math.hypot(T.x - t.x, T.z - t.z) < 4.2) || !(Math.abs(T.y - t.ey) < 4) || t.dead) continue;
    T.got.push(t); T.hit = 1;
    E.hit(null, t, MF_THROW_DMG, 0, 0, 0, 0.9);
  }
  const gy = E.supportHeight(T.x, T.z, T.y + 1);
  if (T.y <= gy + 0.4 || T.t > 6) {                    // it lands, and stays landed
    w.x = T.x; w.z = T.z; w.y = gy; w.rot += T.roll * 0.4; w.tilt = (E.random() - 0.5) * 0.5;
    w.thrown = false;
    E.on.land(T, w, gy);
    F.thrown = null;
    return;
  }
  E.on.fly(T, w);
}

// ---- perception ------------------------------------------------------
//  As the dogs' and gorgons': the best seen of the targets, and whether it
//  sees anyone or not, m.tdist is then of the one it is looking at — or of
//  the nearest, if none. Eleven metres up, so it looks over most of what
//  would hide you from a dog.
const _eye = { x: 0, y: 0, z: 0 }, _dir = { x: 0, y: 0, z: 0 };
function see(F, m) {
  const E = F.env, who = E.targets();
  let best = 0, bt = null, nd = Infinity, nt = null;
  const fx = Math.sin(m.hd), fz = Math.cos(m.hd);
  for (let i = 0; i < who.length; i++) {
    const t = who[i];
    const dx = t.x - m.x, dz = t.z - m.z, dist = Math.hypot(dx, dz);
    if (dist < nd) { nd = dist; nt = t; }
    if (t.dead || dist > MF_VIS) continue;
    const dotf = dist > 0.01 ? (dx / dist) * fx + (dz / dist) * fz : 1;
    if (dotf < MF_VIS_COS && dist > 22) continue;
    _eye.x = m.x; _eye.y = m.y + M_BODY_Y + 2; _eye.z = m.z;
    _dir.x = t.x - _eye.x; _dir.y = (t.ey - 0.6) - _eye.y; _dir.z = t.z - _eye.z;
    const len = Math.sqrt(_dir.x * _dir.x + _dir.y * _dir.y + _dir.z * _dir.z), inv = 1 / len;   // (three.js's length() and multiplyScalar)
    _dir.x *= inv; _dir.y *= inv; _dir.z *= inv;
    if (Math.min(E.rayCity(_eye, _dir, len), WR.ray(E.wrecks(), _eye, _dir)) < len - 1.2) continue;
    const s = t.cloak ? 0.5 : 1;
    if (s > best) { best = s; bt = t; }
  }
  const on = bt || nt;
  if (on) { m.tdist = Math.hypot(on.x - m.x, on.z - m.z); m.tgt = bt; }
  return best;
}

// ---- the decision -----------------------------------------------------
function think(F, m, dt) {
  const E = F.env, rnd = E.random, now = E.now();
  m.stT += dt;
  m.atkCd = Math.max(0, m.atkCd - dt);
  m.panicCd = Math.max(0, m.panicCd - dt);
  m.summonT -= dt;
  m.stagger = Math.max(0, m.stagger - dt * 1.4);
  m.swell = Math.max(0, m.swell - dt * 0.7);
  if (m.dead) { m.deadT += dt; m.sp = 0; m.mawWant = 0; return; }

  command(F, m, dt);
  const seen = see(F, m);
  if (seen > 0) { m.see = seen; m.seeT = now; m.hasT = true; m.tx = m.tgt.x; m.tz = m.tgt.z; }
  else m.see = 0;
  const known = m.hasT && now - m.seeT < MF_MEM;
  const dist = m.tdist;
  const fx = dist > 0.01 ? (m.tx - m.x) / dist : 0, fz = dist > 0.01 ? (m.tz - m.z) / dist : 1;
  let lookX = m.tx, lookZ = m.tz;

  //  §8: the standing summon, on its own clock, capped by what is already here
  if (m.summonT <= 0) {
    m.summonT = MF_SUMMON;
    if (m.st !== 'flee') { m.st = 'summon'; m.stT = 0; m.pendSummon = [2, 1]; }
  }
  //  §28: it decides the day has gone badly — calls everything, then leaves
  if (!m.panicked && m.hp <= MF_HP * MF_PANIC && m.panicCd <= 0) {
    m.panicked = true; m.panicCd = MF_PANIC_CD;
    m.st = 'summon'; m.stT = 0; m.pendSummon = [5, 2]; m.thenFlee = true;
    E.on.panic(m);
  }
  if (m.atk) { runAtk(F, m, dt); return; }

  switch (m.st) {
    case 'wander': {
      m.wanderT -= dt;
      if (m.wanderT <= 0 || Math.hypot(m.wx - m.x, m.wz - m.z) < 8) {
        for (let i = 0; i < 14; i++) {
          const a = m.hd + (rnd() - 0.5) * 1.8, r = 40 + rnd() * 70;
          const nx = m.x + Math.sin(a) * r, nz = m.z + Math.cos(a) * r;
          if (Math.abs(nx) > WORLD * 0.42 || Math.abs(nz) > WORLD * 0.42) continue;
          if (E.clearAt(nx, nz, 2.5)) { m.wx = nx; m.wz = nz; break; }
        }
        m.wanderT = 14 + rnd() * 14;
      }
      step(F, m, m.wx, m.wz, 2.4, dt);
      lookX = m.x + Math.sin(m.hd + Math.sin(now * 0.24) * 0.8) * 30;
      lookZ = m.z + Math.cos(m.hd + Math.sin(now * 0.24) * 0.8) * 30;
      m.mawWant = 0;
      if (known) { m.st = 'alert'; m.stT = 0; }
      break;
    }
    case 'alert':                       // §44: it turns, it swells, it answers
      step(F, m, m.x, m.z, 0, dt); m.sp = 0;
      m.mawWant = 0.4; m.rear = Math.min(1, m.rear + dt * 1.6);
      if (m.stT > 0.2 && !m.roared) { m.roared = 1; E.on.roar(m); }
      if (m.stT > 1.6) { m.roared = 0; m.st = known ? 'track' : 'wander'; m.stT = 0; }
      break;
    case 'track': {
      if (!known) { m.st = 'wander'; m.stT = 0; break; }
      //  §21: distance decides. Close, it swings. Middle, it throws. Far, it
      //  lets the escort do the work and simply keeps coming.
      step(F, m, m.tx - fx * 9, m.tz - fz * 9, m.panicked ? 5.4 : 4.3, dt);
      m.mawWant = 0.2;
      if (m.atkCd <= 0 && m.see > 0) {
        //  Each band offers more than one answer and picks between them, and
        //  the bands overlap: standing at any particular range never tells you
        //  which thing is about to happen.
        const r = rnd();
        if (dist < MF_STOMP_R * 0.9) {
          //  right underneath it: the two that do not need it to turn
          startAtk(F, m, r < 0.45 ? 'stomp' : r < 0.80 ? 'swipe' : 'sweep');
        } else if (dist < MF_SWIPE_R) {
          startAtk(F, m, r < 0.40 ? 'swipe' : r < 0.72 ? 'sweep' : 'stomp');
        } else if (dist < MF_SWEEP_R) {
          startAtk(F, m, r < 0.50 ? 'sweep' : 'lash');
        } else if (dist < MF_LASH_R) {
          startAtk(F, m, r < 0.55 ? 'lash' : 'sweep');
        } else if (dist > MF_THROW_MIN && dist < MF_THROW_MAX) {
          const k = pickWreck(F, m);
          //  and if there is nothing to pick up, it does not simply stand
          //  there waiting for one — it closes and lashes instead
          if (k >= 0 && r < 0.8) { m.holdW = k; startAtk(F, m, 'throw'); }
          else if (dist < MF_LASH_R + 6) startAtk(F, m, 'lash');
          else m.atkCd = 1.6;
        }
      }
      break;
    }
    case 'summon': {
      step(F, m, m.x, m.z, 0, dt); m.sp = 0;
      m.mawWant = 1; m.rear = Math.min(1, m.rear + dt * 2.2);
      if (m.stT > 1.1 && m.pendSummon) {
        summon(F, m, m.pendSummon[0], m.pendSummon[1]);
        m.pendSummon = null;
      }
      if (m.stT > 2.4) {
        m.rear = 0;
        if (m.thenFlee) { m.thenFlee = false; m.st = 'flee'; m.fleeT = 34; }
        else m.st = known ? 'track' : 'wander';
        m.stT = 0;
      }
      break;
    }
    case 'flee': {
      //  §30/§31: it walks out. No vanishing, no shortcut through the world —
      //  it picks somewhere far and puts one foot in front of another until
      //  it is out of the district, and the escort it just called covers it.
      m.fleeT -= dt;
      if (!m.fleeX || Math.hypot(m.fleeX - m.x, m.fleeZ - m.z) < 14) {
        let bx = m.x - fx * 140, bz = m.z - fz * 140;
        bx = Math.max(-WORLD * 0.42, Math.min(WORLD * 0.42, bx));
        bz = Math.max(-WORLD * 0.42, Math.min(WORLD * 0.42, bz));
        m.fleeX = bx; m.fleeZ = bz;
      }
      step(F, m, m.fleeX, m.fleeZ, 6.2, dt);
      m.mawWant = 0.1;
      lookX = m.x + (m.x - m.tx); lookZ = m.z + (m.z - m.tz);
      if (m.fleeT <= 0 || m.tdist > 260) { m.hasT = false; m.st = 'wander'; m.stT = 0; m.fleeX = 0; }
      break;
    }
    default: m.st = 'wander'; m.stT = 0;
  }
  if (m.st !== 'alert' && m.st !== 'summon') m.rear = Math.max(0, m.rear - dt * 1.4);

  { const rel = Math.atan2(lookX - m.x, lookZ - m.z) - m.hd;
    let a = rel; while (a > Math.PI) a -= 6.2832; while (a < -Math.PI) a += 6.2832;
    m.headYawWant = Math.max(-1.0, Math.min(1.0, a));
    const dz2 = Math.hypot(lookX - m.x, lookZ - m.z);
    m.headPitchWant = Math.max(-0.9, Math.min(0.5, Math.atan2(1.5 - M_BODY_Y, Math.max(6, dz2))));
  }
}

// ---- attacks ---------------------------------------------------------
function startAtk(F, m, kind) {
  const legs = [0, 3];                                   // the two forelegs do the hitting
  const leg = legs[F.env.random() < 0.5 ? 0 : 1];
  //  The stomp commits to a spot now, not on impact. Aimed at where you are
  //  when it starts and left there, so the wind-up is a real warning instead
  //  of a homing animation you cannot answer.
  const px = kind === 'stomp' ? m.x + Math.sin(m.hd) * MF_STOMP_OFF : 0;
  const pz = kind === 'stomp' ? m.z + Math.cos(m.hd) * MF_STOMP_OFF : 0;
  m.atk = { kind, t: 0, leg, side: leg === 0 ? 1 : -1, phase: -1, hit: 0, sfx: 0, px, pz, got: [] };
  m.st = 'attack'; m.stT = 0;
  F.env.on.wind(m, kind);
}
function runAtk(F, m, dt) {
  const E = F.env, a = m.atk, A = MF_ATK[a.kind];
  a.t += dt;
  if (see(F, m) > 0) { m.tx = m.tgt.x; m.tz = m.tgt.z; m.seeT = E.now(); }
  const total = A.wind + A.swing + A.rec;
  if (a.t < A.wind) {
    a.phase = -(1 - a.t / A.wind);
    m.rear = Math.min(1, m.rear + dt * 1.8);
    if (a.kind === 'throw' && m.holdW >= 0) {            // §20: grab, lift, hold, release
      const w = E.wrecks()[m.holdW];
      if (w) {
        const lift = Math.min(1, a.t / (A.wind * 0.8));
        const hx = m.x + Math.sin(m.hd) * 9, hz = m.z + Math.cos(m.hd) * 9;
        w.thrown = true;
        const x = w.x + (hx - w.x) * lift, y = w.y + lift * 11, z = w.z + (hz - w.z) * lift;
        E.on.hold(m, w, lift, x, y, z);
        if (a.t > A.wind * 0.8) { w.x = x; w.z = z; w.y = y - 11 * lift; }
      }
    }
  } else if (a.t < A.wind + A.swing) {
    const k = (a.t - A.wind) / A.swing;
    a.phase = k;
    m.rear = Math.max(0, m.rear - dt * 3);
    if (!a.sfx && k > 0.3) { a.sfx = 1; E.on.swing(m); if (a.kind === 'throw') launch(F, m); }
    strike(F, m, a, k);
  } else {
    a.phase = 1;
  }
  if (a.t >= total) {
    m.atkCd = A.cd * (m.panicked ? 0.7 : 1);
    m.atk = null; m.st = 'track'; m.stT = 0;
  }
}
//  Whoever is in the way of it, once each. Every one of these moves you; they
//  only differ in how far and from where — pushing from the impact point
//  rather than from the body is what makes the stomp feel like a shockwave
//  instead of a shove.
function strike(F, m, a, k) {
  const E = F.env, who = E.targets();
  if (a.kind === 'stomp') {
    //  A foreleg comes down on a spot in front of it. The damage falls off
    //  from the crater, so being at the edge is survivable and being under it
    //  is not — and it is aimed where you were when the wind-up started, so
    //  moving at all beats moving in any particular direction.
    if (a.hit || !(k > 0.45) || !who.some((t) => !t.dead)) return;
    a.hit = 1;
    const cx = a.px, cz = a.pz, hits = [];
    for (const t of who) {
      if (t.dead) continue;
      const r = Math.hypot(t.x - cx, t.z - cz);
      if (r < MF_STOMP_R) hits.push({ t, dmg: Math.round(MF_STOMP_DMG * (1 - 0.55 * (r / MF_STOMP_R))), kb: 9.5 * (1 - r / MF_STOMP_R) + 2 });
    }
    E.stomp(m, cx, cz, hits);
    return;
  }
  const open = a.kind === 'swipe' ? k > 0.3 : a.kind === 'sweep' ? k > 0.22 && k < 0.9 : a.kind === 'lash' ? k > 0.35 : false;
  if (!open) return;
  for (const t of who) {
    if (t.dead || a.got.indexOf(t) >= 0) continue;
    const dist = Math.hypot(t.x - m.x, t.z - m.z);
    if (a.kind === 'swipe') {
      if (!(dist < MF_SWIPE_R)) continue;
      a.got.push(t); a.hit = 1;
      E.hit(m, t, MF_SWIPE_DMG, 7.5, m.x, m.z, 1.0);           // §18: it knocks you about
    } else if (a.kind === 'sweep') {
      //  A leg goes round it at knee height. The test is angular, not radial:
      //  it catches you anywhere in a wide arc, so the answer is to be outside
      //  the reach or behind it, never to sidestep.
      if (!(dist < MF_SWEEP_R)) continue;
      const bear = Math.atan2(t.x - m.x, t.z - m.z);
      let rel = bear - (m.hd + a.side * (1.5 - 3.0 * k));
      while (rel > Math.PI) rel -= 6.2832; while (rel < -Math.PI) rel += 6.2832;
      if (!(Math.abs(rel) < 0.30)) continue;
      a.got.push(t); a.hit = 1;
      E.hit(m, t, MF_SWEEP_DMG, 11.0, m.x, m.z, 0.9);          // and it puts you a long way out
    } else {
      //  The neck throws the head out on the end of it. Fast, cheap, and the
      //  only thing it has that reaches past a swipe.
      if (!(dist < MF_LASH_R)) continue;
      const bear = Math.atan2(t.x - m.x, t.z - m.z);
      let rel = bear - m.hd;
      while (rel > Math.PI) rel -= 6.2832; while (rel < -Math.PI) rel += 6.2832;
      if (!(Math.abs(rel) < 0.5)) continue;
      a.got.push(t); a.hit = 1;
      E.hit(m, t, MF_LASH_DMG, 4.0, m.x, m.z, 0.6);
    }
  }
}

// ---- movement --------------------------------------------------------
function step(F, m, tx, tz, speed, dt) {
  const dx = tx - m.x, dz = tz - m.z, dd = Math.hypot(dx, dz);
  const ux = dd > 0.01 ? dx / dd : Math.sin(m.hd), uz = dd > 0.01 ? dz / dd : Math.cos(m.hd);
  const want = Math.atan2(ux, uz);
  //  §5: a slow turn. When it does come round, you have watched it happen.
  const turn = TR.easeHeading(m, want, dt, 1.6, 0.62);
  m.lean += (-turn * 0.10 - m.lean) * Math.min(1, dt * 5);
  const bx = m.x, bz = m.z;
  m.x += Math.sin(m.hd) * speed * dt; m.z += Math.cos(m.hd) * speed * dt;
  //  It steps over the city rather than through it: only the world edge and
  //  the tallest structures stop it, so its legs straddle the traffic.
  m.x = Math.max(-WORLD * 0.45, Math.min(WORLD * 0.45, m.x));
  m.z = Math.max(-WORLD * 0.45, Math.min(WORLD * 0.45, m.z));
  m.sp = dt > 1e-5 ? Math.hypot(m.x - bx, m.z - bz) / dt : 0;
  m.y += (F.env.supportHeight(m.x, m.z, m.y + 1) - m.y) * Math.min(1, dt * 4);
  return dd;
}

// ---- damage ----------------------------------------------------------
function hurt(F, m, dmg, fromX, fromZ) {
  if (!m.live || m.dead) return;
  const E = F.env, now = E.now();
  m.hp -= dmg;
  m.hasT = true; m.tx = fromX; m.tz = fromZ; m.seeT = now;
  m.swell = Math.min(1, m.swell + 0.5);
  if (dmg > 60) m.stagger = 1; else m.stagger = Math.max(m.stagger, 0.2);
  if (m.hp <= 0) { kill(F, m); return; }
  E.on.hurt(m);
  //  §27: hurting the body drives the escort harder
  for (const d of E.dogs()) {
    if (!d.live || d.dead || Math.hypot(d.x - m.x, d.z - m.z) > MF_LINK) continue;
    d.hasT = true; d.tx = fromX; d.tz = fromZ; d.seeT = now;
    if (d.st === 'wander' || d.st === 'idle' || d.st === 'escort') { d.st = 'alert'; d.stT = 0; }
  }
  for (const g of E.gorgons()) {
    if (!g.live || g.dead || Math.hypot(g.x - m.x, g.z - m.z) > MF_LINK) continue;
    g.hasT = true; g.tx = fromX; g.tz = fromZ; g.seeT = now;
    if (g.st === 'wander' || g.st === 'search' || g.st === 'escort') { g.st = 'chase'; g.stT = 0; }
  }
  //  Shot from outside its own sight. There is no answer to this from where
  //  it stands, so it stops being a thing that guards a district and becomes
  //  a thing that is coming: the whole escort is sent, and it walks in itself.
  //  Sniping it from a rooftop half a kilometre away should start a fight.
  if (Math.hypot(fromX - m.x, fromZ - m.z) > MF_VIS) {
    m.seeT = now;                               // it knows, sight or no sight
    m.st = 'track'; m.stT = 0;
    m.panicked = false;
    for (const d of E.dogs()) {
      if (!d.live || d.dead || Math.hypot(d.x - m.x, d.z - m.z) > MF_SUMMON) continue;
      d.hasT = true; d.tx = fromX; d.tz = fromZ; d.seeT = now;
      d.st = 'chase'; d.stT = 0;
    }
    for (const g of E.gorgons()) {
      if (!g.live || g.dead || Math.hypot(g.x - m.x, g.z - m.z) > MF_SUMMON) continue;
      g.hasT = true; g.tx = fromX; g.tz = fromZ; g.seeT = now;
      g.st = 'chase'; g.stT = 0;
    }
    if (!m.farCalled || now - m.farCalled > 12) {
      m.farCalled = now;
      E.on.far(m);
    }
    return;
  }
  if (m.st === 'wander') { m.st = 'alert'; m.stT = 0; }
}
function kill(F, m) {
  drop(F, m);
  m.dead = true; m.deadT = 0; m.hp = 0; m.sp = 0; m.atk = null; m.maw = 0.7;
  F.env.on.death(m);
}

// ---- keeping the district's one -------------------------------------
//  One at a time, and rare: a body lies 22 s and is cleared, and the next
//  arrives two and a half to four and a half minutes on. §6: never alone.
function stock(F, dt) {
  F.spawnCd -= dt;
  let live = 0;
  for (const m of F.flayers) {
    if (!m.live) continue;
    if (m.dead) { if (m.deadT > 22) despawnFlayer(F, m); continue; }
    live++;
  }
  if (F.spawnCd <= 0 && live < 1 && !F.holdSpawn) {
    F.spawnCd = 150 + F.env.random() * 120;
    const m = spawnFlayer(F);
    if (m && !m.escorted) { m.escorted = true; summon(F, m, MF_ESC_DOG, MF_ESC_GOR); }
  }
}
//  a fight always runs at full rate; otherwise every 1 / 3 / 8 frames within / past 120 / 250 m
function fighting(m) { return !!(m.atk || m.st === 'track' || m.st === 'attack'); }

// ---- over the wire ----------------------------------------------------
const HDQ = TR.HDQ;
//  its marks, as a snapshot carries them: 1 dead, 2 panicked, 4 sworn to VECNA, 8 the swing is the right foreleg's
function marks(m) { return (m.dead ? 1 : 0) | (m.panicked ? 2 : 0) | (m.lord === 'vec' ? 4 : 0) | (m.atk && m.atk.leg === 3 ? 8 : 0); }
//  per flayer [slot, x·10, z·10, heading byte, hp, state (MF_ST index + 1),
//  marks, swing (0 none, else ATK_KINDS index + 1), into it·100, head yaw·100,
//  head pitch·100, mouth·100, the wreck in its hand (−1 none), seen ago·10 (−1:
//  nothing known), what it hunts x·10, z·10] — enough to draw it as it is
const SNAP_N = 16;
function snapRows(F) {
  const now = F.env.now(), k = [];
  for (const m of F.flayers) {
    if (!m.live) continue;
    const h = (((m.hd || 0) % 6.2832) + 6.2832) % 6.2832;
    k.push(m.slot, Math.round(m.x * 10), Math.round(m.z * 10), Math.round(h * HDQ),
      Math.max(0, Math.round(m.hp)), MF_ST.indexOf(m.st) + 1, marks(m),
      m.atk ? ATK_KINDS.indexOf(m.atk.kind) + 1 : 0, m.atk ? Math.round(m.atk.t * 100) : 0,
      Math.round((m.headYawWant || 0) * 100), Math.round((m.headPitchWant || 0) * 100), Math.round((m.mawWant || 0) * 100),
      m.atk && m.atk.kind === 'throw' && m.holdW >= 0 ? m.holdW : -1,
      m.hasT ? Math.round(Math.min(600, Math.max(0, now - m.seeT)) * 10) : -1, Math.round(m.tx * 10), Math.round(m.tz * 10));
  }
  return k;
}
//  the car in the air, to draw it: [wreck, x·10, y·10, z·10, vx·10, vy·10, vz·10, spin·100, roll·100]
function flightRow(F) {
  const T = F.thrown;
  return T ? [T.k, Math.round(T.x * 10), Math.round(T.y * 10), Math.round(T.z * 10), Math.round(T.vx * 10), Math.round(T.vy * 10), Math.round(T.vz * 10),
    Math.round(T.spin * 100), Math.round(T.roll * 100)] : null;
}
//  The whole of it, to carry on from ({ r, cd, t }): per live flayer r [slot,
//  x·100, z·100, y·100, heading·1000, hp·10, state, time in it·10, dead
//  time·10 (−1: alive), panicked, target (1/0), tx·10, tz·10, seen ago·10,
//  VECNA's (1/0), swing ready in·10, panic ready in·10, next summon in·10,
//  wander x·10, z·10, wander time·10, flee time·10, flee x·10, z·10, escorted,
//  summons owed (dogs, gorgons; −1 none), then flee] — a swing in the air is
//  let go (a car in its hand put back down); cd the next one's wait·10; t the
//  car in the air, if one is ([wreck, x·100, y·100, z·100, vx·100, vy·100,
//  vz·100, spin·1000, roll·1000, time·100])
const FULL_N = 28;
function fullState(F) {
  const now = F.env.now(), r = [];
  for (const m of F.flayers) {
    if (!m.live) continue;
    r.push(m.slot, Math.round(m.x * 100), Math.round(m.z * 100), Math.round(m.y * 100), Math.round((m.hd || 0) * 1000), Math.round(Math.max(0, m.hp) * 10),
      MF_ST.indexOf(m.st === 'attack' ? 'track' : m.st), Math.round(Math.min(600, m.stT) * 10), m.dead ? Math.round(m.deadT * 10) : -1, m.panicked ? 1 : 0,
      m.hasT ? 1 : 0, Math.round(m.tx * 10), Math.round(m.tz * 10), Math.round(Math.min(600, Math.max(0, now - m.seeT)) * 10),
      m.lord === 'vec' ? 1 : 0, Math.round(m.atkCd * 10), Math.round(m.panicCd * 10), Math.round(Math.max(-60, Math.min(600, m.summonT)) * 10),
      Math.round(m.wx * 10), Math.round(m.wz * 10), Math.round(Math.min(600, m.wanderT) * 10),
      Math.round(Math.max(0, Math.min(600, m.fleeT || 0)) * 10), Math.round((m.fleeX || 0) * 10), Math.round((m.fleeZ || 0) * 10), m.escorted ? 1 : 0,
      m.pendSummon ? m.pendSummon[0] : -1, m.pendSummon ? m.pendSummon[1] : -1, m.thenFlee ? 1 : 0);
  }
  const T = F.thrown;
  return { r, cd: Math.round(Math.max(0, Math.min(6000, F.spawnCd)) * 10),
    t: T ? [T.k, Math.round(T.x * 100), Math.round(T.y * 100), Math.round(T.z * 100), Math.round(T.vx * 100), Math.round(T.vy * 100), Math.round(T.vz * 100),
      Math.round(T.spin * 1000), Math.round(T.roll * 1000), Math.round(T.t * 100)] : null };
}
function fullOk(f) {
  if (!f || typeof f !== 'object') return false;
  const r = f.r;
  if (!Array.isArray(r) || r.length % FULL_N || r.length > NMF * FULL_N || !r.every(Number.isFinite)) return false;
  for (let i = 0; i < r.length; i += FULL_N) {
    if (r[i] < 0 || r[i] >= NMF || Math.abs(r[i + 1]) > 50000 || Math.abs(r[i + 2]) > 50000 || r[i + 6] < 0 || r[i + 6] >= MF_ST.length) return false;
  }
  if (!Number.isFinite(f.cd)) return false;
  if (f.t !== null && f.t !== undefined && (!Array.isArray(f.t) || f.t.length !== 10 || !f.t.every(Number.isFinite))) return false;
  return true;
}
//  (the flayers there now are let go first — not despawned: the dogs and
//  gorgons carried over with them keep their bonds — this is all of them)
function adoptFull(F, f) {
  const E = F.env, now = E.now(), wrecks = E.wrecks();
  for (const m of F.flayers) if (m.live) { drop(F, m); m.live = false; m.dead = false; m.atk = null; E.on.gone(m); }
  const r = f.r;
  for (let i = 0; i < r.length; i += FULL_N) {
    const slot = r[i];
    while (F.flayers.length <= slot) F.flayers.push({ slot: F.flayers.length, live: false });
    const m = F.flayers[slot], x = r[i + 1] / 100, z = r[i + 2] / 100;
    Object.assign(m, {
      live: true, x, z, y: r[i + 3] / 100, hd: r[i + 4] / 1000, sp: 0, hp: Math.min(MF_HP, r[i + 5] / 10),
      st: MF_ST[r[i + 6]], stT: r[i + 7] / 10, gaitPh: 0, lean: 0,
      maw: 0, mawWant: 0, headYaw: 0, headPitch: 0, crouch: 0, rear: 0, lunge: 0, swell: 0,
      stagger: 0, atk: null, atkCd: r[i + 15] / 10, panicked: !!r[i + 9], dead: r[i + 8] >= 0, deadT: r[i + 8] >= 0 ? r[i + 8] / 10 : 0,
      see: 0, seeT: now - r[i + 13] / 10, tx: r[i + 11] / 10, tz: r[i + 12] / 10, tdist: 999, hasT: !!r[i + 10],
      wx: r[i + 18] / 10, wz: r[i + 19] / 10, wanderT: r[i + 20] / 10, summonT: r[i + 17] / 10, panicCd: r[i + 16] / 10,
      stepBeat: -1, pulse: 3, fleeT: r[i + 21] / 10, fleeX: r[i + 22] / 10, fleeZ: r[i + 23] / 10,
      netX: x, netZ: z, netH: r[i + 4] / 1000, rx: x, rz: z, hpHold: 0, lod: 0,
      spawnD: 999, escorted: !!r[i + 24], lord: r[i + 14] ? 'vec' : null, lordSlot: -1, lordFar: 0, taint: r[i + 14] ? 1 : 0,
      pendSummon: r[i + 25] >= 0 ? [r[i + 25], Math.max(0, r[i + 26])] : null, thenFlee: !!r[i + 27],
      roared: 0, holdW: -1, claimT: 0, farCalled: 0,
    });
    if (m.dead) m.hp = 0;
  }
  F.spawnCd = f.cd / 10;
  F.thrown = null;
  const t = f.t;
  if (t && wrecks[t[0]]) {
    F.thrown = { k: t[0], x: t[1] / 100, y: t[2] / 100, z: t[3] / 100, ty: 0, vx: t[4] / 100, vy: t[5] / 100, vz: t[6] / 100,
      spin: t[7] / 1000, roll: t[8] / 1000, t: t[9] / 100, hit: 0, got: [] };
    wrecks[t[0]].thrown = true;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    NMF, MF_HP, MF_VIS, MF_LINK, MF_SHARE, MF_SHARE_S, MF_SUMMON, MF_ESC_GOR, MF_ESC_DOG, MF_TAKE, MF_MEM,
    MF_SWIPE_R, MF_SWIPE_DMG, MF_STOMP_R, MF_STOMP_DMG, MF_STOMP_OFF, MF_SWEEP_R, MF_SWEEP_DMG, MF_LASH_R, MF_LASH_DMG,
    MF_THROW_MIN, MF_THROW_MAX, MF_THROW_DMG, MF_PANIC, M_BODY_Y, M_FOOT_R, MF_ST, MF_ATK, ATK_KINDS, SNAP_N, FULL_N,
    makeFlayers, spawnSpot, spawnFlayer, despawnFlayer, clearFlayers, drop, claimNear, retinueOf, linkedTo, counts, command,
    shareDamage, summon, ring, pickWreck, launch, flight, see, think, startAtk, runAtk, strike, step, hurt, kill, stock, fighting,
    marks, snapRows, flightRow, fullState, fullOk, adoptFull,
  };
}
