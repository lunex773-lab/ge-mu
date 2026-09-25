//  ============================================================
//  VECNA, run by the room  (node, with a clock of our own)
//  ============================================================
//  shared/vecna.js — how he arrives, wakes, watches, lifts the street and
//  circles it about him, commands and summons, walks in, strikes with the
//  wave, the arm, the thrown car and the grip, turns over through his phases,
//  blinks behind whoever shoots him from afar, and dies, whoever runs him —
//  and the room running him beside everything he commands (server/dogs.js)
//  with its own rules: taken over from the host, told to those over there,
//  every shot at him judged here, every blow and grip decided here (and the
//  player told how far he throws them, and that he has hold of them),
//  what he holds and throws told as it happens, given back — and what a
//  call costs.
//
//    node server/test/vecna.test.js

import VC from '../../shared/vecna.js';
import FL from '../../shared/flayers.js';
import GOR from '../../shared/gorgons.js';
import DOG from '../../shared/dogs.js';
import CITY from '../../shared/city.js';
import WR from '../../shared/wrecks.js';
import TF from '../../shared/traffic.js';
import RULES from '../../shared/rules.js';
import { Relay } from '../relay.js';
import { theCity } from '../combat.js';

const results = []; let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else fail++; results.push((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '\n         ' + detail : '')); }
const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;
const F = CITY.footprints(CITY.planBuildings());
function seeded(s) { return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
const L = CITY.lazyNear(theCity()), GD = CITY.ground(L.near, L.full);
const rayCity = (ro, rd, max) => CITY.rayLazy(theCity(), ro, rd, max);
//  a wide clear place, away from the middle, with wrecks about it
let ax = 0, az = 0;
const W0 = WR.makeWrecks(TF.makeTraffic({ now: () => 0 }).cars);
for (let x = 20; x < 200 && !ax; x += 3) for (let z = -60; z < 60; z += 3) {
  if (!F.clearAt(x, z, 14)) continue;
  if (W0.filter((w) => w && Math.hypot(w.x - x, w.z - z) < 40).length >= 3) { ax = x; az = z; break; }
}
if (!ax) for (let x = 20; x < 200 && !ax; x += 3) for (let z = -60; z < 60; z += 3) if (F.clearAt(x, z, 14)) { ax = x; az = z; break; }
const spotNear = (x, z, r, c = 1.6) => { for (let k = 0; k < 64; k++) { const a = k * 0.37, sx = x + Math.sin(a) * r, sz = z + Math.cos(a) * r; if (F.clearAt(sx, sz, c)) return { x: sx, z: sz }; } return null; };
//  (and one from which he can see the spot: nothing of the city between)
const inSight = (x, z, r, c = 1.6) => {
  for (let k = 0; k < 64; k++) {
    const a = k * 0.37, sx = x + Math.sin(a) * r, sz = z + Math.cos(a) * r;
    if (!F.clearAt(sx, sz, c)) continue;
    const o = { x: sx, y: VC.V_HEIGHT - 0.6, z: sz }, d = { x: x - sx, y: RULES.EYE - 0.5 - o.y, z: z - sz }, len = Math.hypot(d.x, d.y, d.z);
    d.x /= len; d.y /= len; d.z /= len;
    if (rayCity(o, d, len) >= len && WR.ray(W0, o, d) >= len) return { x: sx, z: sz };
  }
  return spotNear(x, z, r, c);
};

//  ---- VECNA himself (shared/vecna.js) --------------------------------------------------
let t = 0;
const me = { x: ax, z: az, y: 0, ey: RULES.EYE, dead: false, cloak: false, fx: 0, fz: -1, yaw: 0 };
const wr = WR.makeWrecks(TF.makeTraffic({ now: () => 0 }).cars);
const pack = [], gors = [], mfs = [];
const hits = [], grabs = [], lifts = [], ev = { phase: 0, whisper: 0, command: 0, blink: 0, death: 0, land: 0, gone: 0 };
let held = false;
const minion = (list, at) => { const o = { slot: list.length, live: true, dead: false, x: at ? at.x : 0, z: at ? at.z : 0, y: 0, st: 'wander', hasT: false, tx: 0, tz: 0, seeT: -99, tdist: 999, lord: null, lordSlot: -1 }; list.push(o); return o; };
const env = {
  now: () => t, random: seeded(3), targets: () => [me],
  clearAt: F.clearAt, supportHeight: GD.supportHeight, collide: GD.collide, rayCity, wrecks: () => wr,
  dogs: () => pack, gorgons: () => gors, flayers: () => mfs, spawnDog: () => minion(pack), spawnGorgon: (at) => minion(gors, at),
  hit: (v, tg, kind, dmg, ax2, az2, push, up, shake) => hits.push({ kind, dmg, push: +push.toFixed(2), up: +up.toFixed(2), shake }),
  grab: (v, tg) => { if (held) return false; held = true; grabs.push(Math.hypot(tg.x - v.x, tg.z - v.z)); return true; },
  held: () => held,
  release: () => { held = false; },
  on: { lift: (v, ks) => lifts.push(...ks), hurl: () => {}, charge: () => {}, wave: () => {}, limb: () => {}, psy: () => {},
    phase: () => ev.phase++, whisper: () => ev.whisper++, voice: () => {}, command: () => ev.command++, grew: () => {}, ordered: () => {},
    hurt: () => {}, blink: () => ev.blink++, death: () => ev.death++, fallen: () => {}, rift: () => {}, land: () => ev.land++, fly: () => {}, drop: () => {}, gone: () => ev.gone++ },
};
const V = VC.makeVecna(env), v = V.vec;
const run = (secs, each) => { for (let i = 0; i < secs * 20; i++) { t += 0.05; VC.flights(V, 0.05); VC.stock(V, 0.05); if (v.live) { VC.think(V, 0.05); VC.orbitStep(V, 0.05); VC.ease(V, 0.05); } if (each && each()) return; } };
let V0 = null;
{
  run(215);
  const d = v.live ? Math.hypot(v.x - me.x, v.z - me.z) : 0;
  check('he arrives, far off (150–330 m), and is in no hurry about it', v.live && d >= 150 && d <= 330 && v.st === 'dormant', v.live ? d.toFixed(0) + ' m off, ' + v.st : 'not yet');
  V.holdSpawn = true;
  //  set down 60 m from the player, facing them, a court about him
  const s0 = inSight(me.x, me.z, 60, 3);
  v.x = v.rx = s0.x; v.z = v.rz = s0.z; v.y = 0; v.hd = Math.atan2(me.x - v.x, me.z - v.z);
  for (let q = 0; q < 3; q++) { const s = spotNear(v.x, v.z, 30 + q * 5, 1.2); minion(pack, s); }
  mfs.push({ slot: 0, live: true, dead: false, x: v.x + 60, z: v.z, st: 'wander', hasT: false, lord: null, panicked: true });
  const seen = [];
  run(20, () => { if (seen[seen.length - 1] !== v.st) seen.push(v.st); return v.st === 'hunt' && ev.command > 0; });
  check('he wakes, watches, lifts the street, commands his court, and walks in', v.awake && seen.includes('observe') && seen.includes('manipulate') && ev.command > 0 && seen.includes('hunt'),
    seen.join(' → ') + '; lifted ' + lifts.length + '; ' + pack.filter((q) => q.lord === 'vec').length + ' dogs his; the flayer ' + (mfs[0].lord || '-'));
  check('the flayer near him is his, told where, and steadied', mfs[0].lord === 'vec' && mfs[0].hasT && !mfs[0].panicked);
  //  close: his arm
  const s1 = spotNear(v.x, v.z, 7, 1.2);
  me.x = s1.x; me.z = s1.z;
  v.atkCd = 0;
  run(12, () => hits.some((h) => h.kind === 'limb'));
  const limb = hits.find((h) => h.kind === 'limb');
  check('close, his arm: it lands, and throws the player back and up', limb && limb.dmg === VC.V_LIMB_DMG && limb.push > 0 && limb.up > 0, JSON.stringify(limb));
  //  the first phase turns over: a moment of quiet, then the wave
  v.atk = null; while (v.hp > VC.V_HP * 0.8) v.hp -= 50;
  VC.hurt(V, 20, me.x, me.z);
  run(0.1);
  check('cut past the first mark, the phase turns over (he stops, and bends the world)', v.phase === 1 && v.st === 'channel' && ev.phase === 1, v.st + ', phase ' + v.phase);
  const s2 = spotNear(v.x, v.z, 14, 1.2); me.x = s2.x; me.z = s2.z;
  run(20, () => hits.some((h) => h.kind === 'wave'));
  const wave = hits.find((h) => h.kind === 'wave');
  check('the wave: it lands on whoever is in reach, less at the edge, and throws them', wave && wave.dmg > 0 && wave.dmg <= VC.V_WAVE_DMG && wave.push > 0, JSON.stringify(wave));
  //  past the second: he takes hold of you
  v.atk = null; while (v.hp > VC.V_HP * 0.58) v.hp -= 50;
  VC.hurt(V, 20, me.x, me.z);
  run(3.2);
  const s3 = spotNear(v.x, v.z, 22, 1.2); me.x = s3.x; me.z = s3.z;
  v.hd = Math.atan2(me.x - v.x, me.z - v.z); v.atk = null; v.atkCd = 0;
  VC.startAtk(V, 'grab');
  run(3, () => grabs.length > 0);
  check('past the second mark, from across the street: he takes hold of the player', grabs.length === 1 && held, grabs.length ? grabs[0].toFixed(1) + ' m away' : 'no');
  held = false;
  //  in the window after a phase turns, a round is worth two and a half
  v.atk = null; v.vuln = 1;
  const hp0 = v.hp;
  VC.hurt(V, RULES.DMG, me.x, me.z);
  check('in the window he leaves, a round counts two and a half', Math.abs(hp0 - v.hp - RULES.DMG * 2.5) < 1e-6, (hp0 - v.hp) + '');
  v.vuln = 0;
  //  what he holds, he throws
  v.atk = null; v.orbit.length = 0;
  let k = -1;
  for (let q = 0; q < wr.length && k < 0; q++) if (wr[q] && !wr[q].held && Math.hypot(wr[q].x - v.x, wr[q].z - v.z) < 40 && Math.hypot(wr[q].x - me.x, wr[q].z - me.z) > 14) k = q;
  if (k < 0) for (let q = 0; q < wr.length && k < 0; q++) if (wr[q]) { k = q; wr[q].x = v.x + 12; wr[q].z = v.z; }
  v.hasT = true; v.tx = me.x; v.tz = me.z; v.seeT = t;
  const got = VC.lift(V, 1);
  run(1.2);
  const land0 = ev.land, w = wr[v.orbit.length ? v.orbit[0].k : k], wx0 = w.x, wz0 = w.z;
  v.atkCd = 0; VC.startAtk(V, 'hurl');
  run(6, () => ev.land > land0);
  check('what he lifts circles him, and he throws it: it comes down near the player', got === 1 && ev.land > land0 && Math.hypot(w.x - me.x, w.z - me.z) < 10 && !w.thrown && !w.held,
    'moved ' + Math.hypot(w.x - wx0, w.z - wz0).toFixed(1) + ' m, ' + Math.hypot(w.x - me.x, w.z - me.z).toFixed(1) + ' m from the player; ' + hits.filter((h) => h.kind === 'throw').length + ' hit by it');
  //  shot from far off: behind the shooter
  v.atk = null; v.blinkCd = 0;
  const far = spotNear(v.x + 130, v.z, 0, 4) || spotNear(v.x + 130, v.z, 8, 4);
  VC.hurt(V, RULES.DMG, far.x, far.z);
  check('shot from far off, he stops being over there: he is beside the shooter', ev.blink === 1 && Math.hypot(v.x - far.x, v.z - far.z) < 30, Math.hypot(v.x - far.x, v.z - far.z).toFixed(1) + ' m from them');
  //  carried on from another's word, holding and throwing
  VC.lift(V, 2);
  const w2 = wr.findIndex((q) => q && !q.held && !q.thrown);
  V.thrown.push({ k: w2, x: wr[w2].x, y: 6, z: wr[w2].z, vx: 4, vy: 3, vz: -1, spin: 1, roll: 0.2, t: 0.3, hit: 0, y0: 0, got: [] }); wr[w2].thrown = true;
  const f = VC.fullState(V);
  const H = VC.makeVecna(env);
  VC.adoptFull(H, JSON.parse(JSON.stringify(f)));
  const h = H.vec;
  check('carried on from another\'s word: where he was, as hurt, in the same phase, holding and throwing the same',
    VC.fullOk(f) && h.live && Math.abs(h.x - v.x) < 0.01 && Math.abs(h.hp - v.hp) < 0.1 && h.phase === v.phase && h.orbit.length === v.orbit.length && H.thrown.length === 1 && H.thrown[0].k === w2,
    JSON.stringify(f).length + ' bytes; ' + h.orbit.length + ' held, ' + H.thrown.length + ' in the air');
  V.thrown.length = 0; wr[w2].thrown = false;
  //  killed: what he held falls, and his own break
  mfs[0].panicked = false; mfs[0].st = 'track'; mfs[0].x = v.x + 30; mfs[0].z = v.z;
  held = true;
  while (!v.dead) VC.hurt(V, 400, me.x, me.z);
  check('killed: what he held drops out of the air, he lets go, and his own break and run', ev.death === 1 && v.orbit.length === 0 && !held && mfs[0].st === 'flee' && mfs[0].panicked,
    'the flayer ' + mfs[0].st);
  //  (for the room below: him standing somewhere, awake, a car or two about him)
  const V2 = VC.makeVecna(env);
  const s4 = spotNear(ax + 60, az, 0, 3) || spotNear(ax + 60, az, 6, 3);
  VC.spawnVecna(V2, s4);
  V0 = VC.fullState(V2);
}

//  ---- the room runs him, beside everything he commands (server/dogs.js) ---------------------
let now = 1_000_000;
const R = new Relay({ moves: false });
const out = [];
const keep = (o) => { for (const [to, text] of o || []) out.push([to, JSON.parse(text)]); };
const say = (id, s, p) => { const r = R.handle(id, JSON.stringify({ s, p }), now); keep(r.out); return r; };
const A = 'p000000', B = 'p000001';
const heal = (id) => { const pl = R.players.get(id); pl.hp = 100; pl.dead = false; pl.bittenT = 0; pl.clawedT = 0; };
keep(R.join(A, 'Aki'));
say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 });
keep(R.join(B, 'Ben'));
say(B, 'state', { x: ax - 40, y: 0, z: az, r: 0, w: 0 });
const C = R.creatures, RD = C.dogs;
out.length = 0;
//  the host's game hands him over — and a car it had moved
const wk = W0.findIndex((q) => q && Math.hypot(q.x - ax, q.z - az) > 80);
say(A, 'dfull', { k: [], g: [], f: { r: [], cd: 60000, t: null }, v: V0, w: [wk, Math.round((W0[wk].x + 5) * 10), Math.round(W0[wk].z * 10), 0, 0, 0] });
const rv = RD.vec;
check('two here: the room carries on from the host\'s VECNA, and knows where its cars lie', C.own.d && rv.live && Math.abs(rv.x - V0.v[0] / 100) < 0.01 && Math.abs(RD.wrecks[wk].x - (W0[wk].x + 5)) < 0.05,
  rv.live ? 'at ' + rv.x.toFixed(1) + ', ' + rv.z.toFixed(1) + ', hp ' + rv.hp : 'none');
