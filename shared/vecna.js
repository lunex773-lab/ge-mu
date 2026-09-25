'use strict';
//  ============================================================
//  CONTOUR — VECNA, king of the other side  (shared)
//  ============================================================
//  What he thinks, how he walks, what he does with the street and with the
//  things that answer to him. A player's game runs him while alone (or
//  hosting a room that does not); with two or more in a room the room server
//  runs him (server/dogs.js, beside everything he commands) with this same
//  code. Nothing here draws or makes a sound — the game poses and draws him
//  from the fields this moves, and feels him through the hooks (env.on).
//
//  The other three are animals. This one is a person who stopped being one,
//  and the difference has to be legible in every system, not just in the HP
//  bar: he walks, he does not charge; he lifts the street instead of biting
//  you; and the thing he is actually doing — the reason he outranks a
//  thirteen-metre commander — is that everything else out there is already
//  listening to him. §61: world-unique. §26: the state machine is the
//  personality — DORMANT and OBSERVE come before anything violent.
//
//  The world he lives in comes through env, as the others' does:
//    now(), random(), targets() — [{ x, z, y, ey, dead, cloak, fx, fz, yaw }]
//    clearAt, supportHeight, collide, rayCity, wrecks()
//    dogs(), gorgons(), flayers(), spawnDog(), spawnGorgon(at)
//    hit(v, t, kind, dmg, ax, az, push, up, shake)   a blow lands on target t:
//                          dmg, and thrown push m along (ax, az) and up at `up`
//                          m/s (a thrown car: no push, no lift)
//    grab(v, t)            he takes hold of t (true if he has them now)
//    held(t)               is t in his grip already
//    release(t)            he lets go of t (null: of whoever he holds)
//    on: { lift, hurl, charge, wave, limb, psy, phase, whisper, voice, command,
//          grew, ordered, hurt, blink, death, fallen, rift, land, fly, drop, gone }

const CITY = require('./city.js');
const TR = require('./troop.js');
const WR = require('./wrecks.js');
const RULES = require('./rules.js');
const DG = require('./dogs.js');
const GR = require('./gorgons.js');
const FL = require('./flayers.js');

const V_HP = FL.MF_HP * 3;               // 12600
const V_SIGHT = 124, V_LINK = 190;       // he hears through the whole district
const V_CLEAR = DG.V_CLEAR;              // and nothing of his stands inside this
const V_CMD_DOG = 5, V_CMD_GOR = 2;      // §22/§65: he orders a few, not everything
const V_HEIGHT = 5.1, V_HIP = 2.72;
const V_EXT = 4.6;                       // §13: how far past rest the arm goes
const V_WAVE_R = 26, V_WAVE_DMG = 26;    // §8
const V_LIMB_R = 11.5, V_LIMB_DMG = 22;  // §14
const V_GRAB_R = 34, V_GRAB_DMG = 30;    // §15 — never lethal on its own
const V_THROW_DMG = 34;
const V_ORBIT_MAX = 5;                   // §11/§12, and the ceiling is the point
const V_MEM = 26;                        // how long he keeps what he knew
//  §36: five phases, cut by health. Each one changes what he is willing to do,
//  not how much damage he does.
const V_PHASE = [0.82, 0.60, 0.40, 0.18];
const V_SUMMON_CD = 46;
const V_BLINK_MIN = 52, V_BLINK_CD = 13, V_BLINK_STAND = 17;
const V_TAKE = DG.V_TAKE;
const V_RET = { dogs: DG.RETINUE.vec, gors: GR.RETINUE.vec };   // §22/§65: a few, not everything
const WORLD = RULES.WORLD;
const V_ST = ['dormant', 'observe', 'manipulate', 'command', 'hunt', 'combat', 'channel', 'stagger', 'dead'];
//  §58: every one of these ends in a window. The wind-up is long, the
//  recovery is longer, and the recovery is when he can be hurt properly.
const V_ATK = {
  wave:  { wind: 1.15, act: 0.28, rec: 0.95, cd: 6.5, vuln: 1.5 },
  limb:  { wind: 0.62, act: 0.34, rec: 0.70, cd: 4.2, vuln: 0.9 },
  hurl:  { wind: 0.55, act: 0.22, rec: 0.50, cd: 2.6, vuln: 0.5 },
  grab:  { wind: 1.05, act: 0.30, rec: 1.10, cd: 12.0, vuln: 1.8 },
};
const ATK_KINDS = ['wave', 'limb', 'hurl', 'grab'];            // (a snapshot numbers them 1…)
const ext01 = (e) => 1 + e * V_EXT * 0.55;

//  the one of him: the arrays exist before he does, so nothing that runs a
//  frame early can reach into an undefined pose
function makeVecna(env) {
  return { env, vec: { live: false, orbit: [], armUp: [0, 0], armUpWant: [0, 0], armExt: [0, 0], armExtWant: [0, 0] },
           thrown: [], spawnCd: 210, holdSpawn: false, ev: 0, evKind: 0 };
}
//  something those who only draw him should know happened (a snapshot says the last)
function tell(V, kind) { V.ev = (V.ev + 1) % 1000; V.evKind = kind; }
const EV = { whisper: 1, grew: 2, ordered: 3, blink: 4 };

// ---- the one of him ------------------------------------------------
//  §27: he is somewhere, being somewhere. Far out, in the open, and never in
//  front of anyone — you are supposed to find him, not be handed him.
function spawnSpot(V) {
  const E = V.env, rnd = E.random, who = E.targets();
  let best = null, bestS = -1;
  for (let i = 0; i < 80; i++) {
    const x = (rnd() * 2 - 1) * WORLD * 0.40, z = (rnd() * 2 - 1) * WORLD * 0.40;
    const d = DG.nearestTo(who, x, z).d;
    if (d < 150 || d > 330) continue;
    if (!E.clearAt(x, z, 2.2)) continue;
    let s = d * 0.02 + rnd() * 3;
    const bi = Math.round(x / CITY.PITCH), bj = Math.round(z / CITY.PITCH);
    if (Math.abs(x - bi * CITY.PITCH) < CITY.RW && Math.abs(z - bj * CITY.PITCH) < CITY.RW) s += 7;
    if (s > bestS) { bestS = s; best = { x, z }; }
  }
  return best;
}
function spawnVecna(V, at) {
  const E = V.env, rnd = E.random;
  const spot = at || spawnSpot(V); if (!spot) return null;
  const nt = DG.nearestTo(E.targets(), spot.x, spot.z).t;
  Object.assign(V.vec, {
    live: true, x: spot.x, z: spot.z, y: E.supportHeight(spot.x, spot.z, 1),
    hd: rnd() * 6.2832, sp: 0, hp: V_HP, phase: 0,
    st: 'dormant', stT: 0, gaitPh: rnd(), lean: 0,
    hover: 0, hoverWant: 0, flare: 0, flareWant: 0, arch: 0, archWant: 0,
    armUp: [0, 0], armUpWant: [0, 0], armExt: [0, 0], armExtWant: [0, 0],
    grip: 0, gripWant: 0, spread: 0, spreadWant: 0, maw: 0, mawWant: 0,
    aimYaw: 0, aimPitch: 0, headYaw: 0, headPitch: 0, headYawWant: 0, headPitchWant: 0,
    stagger: 0, vuln: 0, atk: null, atkCd: 6, dead: false, deadT: 0,
    see: 0, seeT: -99, tx: spot.x, tz: spot.z, tdist: 999, hasT: false,
    wx: spot.x, wz: spot.z, wanderT: 0, cmdT: 0, mentalT: 22 + rnd() * 20,
    orbit: [], stepBeat: -1, voiceT: 6, lod: 0, awake: false,
    netX: spot.x, netZ: spot.z, netH: 0, rx: spot.x, rz: spot.z, rspd: 0, hpHold: 0,
    dodgeX: 0, dodgeZ: 0, lastPX: nt ? nt.x : spot.x, lastPZ: nt ? nt.z : spot.z, summonCd: 18, blinkCd: 6,
  });
  return V.vec;
}
function clearVecna(V) {
  const v = V.vec;
  dropOrbit(V);
  V.env.release(null);
  v.live = false; v.dead = false; v.atk = null;
  V.env.on.gone(v);
}

