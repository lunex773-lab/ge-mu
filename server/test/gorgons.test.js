//  ============================================================
//  The other side's demogorgons, run by the room  (node, with a clock of our own)
//  ============================================================
//  shared/gorgons.js — how they stock the district, find you, close, go
//  round, swing, rage and die, whoever runs them — and the room running them
//  beside the dogs (server/dogs.js) with its own rules: taken over from the
//  host, told to those over there, every shot at one judged here, every
//  swing's hit decided here, the room's own flayer commanding them and the
//  host's VECNA's orders made so, given back — and what a call costs.
//
//    node server/test/gorgons.test.js

import GOR from '../../shared/gorgons.js';
import DOG from '../../shared/dogs.js';
import FL from '../../shared/flayers.js';
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
const wrecks = WR.makeWrecks(TF.makeTraffic({ now: () => 0 }).cars);
let ax = 0, az = 0;
for (let x = 20; x < 200 && !ax; x += 3) for (let z = -60; z < 60; z += 3) if (F.clearAt(x, z, 14)) { ax = x; az = z; break; }
//  a clear spot r m from (x, z)
const spotNear = (x, z, r) => { for (let k = 0; k < 48; k++) { const a = k * 0.4, sx = x + Math.sin(a) * r, sz = z + Math.cos(a) * r; if (F.clearAt(sx, sz, 1.6)) return { x: sx, z: sz }; } return null; };

//  ---- the gorgons themselves (shared/gorgons.js) ---------------------------------------
let G0 = null;
{
  let t = 0;
  const me = { x: ax, z: az, y: 0, ey: RULES.EYE, dead: false, cloak: false, fx: 0, fz: -1, yaw: 0 };
  const swings = [], hits = [];
  let roars = 0, deaths = 0, noises = [];
  const G = GOR.makeGorgons({
    now: () => t, random: seeded(11), targets: () => [me],
    clearAt: F.clearAt, supportHeight: GD.supportHeight, collide: GD.collide, navNext: GD.navNext,
    rayCity: (ro, rd, max) => CITY.rayLazy(theCity(), ro, rd, max), wrecks: () => wrecks,
    master: () => null, vec: () => null, noises: () => noises,
    claw: (g, kind, reach, dmg) => { if (g.tdist < reach) { hits.push([kind, dmg]); return true; } return false; },
    on: { wind: (g, k) => swings.push(k), swing: () => {}, growl: () => {}, roar: () => roars++, hurt: () => {}, death: () => deaths++, gone: () => {}, share: () => {} },
  });
  const run = (secs) => { for (let i = 0; i < secs * 20; i++) { t += 0.05; GOR.stock(G, 0.05); for (const g of G.gorgons) if (g.live) { if (g.rise < 1) g.rise = Math.min(1, g.rise + 0.05 / GOR.G_RISE_T); GOR.think(G, g, 0.05); } } };
  run(40);
  const up = G.gorgons.filter((g) => g.live && !g.dead);
  let close = 0, together = 0;
  for (const g of up) { if (Math.hypot(g.x - me.x, g.z - me.z) < GOR.G_KEEP) close++; for (const o of up) if (o !== g && Math.hypot(o.x - g.x, o.z - g.z) < 60) together++; }
  check('the district is stocked with a handful, kept apart, none on top of the player', up.length === GOR.GOR_WILD && close === 0,
    up.length + ' up; ' + close + ' within ' + GOR.G_KEEP + ' m of the player; ' + together / 2 + ' pairs within 60 m of each other');
  //  one set on the player from 25 m: it sees, closes, swings, and the swing lands
  const g = up[0];
  const s0 = spotNear(me.x, me.z, 25);
  g.x = g.rx = s0.x; g.z = g.rz = s0.z; g.y = 0; g.hd = Math.atan2(me.x - g.x, me.z - g.z); g.st = 'wander'; g.stT = 0; g.atkCd = 0;
  for (const o of up) if (o !== g) { o.x = o.rx = -o.x; }
  for (let i = 0; i < 200 && !hits.length; i++) run(0.1);
  check('one close by finds the player, closes in, winds up, and its swing lands', hits.length > 0 && g.hasT, 'swings ' + swings.join(',') + '; landed ' + JSON.stringify(hits));
  //  shot from across the street: it breaks off and goes round
  g.atk = null; g.st = 'chase'; g.stT = 0; g.flankCd = 0; g.enraged = false;
  GOR.hurt(G, g, RULES.DMG, g.x + 30, g.z);
  check('shot from across the street, it breaks off and goes round', g.st === 'flank' && g.hp === GOR.GOR_HP - RULES.DMG, g.st);
  //  hurt to under a third: it rages
  while (g.hp > GOR.GOR_HP * GOR.G_ENRAGE + 1) g.hp -= 20;
  GOR.hurt(G, g, RULES.DMG, me.x, me.z);
  check('hurt to under a third, it rages', g.enraged && g.st === 'enrage' && roars === 1);
  while (!g.dead) GOR.hurt(G, g, RULES.DMG, me.x, me.z);
  run(16);
  check('killed, it lies there, and is cleared after a while', deaths === 1 && !g.live);
  //  carried on from another's word
  const f = GOR.fullState(G);
  const H = GOR.makeGorgons(G.env);
  GOR.adoptFull(H, f);
  const same = H.gorgons.filter((q) => q.live).every((q) => { const o = G.gorgons[q.slot]; return Math.abs(o.x - q.x) < 0.01 && Math.abs(o.z - q.z) < 0.01 && Math.abs(o.hp - q.hp) < 0.1 && o.enraged === q.enraged && o.lord === q.lord; });
  check('carried on from another\'s word: the same gorgons, where they were, as hurt and as angry', GOR.fullOk(f) && same && H.gorgons.filter((q) => q.live).length === G.gorgons.filter((q) => q.live).length,
    H.gorgons.filter((q) => q.live).length + ' gorgons, ' + JSON.stringify(f).length + ' bytes');
  G0 = f;
}

