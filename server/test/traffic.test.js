//  ============================================================
//  The day side's traffic, run by the room  (node, with a clock of our own)
//  ============================================================
//  shared/traffic.js — the cars, the Ferraris and the crowd, whoever runs
//  them — and server/traffic.js with the room's own rules (relay.js): taken
//  over from the host's game, what each player is told and how close what
//  their game shows stays to the truth, what that costs to send, shots at
//  walkers, bodies, given back — and what a call costs.
//
//    node server/test/traffic.test.js

import TF from '../../shared/traffic.js';
import TROOP from '../../shared/troop.js';
import CITY from '../../shared/city.js';
import RULES from '../../shared/rules.js';
import { Relay } from '../relay.js';

const results = []; let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else fail++; results.push((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '\n         ' + detail : '')); }
const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;
const F = CITY.footprints(CITY.planBuildings());

//  ---- the traffic itself (shared/traffic.js) ------------------------------------
{
  let t = 0;
  const T = TF.makeTraffic({ now: () => t }), U = TF.makeTraffic({ now: () => t });
  check('one seed: every screen starts the same city (' + TF.NUMCARS + ' cars, ' + TF.NUM_FERRARI + ' Ferraris, ' + TF.NUM_WALKER + ' walkers)',
    T.cars.length === TF.NUMCARS && T.walkers.length === TF.NUM_WALKER &&
    T.cars.every((c, k) => c.type === U.cars[k].type && c.paint === U.cars[k].paint && c.i === U.cars[k].i && c.s === U.cars[k].s) &&
    T.walkers.every((e, k) => e.colr === U.walkers[k].colr && e.wx === U.walkers[k].wx));
  //  two minutes of the city
  let inWall = 0, tooClose = 0, stoppedAtRed = 0, moving = 0, walkerInWall = 0;
  for (let i = 0; i < 2400; i++) {
    t += 0.05;
    for (const c of T.cars) TF.stepCar(T, c, 0.05);
    for (const a of T.ferraris) TF.stepFerrari(T, a, 0.05);
    for (const e of T.walkers) TF.stepWalker(T, e, 0.05);
    if (i < 200 || i % 10) continue;
    for (const c of T.cars) {
      if (!F.clearAt(c.rx, c.rz, 0)) inWall++;
      if (c.speed > 1) moving++;
      const P = TROOP.signalPhase(t + TROOP.sigOffset(c.i + c.di, c.j + c.dj));
      if (c.speed < 0.3 && (c.di !== 0 ? P.ew : P.ns) !== 2 && (1 - c.s) * CITY.PITCH < CITY.RW + 8) stoppedAtRed++;
    }
    for (const [, lane] of T.lanes) for (let a = 0; a < lane.length; a++) for (let b = a + 1; b < lane.length; b++) if (Math.abs(lane[a].s - lane[b].s) * CITY.PITCH < 3) tooClose++;
    for (const e of T.walkers) if (!F.clearAt(e.wx, e.wz, 0)) walkerInWall++;
  }
  check('two minutes of the city: cars keep to the roads, and walkers to the pavements', inWall === 0 && walkerInWall === 0, inWall + ' car-steps and ' + walkerInWall + ' walker-steps inside a building');
  check('the traffic moves, and stops at red lights', moving > 0 && stoppedAtRed > 0, stoppedAtRed + ' car-steps waiting at a red, ' + moving + ' moving');
  //  carried on from another's word: the same places on the graph, drawn in the
  //  same places; a moment later, the same (until each comes to a junction and
  //  throws its own dice for which way to go)
  const s = TF.fullState(T);
  const V = TF.makeTraffic({ now: () => t });
  TF.adoptFull(V, s);
  const same = V.cars.every((c, k) => c.i === T.cars[k].i && c.j === T.cars[k].j && c.di === T.cars[k].di && Math.abs(c.s - T.cars[k].s) < 0.001 && Math.abs(c.rx - T.cars[k].rx) < 0.06) &&
    V.walkers.every((e, k) => e.i === T.walkers[k].i && e.side === T.walkers[k].side && Math.abs(e.rx - T.walkers[k].rx) < 0.06);
  const node0 = T.cars.map((c) => c.i * 100 + c.j);
  for (let i = 0; i < 10; i++) { t += 0.05; for (const c of T.cars) TF.stepCar(T, c, 0.05); for (const c of V.cars) TF.stepCar(V, c, 0.05); }
  const off = V.cars.filter((c, k) => T.cars[k].i * 100 + T.cars[k].j === node0[k]).map((c) => Math.hypot(c.rx - T.cars[c.k].rx, c.rz - T.cars[c.k].rz));
  check('carried on from another\'s word: every car and walker in the same place on the graph, and drawn where it was; half a second on, still together',
    TF.fullOk(s) && same && Math.max(...off) < 0.1, 'the furthest apart ' + Math.max(...off).toFixed(3) + ' m (' + off.length + ' cars not yet at a junction); the word is ' + JSON.stringify(s).length + ' bytes');
}