// ---- the hive ------------------------------------------------------
//  §20–§25. The network is not a list — it is distance, exactly as the
//  flayer's is, one tier up and much wider. §24 is the reason there is a
//  radius at all: without one he would be inescapable.
function command(V, dt) {
  const E = V.env, v = V.vec, now = E.now();
  const flayers = E.flayers(), gorgons = E.gorgons(), dogs = E.dogs();
  v.cmdT -= dt;
  const known = v.hasT && now - v.seeT < V_MEM;
  //  §23 HIVE SENSE — what anything of his sees, he sees. Upward first.
  for (const m of flayers) {
    if (!m.live || m.dead || !m.hasT || now - m.seeT > 8) continue;
    if (Math.hypot(m.x - v.x, m.z - v.z) > V_LINK) continue;
    v.hasT = true; v.tx = m.tx; v.tz = m.tz; v.seeT = Math.max(v.seeT, m.seeT);
  }
  for (const g of gorgons) {
    if (!g.live || g.dead || !g.hasT || now - g.seeT > 8) continue;
    if (Math.hypot(g.x - v.x, g.z - v.z) > V_LINK) continue;
    v.hasT = true; v.tx = g.tx; v.tz = g.tz; v.seeT = Math.max(v.seeT, g.seeT);
  }
  for (const d of dogs) {
    if (!d.live || d.dead || !d.hasT || now - d.seeT > 8) continue;
    if (Math.hypot(d.x - v.x, d.z - v.z) > V_LINK) continue;
    v.hasT = true; v.tx = d.tx; v.tz = d.tz; v.seeT = Math.max(v.seeT, d.seeT);
  }
  if (!v.awake || v.dead) return;
  //  §22/§55: the override. Sent on a clock, not every frame.
  if (v.cmdT > 0) return;
  v.cmdT = 2.6;
  //  §21/§53: what comes near him is his, hunt or no hunt. Capped hard, and
  //  outside V_CLEAR: a court standing around him, not a wall of bodies.
  FL.claimNear(dogs, v.x, v.z, V_TAKE, V_RET.dogs - FL.retinueOf(dogs, 'vec', -1), 'vec', -1);
  FL.claimNear(gorgons, v.x, v.z, V_TAKE, V_RET.gors - FL.retinueOf(gorgons, 'vec', -1), 'vec', -1);
  v.retinue = FL.retinueOf(dogs, 'vec', -1) + FL.retinueOf(gorgons, 'vec', -1);
  if (!known) return;
  let sent = 0;
  //  §55 COMMAND PRIORITY: down the chain. The flayer is told, and what the
  //  flayer does with its own escort is still the flayer's business.
  for (const m of flayers) {
    if (!m.live || m.dead) continue;
    if (Math.hypot(m.x - v.x, m.z - v.z) > V_LINK) continue;
    m.hasT = true; m.tx = v.tx; m.tz = v.tz; m.seeT = now;
    if (m.st === 'wander') { m.st = 'alert'; m.stT = 0; }
    m.panicked = false;                         // §53: nothing of his runs away
    if (m.st === 'flee') { m.st = 'track'; m.stT = 0; }
    m.lord = 'vec'; m.lordSlot = -1;            // and it wears his colours from now on
    sent++;
  }
  //  §22/§65: a few, and the nearest — not the whole district.
  const pick = (arr, n) => arr
    .filter((o) => o.live && !o.dead && Math.hypot(o.x - v.x, o.z - v.z) <= V_LINK)
    .sort((a, b) => Math.hypot(a.x - v.x, a.z - v.z) - Math.hypot(b.x - v.x, b.z - v.z))
    .slice(0, n);
  for (const g of pick(gorgons, V_CMD_GOR)) {
    g.hasT = true; g.tx = v.tx; g.tz = v.tz; g.seeT = now;
    if (g.st === 'wander' || g.st === 'search' || g.st === 'escort') { g.st = 'chase'; g.stT = 0; }
    sent++;
  }
  for (const d of pick(dogs, V_CMD_DOG)) {
    d.hasT = true; d.tx = v.tx; d.tz = v.tz; d.seeT = now;
    //  §53: they do not hide and they do not break off while he is watching
    if (d.st === 'wander' || d.st === 'idle' || d.st === 'hide' || d.st === 'flee' || d.st === 'escort') { d.st = 'chase'; d.stT = 0; }
    sent++;
  }
  v.cmdSent = sent;
}
//  §21/§29: he calls, but he calls for what is missing and nothing more.
function ring(V, r) {
  const E = V.env, v = V.vec;
  for (let i = 0; i < 20; i++) {
    const a = E.random() * 6.2832;
    const x = v.x + Math.sin(a) * r, z = v.z + Math.cos(a) * r;
    if (Math.abs(x) > WORLD * 0.44 || Math.abs(z) > WORLD * 0.44) continue;
    if (E.clearAt(x, z, 1.3)) return { x, z };
  }
  return null;
}
function summon(V, dogWant, gorWant) {
  const E = V.env, v = V.vec, rnd = E.random;
  let made = 0;
  for (let i = 0; i < gorWant; i++) {
    if (FL.retinueOf(E.gorgons(), 'vec', -1) >= V_RET.gors) break;
    const spot = ring(V, 32 + rnd() * 12); if (!spot) break;
    const g = E.spawnGorgon(spot); if (!g) break;
    g.lord = 'vec'; g.lordSlot = -1;
    g.hasT = v.hasT; g.tx = v.tx; g.tz = v.tz; g.seeT = v.seeT;
    g.st = v.hasT ? 'chase' : 'escort'; g.stT = 0;
    g.rise = 0; g.taint = 0.5; E.on.rift(spot.x, spot.z, 4.4, 3.4);
    made++;
  }
  for (let i = 0; i < dogWant; i++) {
    if (FL.retinueOf(E.dogs(), 'vec', -1) >= V_RET.dogs) break;
    const spot = ring(V, 30 + rnd() * 14); if (!spot) break;
    const d = E.spawnDog(); if (!d) break;
    d.x = d.rx = spot.x; d.z = d.rz = spot.z; d.y = E.supportHeight(spot.x, spot.z, 1);
    d.lord = 'vec'; d.lordSlot = -1;
    d.hasT = v.hasT; d.tx = v.tx; d.tz = v.tz; d.seeT = v.seeT;
    d.st = v.hasT ? 'chase' : 'escort'; d.stT = 0;
    d.rise = 0; d.taint = 0.5; E.on.rift(spot.x, spot.z, 2.9, 2.8);
    made++;
  }
  if (made) v.summonFx = 1;
  return made;
}
function hiveCount(V) {
  const E = V.env, v = V.vec;
  let n = 0;
  for (const d of E.dogs()) if (d.live && !d.dead && Math.hypot(d.x - v.x, d.z - v.z) <= V_LINK) n++;
  for (const g of E.gorgons()) if (g.live && !g.dead && Math.hypot(g.x - v.x, g.z - v.z) <= V_LINK) n++;
  for (const m of E.flayers()) if (m.live && !m.dead && Math.hypot(m.x - v.x, m.z - v.z) <= V_LINK) n++;
  return n;
}

