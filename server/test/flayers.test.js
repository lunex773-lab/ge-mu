//  ============================================================
//  The other side's mind flayers, run by the room  (node, with a clock of our own)
//  ============================================================
//  shared/flayers.js — how one arrives (never alone), finds you, closes,
//  strikes, stamps and throws a car, commands and bleeds through its escort,
//  breaks and walks off, and dies, whoever runs it — and the room running it
//  beside the dogs and gorgons it commands (server/dogs.js) with its own
//  rules: taken over from the host, told to those over there, every shot at
//  one judged here, every blow and every thrown car decided here (and the
//  player told how far it knocks them), the host's VECNA's orders made so,
//  given back — and what a call costs.
//
//    node server/test/flayers.test.js

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
const freshWrecks = () => WR.makeWrecks(TF.makeTraffic({ now: () => 0 }).cars);
//  a wide clear place, away from the middle
let ax = 0, az = 0;
for (let x = 20; x < 200 && !ax; x += 3) for (let z = -60; z < 60; z += 3) if (F.clearAt(x, z, 16)) { ax = x; az = z; break; }
//  a clear spot r m from (x, z)
const spotNear = (x, z, r, c = 1.6) => { for (let k = 0; k < 64; k++) { const a = k * 0.37, sx = x + Math.sin(a) * r, sz = z + Math.cos(a) * r; if (F.clearAt(sx, sz, c)) return { x: sx, z: sz }; } return null; };
//  a wreck out in the open, far from the middle, with a clear line of 50 m beside it
function openWreck(ws) {
  for (let k = 0; k < ws.length; k++) {
    const w = ws[k]; if (!w || Math.hypot(w.x, w.z) < 60) continue;
    for (let q = 0; q < 16; q++) {
      const a = q * 0.39, fx = w.x + Math.sin(a) * 10, fz = w.z + Math.cos(a) * 10, px = w.x - Math.sin(a) * 36, pz = w.z - Math.cos(a) * 36;
      if (F.clearAt(fx, fz, 3) && F.clearAt(px, pz, 2) && CITY.rayLazy(theCity(), { x: fx, y: 15, z: fz }, norm(px - fx, 1.1 - 15, pz - fz), Math.hypot(px - fx, 1.1 - 15, pz - fz)) > Math.hypot(px - fx, 1.1 - 15, pz - fz) - 1) return { k, fx, fz, px, pz };
    }
  }
  return null;
}
function norm(x, y, z) { const l = Math.hypot(x, y, z); return { x: x / l, y: y / l, z: z / l }; }

