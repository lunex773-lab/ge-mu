'use strict';
//  ============================================================
//  CONTOUR — the monkey troop: how it walks, chases, eats and rages
//  ============================================================
//  Shared (B9c): whoever runs the troop runs this — a player's game while
//  alone in a room, the room server (server/troop.js) when two or more are
//  there — so it is one troop, whoever runs it. Nothing here draws or plays
//  a sound. The game draws a monkey from the fields this moves (wx, wz, hd,
//  rspd, phase, hp, aggro, eating) and hears of the rest through the hooks
//  a troop is made with (makeTroop env):
//
//    now()          the city's clock (s), which the signals run on
//    nearest(x, z)  the player a raging monkey goes for ({ x, z }), or null
//    spot()         a clear bit of street near a player, for a monkey to
//                   come round the corner at during a rage ({ x, z }), or null
//    onWake(m)      a monkey has come (back) into play, at m.wx, m.wz
//    onCalm(m)      a monkey from the reserve has gone again
//    onEnrage()     the troop has just turned (not every time it is hit)
//    onEaten(c)     a body has been eaten away
//
//  The streets are the city's grid (city.js), walked the way the crowd walks
//  them — along the pavements, crossing when the signals say — so the
//  signals are here too: one clock for the whole city, the green wave.
//
//  Monkeys are plain objects; the game's are its crowd's walkers (with a
//  body to draw hung on them), the room's have nothing else. Their fields:
//    mi              the monkey's number, the same on every screen
//    i j di dj s side  where on the pavement graph it is walking
//    running speed pspeed phase   how it walks
//    wx wz           where it is;  rx rz hd rspd  where it is drawn, eased
//    hp aggro eating feedC meleeCd killed deadT deadFx corpseT
//    pooled active   one of the reserve, and whether it is in play

const { N, PITCH, RW, SWW } = require('./city.js');

//  ---- the signals (2 green, 1 yellow, 0 red), on one clock ------------------
//  The cycle is tuned so that half of it is exactly the time it takes to drive
//  one block at cruise (66 m at ~8.5 m/s ≈ 7.76 s): neighbouring junctions are
//  offset by half a cycle, so a car that clears one green arrives at the next
//  in the same part of the cycle — in all four directions.
const SIG = { g: 4.2, y: 1.5, ar: 0.8, scr: 2.5 };
const CYCLE = SIG.g * 2 + SIG.y * 2 + SIG.ar * 2 + SIG.scr;      // 15.5 s
function signalPhase(t) {
  t = ((t % CYCLE) + CYCLE) % CYCLE;
  if (t < SIG.g) return { ns: 2, ew: 0, ped: 0 };                 t -= SIG.g;
  if (t < SIG.y) return { ns: 1, ew: 0, ped: 0 };                 t -= SIG.y;
  if (t < SIG.ar) return { ns: 0, ew: 0, ped: 0 };                t -= SIG.ar;
  if (t < SIG.g) return { ns: 0, ew: 2, ped: 0 };                 t -= SIG.g;
  if (t < SIG.y) return { ns: 0, ew: 1, ped: 0 };                 t -= SIG.y;
  if (t < SIG.ar) return { ns: 0, ew: 0, ped: 0 };
  return { ns: 0, ew: 0, ped: 1 };                                // pedestrian scramble
}
const WAVE_STEP = CYCLE / 2;
const sigOffset = (i, j) => -(i + j) * WAVE_STEP;
//  A walker crossing at a head has the traffic that would hit them stopped.
//  axis 1 = the head over the E-W road, read by walkers going E-W, who are
//  crossing the N-S road — so it is the N-S traffic that has to be red.
const pedWalk = (P, axis) => P.ped === 1 || (axis === 1 ? P.ns : P.ew) === 0;

