'use strict';
//  ============================================================
//  CONTOUR — the day side's traffic: the cars, the Ferraris, the crowd
//  ============================================================
//  Shared (B9t): a player's game runs the traffic while alone in a room;
//  with two or more there the room server runs it (server/traffic.js) and
//  sends each player what they need to see it, so everyone sees the same
//  cars and the same people. Nothing here draws: the game draws a car from
//  the fields this moves (rx, rz, hd; the turn rate a step returns), and a
//  walker from its eased pose (rx, rz, hd, rspd, phase).
//
//  Everything is seeded (SEED), so every screen and the room start the same
//  city: which car is a taxi, what colour it is, what each walker wears.
//  The streets are shared/troop.js's: the signals on one clock, the graph.
//  `env.now()` is that clock (s).

const { N, PITCH, RW, SWW, mulberry32 } = require('./city.js');
const TR = require('./troop.js');

const NUMCARS = 140, NUM_FERRARI = 6, NUM_WALKER = 215;
const LANE = 3.4;                          // a driving lane's offset from the road's centre
const AVGCRUISE = 8.5;                     // m/s: a car at cruise (a Ferrari does three times it)
const CAR_TYPES = ['sedan', 'sedan', 'sedan', 'kei', 'van', 'taxi'];
const PAINTS = 10;                         // the game's car paints (index.html carPaint)
const LOOKS = 480;                         // walkers' outfits: 8 shirts × 5 trousers × 3 skins × 4 hair (index.html packLook)
const SEED = 0x7aff1c;

function carShape(type) {
  let W = 1.9, H = 0.75, L = 4.4, cabH = 0.72, cabL = 2.0, cabZ = -0.15, taxi = false;
  if (type === 'kei') { W = 1.7; H = 1.15; L = 3.3; cabH = 0.55; cabL = 1.5; cabZ = 0; }
  else if (type === 'van') { W = 2.0; H = 1.5; L = 4.9; cabH = 0; cabL = 0; }
  else if (type === 'taxi') { taxi = true; }
  return { W, H, L, cabH, cabL, cabZ, taxi, halfW: W / 2, halfL: L / 2 };
}

//  the city's traffic, from SEED: cars (with their shape and paint), the
//  Ferraris (spread over the quarters of the grid so they roam all of it),
//  and the walkers (with their outfits)
function makeTraffic(env) {
  const rand = mulberry32(SEED);
  const T = { env, cars: [], ferraris: [], walkers: [], lanes: new Map(), rand };
  for (let k = 0; k < NUMCARS; k++) {
    const e = TR.randEdge(rand); e.speed = 6; e.cruise = 7 + rand() * 3; e.turnSign = 1; e.drift = 0; e.k = k;
    e.type = CAR_TYPES[rand() * CAR_TYPES.length | 0]; Object.assign(e, carShape(e.type));
    e.paint = rand() * PAINTS | 0;
    T.cars.push(e);
  }
  for (let k = 0; k < NUM_FERRARI; k++) {
    const e = TR.randEdge(rand); e.speed = 12; e.cruise = AVGCRUISE * 3; e.turnSign = 1; e.drift = 0; e.reckless = true; e.k = k;   // 3× normal, runs reds
    e.i = Math.max(-(N - 1), Math.min(N - 1, ((k % 3) - 1) * (N - 1)));
    e.j = Math.max(-(N - 1), Math.min(N - 1, (k < 3 ? -1 : 1) * (N - 2)));
    if (Math.abs(e.i + e.di) > N) e.di = -e.di;
    if (Math.abs(e.j + e.dj) > N) e.dj = -e.dj;
    e.halfW = 1.0; e.halfL = 2.35;
    T.ferraris.push(e);
  }
  for (let k = 0; k < NUM_WALKER; k++) {
    const e = TR.randEdge(rand); e.ped = true; e.side = rand() < 0.5 ? 1 : -1;
    e.running = rand() < 0.3; e.speed = e.running ? 3.6 : 1.5; e.pspeed = 0; e.phase = rand() * 6; e.hidx = k;
    e.colr = rand() * LOOKS | 0;
    const off = e.side * (RW + SWW * 0.55);
    e.wx = (e.i + e.s * e.di) * PITCH + e.dj * off; e.wz = (e.j + e.s * e.dj) * PITCH - e.di * off;
    T.walkers.push(e);
  }
  //  drawn where they are, facing the way they go (so the city is whole
  //  before its first step, to hand over or to draw)
  for (const a of T.cars.concat(T.ferraris)) { a.rx = a._x = laneX(a); a.rz = a._z = laneZ(a); a.hd = Math.atan2(a.di, a.dj); }
  for (const e of T.walkers) { e.rx = e.wx; e.rz = e.wz; e.hd = Math.atan2(e.di, e.dj); }
  lanesUp(T);
  return T;
}
//  every vehicle on its lane's list, before anyone looks for the car in front
function lanesUp(T) {
  T.lanes.clear();
  for (const a of T.cars.concat(T.ferraris)) { a.lane = undefined; laneMove(T, a, laneOf(a)); }
}