//  ---- the room runs them, beside the dogs (server/dogs.js) --------------------------------
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
say(A, 'dfull', { k: [], g: G0 });
check('two here: the room carries on from the host\'s gorgons, with its dogs', C.own.d && RD.gorgons.filter((g) => g.live).length === G0.length / GOR.FULL_N,
  RD.gorgons.filter((g) => g.live).length + ' gorgons taken');
//  (the room's dogs held off, for a quiet street)
RD.D.holdSpawn = true;
out.length = 0;
for (let i = 0; i < 4; i++) { now += 60; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 }); }
const dv = out.filter(([, m]) => m.s === 'dv');
check('those over there are told every gorgon, nobody else', dv.length >= 1 && dv.every(([to]) => to === A) && dv.every(([, m]) => Array.isArray(m.p.q) && m.p.q.length === RD.gorgons.filter((g) => g.live).length * 7));
RD.M.holdSpawn = true;                     // (no flayer of the room's own until one is wanted, below)
out.length = 0;
say(A, 'mob', { q: [1, 2, 3, 4, 5, 6, 7], g: null });
check('the host\'s own gorgons are not passed on any more', out.find(([, m]) => m.s === 'mob')[1].p.q === undefined);

//  shots
const gg = RD.gorgons.find((g) => g.live && !g.dead);
const put = (g, x, z) => { g.x = g.rx = x; g.z = g.rz = z; g.y = 0; g.rise = 1; g.atk = null; };
put(gg, ax + 12, az); gg.hp = GOR.GOR_HP; gg.st = 'wander'; gg.enraged = false;
now += 300; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 });
put(gg, ax + 12, az);
out.length = 0;
say(A, 'ghit', { i: gg.slot, x: ax, z: az });
check('a shot at a gorgon in the open lands, for the gun\'s damage, and is not passed on', gg.hp === GOR.GOR_HP - RULES.DMG && !out.some(([, m]) => m.s === 'ghit'),
  GOR.GOR_HP + ' → ' + gg.hp + (R.lastRefusal ? '; last refused: ' + R.lastRefusal : ''));