// ---- telekinesis ---------------------------------------------------
//  §7/§10/§11/§12/§44/§45. The orbit holds real wrecks, so what he lifts is
//  gone from where it was, and what he throws is still lying where it landed.
function pickWrecks(V, want) {
  const E = V.env, v = V.vec, wrecks = E.wrecks(), now = E.now();
  //  §45: not at random. A thing that can reach the player beats a thing that
  //  is merely close, and a thing already at their feet is no use to anybody.
  const cand = [];
  for (let k = 0; k < wrecks.length; k++) {
    const w = wrecks[k];
    if (!w || w.thrown || w.held) continue;
    const d = Math.hypot(w.x - v.x, w.z - v.z);
    if (d > 46) continue;
    //  and only when he has somewhere to throw it
    const known = v.hasT && now - v.seeT < V_MEM;
    const toP = known ? Math.hypot(w.x - v.tx, w.z - v.tz) : 1e9;
    if (toP < 12) continue;                            // not one already at their feet
    cand.push({ k, s: (toP < 60 ? 40 : 0) + (46 - d) });
  }
  cand.sort((a, b) => b.s - a.s);
  return cand.slice(0, want).map((c) => c.k);
}
function lift(V, want) {
  const E = V.env, v = V.vec, rnd = E.random, wrecks = E.wrecks();
  const room = Math.min(want, V_ORBIT_MAX - v.orbit.length);
  if (room <= 0) return 0;
  const picks = pickWrecks(V, room);
  for (const k of picks) {
    const w = wrecks[k];
    w.held = true;
    v.orbit.push({ k, a: rnd() * 6.2832, r: 5.4 + rnd() * 3.2,
                   h: 2.6 + rnd() * 3.4, spin: (rnd() - 0.5) * 2.4, roll: 0, y0: w.y, rise: 0 });
  }
  if (picks.length) E.on.lift(v, picks);
  return picks.length;
}
function dropOrbit(V) {
  const v = V.vec, wrecks = V.env.wrecks();
  if (!v.orbit || !v.orbit.length) return;
  const ks = [];
  for (const o of v.orbit) { const w = wrecks[o.k]; if (w) { w.held = false; w.y = o.y0; ks.push(o.k); } }
  v.orbit.length = 0;
  V.env.on.drop(ks);                    // and they are back on the road where they fell
}
function hurl(V) {
  const E = V.env, v = V.vec, wrecks = E.wrecks();
  //  one at a time, and the arm does it — the throw is aimed from the hand
  if (!v.orbit.length) return false;
  const o = v.orbit.shift();
  const w = wrecks[o.k];
  if (!w) return false;
  const sx = v.x + Math.sin(o.a) * o.r, sz = v.z + Math.cos(o.a) * o.r;
  const sy = v.y + o.h + 1.6;
  const dx = v.tx - sx, dz = v.tz - sz, d = Math.max(4, Math.hypot(dx, dz));
  const t = Math.max(0.55, d / 44);                     // faster and flatter than the flayer's lob
  V.thrown.push({ k: o.k, x: sx, y: sy, z: sz,
                  vx: dx / t, vz: dz / t,
                  vy: (E.supportHeight(v.tx, v.tz, 2) + 1.2 - sy + 0.5 * 26 * t * t) / t,
                  spin: o.spin, roll: o.roll, t: 0, hit: 0, y0: o.y0, got: [] });
  w.thrown = true; w.held = false;
  E.on.hurl(v, o.k);
  return true;
}
//  the cars in the air: they fall, they may land on someone, and they come
//  down where they come down (judge false: only drawn here)
function flights(V, dt, judge) {
  const E = V.env, wrecks = E.wrecks(), F = V.thrown;
  for (let i = F.length - 1; i >= 0; i--) {
    const T = F[i];
    T.t += dt;
    T.vy -= 26 * dt;
    T.x += T.vx * dt; T.y += T.vy * dt; T.z += T.vz * dt;
    T.roll += T.spin * dt;
    const w = wrecks[T.k];
    if (!w) { F.splice(i, 1); continue; }
    if (judge !== false) for (const t of E.targets()) {
      if (T.got.indexOf(t) >= 0 || !(Math.hypot(T.x - t.x, T.z - t.z) < 4.2) || !(Math.abs(T.y - t.ey) < 4.2) || t.dead) continue;
      T.got.push(t); T.hit = 1;
      E.hit(null, t, 'throw', V_THROW_DMG, 0, 0, 0, 0, 0.95);
    }
    const gy = E.supportHeight(T.x, T.z, T.y + 1);
    if (T.y <= gy + 0.4 || T.t > 7) {
      w.x = T.x; w.z = T.z; w.y = gy; w.rot += T.roll * 0.4; w.tilt = (E.random() - 0.5) * 0.5;
      w.thrown = false; w.held = false;
      E.on.land(T, w, gy);
      F.splice(i, 1);
      continue;
    }
    E.on.fly(T, w);
  }
}
//  what he holds circles him, rising unwillingly and then hanging
function orbitStep(V, dt) {
  const v = V.vec, wrecks = V.env.wrecks();
  for (const o of v.orbit) {
    if (!wrecks[o.k]) continue;
    o.rise = Math.min(1, o.rise + dt * 1.1);
    o.a += dt * 0.42;
    o.roll += o.spin * dt * 0.35;
  }
}

// ---- perception ----------------------------------------------------
//  §35: no wallhack. He sees what is in front of him and otherwise relies on
//  the hive — his eyes are everyone else's. The nearest he sees, of the
//  targets; whether he sees anyone or not, v.tdist is then of that one, or of
//  the nearest.
const _eye = { x: 0, y: 0, z: 0 }, _dir = { x: 0, y: 0, z: 0 };
function sees(V, t) {
  const E = V.env, v = V.vec;
  const dx = t.x - v.x, dz = t.z - v.z, dist = Math.hypot(dx, dz);
  if (t.dead || dist > V_SIGHT) return false;
  const rel = Math.atan2(dx, dz) - v.hd;
  let a = rel; while (a > Math.PI) a -= 6.2832; while (a < -Math.PI) a += 6.2832;
  if (Math.abs(a) > 1.5 && dist > 14) return false;
  _eye.x = v.x; _eye.y = v.y + V_HEIGHT - 0.6; _eye.z = v.z;
  _dir.x = t.x - _eye.x; _dir.y = (t.ey - 0.5) - _eye.y; _dir.z = t.z - _eye.z;
  const len = Math.sqrt(_dir.x * _dir.x + _dir.y * _dir.y + _dir.z * _dir.z), inv = 1 / (len || 1);   // (three.js's length() and normalize())
  _dir.x *= inv; _dir.y *= inv; _dir.z *= inv;
  if (Math.min(E.rayCity(_eye, _dir, len), WR.ray(E.wrecks(), _eye, _dir)) < len - 0.6) return false;
  return true;
}
function see(V) {
  const E = V.env, v = V.vec, who = E.targets();
  let bt = null, bd = Infinity, nd = Infinity, nt = null;
  for (let i = 0; i < who.length; i++) {
    const t = who[i];
    const dist = Math.hypot(t.x - v.x, t.z - v.z);
    if (dist < nd) { nd = dist; nt = t; }
    if (dist < bd && sees(V, t)) { bd = dist; bt = t; }
  }
  const on = bt || nt;
  if (on) v.tdist = Math.hypot(on.x - v.x, on.z - v.z);
  v.tgt = bt; v.near = nt;
  return bt ? 1 : 0;
}