RD.D.holdSpawn = true; RD.G.holdSpawn = true; RD.M.holdSpawn = true; RD.V.holdSpawn = true;
for (const d of RD.dogs) if (d.live) DOG.despawnDog(RD.D, d);
for (const g of RD.gorgons) if (g.live) GOR.despawnGorgon(RD.G, g);
for (let i = 0; i < 4; i++) { now += 60; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 }); }
const dv = out.filter(([, m]) => m.s === 'dv');
check('those over there are told him, as he is (his swing, his body, what he hunts), and the car where it lies; nobody else',
  dv.length >= 1 && dv.every(([to]) => to === A) && dv.every(([, m]) => Array.isArray(m.p.v) && m.p.v.length === VC.SNAP_N) && dv.some(([, m]) => Array.isArray(m.p.w) && m.p.w.includes(wk)),
  dv.length + ' words, to ' + [...new Set(dv.map(([to]) => to))].join(',') + '; v ' + dv.map(([, m]) => m.p.v ? m.p.v.length : m.p.v).join(',') + '; w ' + dv.map(([, m]) => m.p.w ? m.p.w.length : '-').join(','));
out.length = 0;
say(A, 'mob', { v: [1, 2, 3, 4, 5, 6, 7, 8], g: null });
check('the host\'s own VECNA is not passed on any more', out.find(([, m]) => m.s === 'mob')[1].p.v === undefined);