//  ---- driving ------------------------------------------------------------------------
//  Each lane (a road edge and a direction) keeps its own list of what is on
//  it, moved along as a vehicle turns onto the next, so a car only checks
//  the ones it could run into — cars AND Ferraris, so neither clips into
//  the other (a Ferrari falls in behind slower traffic).
const laneOf = (a) => (((a.i + 16) * 64 + (a.j + 16)) * 4) + (a.di === 1 ? 0 : a.di === -1 ? 1 : a.dj === 1 ? 2 : 3);
function laneMove(T, a, nl) {
  if (a.lane !== undefined) { const o = T.lanes.get(a.lane); if (o) { const i = o.indexOf(a); if (i >= 0) o.splice(i, 1); } }
  let l = T.lanes.get(nl); if (!l) T.lanes.set(nl, l = []);
  l.push(a); a.lane = nl;
}
//  the nearest vehicle ahead on the same lane (m)
function gapAhead(T, a) {
  let ahead = Infinity;
  const nl = laneOf(a);
  if (nl !== a.lane) laneMove(T, a, nl);
  for (const o of T.lanes.get(nl)) { if (o !== a && o.s > a.s) ahead = Math.min(ahead, (o.s - a.s) * PITCH); }
  return ahead;
}
function driveAgent(T, a, dt, followAhead, stopExtra) {
  const node = TR.signalPhase(T.env.now() + TR.sigOffset(a.i + a.di, a.j + a.dj));
  //  the Ferraris run every red they come to; they still keep a gap to the car
  //  in front, so they blow the light without driving through anybody's boot
  const go = a.reckless || (a.di !== 0 ? node.ew : node.ns) === 2;
  let target = a.cruise;
  const distToNode = (1 - a.s) * PITCH, stopS = 1 - (RW + 3) / PITCH;
  //  Once past the stop line the car is committed: it clears the intersection
  //  even if the light changes behind it (a hard clamp once dragged cars that
  //  were already in the junction back to the line)
  const committed = a.s > stopS;
  if (!go && !committed && distToNode < RW + stopExtra) target = 0;
  if (followAhead < 9) target = Math.min(target, Math.max(0, (followAhead - 5.5) * 1.4));   // keep a car-length gap
  a.speed += (target - a.speed) * Math.min(1, dt * 2.4);
  a.s += a.speed * dt / PITCH;
  if (!go && !committed) a.s = Math.min(a.s, stopS);
  return a.s >= 1 ? TR.advanceNode(a, T.rand) : false;   // whether a turn happened
}
const laneX = (a) => (a.i + a.s * a.di) * PITCH + a.dj * LANE;
const laneZ = (a) => (a.j + a.s * a.dj) * PITCH - a.di * LANE;
//  One step of a car. It swings through a corner instead of snapping: the
//  drawn pose chases the lane's, and the turn rate this returns (rad/s)
//  steers the front wheels and rolls the body.
function stepCar(T, car, dt) {
  driveAgent(T, car, dt, gapAhead(T, car), 6);
  const w = TR.easePose(car, laneX(car), laneZ(car), Math.atan2(car.di, car.dj), dt, 6, Math.max(14, car.cruise * 2), 5, 2.8);
  const nl = laneOf(car);
  if (nl !== car.lane) laneMove(T, car, nl);
  car._x = car.rx; car._z = car.rz;
  return w;
}
//  One step of a Ferrari: it follows traffic, and drifts out of every corner
//  (slip: how far the tail is out, for the drawing)
function stepFerrari(T, a, dt) {
  if (driveAgent(T, a, dt, gapAhead(T, a), 7)) a.drift = 0.9;
  { const nl = laneOf(a); if (nl !== a.lane) laneMove(T, a, nl); }
  const w = TR.easePose(a, laneX(a), laneZ(a), Math.atan2(a.di, a.dj), dt, 9, 46, 6, 3.4);
  a.slip = 0;
  if (a.drift > 0) { a.slip = Math.sin((a.drift / 0.9) * Math.PI) * 0.7 * a.turnSign; a.drift = Math.max(0, a.drift - dt); }
  a._x = a.rx; a._z = a.rz;
  return w;
}
//  One step of a walker: along the pavement, crossing when the signals say,
//  rounding the corners (the lean this returns tips the body into a turn)
function stepWalker(T, e, dt) {
  const g = TR.pedGraphStep(e, dt, T.env.now(), T.rand);
  const lean = -TR.easePose(e, g.bx, g.bz, g.heading, dt, 3.2, Math.max(4.6, e.speed * 1.6), 7, 4.5) * 0.07;
  e.wx = e.rx; e.wz = e.rz;
  return lean;
}
//  the walkers a vehicle (at bx, bz, heading, half width and length) at
//  `speed` runs down on the crossing — the box test the player gets
function mow(T, bx, bz, heading, hw, hl, speed) {
  const hit = [];
  if (speed < 5) return hit;
  const ch = Math.cos(heading), sh = Math.sin(heading);
  for (const e of T.walkers) {
    const dx = e.wx - bx, dz = e.wz - bz;
    if (dx * dx + dz * dz > 25) continue;
    const lz = dx * sh + dz * ch, lx = dx * ch - dz * sh;
    if (Math.abs(lx) < hw + 0.4 && Math.abs(lz) < hl + 0.4) hit.push(e);
  }
  return hit;
}
//  a walker who is killed rejoins the crowd somewhere else, so the streets
//  stay as busy as they were
function respawn(T, e) {
  const n = TR.randEdge(T.rand);
  e.i = n.i; e.j = n.j; e.di = n.di; e.dj = n.dj; e.s = n.s;
  e.side = T.rand() < 0.5 ? 1 : -1; e.pspeed = 0;
  const off = e.side * (RW + SWW * 0.55);
  e.wx = e.rx = (e.i + e.s * e.di) * PITCH + e.dj * off;
  e.wz = e.rz = (e.j + e.s * e.dj) * PITCH - e.di * off;
  e.hd = Math.atan2(e.di, e.dj);
}