// ---- the decision --------------------------------------------------
//  §65 is the spine of this function. He does not hurry, he does not shout,
//  and he does not empty a spawn table at you.
function phaseOf(hp) {
  const f = hp / V_HP;
  let ph = 0;
  for (let i = 0; i < V_PHASE.length; i++) if (f <= V_PHASE[i]) ph = i + 1;
  return ph;
}
function think(V, dt) {
  const E = V.env, v = V.vec, rnd = E.random, now = E.now();
  v.stT += dt;
  v.atkCd = Math.max(0, v.atkCd - dt);
  v.stagger = Math.max(0, v.stagger - dt * 1.5);
  v.vuln = Math.max(0, v.vuln - dt);
  v.mentalT -= dt;
  v.voiceT -= dt;
  v.summonCd -= dt;
  v.blinkCd -= dt;
  if (v.dead) { v.deadT += dt; v.sp = 0; return; }

  command(V, dt);
  const seen = see(V);
  if (seen > 0) { v.see = seen; v.seeT = now; v.hasT = true; v.tx = v.tgt.x; v.tz = v.tgt.z; }
  else v.see = 0;
  const known = v.hasT && now - v.seeT < V_MEM;
  const dist = v.tdist;
  const fx = dist > 0.01 ? (v.tx - v.x) / dist : 0, fz = dist > 0.01 ? (v.tz - v.z) / dist : 1;
  let lookX = v.tx, lookZ = v.tz;

  //  §34: he may lean where you have been going. From position and velocity
  //  only — a running average of the movement of the one he hunts.
  { const q = v.tgt || v.near;
    if (q) {
      const vxp = (q.x - v.lastPX) / Math.max(1e-3, dt), vzp = (q.z - v.lastPZ) / Math.max(1e-3, dt);
      v.dodgeX += (vxp - v.dodgeX) * Math.min(1, dt * 1.4);
      v.dodgeZ += (vzp - v.dodgeZ) * Math.min(1, dt * 1.4);
      v.lastPX = q.x; v.lastPZ = q.z;
    } }

  //  §36 phase transitions. Announced by the body, and by a moment of quiet
  //  in which nothing is thrown at you.
  const ph = phaseOf(v.hp);
  if (ph !== v.phase) {
    v.phase = ph;
    v.st = 'channel'; v.stT = 0; v.chan = 'phase';
    v.atkCd = Math.max(v.atkCd, 1.4);
    E.on.phase(v, ph);
  }
  //  §16/§18: the psychological echo, on its own long clock
  if (v.mentalT <= 0 && known && dist < 180) {
    v.mentalT = 26 + rnd() * 22 - v.phase * 3;
    tell(V, EV.whisper);
    E.on.whisper(v);
  }
  if (v.atk) { runAtk(V, dt); return; }

  switch (v.st) {
    case 'dormant': {
      //  §27: he is not looking for you. If you walk past far enough away
      //  nothing happens at all.
      v.sp = 0;
      v.hoverWant = 0.25; v.flareWant = 0.10; v.mawWant = 0;
      v.armUpWant[0] = 0; v.armUpWant[1] = 0;
      lookX = v.x + Math.sin(v.hd + Math.sin(now * 0.11) * 0.5) * 30;
      lookZ = v.z + Math.cos(v.hd + Math.sin(now * 0.11) * 0.5) * 30;
      if (known && dist < 150) { v.st = 'observe'; v.stT = 0; v.awake = true; }
      break;
    }
    case 'observe': {
      //  §28: he watches. The first thing that happens is not an attack — it
      //  is the street being tidied up around you.
      v.sp = 0;
      v.hoverWant = 0.35; v.flareWant = 0.28; v.mawWant = 0;
      if (v.voiceT <= 0) { v.voiceT = 14 + rnd() * 12; E.on.voice(v); }
      if (!known) { if (v.stT > 8) { v.st = 'dormant'; v.stT = 0; v.awake = false; } break; }
      if (v.stT > (v.phase === 0 ? 5.5 : 2.2)) { v.st = 'manipulate'; v.stT = 0; }
      break;
    }
    case 'manipulate': {
      //  §29/§37: PHASE 1 is played entirely from here. He lifts the street,
      //  he sends what is already out there, and he does not close himself.
      v.sp = 0;
      v.hoverWant = 0.55; v.flareWant = 0.55;
      v.armUpWant[0] = 0.85; v.armUpWant[1] = v.phase >= 2 ? 0.85 : 0.2;
      v.spreadWant = 1; v.gripWant = 0;
      if (v.stT > 1.0 && !v.lifted) {
        v.lifted = 1;
        lift(V, v.phase >= 3 ? 4 : v.phase >= 1 ? 3 : 2);
      }
      if (v.stT > 2.6) {
        v.lifted = 0;
        v.st = v.phase === 0 ? 'command' : 'hunt'; v.stT = 0;
      }
      break;
    }
    case 'command': {
      //  §39: arms out, crown wide, and everything within reach turns at once.
      v.sp = 0;
      v.hoverWant = 0.8; v.flareWant = 1; v.archWant = 0.5;
      v.armUpWant[0] = 1; v.armUpWant[1] = 1; v.spreadWant = 1;
      if (v.stT > 0.8 && !v.cmdDone) {
        v.cmdDone = 1; v.cmdT = 0; command(V, 0);
        E.on.command(v);
        //  and what does not answer, he grows — only ever the shortfall
        let grew = 0;
        if (v.summonCd <= 0) { v.summonCd = V_SUMMON_CD; grew = summon(V, 2, 1); }
        const n = hiveCount(V);
        if (grew) { tell(V, EV.grew); E.on.grew(v); }
        else if (n > 0) { tell(V, EV.ordered); E.on.ordered(v); }
      }
      if (v.stT > 2.4) { v.cmdDone = 0; v.archWant = 0; v.st = 'hunt'; v.stT = 0; }
      break;
    }
    case 'hunt': {
      //  §30/§31: he walks. He never runs, at any phase.
      if (!known) { v.st = 'observe'; v.stT = 0; break; }
      const standoff = v.phase >= 4 ? 10 : 20 - v.phase * 2;
      v.hoverWant = v.phase >= 3 ? 0.5 : 0.12;
      v.flareWant = 0.4 + v.phase * 0.1;
      v.armUpWant[0] = v.orbit.length ? 0.8 : 0.12;
      v.armUpWant[1] = 0.10; v.spreadWant = v.orbit.length ? 1 : 0.2;
      step(V, v.tx - fx * standoff, v.tz - fz * standoff, 1.55 + v.phase * 0.22, dt);
      if (v.atkCd <= 0 && (v.see > 0 || dist < 40)) chooseAtk(V, dist);
      //  keeps the orbit topped up while he walks: a wall as much as ammunition
      if (v.phase >= 2 && v.orbit.length < 2 && rnd() < dt * 0.35) lift(V, 2);
      //  and when the court has thinned he breaks off and calls
      if (v.summonCd <= 0 && v.stT > 3 && !v.atk &&
          FL.retinueOf(E.dogs(), 'vec', -1) + FL.retinueOf(E.gorgons(), 'vec', -1) < V_RET.dogs) {
        v.st = 'command'; v.stT = 0; v.cmdDone = 0;
      }
      break;
    }
    case 'combat': v.st = 'hunt'; v.stT = 0; break;
    case 'channel': {
      //  §40: the phase turn. He is not attacking and cannot be hurried.
      v.sp = 0;
      v.hoverWant = 1; v.flareWant = 1; v.archWant = 1;
      v.armUpWant[0] = 1; v.armUpWant[1] = 1; v.spreadWant = 1; v.mawWant = 0.8;
      if (v.stT > 1.2 && !v.chanDone) {
        v.chanDone = 1;
        lift(V, Math.min(V_ORBIT_MAX, 2 + v.phase));
        v.cmdT = 0; command(V, 0);
      }
      if (v.stT > 3.0) {
        v.chanDone = 0; v.archWant = 0; v.mawWant = 0;
        v.st = 'hunt'; v.stT = 0;
        v.vuln = 2.2;                       // §58: the window
      }
      break;
    }
    default: v.st = 'dormant'; v.stT = 0;
  }
  if (v.st !== 'command' && v.st !== 'channel') v.archWant = 0;

  { const rel = Math.atan2(lookX - v.x, lookZ - v.z) - v.hd;
    let a = rel; while (a > Math.PI) a -= 6.2832; while (a < -Math.PI) a += 6.2832;
    v.headYawWant = Math.max(-1.1, Math.min(1.1, a));
    const dz2 = Math.hypot(lookX - v.x, lookZ - v.z);
    v.headPitchWant = Math.max(-0.8, Math.min(0.7, Math.atan2(1.6 - V_HEIGHT, Math.max(4, dz2)) * 1.4));
    v.aimYaw = v.headYawWant * 0.5;
    v.aimPitch = v.headPitchWant * 0.4;
  }
}