//  shots
const put = (x, z, keep) => { rv.x = rv.rx = x; rv.z = rv.rz = z; rv.y = GD.supportHeight(x, z, 1); if (!keep) rv.atk = null; };
const s5 = spotNear(ax, az, 30, 3);
put(s5.x, s5.z); rv.hp = VC.V_HP; rv.st = 'dormant'; rv.hasT = false; rv.awake = false; rv.vuln = 0; rv.blinkCd = 99;
now += 300; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 });
put(s5.x, s5.z);
out.length = 0;
say(A, 'vhit', { x: ax, z: az });
check('a shot at him in the open lands, for the gun\'s damage, and is not passed on', rv.hp === VC.V_HP - RULES.DMG && !out.some(([, m]) => m.s === 'vhit'),
  VC.V_HP + ' → ' + rv.hp + (R.lastRefusal ? '; last refused: ' + R.lastRefusal : ''));
now += 20; say(A, 'vhit', {});
check('the next, sooner than the gun can fire, does not', rv.hp === VC.V_HP - RULES.DMG && /faster than the gun/.test(R.lastRefusal), R.lastRefusal);
now += 300; say(B, 'vhit', {});
check('nor one from this side of the tear', rv.hp === VC.V_HP - RULES.DMG && /other side/.test(R.lastRefusal), R.lastRefusal);
now += 300; rv.vuln = 1; rv.atk = null; put(s5.x, s5.z); say(A, 'vhit', {});
check('and in his window, the room counts it two and a half', rv.hp === VC.V_HP - RULES.DMG * 3.5, rv.hp + '');
rv.vuln = 0;