//  ---- the flayer itself (shared/flayers.js) -------------------------------------------
let t = 0;
const me = { x: ax, z: az, y: 0, ey: RULES.EYE, dead: false, cloak: false, fx: 0, fz: -1, yaw: 0 };
const pack = [], gors = [];
const hits = [], stomps = [], winds = [];
let summons = 0, far = 0, panics = 0, deaths = 0, lands = 0;
const wr = freshWrecks();
const minion = (list, at) => { const o = { slot: list.length, live: true, dead: false, x: at ? at.x : 0, z: at ? at.z : 0, y: 0, st: 'wander', hasT: false, tx: 0, tz: 0, seeT: -99, tdist: 999, lord: null, lordSlot: -1 }; list.push(o); return o; };
const env = {
  now: () => t, random: seeded(5), targets: () => [me],
  clearAt: F.clearAt, supportHeight: GD.supportHeight, rayCity, wrecks: () => wr, master: () => null,
  dogs: () => pack, gorgons: () => gors, spawnDog: () => minion(pack), spawnGorgon: (at) => minion(gors, at),
  hit: (m, tg, dmg, kb, ox, oz, shake) => hits.push({ by: m ? 'blow' : 'car', kind: m && m.atk ? m.atk.kind : '-', dmg, kb, shake }),
  stomp: (m, cx, cz, hs) => stomps.push({ cx, cz, hs: hs.map((h) => [h.dmg, +h.kb.toFixed(1)]) }),
  on: { roar: () => {}, summon: () => summons++, wind: (m, k) => winds.push(k), swing: () => {}, launch: () => {}, hold: () => {}, fly: () => {},
    land: () => lands++, drop: () => {}, far: () => far++, panic: () => panics++, hurt: () => {}, death: () => deaths++, rift: () => {}, gone: () => {} },
};
const M = FL.makeFlayers(env);
const run = (secs, each) => { for (let i = 0; i < secs * 20; i++) { t += 0.05; FL.flight(M, 0.05); FL.stock(M, 0.05); for (const m of M.flayers) if (m.live) FL.think(M, m, 0.05); if (each && each()) return; } };
let F0 = null;
{
  run(72);
  const m = M.flayers.find((o) => o.live);
  const d = m ? Math.hypot(m.x - me.x, m.z - me.z) : 0;
  const sworn = pack.filter((o) => o.lord === 'mf' && o.lordSlot === m.slot).length + gors.filter((o) => o.lord === 'mf' && o.lordSlot === m.slot).length;
  check('one arrives, far off (120–300 m) and never alone: its escort climbs out around it', m && d >= 120 && d <= 300 && sworn === FL.MF_ESC_DOG + FL.MF_ESC_GOR && summons === 1,
    m ? d.toFixed(0) + ' m off, ' + sworn + ' sworn to it' : 'none');
  M.holdSpawn = true;
  //  set on the player from 40 m, in the open: it answers, closes, and strikes
  const s0 = spotNear(me.x, me.z, 40, 3);
  m.x = m.rx = s0.x; m.z = m.rz = s0.z; m.y = 0; m.hd = Math.atan2(me.x - m.x, me.z - m.z); m.st = 'wander'; m.stT = 0; m.atkCd = 0; m.summonT = 999;
  run(40, () => hits.some((h) => h.by === 'blow' && h.kb > 0) || stomps.some((s) => s.hs.length));
  const blow = hits.find((h) => h.by === 'blow');
  check('set on the player from 40 m, it closes and strikes: the blow lands, and knocks them away', (blow && blow.kb > 0 && blow.shake > 0) || stomps.some((s) => s.hs.length),
    'winds ' + winds.join(',') + '; ' + JSON.stringify(blow || stomps.find((s) => s.hs.length)));
  //  a car: it picks one up and throws it at them
  const ow = openWreck(wr);
  m.atk = null; m.x = m.rx = ow.fx; m.z = m.rz = ow.fz; m.hd = Math.atan2(ow.px - ow.fx, ow.pz - ow.fz);
  me.x = ow.px; me.z = ow.pz;
  m.hasT = true; m.tx = me.x; m.tz = me.z; m.seeT = t; m.st = 'track'; m.atkCd = 99;
  const w = wr[ow.k], wx = w.x, wz = w.z, carHits = hits.filter((h) => h.by === 'car').length;
  m.holdW = ow.k; FL.startAtk(M, m, 'throw');
  let flew = false;
  run(8, () => { if (M.thrown) flew = true; return flew && !M.thrown; });
  const moved = Math.hypot(w.x - wx, w.z - wz), toMe = Math.hypot(w.x - me.x, w.z - me.z);
  check('it picks up a car and throws it: the car flies, comes down near the player, and lies there', flew && lands >= 1 && !w.thrown && moved > 20 && toMe < 8,
    'moved ' + moved.toFixed(1) + ' m, lies ' + toMe.toFixed(1) + ' m from them; ' + (hits.filter((h) => h.by === 'car').length - carHits) + ' hit by it');
  //  shot from far out of its sight: it sends everything, and comes itself
  me.x = ax; me.z = az;
  const d1 = minion(pack, { x: m.x + 40, z: m.z }); d1.st = 'wander';
  FL.hurt(M, m, RULES.DMG, m.x + 200, m.z);
  check('shot from far out of its sight: it comes, and sends the escort', m.st === 'track' && far === 1 && d1.st === 'chase' && d1.hasT && m.hp === FL.MF_HP - RULES.DMG, m.st + ', the dog ' + d1.st);
  //  its linked minions bleed into it — up to a point
  const hp1 = m.hp;
  FL.shareDamage(M, m.x + 10, m.z, 20);
  const one = hp1 - m.hp;
  for (let i = 0; i < 20; i++) FL.shareDamage(M, m.x + 10, m.z, 20);
  check('a linked minion hurt: a share of it reaches the flayer, and never more than ' + FL.MF_SHARE_S + ' a second', Math.abs(one - 20 * FL.MF_SHARE) < 1e-9 && Math.abs(hp1 - m.hp - FL.MF_SHARE_S) < 1e-6,
    one.toFixed(1) + ' for one; ' + (hp1 - m.hp).toFixed(1) + ' for twenty-one');
  //  under a third: it calls all it may, and walks off
  m.atk = null; m.st = 'track'; m.hp = FL.MF_HP * FL.MF_PANIC - 1; m.panicCd = 0; m.panicked = false;
  const s1 = summons;
  run(3);
  const fleeing = m.st === 'flee';
  const from = Math.hypot(m.x - me.x, m.z - me.z);
  run(8);
  check('under a third: it calls, then walks off — on its legs', panics === 1 && m.panicked && fleeing && Math.hypot(m.x - me.x, m.z - me.z) > from + 20,
    'summoned ' + (summons - s1) + ' more; ' + from.toFixed(0) + ' → ' + Math.hypot(m.x - me.x, m.z - me.z).toFixed(0) + ' m');
  //  carried on from another's word, a car in the air with it
  const w2 = wr.findIndex((q, k) => q && k !== ow.k && !q.thrown);
  M.thrown = { k: w2, x: wr[w2].x, y: 9, z: wr[w2].z, ty: 0, vx: 3, vy: 5, vz: -2, spin: 1, roll: 0.3, t: 0.4, hit: 0, got: [] }; wr[w2].thrown = true;
  const f = FL.fullState(M);
  const H = FL.makeFlayers(Object.assign({}, env, { wrecks: () => wr }));
  FL.adoptFull(H, JSON.parse(JSON.stringify(f)));
  const q = H.flayers[m.slot];
  check('carried on from another\'s word: where it was, as hurt, as broken, and the car still in the air', FL.fullOk(f) && q.live && Math.abs(q.x - m.x) < 0.01 && Math.abs(q.hp - m.hp) < 0.1 && q.panicked && q.st === m.st && H.thrown && H.thrown.k === w2 && Math.abs(H.thrown.vy - 5) < 0.01,
    JSON.stringify(f).length + ' bytes');
  M.thrown = null; wr[w2].thrown = false;
  //  killed: it lies there, and is cleared; its escort is let go
  while (!m.dead) FL.hurt(M, m, 400, me.x, me.z);
  run(23);
  check('killed, it lies there, is cleared after a while, and its escort is let go', deaths === 1 && !m.live && !pack.some((o) => o.lord === 'mf' && o.lordSlot === m.slot));
  //  (for the room below: one standing somewhere)
  const M2 = FL.makeFlayers(env);
  const s2 = spotNear(ax + 70, az, 0, 3) || spotNear(ax + 70, az, 6, 3);
  FL.spawnFlayer(M2, s2);
  F0 = FL.fullState(M2);
}