// ---- attacks -------------------------------------------------------
//  §33: distance picks, and the combination emerges from it rather than
//  from a scripted chain — close he strikes, mid he throws, far he pulls.
function chooseAtk(V, dist) {
  const E = V.env, v = V.vec, t = v.tgt || v.near;
  const opts = [];
  if (dist < V_LIMB_R) opts.push('limb', 'limb');
  if (dist < V_WAVE_R && v.phase >= 1) opts.push('wave');
  if (v.orbit.length) opts.push('hurl', 'hurl');
  if (dist > 12 && dist < V_GRAB_R && v.phase >= 2 && !(t && E.held(t))) opts.push('grab');
  if (!opts.length) { v.atkCd = 1.5; return; }
  startAtk(V, opts[(E.random() * opts.length) | 0]);
}
function startAtk(V, kind) {
  const v = V.vec;
  const side = V.env.random() < 0.5 ? 0 : 1;
  v.atk = { kind, t: 0, side, phase: 0, hit: 0, sfx: 0, got: [] };
  v.st = 'combat'; v.stT = 0;
  if (kind === 'wave' || kind === 'grab') V.env.on.charge(v, kind);
}
function runAtk(V, dt) {
  const E = V.env, v = V.vec, a = v.atk, A = V_ATK[a.kind];
  a.t += dt;
  //  (the one he is about to do it to: the one he sees, else the nearest)
  const t0 = v.tgt || v.near;
  const dist = t0 ? Math.hypot(t0.x - v.x, t0.z - v.z) : v.tdist;
  v.tdist = dist;
  if (t0 && (v.see > 0 || dist < 30)) { v.tx = t0.x; v.tz = t0.z; }
  //  he always faces what he is about to do
  { const want = Math.atan2(v.tx - v.x, v.tz - v.z);
    TR.easeHeading(v, want, dt, 2.4, 1.5); }
  v.sp = 0;
  const wind = A.wind, act = wind + A.act, done = act + A.rec;
  const who = E.targets();

  if (a.kind === 'wave') {
    //  §8: charge, pressure, release. The crown folds forward on the wind-up
    //  and snaps back on the beat, which is the read the player has to learn.
    if (a.t < wind) {
      const u = a.t / wind;
      v.hoverWant = 0.9; v.flareWant = 1 - u * 0.8;
      v.armUpWant[0] = 0.55 + u * 0.35; v.armUpWant[1] = 0.55 + u * 0.35;
      v.spreadWant = 0.1; v.gripWant = u * 0.6;
      v.armExtWant[0] = 0; v.armExtWant[1] = 0;
      if (!a.sfx && a.t > wind * 0.5) { a.sfx = 1; E.on.psy(v, 0.34, 900); }
    } else if (a.t < act) {
      v.flareWant = 1; v.spreadWant = 1; v.gripWant = 0;
      v.armUpWant[0] = 0.75; v.armUpWant[1] = 0.75;
      if (!a.hit) {
        a.hit = 1;
        E.on.wave(v);
        //  §8: damage falls off, knockback does not disappear, and it is a
        //  physics impulse rather than a teleport — you land where the ground is
        for (const t of who) {
          if (t.dead) continue;
          const d = Math.hypot(t.x - v.x, t.z - v.z);
          if (!(d < V_WAVE_R) || !(Math.abs(t.y - v.y) < 4.2)) continue;
          const f = 1 - d / V_WAVE_R;
          E.hit(v, t, 'wave', Math.round(V_WAVE_DMG * (0.45 + 0.55 * f)), (t.x - v.x) / Math.max(1, d), (t.z - v.z) / Math.max(1, d), 5.5 * f, 6.5 * f + 2.2, 0);
        }
        //  §43: the arena moves too. Anything he is holding is flung outward.
        for (const o of v.orbit) o.r = Math.min(14, o.r + 4);
      }
    } else {
      const u = (a.t - act) / A.rec;
      v.armUpWant[0] = 0.75 * (1 - u); v.armUpWant[1] = 0.75 * (1 - u);
      v.flareWant = 1 - u * 0.5;
    }
  } else if (a.kind === 'limb') {
    //  §13/§14: Normal → Stretch → Extended → Strike → Retract, and the arm
    //  is genuinely longer while it happens.
    const i = a.side;
    if (a.t < wind) {
      const u = a.t / wind;
      v.armUpWant[i] = 0.55; v.armExtWant[i] = u * 0.25;
      v.gripWant = 0.15; v.spreadWant = 1 - u;
      v.hoverWant = 0.25;
    } else if (a.t < act) {
      const u = (a.t - act + A.act) / A.act;
      v.armUpWant[i] = 0.62;
      v.armExtWant[i] = 0.25 + u * 0.75;               // out
      v.gripWant = 0.2 + u * 0.7;
      if (!a.sfx) { a.sfx = 1; E.on.limb(v); }
      if (u > 0.35) for (const t of who) {
        if (t.dead || a.got.indexOf(t) >= 0) continue;
        const d = Math.hypot(t.x - v.x, t.z - v.z);
        if (!(d < V_LIMB_R * (0.5 + ext01(v.armExt[i]))) || !(Math.abs(t.y - v.y) < 3.6)) continue;
        a.got.push(t); a.hit = 1;
        E.hit(v, t, 'limb', V_LIMB_DMG, (t.x - v.x) / Math.max(1, d), (t.z - v.z) / Math.max(1, d), 2.6, 4.2, 0.7);
      }
    } else {
      const u = (a.t - act) / A.rec;
      v.armExtWant[i] = 1 - u;                          // retract
      v.armUpWant[i] = 0.62 * (1 - u);
      v.gripWant = 0.9 * (1 - u);
    }
  } else if (a.kind === 'hurl') {
    const i = a.side;
    if (a.t < wind) {
      v.armUpWant[i] = 0.9; v.spreadWant = 0.2; v.gripWant = 0.8;
      v.hoverWant = Math.max(v.hoverWant, 0.4);
    } else if (a.t < act) {
      if (!a.hit) { a.hit = 1; v.armUpWant[i] = 0.4; v.gripWant = 0; v.spreadWant = 1; hurl(V); }
    } else {
      const u = (a.t - act) / A.rec;
      v.armUpWant[i] = 0.4 * (1 - u); v.spreadWant = 1 - u;
    }
  } else if (a.kind === 'grab') {
    const i = a.side;
    if (a.t < wind) {
      const u = a.t / wind;
      v.armUpWant[i] = 0.9 + u * 0.1; v.spreadWant = 1;
      v.armExtWant[i] = u * 0.30; v.hoverWant = 0.7; v.flareWant = 0.8;
      if (!a.sfx && a.t > wind * 0.55) { a.sfx = 1; E.on.psy(v, 0.4, 1200); }
    } else if (a.t < act) {
      if (!a.hit) {
        a.hit = 1;
        v.gripWant = 1; v.spreadWant = 0;
        if (t0 && dist < V_GRAB_R && !t0.dead && sees(V, t0) && Math.abs(t0.y - v.y) < 4.2) E.grab(v, t0);
        else E.on.limb(v);
      }
    } else {
      const u = (a.t - act) / A.rec;
      v.armUpWant[i] = 1 - u; v.armExtWant[i] = 0.30 * (1 - u); v.gripWant = 1 - u;
    }
  }

  if (a.t >= done) {
    v.atk = null;
    v.atkCd = A.cd * (v.phase >= 3 ? 0.72 : 1);
    v.vuln = A.vuln;                                  // §58
    v.armExtWant[0] = 0; v.armExtWant[1] = 0;
    v.gripWant = 0; v.spreadWant = 0;
    v.st = 'hunt'; v.stT = 0;
  }
}