//  his blows: the room decides them, and says how far they throw you
{
  now += 300; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 }); heal(A);
  const s6 = inSight(ax, az, 7, 1.2);
  const set = () => { put(s6.x, s6.z); rv.hd = Math.atan2(ax - rv.x, az - rv.z); rv.st = 'hunt'; rv.stT = 0; rv.atkCd = 0; rv.awake = true; rv.hasT = true; rv.tx = ax; rv.tz = az; rv.seeT = RD.t; rv.orbit.length = 0; };
  set();
  out.length = 0;
  let struck = null;
  for (let i = 0; i < 200 && !struck; i++) {
    if (i % 60 === 59) set();
    now += 50; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 }); heal(A);
    const b = out.find(([to, m]) => to === A && m.s === 'hp' && m.p.src === 'vec'); if (b) struck = b;
  }
  check('close by, his arm: the room decides it lands, and tells the player how far and how high it throws them', struck && Array.isArray(struck[1].p.kb) && struck[1].p.up > 0,
    struck ? JSON.stringify(struck[1].p) : 'no blow');
  now += 300; say(B, 'state', { x: ax - 40, y: 0, z: az, r: 0, w: 0 });
  const hpB = R.players.get(B).hp;
  for (let i = 0; i < 60; i++) { put(ax - 44, az); rv.st = 'hunt'; rv.atkCd = 0; now += 50; say(B, 'state', { x: ax - 40, y: 0, z: az, r: 0, w: 0 }); }
  check('nobody on this side of the tear is struck', R.players.get(B).hp === hpB);
}