//  ---- the room runs it, beside the dogs and gorgons (server/dogs.js) -----------------------------
let now = 1_000_000;
const R = new Relay({ moves: false });
const out = [];
const keep = (o) => { for (const [to, text] of o || []) out.push([to, JSON.parse(text)]); };
const say = (id, s, p) => { const r = R.handle(id, JSON.stringify({ s, p }), now); keep(r.out); return r; };
const A = 'p000000', B = 'p000001';
const heal = (id) => { const v = R.players.get(id); v.hp = 100; v.dead = false; v.bittenT = 0; v.clawedT = 0; };
keep(R.join(A, 'Aki'));
say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 });
keep(R.join(B, 'Ben'));
say(B, 'state', { x: ax - 40, y: 0, z: az, r: 0, w: 0 });
const C = R.creatures, RD = C.dogs;
out.length = 0;
say(A, 'dfull', { k: [], g: [], f: F0 });
check('two here: the room carries on from the host\'s flayer, with its dogs and gorgons', C.own.d && RD.flayers.filter((m) => m.live).length === 1 && Math.abs(RD.flayers.find((m) => m.live).x - F0.r[1] / 100) < 0.01,
  RD.flayers.filter((m) => m.live).length + ' flayer taken');
RD.D.holdSpawn = true; RD.G.holdSpawn = true; RD.M.holdSpawn = true;
for (const d of RD.dogs) if (d.live) DOG.despawnDog(RD.D, d);
for (const g of RD.gorgons) if (g.live) GOR.despawnGorgon(RD.G, g);
out.length = 0;
for (let i = 0; i < 4; i++) { now += 60; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 }); }
const dv = out.filter(([, m]) => m.s === 'dv');
check('those over there are told every flayer, as it is (its swing, its gaze, what it hunts), nobody else', dv.length >= 1 && dv.every(([to]) => to === A) && dv.every(([, m]) => Array.isArray(m.p.f) && m.p.f.length === FL.SNAP_N));
out.length = 0;
say(A, 'mob', { f: [0, 1, 2, 3, 4, 5, 6], g: null });
check('the host\'s own flayers are not passed on any more', out.find(([, m]) => m.s === 'mob')[1].p.f === undefined);