//  ---- the room runs it (server/traffic.js) --------------------------------------------
let now = 1_000_000;
const R = new Relay({ moves: false });
const out = [];
const keep = (o) => { for (const [to, text] of o || []) out.push([to, JSON.parse(text), text.length]); };
const say = (id, s, p) => { const r = R.handle(id, JSON.stringify({ s, p }), now); keep(r.out); return r; };
let cx = 0, cz = 0;                                     // a busy crossing, in the open
for (let x = -140; x < 140 && !cx; x += 2) for (let z = -140; z < 140; z += 2) if (F.clearAt(x, z, 1) && Math.abs(x % CITY.PITCH) < 12 && Math.abs(z % CITY.PITCH) < 12) { cx = x; cz = z; break; }
keep(R.join('p000000', 'Aki'));
say('p000000', 'state', { x: cx, y: 0, z: cz, r: 0, w: 0 });
//  the host's game has been running the city for a while
let ht = 0;
const host = TF.makeTraffic({ now: () => ht });
for (let i = 0; i < 400; i++) { ht += 0.05; for (const c of host.cars) TF.stepCar(host, c, 0.05); for (const e of host.walkers) TF.stepWalker(host, e, 0.05); for (const a of host.ferraris) TF.stepFerrari(host, a, 0.05); }
out.length = 0;
keep(R.join('p000001', 'Ben'));
say('p000001', 'state', { x: cx + 4, y: 0, z: cz + 3, r: 0, w: 0 });
const tq = out.find(([to, m]) => m.s === 'tq');
check('two here: the room asks the host\'s game for its traffic', tq && tq[0] === 'p000000');
out.length = 0;
say('p000000', 'tfull', TF.fullState(host));
const own = out.find(([, m]) => m.s === 'own');
const RT = R.creatures.traffic;
check('and carries on from it, and says so', own && own[1].p.t === 1 && R.creatures.own.t && Math.abs(RT.T.cars[7].rx - host.cars[7].rx) < 0.1 && Math.abs(RT.t - ht) < 0.01,
  JSON.stringify(own && own[1].p) + '; the room\'s clock ' + RT.t.toFixed(2) + ' s, the host\'s ' + ht.toFixed(2));