//  his grip: the room says he has hold of the player, and does the harm the drag does
{
  heal(A);
  rv.phase = 2; rv.hp = VC.V_HP * 0.5;
  const s7 = inSight(ax, az, 22, 1.2);
  put(s7.x, s7.z); rv.hd = Math.atan2(ax - rv.x, az - rv.z); rv.st = 'hunt'; rv.awake = true; rv.hasT = true; rv.tx = ax; rv.tz = az; rv.seeT = RD.t;
  now += 60; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 });
  rv.atk = null; rv.atkCd = 99; VC.startAtk(RD.V, 'grab');
  out.length = 0;
  let gripped = null, hurt = null, t0 = now;
  for (let i = 0; i < 80 && !hurt; i++) {
    put(s7.x, s7.z, true);
    now += 50; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 });
    if (!gripped) { const g = out.find(([to, m]) => to === A && m.s === 'grip' && !m.p.off); if (g) { gripped = g; t0 = now; } }
    const hh = out.find(([to, m]) => to === A && m.s === 'hp' && m.p.src === 'vecgrip'); if (hh) hurt = hh;
  }
  check('past the second mark, he takes hold of the player from across the street: the room tells them so', gripped && Number.isFinite(gripped[1].p.x), gripped ? JSON.stringify(gripped[1].p) : 'no');
  check('and as he drags them in, the room does the harm (' + VC.V_GRAB_DMG + ')', hurt && hurt[1].p.hp === 100 - VC.V_GRAB_DMG && now - t0 >= 1700,
    hurt ? JSON.stringify(hurt[1].p) + ' ' + (now - t0) + ' ms in' : 'none');
  //  the wave breaks his grip: no harm after it
  heal(A); rv.atk = null; rv.atkCd = 99; VC.startAtk(RD.V, 'grab');
  out.length = 0;
  let g2 = false;
  for (let i = 0; i < 40 && !g2; i++) { put(s7.x, s7.z, true); now += 50; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 }); g2 = out.some(([to, m]) => to === A && m.s === 'grip' && !m.p.off); }
  RD.vblow(rv, RD.byId.get(A), 'wave', 10, 1, 3, 0);
  out.length = 0;
  for (let i = 0; i < 50; i++) { put(s7.x, s7.z); rv.atk = null; rv.atkCd = 99; now += 50; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 }); }
  check('his wave breaks his own grip: the drag does no harm after it', g2 && !out.some(([, m]) => m.s === 'hp' && m.p.src === 'vecgrip'));
  heal(A);
}