//  shots
const mf = RD.flayers.find((m) => m.live);
const put = (m, x, z) => { m.x = m.rx = x; m.z = m.rz = z; m.y = GD.supportHeight(x, z, 1); m.atk = null; };
const s3 = spotNear(ax, az, 30, 3);
put(mf, s3.x, s3.z); mf.hp = FL.MF_HP; mf.st = 'wander'; mf.hasT = false; mf.summonT = 999; mf.escorted = true;
now += 300; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 });
put(mf, s3.x, s3.z);
out.length = 0;
say(A, 'mfhit', { i: mf.slot, x: ax, z: az });
check('a shot at a flayer in the open lands, for the gun\'s damage, and is not passed on', mf.hp === FL.MF_HP - RULES.DMG && !out.some(([, m]) => m.s === 'mfhit'),
  FL.MF_HP + ' → ' + mf.hp + (R.lastRefusal ? '; last refused: ' + R.lastRefusal : ''));
now += 20; say(A, 'mfhit', { i: mf.slot });
check('the next, sooner than the gun can fire, does not', mf.hp === FL.MF_HP - RULES.DMG && /faster than the gun/.test(R.lastRefusal), R.lastRefusal);
now += 300; say(B, 'mfhit', { i: mf.slot });
check('nor one from this side of the tear', mf.hp === FL.MF_HP - RULES.DMG && /other side/.test(R.lastRefusal), R.lastRefusal);
{
  put(mf, -300, -300);                    // (it stands over anything)
  now += 300; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 });
  say(A, 'mfhit', { i: mf.slot });
  check('nor one from beyond the gun\'s reach (' + RULES.MAX_RANGE + ' m)', mf.hp === FL.MF_HP - RULES.DMG && /out of range/.test(R.lastRefusal), R.lastRefusal + ', at ' + Math.hypot(mf.x - ax, mf.z - az).toFixed(0) + ' m');
}

//  its blows: the room decides them, and says how far they knock you
{
  now += 300; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 }); heal(A);
  const s5 = spotNear(ax, az, 14, 3);
  put(mf, s5.x, s5.z); mf.hd = Math.atan2(ax - mf.x, az - mf.z); mf.hp = FL.MF_HP; mf.st = 'track'; mf.stT = 0; mf.atkCd = 0;
  mf.hasT = true; mf.tx = ax; mf.tz = az; mf.seeT = RD.t; mf.panicked = false;
  out.length = 0;
  let struck = null; const kinds = [];
  for (let i = 0; i < 400 && !struck; i++) {
    now += 50; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 });
    if (mf.atk && !kinds.includes(mf.atk.kind)) kinds.push(mf.atk.kind);
    const b = out.find(([to, m]) => to === A && m.s === 'hp' && m.p.src === 'mf' && Array.isArray(m.p.kb)); if (b) struck = b;
    heal(A);
  }
  check('close by, it strikes, and the room decides it lands: the player is told it was the flayer, and how far it knocks them', struck && struck[1].p.kb[2] > 0 && Number.isFinite(struck[1].p.sh),
    'swings ' + kinds.join(',') + (struck ? ', told ' + JSON.stringify(struck[1].p) : ''));
  const fr = out.filter(([, m]) => m.s === 'dv').map(([, m]) => m.p.f).find((f) => f && f[7] > 0);
  check('and those over there see the swing (which, how far into it)', fr && FL.ATK_KINDS[fr[7] - 1] && fr[8] >= 0, fr && FL.ATK_KINDS[fr[7] - 1] + ' at ' + fr[8] / 100 + ' s');
  now += 300; say(B, 'state', { x: ax - 40, y: 0, z: az, r: 0, w: 0 });
  const hpB = R.players.get(B).hp;
  for (let i = 0; i < 60; i++) { put(mf, ax - 45, az); mf.st = 'track'; mf.atkCd = 0; now += 50; say(B, 'state', { x: ax - 40, y: 0, z: az, r: 0, w: 0 }); }
  check('nobody on this side of the tear is struck', R.players.get(B).hp === hpB);
  heal(A);
}