// ---- movement ------------------------------------------------------
const _pos = { x: 0, y: 0, z: 0 };
function step(V, tx, tz, speed, dt) {
  const E = V.env, v = V.vec;
  const dx = tx - v.x, dz = tz - v.z, dd = Math.hypot(dx, dz);
  if (dd < 2.2) { v.sp = 0; return dd; }
  const ux = dx / dd, uz = dz / dd;
  //  §65: a slow turn and a slower walk. He arrives when he arrives.
  TR.easeHeading(v, Math.atan2(ux, uz), dt, 1.5, 0.85);
  const bx = v.x, bz = v.z;
  v.x += Math.sin(v.hd) * speed * dt; v.z += Math.cos(v.hd) * speed * dt;
  v.x = Math.max(-WORLD * 0.45, Math.min(WORLD * 0.45, v.x));
  v.z = Math.max(-WORLD * 0.45, Math.min(WORLD * 0.45, v.z));
  _pos.x = v.x; _pos.y = v.y; _pos.z = v.z;
  E.collide(_pos, v.y, v.y + 2.4, 1.0);
  v.x = _pos.x; v.z = _pos.z;
  v.sp = dt > 1e-5 ? Math.hypot(v.x - bx, v.z - bz) / dt : 0;
  v.y += (E.supportHeight(v.x, v.z, v.y + 1) - v.y) * Math.min(1, dt * 4);
  return dd;
}
//  Everything the animator reads is eased, never snapped — this is most of
//  why he reads as composed rather than as a state machine wearing a body.
//  (Whoever runs him eases it too: the reach of his arm is its eased length.)
function ease(V, dt) {
  const v = V.vec;
  const ez = Math.min(1, dt * 3.2);
  v.headYaw += ((v.headYawWant || 0) - v.headYaw) * ez;
  v.headPitch += ((v.headPitchWant || 0) - v.headPitch) * ez;
  v.hover += ((v.hoverWant || 0) - v.hover) * Math.min(1, dt * 1.6);
  v.flare += ((v.flareWant || 0) - v.flare) * Math.min(1, dt * 2.0);
  v.arch += ((v.archWant || 0) - v.arch) * Math.min(1, dt * 2.2);
  v.grip += ((v.gripWant || 0) - v.grip) * Math.min(1, dt * 7);
  v.spread += ((v.spreadWant || 0) - v.spread) * Math.min(1, dt * 5);
  v.maw += ((v.mawWant || 0) - v.maw) * Math.min(1, dt * 3.5);
  for (let i = 0; i < 2; i++) {
    v.armUp[i] += ((v.armUpWant[i] || 0) - v.armUp[i]) * Math.min(1, dt * 4.5);
    v.armExt[i] += ((v.armExtWant[i] || 0) - v.armExt[i]) * Math.min(1, dt * 9);
  }
  v.lean += ((v.sp > 0.3 ? 0.06 : 0) - v.lean) * Math.min(1, dt * 3);
}