//  a minute: both stand at the crossing; A's game carries each thing on as it
//  was last told — how far from the truth does it get, and what does that cost?
const seen = new Map();                                 // what A's game has: kind:k → { x, z, vx, vz, t }
let bytesA = 0, msgsA = 0, callWorst = 0, callSum = 0, calls = 0;
const worst = { c: [0, 0, 0], w: [0, 0, 0], f: [0, 0, 0] }, errs = { c: [[], [], []], w: [[], [], []], f: [[], [], []] };
const HDQ = TROOP.HDQ;
for (let i = 0; i < 1200; i++) {
  now += 50;
  out.length = 0;
  const t0 = process.hrtime.bigint();
  say(i % 2 ? 'p000001' : 'p000000', 'state', i % 2 ? { x: cx + 4, y: 0, z: cz + 3, r: 0, w: 0 } : { x: cx, y: 0, z: cz, r: 0, w: 0 });
  const d = ms(t0); callWorst = Math.max(callWorst, d); callSum += d; calls++;
  for (const [to, m, len] of out) {
    if (to !== 'p000000' || m.s !== 'tv') continue;
    bytesA += len; msgsA++;
    for (const [kind, n] of [['c', 6], ['w', 6], ['f', 7]]) {
      const a = m.p[kind] || [];
      for (let j = 0; j + n - 1 < a.length; j += n) seen.set(kind + ':' + a[j], { x: a[j + 1] / 10, z: a[j + 2] / 10, vx: a[j + 3] / 10, vz: a[j + 4] / 10, t: now / 1000 });
    }
  }
  if (i < 100) continue;                                  // (from ten seconds in)
  for (const [kind, list] of [['c', RT.T.cars], ['w', RT.T.walkers], ['f', RT.T.ferraris]]) list.forEach((a, k) => {
    const g = seen.get(kind + ':' + k); if (!g) return;
    if (kind === 'w' && a.respawnT !== undefined && RT.t - a.respawnT < 0.2) return;   // (back in the crowd elsewhere: a jump, told at the next word)
    const age = Math.min(10, now / 1000 - g.t), err = Math.hypot(g.x + g.vx * age - a.rx, g.z + g.vz * age - a.rz), dd = Math.hypot(a.rx - cx, a.rz - cz);
    const band = dd < 110 ? 0 : dd < 250 ? 1 : 2;
    worst[kind][band] = Math.max(worst[kind][band], err); errs[kind][band].push(err);
  });
}
const all = TF.NUMCARS + TF.NUM_FERRARI + TF.NUM_WALKER;
check('every car and walker is known to each player\'s game', seen.size === all, seen.size + ' of ' + all);
const fmt = (a) => a.map((x) => x.toFixed(2)).join(' / ');
const p99 = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length * 0.99)] : 0; };
//  (a car rounding a corner slides onto the next lane at up to ~13 m/s: a word
//  a tenth of a second apart can be a metre behind that, for that moment)
check('what their game shows stays close to the truth: nearly always within 0.3 m near them, 1 m further out, 3 m in the fog',
  ['c', 'w'].every((k) => p99(errs[k][0]) < 0.35 && p99(errs[k][1]) < 1.05 && p99(errs[k][2]) < 3.1),
  '99% of the time within (110 m / 250 m / beyond): cars ' + fmt(errs.c.map(p99)) + ' m, walkers ' + fmt(errs.w.map(p99)) + ' m');
check('and at worst, a car rounding a corner, within 1.5 m near them, 2 m further out, 4.5 m in the fog',
  ['c', 'w'].every((k) => worst[k][0] < 1.5 && worst[k][1] < 2 && worst[k][2] < 4.5),
  'the worst: cars ' + fmt(worst.c) + ' m, walkers ' + fmt(worst.w) + ' m');
check('the Ferraris (25 m/s, 46 catching up after a corner) within 2.5 m, 4.5 m in the fog — a tenth of a second of their going', worst.f[0] < 2.5 && worst.f[1] < 2.5 && worst.f[2] < 4.5, 'Ferraris ' + fmt(worst.f) + ' m');
check('and it costs each player a few KB a second', bytesA / 60 < 6000, (bytesA / 60 / 1024).toFixed(2) + ' KB/s in ' + (msgsA / 60).toFixed(1) + ' words a second (the whole city, near and far)');
check('a minute of the city run by the room, two players about: no call near the 10 ms a call has', callWorst < 9.5,
  'each call ' + (callSum / calls).toFixed(3) + ' ms on average, ' + callWorst.toFixed(2) + ' ms at worst');

//  shots at walkers
const e7 = RT.T.walkers.slice().sort((a, b) => Math.hypot(a.wx - cx, a.wz - cz) - Math.hypot(b.wx - cx, b.wz - cz))[2];
//  put A right beside it, in the open
now += 300; say('p000000', 'state', { x: e7.wx + 1.5, y: 0, z: e7.wz + 1.5, r: 0, w: 0 });
const before = [e7.wx, e7.wz];
out.length = 0;
say('p000000', 'pedkill', { k: e7.hidx });
check('a shot into a walker: the room takes them out of the crowd (they rejoin it elsewhere), and says nothing of the shot', Math.hypot(e7.wx - before[0], e7.wz - before[1]) > 1 && !out.some(([, m]) => m.s === 'pedkill'),
  'from ' + before.map((v) => v.toFixed(1)) + ' to ' + [e7.wx, e7.wz].map((v) => v.toFixed(1)) + (R.lastRefusal ? '; last refused: ' + R.lastRefusal : ''));