//  what he holds and throws: those over there are told it as it happens
{
  now += 300; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 }); heal(A);
  const s8 = inSight(ax, az, 30, 3);
  put(s8.x, s8.z); rv.atk = null; rv.orbit.length = 0; rv.atkCd = 99; rv.st = 'hunt';
  //  (a car lying beside him, far enough from the player)
  const k2 = RD.wrecks.findIndex((q, i) => q && !q.held && !q.thrown && i !== wk);
  const wq = RD.wrecks[k2]; wq.x = rv.x + 10; wq.z = rv.z; wq.y = 0;
  rv.hasT = true; rv.tx = ax; rv.tz = az; rv.seeT = RD.t;
  out.length = 0;
  const took = VC.lift(RD.V, 1), up = rv.orbit.length ? rv.orbit[0].k : -1;
  for (let i = 0; i < 20; i++) { put(s8.x, s8.z); now += 60; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 }); }
  //  (he may take up another of his own meanwhile: what he is told to hold is what he holds)
  const vo = out.filter(([, m]) => m.s === 'dv' && Array.isArray(m.p.vo)).map(([, m]) => m.p.vo).pop();
  const ks = vo ? vo.filter((q, i) => i % 7 === 0) : [];
  check('he takes a car up: those over there are told what he holds', took === 1 && vo && ks.includes(up) && vo.length === 7 * rv.orbit.length && rv.orbit.every((o) => ks.includes(o.k)), vo && JSON.stringify(vo));
  out.length = 0;
  rv.atkCd = 0; VC.startAtk(RD.V, 'hurl');
  let flew = 0, down = null;
  const kk = rv.orbit[0].k;
  for (let i = 0; i < 120 && !down; i++) {
    put(s8.x, s8.z, true); now += 50; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 }); heal(A);
    for (const [to, m] of out) if (to === A && m.s === 'dv') {
      if (Array.isArray(m.p.vf) && m.p.vf[0] === kk) flew++;
      const r = m.p.w || [];
      for (let j = 0; j + 5 < r.length; j += 6) if (r[j] === kk && r[j + 5] === 0 && flew) down = r.slice(j, j + 6);
    }
    out.length = 0;
  }
  const wk2 = RD.wrecks[kk];
  check('and throws it: those over there are told it in the air, then where it came down — where the room has it',
    flew >= 2 && down && Math.abs(down[1] / 10 - wk2.x) < 0.06 && Math.abs(down[2] / 10 - wk2.z) < 0.06 && !wk2.thrown && !wk2.held,
    flew + ' words of it in the air; down at ' + (down ? down.slice(1, 3).map((q) => q / 10).join(', ') : '-'));
}