//  a car: thrown in the room, seen by everyone over there, lying where the room says
{
  const ow = openWreck(RD.wrecks);
  now += 300; say(A, 'state', { x: ow.px, y: 0, z: ow.pz, r: 0, w: 1 }); heal(A);
  for (let i = 0; i < 3; i++) { now += 60; say(A, 'state', { x: ow.px, y: 0, z: ow.pz, r: 0, w: 1 }); }
  put(mf, ow.fx, ow.fz); mf.hd = Math.atan2(ow.px - ow.fx, ow.pz - ow.fz);
  mf.hasT = true; mf.tx = ow.px; mf.tz = ow.pz; mf.seeT = RD.t; mf.st = 'track'; mf.atkCd = 99;
  const w = RD.wrecks[ow.k], wx = w.x, wz = w.z;
  mf.holdW = ow.k; FL.startAtk(RD.M, mf, 'throw');
  out.length = 0;
  //  (the host's VECNA does not get to move it while it is the flayer's)
  now += 50; say(A, 'state', { x: ow.px, y: 0, z: ow.pz, r: 0, w: 1 });
  say(A, 'dord', { o: [['w', ow.k, Math.round((wx + 30) * 10), Math.round(wz * 10), 0, 0]] });
  const kept = Math.hypot(w.x - wx - 30, w.z - wz) > 5;
  let flew = 0, landed = null;
  for (let i = 0; i < 120 && !landed; i++) {
    now += 50; say(A, 'state', { x: ow.px, y: 0, z: ow.pz, r: 0, w: 1 }); heal(A);
    for (const [to, m] of out) if (to === A && m.s === 'dv') {
      if (m.p.fly && m.p.fly[0] === ow.k) flew++;
      const r = m.p.w || [];
      for (let j = 0; j + 5 < r.length; j += 6) if (r[j] === ow.k && r[j + 5] === 0 && flew) landed = r.slice(j, j + 6);
    }
    out.length = 0;
  }
  check('a car in a flayer\'s hand is its own: VECNA\'s word does not move it', kept);
  check('it throws the car: those over there are told it in the air, then where it came down — where the room has it', flew >= 3 && landed && Math.abs(landed[1] / 10 - w.x) < 0.06 && Math.abs(landed[2] / 10 - w.z) < 0.06 && Math.hypot(w.x - wx, w.z - wz) > 20 && !w.thrown,
    flew + ' words of it in the air; down at ' + (landed ? landed.slice(1, 3).map((v) => v / 10).join(', ') : '-') + ', ' + Math.hypot(w.x - wx, w.z - wz).toFixed(1) + ' m from where it lay');
  out.length = 0;
  for (let i = 0; i < 12; i++) { now += 60; say(A, 'state', { x: ow.px, y: 0, z: ow.pz, r: 0, w: 1 }); }
  const again = out.filter(([, m]) => m.s === 'dv' && Array.isArray(m.p.w) && m.p.w.includes(ow.k));
  check('and it is said again with every whole word, for whoever crosses later', again.length >= 1);
}