//  ---- the street graph ------------------------------------------------------------
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function randEdge(rand) {
  rand = rand || Math.random;
  let i, j, d;
  do { i = (rand() * (2 * N + 1) | 0) - N; j = (rand() * (2 * N + 1) | 0) - N; d = DIRS[rand() * 4 | 0]; } while (Math.abs(i + d[0]) > N || Math.abs(j + d[1]) > N);
  return { i, j, di: d[0], dj: d[1], s: rand() };
}
function advanceNode(a, rand) {
  rand = rand || Math.random;
  a.i += a.di; a.j += a.dj; a.s -= 1; if (a.s < 0) a.s = 0;
  const opts = [];
  for (const [ndi, ndj] of DIRS) { if (ndi === -a.di && ndj === -a.dj) continue; if (Math.abs(a.i + ndi) > N || Math.abs(a.j + ndj) > N) continue; opts.push([ndi, ndj]); }
  if (!opts.length) { a.di = -a.di; a.dj = -a.dj; return false; }
  const straight = opts.find((o) => o[0] === a.di && o[1] === a.dj);
  const ch = (straight && rand() < (a.ped ? 0.55 : 0.68)) ? straight : opts[rand() * opts.length | 0];
  const turned = ch[0] !== a.di || ch[1] !== a.dj;
  a.turnSign = Math.sign(a.di * ch[1] - a.dj * ch[0]) || 1;
  a.di = ch[0]; a.dj = ch[1];
  return turned;
}

//  ---- turning: the graph snaps direction (and the lane / pavement offset) at
//  every node, so an agent carries a drawn pose that chases the graph's —
//  position eased in with a speed cap, heading swung at a limited rate — and
//  the turn rate this returns drives the leaning.
function easeHeading(a, tgtH, dt, gain, maxW) {
  if (a.hd === undefined) { a.hd = tgtH; return 0; }
  let da = tgtH - a.hd;
  while (da > Math.PI) da -= 6.2832;
  while (da < -Math.PI) da += 6.2832;
  let w = da * gain;
  if (w > maxW) w = maxW; else if (w < -maxW) w = -maxW;
  //  Never turn past the thing being turned towards. At a frame's dt this
  //  clamp never fires — the ease is a fraction of the error — but the AI LOD
  //  hands far creatures a whole second and a bit at a time, and 2.6 rad/s of
  //  it is 3.1 radians in one go: a half-radian correction becomes a 179°
  //  overshoot, the next step overshoots back, and the animal spins. It reads
  //  as full speed with no progress, which is exactly how it measured — an
  //  escort 32 m behind a master strolling at 2.4 m/s, running flat out at
  //  8.4 and falling further behind every sample.
  let step = w * dt;
  if (step > 0 ? step > da : step < da) step = da;
  a.hd += step;
  return dt > 1e-5 ? step / dt : 0;          // rad/s, +ve = turning right
}
function easePose(a, bx, bz, tgtH, dt, rate, maxCatch, gain, maxW) {
  if (a.rx === undefined) { a.rx = bx; a.rz = bz; }
  const dx = bx - a.rx, dz = bz - a.rz, d = Math.hypot(dx, dz);
  let step = 0;
  if (d > 24) { a.rx = bx; a.rz = bz; }       // respawned or woken somewhere else
  else if (d > 1e-5) {
    step = Math.min(d * Math.min(1, dt * rate), maxCatch * dt);
    a.rx += dx / d * step; a.rz += dz / d * step;
  }
  a.rspd = dt > 1e-5 ? step / dt : 0;
  return easeHeading(a, tgtH, dt, gain, maxW);
}
//  one step along the pavement at time t (the signals' clock), as a walker takes it
function pedGraphStep(ped, dt, t, rand) {
  const P = signalPhase(t + sigOffset(ped.i + ped.di, ped.j + ped.dj));
  const canCross = pedWalk(P, ped.di !== 0 ? 1 : 0);   // the same rule the ped head displays
  let target = ped.speed;
  const distToNode = (1 - ped.s) * PITCH, stopS = 1 - (RW + 2.5) / PITCH;
  const committed = ped.s > stopS;            // already out on the crossing — finish it
  if (!canCross && !committed && distToNode < RW + 3) target = 0;
  ped.pspeed += (target - ped.pspeed) * Math.min(1, dt * 4);
  ped.s += ped.pspeed * dt / PITCH;
  if (!canCross && !committed) ped.s = Math.min(ped.s, stopS);
  if (ped.s >= 1) advanceNode(ped, rand);
  const off = ped.side * (RW + SWW * 0.55);
  const bx = (ped.i + ped.s * ped.di) * PITCH + ped.dj * off, bz = (ped.j + ped.s * ped.dj) * PITCH - ped.di * off;
  return { bx, bz, heading: Math.atan2(ped.di, ped.dj), walk: ped.pspeed > 0.3 ? Math.min(ped.pspeed / ped.speed, 1) : 0 };
}
//  Back onto the graph at the pavement nearest to where it stands. Anything
//  that leaves the graph — a monkey that chased someone across the map, or
//  walked off to a body — has a stale i/j/s, and rejoining without this
//  snapped it back to wherever it had left off.
function reseat(e) {
  const ci = Math.round(e.wx / PITCH), cj = Math.round(e.wz / PITCH);
  if (Math.abs(e.wz - cj * PITCH) <= Math.abs(e.wx - ci * PITCH)) {   // nearer an E-W road
    e.di = 1; e.dj = 0;
    e.j = Math.max(-N, Math.min(N, cj));
    const u = e.wx / PITCH;
    e.i = Math.max(-N, Math.min(N - 1, Math.floor(u)));
    e.s = Math.max(0, Math.min(0.999, u - e.i));
    e.side = e.wz > e.j * PITCH ? -1 : 1;
  } else {                                                            // nearer an N-S road
    e.di = 0; e.dj = 1;
    e.i = Math.max(-N, Math.min(N, ci));
    const u = e.wz / PITCH;
    e.j = Math.max(-N, Math.min(N - 1, Math.floor(u)));
    e.s = Math.max(0, Math.min(0.999, u - e.j));
    e.side = e.wx > e.i * PITCH ? 1 : -1;
  }
  e.pspeed = 0; e.rx = e.wx; e.rz = e.wz; e.hd = Math.atan2(e.di, e.dj);
}