now += 20; say(A, 'ghit', { i: gg.slot });
check('the next, sooner than the gun can fire, does not', gg.hp === GOR.GOR_HP - RULES.DMG && /faster than the gun/.test(R.lastRefusal), R.lastRefusal);
now += 300; say(B, 'ghit', { i: gg.slot });
check('nor one from this side of the tear', gg.hp === GOR.GOR_HP - RULES.DMG && /other side/.test(R.lastRefusal), R.lastRefusal);

//  swings: the room decides them
{
  now += 300; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 }); heal(A);
  for (const g of RD.gorgons) if (g.live && g !== gg && Math.hypot(g.x - ax, g.z - az) < 150) GOR.despawnGorgon(RD.G, g);
  RD.G.holdSpawn = true;
  const s0 = spotNear(ax, az, 3);
  put(gg, s0.x, s0.z); gg.hd = Math.atan2(ax - gg.x, az - gg.z); gg.hp = GOR.GOR_HP; gg.st = 'chase'; gg.stT = 0; gg.atkCd = 0; gg.hasT = true; gg.tx = ax; gg.tz = az; gg.seeT = RD.t;
  out.length = 0;
  let struck = null, kinds = [];
  for (let i = 0; i < 200 && !struck; i++) {
    now += 50; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 });
    if (gg.atk && !kinds.includes(gg.atk.kind)) kinds.push(gg.atk.kind);
    const b = out.find(([to, m]) => to === A && m.s === 'hp' && (m.p.src === 'gor' || m.p.src === 'gorpred')); if (b) struck = b;
  }
  const va = R.players.get(A);
  check('a gorgon close by swings, and the room decides it lands: the player is told it was a gorgon', struck && va.hp < 100 && va.hp >= 100 - GOR.G_PRED_DMG * 1.25,
    'hp ' + va.hp + ', swings ' + kinds.join(',') + (struck ? ', told ' + JSON.stringify(struck[1].p) : ''));
  now += 300; say(B, 'state', { x: ax - 40, y: 0, z: az, r: 0, w: 0 });
  const hpB = R.players.get(B).hp;
  for (let i = 0; i < 60; i++) { put(gg, ax - 39, az); gg.st = 'chase'; gg.atkCd = 0; now += 50; say(B, 'state', { x: ax - 40, y: 0, z: az, r: 0, w: 0 }); }
  check('nobody on this side of the tear is struck', R.players.get(B).hp === hpB);
  heal(A);
}