//  the host's VECNA: his orders to it
{
  const mob = () => say(A, 'mob', { v: [Math.round((mf.x + 50) * 10), Math.round(mf.z * 10), 0, 1500, 1, 2, 0, 0], g: null });
  now += 300; mob(); say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 });
  mf.lord = null; mf.panicked = true; mf.atk = null; mf.st = 'flee'; mf.fleeT = 20;
  say(A, 'dord', { o: [['fl', mf.slot, 2, -1], ['ft', mf.slot, Math.round(ax * 10), Math.round(az * 10), 0], ['fk', mf.slot, 0], ['fs', mf.slot, FL.MF_ST.indexOf('track')]] });
  check('VECNA takes it, hands it his target, steadies it and turns it round', mf.lord === 'vec' && mf.hasT && Math.abs(mf.tx - ax) < 0.1 && !mf.panicked && mf.st === 'track', mf.lord + ' ' + mf.st + (mf.panicked ? ' panicked' : ''));
  const f0 = out.filter(([, m]) => m.s === 'dv').length;
  now += 150; mob(); say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 });
  const fr = out.filter(([, m]) => m.s === 'dv').slice(f0).map(([, m]) => m.p.f).pop();
  check('and everyone over there sees it wear his colours', fr && (fr[6] & 4), fr && 'marks ' + fr[6]);
  say(A, 'dord', { o: [['fl', mf.slot, 1, 0]] });
  check('a flayer is nobody\'s but VECNA\'s', mf.lord === 'vec');
  mf.atk = null;
  say(A, 'dord', { o: [['fs', mf.slot, FL.MF_ST.indexOf('flee'), 300], ['fk', mf.slot, 1]] });
  check('he falls: it breaks, and walks off for as long as it is told', mf.st === 'flee' && Math.abs(mf.fleeT - 30) < 0.01 && mf.panicked, mf.st + ' ' + mf.fleeT);
  mf.st = 'track'; mf.panicked = false;
}

//  a minute of it, two players over there, the flayer, its escort and the dogs on them: what a call costs
RD.D.holdSpawn = false; RD.G.holdSpawn = false;
mf.hp = FL.MF_HP; mf.escorted = false; mf.summonT = 5; mf.lord = null;
put(mf, s3.x, s3.z);
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
      if (m.s === 'hp' && m.p.src === 'mf') blows++;
      if (to === A && m.s === 'dv') for (const key in m.p) part[key] = (part[key] || 0) + JSON.stringify(m.p[key]).length / 60;
    }
    if (i % 40 === 0) say(A, 'shot', {});
    heal(A); heal(B);
    const d = ms(t0); worst = Math.max(worst, d); sum += d; n++;
  }
} catch (e) { thrown = e; }
check('a minute of a flayer, its escort and the pack on two players: no error, and no call near the 10 ms a call has', !thrown && worst < 9.5,
  (thrown ? thrown.message + ' ' : '') + 'each call ' + (sum / n).toFixed(3) + ' ms on average, ' + worst.toFixed(2) + ' ms at worst; ' + blows + ' blows landed; ' +
  RD.dogs.filter((d) => d.live && !d.dead && d.lord === 'mf').length + ' dogs and ' + RD.gorgons.filter((g) => g.live && !g.dead && g.lord === 'mf').length + ' gorgons sworn to it');
check('and what the flayer costs to send: a few hundred bytes a second', (part.f || 0) + (part.fly || 0) + (part.w || 0) < 600,
  Object.entries(part).map(([key, b]) => key + ' ' + Math.round(b) + ' B/s').join(', '));

//  one left: given back
out.length = 0;
keep(R.leave(B));
const gave = out.find(([, m]) => m.s === 'own');
check('one left: the room gives it back, with the dogs and gorgons', gave && gave[1].p.d === 0 && FL.fullOk(gave[1].p.df.f) && gave[1].p.df.f.r.length === FL.FULL_N, gave && (gave[1].p.df.f.r.length / FL.FULL_N + ' flayer'));

console.log('\nTHE OTHER SIDE\'S MIND FLAYERS — shared, and run by the room, in node\n');
console.log(results.join('\n'));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