//  ---- the troop ------------------------------------------------------------------
const NUM = 12, POOL = 10, HP = 60;          // on the streets from the start; the reserve a rage wakes
const RAGE_TIME = 60, RAGE_SPAWN = 2.5, RAGE_RESPAWN = 3.0;
const BODY_TIME = 10;                        // s a fallen monkey lies there
const NUM_CORPSE = 8, CORPSE_EAT = 10, CORPSE_FEEDERS = 5, CORPSE_GIVEUP = 25;
const CHASE = 4.6, TO_FOOD = 3.6;            // m/s
const HDQ = 255 / 6.2832;                    // a heading in a byte

//  a monkey: on the streets (a place on the graph, walking or running), or
//  one of the reserve (out of play until a rage wakes it)
function newMonkey(mi, pooled, rand) {
  rand = rand || Math.random;
  const e = randEdge(rand);
  e.ped = true; e.isMonkey = true; e.mi = mi; e.side = rand() < 0.5 ? 1 : -1;
  e.aggro = false; e.meleeCd = 0;
  if (pooled) {
    e.pooled = true; e.active = false; e.running = true; e.speed = 3.6; e.pspeed = 0;
    e.phase = rand() * 6; e.hp = 0; e.deadT = 1e9; e.wx = 0; e.wz = 0;
  } else {
    e.running = rand() < 0.3; e.speed = e.running ? 3.6 : 1.5; e.pspeed = 0; e.phase = rand() * 6;
    e.hp = HP;
    const off = e.side * (RW + SWW * 0.55);      // the world position, from the graph
    e.wx = (e.i + e.s * e.di) * PITCH + e.dj * off; e.wz = (e.j + e.s * e.dj) * PITCH - e.di * off;
  }
  return e;
}
//  a troop: its monkeys (NUM on the streets, then POOL in reserve, numbered
//  in that order), the bodies lying about, and the rage clock. `monkeys` and
//  `corpses` may be the caller's own lists (the game's carry its drawing).
function makeTroop(env, monkeys, corpses, rand) {
  rand = rand || Math.random;
  if (!monkeys) { monkeys = []; for (let k = 0; k < NUM + POOL; k++) monkeys.push(newMonkey(k, k >= NUM, rand)); }
  if (!corpses) { corpses = []; for (let n = 0; n < NUM_CORPSE; n++) corpses.push(newCorpse()); }
  return { env, monkeys, corpses, rageT: 0, rageSpawnCd: 0, rand, pose: { heading: 0, walk: 1, running: false, lean: 0, eat: 0 } };
}
const inPlay = (m) => m.hp > 0 && (!m.pooled || m.active);