//  the room's own flayer, commanding them; the host's VECNA's orders
{
  now += 300; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 });
  const fx = ax + 40, fz = az;
  const mob = () => say(A, 'mob', { v: [Math.round((ax - 60) * 10), Math.round(az * 10), 0, 1500, 1, 2, 0, 0], g: null });
  mob();
  for (const g of RD.gorgons) if (g.live) GOR.despawnGorgon(RD.G, g);
  const mf = FL.spawnFlayer(RD.M, { x: fx, z: fz });
  const still = () => { mf.x = mf.rx = fx; mf.z = mf.rz = fz; mf.hasT = false; mf.st = 'wander'; mf.wx = fx; mf.wz = fz; mf.wanderT = 99; mf.summonT = 999; mf.escorted = true; mf.atk = null; };
  still();
  const s1 = spotNear(fx, fz, 14);
  const g1 = GOR.spawnGorgon(RD.G, s1);
  g1.hasT = false;
  let escorts = 0;
  for (let i = 0; i < 60; i++) { now += 50; mob(); still(); g1.hasT = false; say(A, 'state', { x: ax - 250, y: 0, z: az, r: 0, w: 1 }); if (g1.st === 'escort') escorts++; }
  check('the room\'s flayer claims one loose near it: it is the flayer\'s, and keeps station on it', g1.lord === 'mf' && g1.lordSlot === mf.slot && escorts > 30 && Math.hypot(g1.x - fx, g1.z - fz) < 40,
    g1.lord + ' ' + g1.st + ', ' + Math.hypot(g1.x - fx, g1.z - fz).toFixed(1) + ' m from it');
  say(A, 'dord', { o: [['gt', g1.slot, Math.round(ax * 10), Math.round(az * 10), 5]] });
  check('VECNA hands one a target: it knows where', g1.hasT && Math.abs(g1.tx - ax) < 0.1);
  FL.summon(RD.M, mf, 0, 4);
  const sworn = RD.gorgons.filter((g) => g.live && !g.dead && g.lord === 'mf' && g.lordSlot === mf.slot);
  check('the flayer summons: its gorgons are made up to ' + GOR.RETINUE.mf + ', no more, each climbing out', sworn.length === GOR.RETINUE.mf && sworn.some((g) => g.rise < 1), sworn.length + ' sworn to it');
  out.length = 0;
  now += 600; mob(); say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 });
  const dk = out.find(([to, m]) => to === A && m.s === 'dk');
  check('the host\'s game is told what the gorgons know (VECNA learns through them)', dk && Array.isArray(dk[1].p.g) && dk[1].p.g.length >= 4, dk && (dk[1].p.g.length / 4 + ' gorgons with a target'));
  //  one linked to the flayer, shot: the flayer bleeds, here
  still();
  put(g1, fx + 8, fz); g1.hp = GOR.GOR_HP;
  now += 300; say(A, 'state', { x: fx + 20, y: 0, z: fz, r: 0, w: 1 });
  put(g1, fx + 8, fz);
  const hp0 = mf.hp;
  out.length = 0;
  say(A, 'ghit', { i: g1.slot });
  check('a gorgon within the flayer\'s link, shot: the flayer bleeds a share, in the room', Math.abs(hp0 - mf.hp - RULES.DMG * FL.MF_SHARE) < 0.01 && !out.some(([, m]) => m.s === 'dshare'), hp0 + ' → ' + mf.hp);
  FL.despawnFlayer(RD.M, mf);
  //  VECNA keeps his ground clear of them
  const g2 = sworn.find((g) => g !== g1) || g1;
  put(g2, ax - 60 + 5, az); g2.st = 'wander'; g2.lord = null;
  for (let i = 0; i < 6; i++) { now += 50; mob(); say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 }); }
  check('and VECNA\'s ground is kept clear of them', Math.hypot(g2.x - (ax - 60), g2.z - az) >= DOG.V_CLEAR - 0.5, Math.hypot(g2.x - (ax - 60), g2.z - az).toFixed(1) + ' m from him');
  RD.G.holdSpawn = false;
}

//  a minute of it, two players over there, dogs and gorgons on them: what a call costs
RD.D.holdSpawn = false;
let worst = 0, sum = 0, n = 0, thrown = null;
try {
  for (let i = 0; i < 1200; i++) {
    now += 50;
    const t0 = process.hrtime.bigint();
    const k = i % 2, x = ax + Math.sin(i / 80) * 20, z = az + Math.cos(i / 80) * 20;
    say(k ? B : A, 'state', k ? { x: x - 4, y: 0, z, r: 0, w: 1 } : { x, y: 0, z, r: 0, w: 1 });
    if (i % 40 === 0) say(A, 'shot', {});
    heal(A); heal(B);
    const d = ms(t0); worst = Math.max(worst, d); sum += d; n++;
  }
} catch (e) { thrown = e; }
check('a minute of dogs and gorgons on two players: no error, and no call near the 10 ms a call has', !thrown && worst < 9.5,
  (thrown ? thrown.message + ' ' : '') + 'each call ' + (sum / n).toFixed(3) + ' ms on average, ' + worst.toFixed(2) + ' ms at worst; ' +
  RD.gorgons.filter((g) => g.live && !g.dead).length + ' gorgons, ' + RD.dogs.filter((d) => d.live && !d.dead).length + ' dogs up');

//  one left: given back
out.length = 0;
keep(R.leave(B));
const gave = out.find(([, m]) => m.s === 'own');
check('one left: the room gives them back, the gorgons with the dogs', gave && gave[1].p.d === 0 && GOR.fullOk(gave[1].p.df.g) && gave[1].p.df.g.length > 0, gave && (gave[1].p.df.g.length / GOR.FULL_N + ' gorgons'));

console.log('\nTHE OTHER SIDE\'S DEMOGORGONS — shared, and run by the room, in node\n');
console.log(results.join('\n'));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