now += 20;
const b2 = [e7.wx, e7.wz];
say('p000000', 'pedkill', { k: e7.hidx });
check('the next, sooner than the gun can fire, does nothing', e7.wx === b2[0] && /faster than the gun/.test(R.lastRefusal), R.lastRefusal);
now += 300; say('p000001', 'state', { x: cx + 4, y: 0, z: cz + 3, r: 0, w: 1 });
say('p000001', 'pedkill', { k: 3 });
check('nor from the other side of the tear', /other side/.test(R.lastRefusal), R.lastRefusal);
//  … and over there nothing of this side is sent; back here, all of it again
out.length = 0;
for (let i = 0; i < 20; i++) { now += 50; say('p000001', 'state', { x: cx + 4, y: 0, z: cz + 3, r: 0, w: 1 }); }
const overThere = out.filter(([to, m]) => to === 'p000001' && m.s === 'tv').length;
out.length = 0;
now += 50; say('p000001', 'state', { x: cx + 4, y: 0, z: cz + 3, r: 0, w: 0 });
for (let i = 0; i < 3; i++) { now += 50; say('p000000', 'state', { x: cx, y: 0, z: cz, r: 0, w: 0 }); }
const told = new Set();
for (const [to, m] of out) if (to === 'p000001' && m.s === 'tv') for (const [kind, n] of [['c', 6], ['w', 6], ['f', 7]]) { const a = m.p[kind] || []; for (let j = 0; j < a.length; j += n) told.add(kind + a[j]); }
const back = told.size;
check('a player over the tear is sent nothing of this side, and all of it on coming back', overThere === 0 && back === all, overThere + ' words while over there; ' + back + ' told on return');

//  a Ferrari through the crowd
{
  const f = RT.T.ferraris[0], w = RT.T.walkers[11];
  w.wx = w.rx = f.rx + Math.sin(f.hd) * 1; w.wz = w.rz = f.rz + Math.cos(f.hd) * 1; f.speed = 20;
  out.length = 0;
  const hitsBefore = RT.T.walkers.filter((e) => e === w).length;
  now += 60; say('p000000', 'state', { x: cx, y: 0, z: cz, r: 0, w: 0 });
  const body = out.find(([, m]) => m.s === 'corpse');
  check('a Ferrari through the crowd: a body on every screen, and the walker back in the crowd elsewhere', hitsBefore && body && body[0] === 'all' && body[1].p.id === '__room' && body[1].p.k === w.colr,
    body ? JSON.stringify(body[1].p) : 'no body');
}

//  one left: given back
out.length = 0;
keep(R.leave('p000001'));
const gave = out.find(([, m]) => m.s === 'own');
check('one left: the room gives the traffic back, with its last word on it', gave && gave[1].p.t === 0 && TF.fullOk(gave[1].p.tf) && !R.creatures.own.t, gave ? Object.keys(gave[1].p).join(', ') : 'nothing');

//  a host that never answers: the city's own
{
  const Q = new Relay({ moves: false });
  Q.join('p000000', 'Aki'); Q.join('p000001', 'Ben');
  let taken = false;
  for (let i = 0; i < 14 && !taken; i++) taken = Q.handle('p000000', JSON.stringify({ s: 'mob', p: { g: null } }), now + i).out.some(([, t]) => { const m = JSON.parse(t); return m.s === 'own' && m.p.t === 1; });
  check('a host whose game never sends its traffic: the room starts the city\'s own', taken && Q.creatures.own.t);
  const late = Q.handle('p000001', JSON.stringify({ s: 'tfull', p: TF.fullState(host) }), now + 20);
  check('and nobody but the host, asked, may hand the room a city', late.drop === 'refused tfull');
}

//  a room woken from sleep asks the host's game again for its traffic
{
  const W = new Relay({ moves: false });
  W.join('p000000', 'Aki'); W.join('p000001', 'Ben'); W.woke = true;
  const o = W.handle('p000001', JSON.stringify({ s: 'state', p: { x: 1, y: 0, z: 1 } }), now).out.map(([to, t]) => [to, JSON.parse(t)]);
  check('a room woken from sleep says it runs nothing yet, and asks the host\'s game again for its traffic',
    o.some(([to, m]) => m.s === 'own' && m.p.t === 0) && o.some(([to, m]) => to === 'p000000' && m.s === 'tq'));
}

console.log('\nTHE DAY SIDE\'S TRAFFIC — shared, and run by the room, in node\n');
console.log(results.join('\n'));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