//  One step of a monkey in play, by whoever runs the troop: to a body to eat,
//  at the nearest player when the troop is raging, or along the streets.
//  Returns how it moves (T.pose, reused), for the drawing.
function stepMonkey(T, m, dt) {
  const o = T.pose;
  o.walk = 1; o.running = m.running; o.lean = 0; o.eat = 0;
  const chase = m.aggro ? T.env.nearest(m.wx, m.wz) : null;
  if (!chase && m.feedC && m.feedC.active) {                 // a body on the road — go and eat
    const c = m.feedC;
    const dx = c.x - m.wx, dz = c.z - m.wz, d = Math.hypot(dx, dz) || 1;
    if (d > 1.5) { m.wx += dx / d * TO_FOOD * dt; m.wz += dz / d * TO_FOOD * dt; m.eating = false; }
    else m.eating = true;
    m.rx = m.wx; m.rz = m.wz;
    o.lean = -easeHeading(m, Math.atan2(dx, dz), dt, 8, 5) * 0.05;
    o.running = !m.eating; o.eat = m.eating ? 1 : 0; o.walk = m.eating ? 0 : 1;
    m.phase += dt * (m.eating ? 6 : 11);
  } else if (chase) {                                        // charge whoever is nearest
    m.eating = false;
    const dx = chase.x - m.wx, dz = chase.z - m.wz, d = Math.hypot(dx, dz) || 1;
    if (d > 1.3) { m.wx += dx / d * CHASE * dt; m.wz += dz / d * CHASE * dt; }
    m.rx = m.wx; m.rz = m.wz;                                // the chase already moves smoothly
    o.lean = -easeHeading(m, Math.atan2(dx, dz), dt, 8, 5) * 0.05;
    o.running = true;
    m.phase += dt * 13;
  } else {
    m.eating = false;
    const s = pedGraphStep(m, dt, T.env.now(), T.rand);
    o.lean = -easePose(m, s.bx, s.bz, s.heading, dt, 3.2, Math.max(4.6, m.speed * 1.6), 7, 4.5) * 0.07;
    m.wx = m.rx; m.wz = m.rz;          // the eased pose is the real one — shots and swipes agree with it
    const spd = m.rspd; o.running = spd > 2.6;
    o.walk = Math.min(1, spd / (o.running ? 3.6 : 1.5));
    m.phase += dt * spd * (o.running ? 3.4 : 5.0);
  }
  o.heading = m.hd;
  return o;
}
//  a fallen monkey: its body lies there BODY_TIME s. True on the step it fell.
function fallen(m, dt) {
  let first = false;
  if (!m.deadFx) { m.deadFx = true; m.corpseT = BODY_TIME; first = true; }
  m.corpseT -= dt;
  return first;
}

//  ---- the rage ---------------------------------------------------------------------
//  A shot turns the whole troop on the players for RAGE_TIME s (hitting them
//  again does not restart the clock); the reserve comes round the corners,
//  and the fallen get back up once their bodies have gone.
function enrage(T) {
  const fresh = T.rageT <= 0;
  if (fresh) T.rageT = RAGE_TIME;
  for (const m of T.monkeys) if (inPlay(m)) m.aggro = true;
  if (fresh) { T.rageSpawnCd = 0.6; if (T.env.onEnrage) T.env.onEnrage(); }
}
function calm(T) {
  for (const m of T.monkeys) {
    if (m.aggro && m.hp > 0) reseat(m);   // they chased someone off the graph; walk on from here
    m.aggro = false; m.eating = false; m.feedC = null;
    if (m.pooled) { m.active = false; if (T.env.onCalm) T.env.onCalm(m); }
  }
}
function wake(T, m) {
  const sp = T.env.spot(); if (!sp) return false;
  m.hp = HP; m.killed = false; m.deadT = 0; m.aggro = true; m.meleeCd = 0;
  m.deadFx = false; m.corpseT = 0;
  m.wx = m.rx = sp.x; m.wz = m.rz = sp.z; m.active = true;
  if (T.env.onWake) T.env.onWake(m);
  return true;
}
//  the rage clock, run by whoever runs the troop
function stepRage(T, dt) {
  if (T.rageT <= 0) return;
  T.rageT -= dt;
  T.rageSpawnCd -= dt;
  if (T.rageSpawnCd <= 0) {                  // keep them coming
    T.rageSpawnCd = RAGE_SPAWN;
    const idle = T.monkeys.find((m) => m.pooled && !m.active);
    if (idle) wake(T, idle);
  }
  for (const m of T.monkeys) {               // and put the fallen back in play
    if (m.hp > 0) continue;
    m.deadT = (m.deadT || 0) + dt;
    if (m.deadT >= RAGE_RESPAWN && !(m.corpseT > 0)) wake(T, m);   // let the body clear first
  }
  if (T.rageT <= 0) calm(T);
}
//  a round (or anything else) into monkey m: true when it takes it down
function hurt(T, m, dmg) {
  if (!m || !inPlay(m)) return false;
  m.hp -= dmg; m.aggro = true;
  enrage(T);
  if (m.hp <= 0) { m.killed = true; return true; }
  return false;
}