// ---- damage --------------------------------------------------------
function hurt(V, dmg, fromX, fromZ) {
  const E = V.env, v = V.vec;
  if (!v.live || v.dead) return;
  //  §58: the window is the weapon. Catch him in the recovery of something big
  //  and the same bullet is worth two and a half.
  const mult = v.vuln > 0 ? 2.5 : 1;
  v.hp -= dmg * mult;
  v.awake = true;
  v.hasT = true; v.tx = fromX; v.tz = fromZ; v.seeT = E.now();
  //  §65: he is very hard to interrupt, and only while he is already exposed
  if (v.vuln > 0 && dmg * mult > 60) v.stagger = 1;
  else v.stagger = Math.max(v.stagger, 0.12);
  if (v.hp <= 0) { kill(V); return; }
  E.on.hurt(v);
  if (v.st === 'dormant' || v.st === 'observe') { v.st = 'manipulate'; v.stT = 0; }
  //  §53: hurting him drives everything of his
  v.cmdT = 0;
  //  Shot from a distance he cannot answer, he simply stops being over there —
  //  and the court comes with him.
  if (Math.hypot(fromX - v.x, fromZ - v.z) > V_BLINK_MIN && v.blinkCd <= 0) blinkTo(V, fromX, fromZ);
}
//  §7/§45: the arrival is loud on purpose. He opens the ground where he was
//  and again where he lands, so it never reads as a teleport in the cheap sense.
function blinkTo(V, tx, tz) {
  const E = V.env, v = V.vec, rnd = E.random, now = E.now();
  let spot = null;
  for (let i = 0; i < 24 && !spot; i++) {
    const a2 = rnd() * 6.2832, r = V_BLINK_STAND + rnd() * 9;
    const x = tx + Math.sin(a2) * r, z = tz + Math.cos(a2) * r;
    if (Math.abs(x) > WORLD * 0.44 || Math.abs(z) > WORLD * 0.44) continue;
    if (E.clearAt(x, z, 3.2)) spot = { x, z };
  }
  if (!spot) return;
  v.blinkCd = V_BLINK_CD;
  const ox = v.x, oz = v.z;
  E.on.rift(ox, oz, 7.5, 2.6);
  //  Everything of his moves by the same offset, so the court arrives in the
  //  formation it was already standing in rather than stacked on one point.
  const dx = spot.x - ox, dz = spot.z - oz;
  const carry = (arr, tag) => {
    for (const o of arr) {
      if (!o.live || o.dead || o.lord !== tag) continue;
      let nx = o.x + dx, nz = o.z + dz;
      if (!E.clearAt(nx, nz, 1.2)) {
        const a3 = rnd() * 6.2832, rr = V_CLEAR + 4 + rnd() * 10;
        nx = spot.x + Math.sin(a3) * rr; nz = spot.z + Math.cos(a3) * rr;
        if (!E.clearAt(nx, nz, 1.2)) continue;
      }
      E.on.rift(o.x, o.z, 2.4, 2.0);
      o.x = o.rx = nx; o.z = o.rz = nz; o.y = E.supportHeight(nx, nz, 1);
      o.hasT = true; o.tx = tx; o.tz = tz; o.seeT = now;
      o.st = 'chase'; o.stT = 0; o.stuck = 0;
      E.on.rift(nx, nz, 2.4, 2.4);
    }
  };
  carry(E.dogs(), 'vec'); carry(E.gorgons(), 'vec');
  v.x = v.rx = spot.x; v.z = v.rz = spot.z;
  v.y = E.supportHeight(spot.x, spot.z, 2);
  v.hd = Math.atan2(tx - spot.x, tz - spot.z);
  v.tx = tx; v.tz = tz; v.hasT = true; v.seeT = now; v.awake = true;
  v.st = 'hunt'; v.stT = 0; v.atk = null;
  v.atkCd = Math.max(v.atkCd, 0.9);           // a beat to react before he swings
  tell(V, EV.blink);
  E.on.blink(v, spot);
}
function kill(V) {
  const E = V.env, v = V.vec;
  //  §59: not a body falling over. The network goes first — everything he was
  //  holding drops out of the air — then the world, then him.
  v.dead = true; v.deadT = 0; v.hp = 0; v.sp = 0; v.atk = null;
  v.hoverWant = 0; v.flareWant = 0; v.archWant = 0;
  E.release(null);
  dropOrbit(V);
  E.on.death(v);
  for (const m of E.flayers()) if (m.live && !m.dead && Math.hypot(m.x - v.x, m.z - v.z) <= V_LINK) { m.panicked = true; m.st = 'flee'; m.stT = 0; m.fleeT = 30; }
  for (const d of E.dogs()) if (d.live && !d.dead && Math.hypot(d.x - v.x, d.z - v.z) <= V_LINK) { d.st = 'flee'; d.stT = 0; }
  E.on.fallen(v);
}

// ---- the one of him, in the district -----------------------------------
//  §61: one, and he takes his time about turning up
function stock(V, dt) {
  if (V.vec.live || V.holdSpawn) return;
  V.spawnCd -= dt;
  if (V.spawnCd <= 0) { V.spawnCd = 260 + V.env.random() * 180; spawnVecna(V); }
}
//  combat every step; otherwise every 1 / 3 / 8 within / past 150 / 300 m
function fighting(v) { return !!(v.atk || v.st === 'hunt' || v.st === 'combat'); }