//  his death, and he is gone
{
  heal(A);
  //  (the last round a player fires, as the room judges it)
  put(s5.x, s5.z); rv.hp = 5; rv.vuln = 0; rv.blinkCd = 99;
  RD.byId.get(A).pl.grip = { at: now, hurt: false };
  out.length = 0;
  now += 300; say(A, 'vhit', {});
  now += 60; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 });
  const dvD = out.filter(([, m]) => m.s === 'dv').map(([, m]) => m.p.v).pop();
  check('killed: everyone over there sees him fall, and whoever he held is let go', dvD && (dvD[5] & 1) && out.some(([to, m]) => to === A && m.s === 'grip' && m.p.off));
  for (let i = 0; i < 28 * 20; i++) { now += 50; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 }); }
  out.length = 0;
  now += 120; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 });
  const dvG = out.filter(([, m]) => m.s === 'dv').pop();
  check('and some while after, he is gone', !rv.live && dvG && dvG[1].p.v === null);
}

//  a minute of it: him, awake and hunting two players, his court and the pack about them — what a call costs
RD.D.holdSpawn = false; RD.G.holdSpawn = false;
VC.spawnVecna(RD.V, spotNear(ax, az, 40, 3));
Object.assign(rv, { awake: true, st: 'hunt', hasT: true, tx: ax, tz: az, seeT: RD.t, summonCd: 3 });
let worst = 0, sum = 0, n = 0, thrown = null, blows = 0;
const part = {};
try {
  for (let i = 0; i < 1200; i++) {
    now += 50;
    const t0 = process.hrtime.bigint();
    const k = i % 2, x = ax + Math.sin(i / 80) * 20, z = az + Math.cos(i / 80) * 20;
    out.length = 0;
    say(k ? B : A, 'state', k ? { x: x - 4, y: 0, z, r: 0, w: 1 } : { x, y: 0, z, r: 0, w: 1 });
    for (const [to, m] of out) {
      if (m.s === 'hp' && (m.p.src === 'vec' || m.p.src === 'vecgrip')) blows++;
      if (to === A && m.s === 'dv') for (const key in m.p) part[key] = (part[key] || 0) + JSON.stringify(m.p[key]).length / 60;
    }
    if (i % 40 === 0) say(A, 'shot', {});
    heal(A); heal(B); rv.hp = Math.max(rv.hp, VC.V_HP * 0.3);
    const d = ms(t0); worst = Math.max(worst, d); sum += d; n++;
  }
} catch (e) { thrown = e; }
check('a minute of him, his court and the pack on two players: no error, and no call near the 10 ms a call has', !thrown && worst < 9.5,
  (thrown ? thrown.message + ' ' : '') + 'each call ' + (sum / n).toFixed(3) + ' ms on average, ' + worst.toFixed(2) + ' ms at worst; ' + blows + ' blows and grips; phase ' + rv.phase + ', ' +
  RD.dogs.filter((d) => d.live && d.lord === 'vec').length + ' dogs and ' + RD.gorgons.filter((g) => g.live && g.lord === 'vec').length + ' gorgons his');
check('and what he costs to send: well under a kilobyte a second', (part.v || 0) + (part.vo || 0) + (part.vf || 0) < 900,
  Object.entries(part).map(([key, b]) => key + ' ' + Math.round(b) + ' B/s').join(', '));

//  one left: given back
out.length = 0;
keep(R.leave(B));
const gave = out.find(([, m]) => m.s === 'own');
check('one left: the room gives him back, with the rest of the other side and where the cars lie', gave && gave[1].p.d === 0 && VC.fullOk(gave[1].p.df.v) && gave[1].p.df.v.v && Array.isArray(gave[1].p.df.w) && gave[1].p.df.w.length > 0,
  gave && JSON.stringify(gave[1].p.df.v).length + ' bytes of him; ' + (gave[1].p.df.w.length / 6) + ' cars');

console.log('\nVECNA — shared, and run by the room, in node\n');
console.log(results.join('\n'));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);