//  ---- bodies ------------------------------------------------------------------------
//  A walker run over or shot is thrown, lands, and lies there until the troop
//  has eaten it: CORPSE_FEEDERS round it (or anyone at all, after
//  CORPSE_GIVEUP s) for CORPSE_EAT s.
function newCorpse() {
  return { active: false, cid: 0, colr: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, tumble: 0, spin: 0,
    state: 'lie', age: 0, eaters: 0, eatT: 0 };
}
function placeCorpse(c, cid, x, z, vx, vz, colr, flying, rand) {
  rand = rand || Math.random;
  c.active = true; c.cid = cid; c.colr = colr;
  c.x = x; c.z = z; c.age = 0; c.eaters = 0; c.eatT = 0; c.tumble = 0;
  c.heading = Math.atan2(vx, vz) + Math.PI;            // lands head-first along the hit
  if (flying) {
    c.state = 'fly'; c.y = 0.9;
    c.vx = vx; c.vz = vz; c.vy = 4.2 + rand() * 2.2;
    c.spin = (5 + rand() * 5) * (rand() < 0.5 ? -1 : 1);
  } else {
    c.state = 'lie'; c.y = 0.16; c.vx = c.vy = c.vz = 0; c.spin = 0;
  }
  return c;
}
//  a body's slot: the one already showing it, else a free one, else the oldest
function corpseSlot(T, cid) {
  let c = T.corpses.find((o) => o.cid === cid && o.active);
  if (c) return { c, had: true };
  c = T.corpses.find((o) => !o.active);
  if (!c) { c = T.corpses.reduce((a, b) => (a.age > b.age ? a : b)); freeCorpse(T, c); }
  return { c, had: false };
}
function freeCorpse(T, c) {
  c.active = false; c.eatT = 0; c.eaters = 0;
  for (const mk of T.monkeys) if (mk.feedC === c) { mk.feedC = null; mk.eating = false; reseat(mk); }
}
//  A body's step: thrown, it flies and lands; lying, the monkeys round it are
//  counted (everyone counts: it is what makes it twitch), and whoever runs the
//  troop (`runs`) runs the clock that clears it. False once it is gone.
function stepCorpse(T, c, dt, runs) {
  c.age += dt;
  if (c.state === 'fly') {
    c.vy -= 22 * dt;
    c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
    c.vx *= 1 - dt * 0.6; c.vz *= 1 - dt * 0.6;
    c.tumble += c.spin * dt;
    if (c.y <= 0.16 && c.vy < 0) { c.y = 0.16; c.state = 'lie'; c.tumble = 0; }
    return true;
  }
  c.eaters = 0;
  for (const mk of T.monkeys) {
    if (!mk.eating || mk.hp <= 0) continue;
    const dx = mk.wx - c.x, dz = mk.wz - c.z;
    if (dx * dx + dz * dz < 9) c.eaters++;
  }
  if (!runs) return true;
  if (c.eatT > 0) { c.eatT -= dt; if (c.eatT <= 0) { if (T.env.onEaten) T.env.onEaten(c); else freeCorpse(T, c); return false; } }
  else if (c.eaters >= CORPSE_FEEDERS || (c.eaters >= 1 && c.age > CORPSE_GIVEUP)) c.eatT = CORPSE_EAT;
  return true;
}
//  which monkeys go and eat: the nearest free ones, up to CORPSE_FEEDERS a
//  body, within 80 m — never while the troop is raging (a rage outranks a meal)
function assignFeeders(T) {
  for (const mk of T.monkeys) if (mk.feedC && !mk.feedC.active) { mk.feedC = null; mk.eating = false; }
  if (T.rageT > 0) { for (const mk of T.monkeys) { mk.feedC = null; mk.eating = false; } return; }
  for (const c of T.corpses) {
    if (!c.active || c.state !== 'lie' || c.eatT > 0) continue;
    let claimed = 0;
    for (const mk of T.monkeys) if (mk.feedC === c) claimed++;
    for (let i = 0; i < T.monkeys.length && claimed < CORPSE_FEEDERS; i++) {
      const mk = T.monkeys[i];
      if (mk.feedC || !inPlay(mk)) continue;
      const dx = mk.wx - c.x, dz = mk.wz - c.z;
      if (dx * dx + dz * dz > 6400) continue;
      mk.feedC = c; claimed++;
    }
  }
}