// ---- over the wire ----------------------------------------------------
const HDQ = TR.HDQ;
const q100 = (x) => Math.round((x || 0) * 100);
//  him, to draw him as he is: [x·10, z·10, heading byte, hp, state (V_ST
//  index + 1), marks (1 dead, 2 awake, 4 in a window), phase, swing (0 none,
//  else ATK_KINDS index + 1), into it·100, which arm, then what his body is
//  easing toward·100 — head yaw, head pitch, hover, crown, arch, arms up (2),
//  arms out (2), grip, spread, mouth — seen ago·10 (−1: nothing known), what
//  he hunts x·10, z·10, and the last thing that happened (a count, and what:
//  EV) with where (the blink: whom he came for)]
const SNAP_N = 30;
function snapRow(V) {
  const v = V.vec;
  if (!v.live) return null;
  const now = V.env.now(), a = v.atk;
  const h = (((v.hd || 0) % 6.2832) + 6.2832) % 6.2832;
  return [Math.round(v.x * 10), Math.round(v.z * 10), Math.round(h * HDQ), Math.max(0, Math.round(v.hp)), V_ST.indexOf(v.st) + 1,
    (v.dead ? 1 : 0) | (v.awake ? 2 : 0) | (v.vuln > 0 ? 4 : 0), v.phase | 0,
    a ? ATK_KINDS.indexOf(a.kind) + 1 : 0, a ? Math.round(a.t * 100) : 0, a ? a.side : 0,
    q100(v.headYawWant), q100(v.headPitchWant), q100(v.hoverWant), q100(v.flareWant), q100(v.archWant),
    q100(v.armUpWant[0]), q100(v.armUpWant[1]), q100(v.armExtWant[0]), q100(v.armExtWant[1]), q100(v.gripWant), q100(v.spreadWant), q100(v.mawWant),
    v.hasT ? Math.round(Math.min(600, Math.max(0, now - v.seeT)) * 10) : -1, Math.round(v.tx * 10), Math.round(v.tz * 10),
    V.ev, V.evKind, Math.round(v.x * 10), Math.round(v.z * 10), v.orbit.length];
}
//  what he holds: per car [wreck, angle·100, radius·10, height·10, spin·100, rise·100, rest height·10]
function orbitRows(V) {
  const r = [];
  for (const o of V.vec.orbit) r.push(o.k, Math.round(o.a * 100), Math.round(o.r * 10), Math.round(o.h * 10), Math.round(o.spin * 100), Math.round(o.rise * 100), Math.round(o.y0 * 10));
  return r;
}
//  the cars in the air: per car [wreck, x·10, y·10, z·10, vx·10, vy·10, vz·10, spin·100, roll·100]
function flightRows(V) {
  const r = [];
  for (const T of V.thrown) r.push(T.k, Math.round(T.x * 10), Math.round(T.y * 10), Math.round(T.z * 10), Math.round(T.vx * 10), Math.round(T.vy * 10), Math.round(T.vz * 10), Math.round(T.spin * 100), Math.round(T.roll * 100));
  return r;
}
//  The whole of him, to carry on from ({ v, o, t, cd }, or null when he is not
//  about): v [x·100, z·100, y·100, heading·1000, hp·10, state, time in it·10,
//  dead time·10 (−1: alive), awake, phase, target (1/0), tx·10, tz·10, seen
//  ago·10, swing ready in·10, window·10, next whisper in·10, next voice in·10,
//  next summon in·10, next blink in·10, next order in·10] — a swing in the air
//  is let go; o what he holds (orbitRows, ·100 where finer); t the cars in the
//  air (·100); cd the wait for him when he is not about
const FULL_N = 21;
function fullState(V) {
  const v = V.vec, now = V.env.now();
  const out = { cd: Math.round(Math.max(0, Math.min(6000, V.spawnCd)) * 10), v: null, o: [], t: [] };
  if (!v.live) return out;
  out.v = [Math.round(v.x * 100), Math.round(v.z * 100), Math.round(v.y * 100), Math.round((v.hd || 0) * 1000), Math.round(Math.max(0, v.hp) * 10),
    V_ST.indexOf(v.st === 'combat' ? 'hunt' : v.st), Math.round(Math.min(600, v.stT) * 10), v.dead ? Math.round(v.deadT * 10) : -1, v.awake ? 1 : 0, v.phase | 0,
    v.hasT ? 1 : 0, Math.round(v.tx * 10), Math.round(v.tz * 10), Math.round(Math.min(600, Math.max(0, now - v.seeT)) * 10),
    Math.round(v.atkCd * 10), Math.round(v.vuln * 10), Math.round(Math.max(-60, Math.min(600, v.mentalT)) * 10), Math.round(Math.max(-60, Math.min(600, v.voiceT)) * 10),
    Math.round(Math.max(-60, Math.min(600, v.summonCd)) * 10), Math.round(Math.max(-60, Math.min(600, v.blinkCd)) * 10), Math.round(Math.max(-60, Math.min(600, v.cmdT)) * 10)];
  for (const o of v.orbit) out.o.push(o.k, Math.round(o.a * 1000), Math.round(o.r * 100), Math.round(o.h * 100), Math.round(o.spin * 1000), Math.round(o.rise * 1000), Math.round(o.y0 * 100), Math.round(o.roll * 1000));
  for (const T of V.thrown) out.t.push(T.k, Math.round(T.x * 100), Math.round(T.y * 100), Math.round(T.z * 100), Math.round(T.vx * 100), Math.round(T.vy * 100), Math.round(T.vz * 100),
    Math.round(T.spin * 1000), Math.round(T.roll * 1000), Math.round(T.t * 100), Math.round((T.y0 || 0) * 100));
  return out;
}
function fullOk(f) {
  if (!f || typeof f !== 'object' || !Number.isFinite(f.cd)) return false;
  if (f.v !== null && (!Array.isArray(f.v) || f.v.length !== FULL_N || !f.v.every(Number.isFinite) || Math.abs(f.v[0]) > 50000 || Math.abs(f.v[1]) > 50000 || f.v[5] < 0 || f.v[5] >= V_ST.length)) return false;
  if (!Array.isArray(f.o) || f.o.length % 8 || f.o.length > V_ORBIT_MAX * 8 || !f.o.every(Number.isFinite)) return false;
  if (!Array.isArray(f.t) || f.t.length % 11 || f.t.length > 20 * 11 || !f.t.every(Number.isFinite)) return false;
  return true;
}
//  (the wrecks he holds and throws are marked so: they are up in the air)
function adoptFull(V, f) {
  const E = V.env, v = V.vec, now = E.now(), wrecks = E.wrecks();
  V.thrown.length = 0; v.orbit = [];
  v.live = false; v.atk = null;
  V.spawnCd = f.cd / 10;
  if (!f.v) { E.on.gone(v); return; }
  const r = f.v, x = r[0] / 100, z = r[1] / 100;
  Object.assign(v, {
    live: true, x, z, y: r[2] / 100, hd: r[3] / 1000, sp: 0, hp: Math.min(V_HP, r[4] / 10), phase: r[9],
    st: V_ST[r[5]], stT: r[6] / 10, gaitPh: 0, lean: 0,
    hover: 0, hoverWant: 0, flare: 0, flareWant: 0, arch: 0, archWant: 0,
    armUp: [0, 0], armUpWant: [0, 0], armExt: [0, 0], armExtWant: [0, 0],
    grip: 0, gripWant: 0, spread: 0, spreadWant: 0, maw: 0, mawWant: 0,
    aimYaw: 0, aimPitch: 0, headYaw: 0, headPitch: 0, headYawWant: 0, headPitchWant: 0,
    stagger: 0, vuln: r[15] / 10, atk: null, atkCd: r[14] / 10, dead: r[7] >= 0, deadT: r[7] >= 0 ? r[7] / 10 : 0,
    see: 0, seeT: now - r[13] / 10, tx: r[11] / 10, tz: r[12] / 10, tdist: 999, hasT: !!r[10],
    wx: x, wz: z, wanderT: 0, cmdT: r[20] / 10, mentalT: r[16] / 10,
    orbit: [], stepBeat: -1, voiceT: r[17] / 10, lod: 0, awake: !!r[8],
    netX: x, netZ: z, netH: r[3] / 1000, rx: x, rz: z, rspd: 0, hpHold: 0,
    dodgeX: 0, dodgeZ: 0, lastPX: x, lastPZ: z, summonCd: r[18] / 10, blinkCd: r[19] / 10,
    lifted: 0, cmdDone: 0, chanDone: 0,
  });
  if (v.dead) v.hp = 0;
  for (let i = 0; i + 7 < f.o.length; i += 8) {
    const k = f.o[i]; if (!wrecks[k]) continue;
    v.orbit.push({ k, a: f.o[i + 1] / 1000, r: f.o[i + 2] / 100, h: f.o[i + 3] / 100, spin: f.o[i + 4] / 1000, rise: f.o[i + 5] / 1000, y0: f.o[i + 6] / 100, roll: f.o[i + 7] / 1000 });
    wrecks[k].held = true;
  }
  for (let i = 0; i + 10 < f.t.length; i += 11) {
    const k = f.t[i]; if (!wrecks[k]) continue;
    V.thrown.push({ k, x: f.t[i + 1] / 100, y: f.t[i + 2] / 100, z: f.t[i + 3] / 100, vx: f.t[i + 4] / 100, vy: f.t[i + 5] / 100, vz: f.t[i + 6] / 100,
      spin: f.t[i + 7] / 1000, roll: f.t[i + 8] / 1000, t: f.t[i + 9] / 100, y0: f.t[i + 10] / 100, hit: 0, got: [] });
    wrecks[k].thrown = true; wrecks[k].held = false;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    V_HP, V_SIGHT, V_LINK, V_CLEAR, V_CMD_DOG, V_CMD_GOR, V_HEIGHT, V_HIP, V_EXT, V_WAVE_R, V_WAVE_DMG, V_LIMB_R, V_LIMB_DMG, V_GRAB_R, V_GRAB_DMG,
    V_THROW_DMG, V_ORBIT_MAX, V_MEM, V_PHASE, V_SUMMON_CD, V_BLINK_MIN, V_BLINK_CD, V_BLINK_STAND, V_TAKE, V_RET, V_ST, V_ATK, ATK_KINDS, EV, SNAP_N, FULL_N,
    makeVecna, tell, spawnSpot, spawnVecna, clearVecna, command, ring, summon, hiveCount, pickWrecks, lift, dropOrbit, hurl, flights, orbitStep,
    sees, see, phaseOf, think, chooseAtk, startAtk, runAtk, step, ease, hurt, blinkTo, kill, stock, fighting, ext01,
    snapRow, orbitRows, flightRows, fullState, fullOk, adoptFull,
  };
}