//  ---- carrying on from where someone else had them ----------------------------------
//  From where a vehicle stands and which way it faces: onto the lane of the
//  nearest road going that way. Its drawn pose stays where it is, and eases
//  onto the lane from there.
function along(u, d) {                     // (node, fraction) going d (±1) along an axis at u (in blocks)
  let n = d > 0 ? Math.floor(u) : Math.ceil(u);
  n = Math.max(-N + (d < 0 ? 1 : 0), Math.min(N - (d > 0 ? 1 : 0), n));
  return [n, Math.max(0, Math.min(0.999, d > 0 ? u - n : n - u))];
}
function seatCar(a, x, z, h, speed) {
  const sx = Math.sin(h), cz = Math.cos(h);
  if (Math.abs(sx) >= Math.abs(cz)) {      // an E-W road
    a.di = sx >= 0 ? 1 : -1; a.dj = 0;
    a.j = Math.max(-N, Math.min(N, Math.round((z + a.di * LANE) / PITCH)));
    [a.i, a.s] = along(x / PITCH, a.di);
  } else {                                 // an N-S road
    a.di = 0; a.dj = cz >= 0 ? 1 : -1;
    a.i = Math.max(-N, Math.min(N, Math.round((x - a.dj * LANE) / PITCH)));
    [a.j, a.s] = along(z / PITCH, a.dj);
  }
  a.rx = a._x = x; a.rz = a._z = z; a.hd = h;
  a.speed = Math.max(0, +speed || 0); a.drift = 0;
}
//  a walker likewise, onto the nearer pavement, walking the way it faces
function seatWalker(e, x, z, h) {
  const ci = Math.round(x / PITCH), cj = Math.round(z / PITCH), sx = Math.sin(h), cz = Math.cos(h);
  if (Math.abs(z - cj * PITCH) <= Math.abs(x - ci * PITCH)) {   // nearer an E-W road
    e.di = sx >= 0 ? 1 : -1; e.dj = 0; e.j = Math.max(-N, Math.min(N, cj));
    [e.i, e.s] = along(x / PITCH, e.di);
    e.side = (z > e.j * PITCH ? -1 : 1) * e.di;
  } else {                                                        // nearer an N-S road
    e.di = 0; e.dj = cz >= 0 ? 1 : -1; e.i = Math.max(-N, Math.min(N, ci));
    [e.j, e.s] = along(z / PITCH, e.dj);
    e.side = (x > e.i * PITCH ? 1 : -1) * e.dj;
  }
  e.wx = e.rx = x; e.wz = e.rz = z; e.hd = h; e.pspeed = 0;
}
//  Everything, as whoever hands it over says it: the clock; per car and
//  Ferrari [x·10, z·10, heading byte, speed·10, edge, s·1000]; per walker
//  [x·10, z·10, heading byte, edge, s·1000, side]. `edge` is where on the
//  graph (the node it left and the way it went), so whoever carries on from
//  it drives on exactly where it was — and what is drawn stays where it was.
const SIDE = 2 * N + 1;
const edgeOf = (a) => ((a.i + N) * SIDE + (a.j + N)) * 4 + (a.di === 1 ? 0 : a.di === -1 ? 1 : a.dj === 1 ? 2 : 3);
function edgeTo(a, e) {
  const d = e % 4, n = (e - d) / 4, jj = n % SIDE, ii = (n - jj) / SIDE;
  a.i = ii - N; a.j = jj - N; a.di = d === 0 ? 1 : d === 1 ? -1 : 0; a.dj = d === 2 ? 1 : d === 3 ? -1 : 0;
}
const hbOf = (h) => Math.round(((((h || 0) % 6.2832) + 6.2832) % 6.2832) * TR.HDQ) % 256;
function fullState(T) {
  const c = [], f = [], w = [];
  const v = (a) => [Math.round(a.rx * 10), Math.round(a.rz * 10), hbOf(a.hd), Math.round((a.speed || 0) * 10), edgeOf(a), Math.round(a.s * 1000)];
  for (const a of T.cars) c.push(...v(a));
  for (const a of T.ferraris) f.push(...v(a));
  for (const e of T.walkers) w.push(Math.round(e.rx * 10), Math.round(e.rz * 10), hbOf(e.hd), edgeOf(e), Math.round(e.s * 1000), e.side);
  return { t: +T.env.now().toFixed(2), c, f, w };
}
function fullOk(s) {
  const edges = SIDE * SIDE * 4;
  const fin = (a, n, st, ei) => Array.isArray(a) && a.length === n * st && a.every(Number.isFinite) &&
    a.every((x, i) => i % st !== ei || (x >= 0 && x < edges && x === Math.round(x)));
  return !!s && Number.isFinite(s.t) && fin(s.c, NUMCARS, 6, 4) && fin(s.f, NUM_FERRARI, 6, 4) && fin(s.w, NUM_WALKER, 6, 3);
}
function adoptFull(T, s) {
  T.lanes.clear();
  const veh = (a, r, o) => {
    a.rx = a._x = r[o] / 10; a.rz = a._z = r[o + 1] / 10; a.hd = r[o + 2] / TR.HDQ; a.speed = Math.max(0, r[o + 3] / 10);
    edgeTo(a, r[o + 4]); a.s = Math.max(0, Math.min(0.999, r[o + 5] / 1000)); a.lane = undefined; a.drift = 0;
  };
  T.cars.forEach((a, k) => veh(a, s.c, k * 6));
  T.ferraris.forEach((a, k) => veh(a, s.f, k * 6));
  T.walkers.forEach((e, k) => {
    const o = k * 6;
    e.wx = e.rx = s.w[o] / 10; e.wz = e.rz = s.w[o + 1] / 10; e.hd = s.w[o + 2] / TR.HDQ;
    edgeTo(e, s.w[o + 3]); e.s = Math.max(0, Math.min(0.999, s.w[o + 4] / 1000)); e.side = s.w[o + 5] < 0 ? -1 : 1; e.pspeed = 0;
  });
  lanesUp(T);
}
//  Carrying on from nothing but what is drawn (a game that was shown the
//  room's traffic, and whose own graph places are stale by now): each one
//  onto the nearest lane or pavement going the way it faces.
function reseatAll(T) {
  T.lanes.clear();
  for (const a of T.cars.concat(T.ferraris)) { a.lane = undefined; seatCar(a, a.rx, a.rz, a.hd || 0, a.speed); }
  for (const e of T.walkers) seatWalker(e, e.rx === undefined ? e.wx : e.rx, e.rz === undefined ? e.wz : e.rz, e.hd || 0);
  lanesUp(T);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    NUMCARS, NUM_FERRARI, NUM_WALKER, LANE, AVGCRUISE, CAR_TYPES, PAINTS, LOOKS, SEED, carShape, makeTraffic,
    laneOf, laneMove, gapAhead, driveAgent, stepCar, stepFerrari, stepWalker, mow, respawn,
    seatCar, seatWalker, fullState, fullOk, adoptFull, reseatAll,
  };
}