//  ---- what everyone is told ---------------------------------------------------------
//  The troop as the game's snapshot has it: per monkey in play
//  [mi, x·10, z·10, hp, heading byte, aggro | eating·2]; per body lying about
//  [cid, x·10, z·10, look]; the rage clock in tenths.
function troopArrays(T) {
  const a = [], b = [];
  for (const m of T.monkeys) {
    if (m.hp <= 0 || (m.pooled && !m.active)) continue;
    const h = (((m.hd || 0) % 6.2832) + 6.2832) % 6.2832;
    a.push(m.mi, Math.round(m.wx * 10), Math.round(m.wz * 10), m.hp, Math.round(h * HDQ), (m.aggro ? 1 : 0) | (m.eating ? 2 : 0));
  }
  for (const c of T.corpses) if (c.active) b.push(c.cid, Math.round(c.x * 10), Math.round(c.z * 10), c.colr);
  return { m: a, c: b, r: Math.round(T.rageT * 10) };
}
//  Carrying on from what the last one to run it said (troopArrays' form):
//  who is in play and where, on the graph from where each stands; the bodies
//  lying where they lie; the rage clock. Monkeys not in it are out of play.
function adopt(T, a, b, r) {
  const seen = new Set();
  for (let i = 0; i + 5 < (a || []).length; i += 6) {
    const m = T.monkeys[a[i]]; if (!m) continue;
    seen.add(m);
    m.wx = a[i + 1] / 10; m.wz = a[i + 2] / 10; m.hp = a[i + 3]; m.hd = a[i + 4] / HDQ;
    m.aggro = !!(a[i + 5] & 1); m.eating = false; m.feedC = null;
    m.killed = false; m.deadFx = false; m.corpseT = 0; m.deadT = 0;
    if (m.pooled) m.active = true;
    reseat(m); m.hd = a[i + 4] / HDQ;
  }
  for (const m of T.monkeys) {
    if (seen.has(m)) continue;
    m.eating = false; m.feedC = null;
    if (m.pooled) { m.active = false; m.hp = 0; m.deadT = 1e9; }
    else if (m.hp > 0) { m.hp = 0; m.killed = true; m.deadFx = true; m.corpseT = 0; m.deadT = 0; }
  }
  for (const c of T.corpses) c.active = false;
  for (let i = 0; i + 3 < (b || []).length; i += 4) {
    const { c } = corpseSlot(T, b[i]);
    placeCorpse(c, b[i], b[i + 1] / 10, b[i + 2] / 10, 0, 0, b[i + 3], false, T.rand);
  }
  T.rageT = Math.max(0, (r || 0) / 10);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SIG, CYCLE, WAVE_STEP, signalPhase, sigOffset, pedWalk, DIRS, randEdge, advanceNode, easeHeading, easePose, pedGraphStep, reseat,
    NUM, POOL, HP, RAGE_TIME, RAGE_SPAWN, RAGE_RESPAWN, BODY_TIME, NUM_CORPSE, CORPSE_EAT, CORPSE_FEEDERS, CORPSE_GIVEUP, HDQ,
    newMonkey, makeTroop, inPlay, stepMonkey, fallen, enrage, calm, wake, stepRage, hurt,
    newCorpse, placeCorpse, corpseSlot, freeCorpse, stepCorpse, assignFeeders, troopArrays, adopt,
  };
}
