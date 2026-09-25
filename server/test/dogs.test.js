//  ============================================================
//  The other side's dogs, run by the room  (node, with a clock of our own)
//  ============================================================
//  shared/dogs.js — how the dogs stock the district, hear, see, hunt, bite,
//  break off and die, whoever runs them — and server/dogs.js with the room's
//  own rules (relay.js): taken over from the host, told to those over there
//  and nobody else, every shot at a dog judged here, the bites decided here,
//  the host's flayers' and VECNA's orders made so, given back — and what a
//  call costs.
//
//    node server/test/dogs.test.js

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
const L = CITY.lazyNear(theCity()), G = CITY.ground(L.near, L.full);
const wrecks = WR.makeWrecks(TF.makeTraffic({ now: () => 0 }).cars);
//  a clear spot out in the street, away from the middle
let ax = 0, az = 0;
for (let x = 20; x < 200 && !ax; x += 3) for (let z = -60; z < 60; z += 3) if (F.clearAt(x, z, 12)) { ax = x; az = z; break; }

//  ---- the dogs themselves (shared/dogs.js) -----------------------------------------
let D0 = null;
{
  let t = 0;
  const me = { x: ax, z: az, y: 0, ey: RULES.EYE, dead: false, cloak: false, fx: 0, fz: -1 };
  let bites = 0, calls = 0, deaths = 0;
  const D = DOG.makeDogs({
    now: () => t, random: seeded(7), targets: () => [me],
    clearAt: F.clearAt, supportHeight: G.supportHeight, collide: G.collide, bldAt: G.bldAt, navNext: G.navNext,
    rayCity: (ro, rd, max) => CITY.rayLazy(theCity(), ro, rd, max), wrecks: () => wrecks,
    master: () => null, gorgons: () => [], vec: () => null,
    bite: (d) => { if (d.tdist < DOG.D_BITE_R) bites++; },
    on: { call: () => calls++, hurt: () => {}, death: () => deaths++, gone: () => {}, share: () => {} },
  });
  const run = (secs) => { for (let i = 0; i < secs * 20; i++) { t += 0.05; DOG.stock(D, 0.05); for (const d of D.dogs) if (d.live) { if (d.rise < 1) d.rise = Math.min(1, d.rise + 0.05 / DOG.D_RISE_T); DOG.tick(D, d, 0.05); } } };
  run(3);
  const up = D.dogs.filter((d) => d.live && !d.dead);
  const close = up.filter((d) => Math.hypot(d.x - me.x, d.z - me.z) < DOG.D_KEEP).length;
  const quarters = new Set(up.map((d) => (d.x > 0 ? 1 : 0) + (d.z > 0 ? 2 : 0))).size;
  //  (four at a time until eight short, then one every few seconds: shared/dogs.js stock)
  check('the district is stocked in a few seconds: across the whole map, none on top of the player', up.length >= DOG.NDOG - 2 - 8 && close === 0 && quarters === 4,
    up.length + ' up, in ' + quarters + ' quarters; ' + close + ' within ' + DOG.D_KEEP + ' m of the player');
  run(20);
  const inWall = D.dogs.filter((d) => d.live && d.inB === false && !F.clearAt(d.x, d.z, -0.5)).length;
  const out = D.dogs.filter((d) => d.live && (Math.abs(d.x) > RULES.WORLD * 0.48 || Math.abs(d.z) > RULES.WORLD * 0.48)).length;
  check('they walk the district: none lost in a wall or off the edge', inWall === 0 && out === 0, inWall + ' in a wall, ' + out + ' off the edge');
  //  a shot: those in earshot come to see
  DOG.noise(D, me.x, me.z, 1.0, 'shot');
  let heard = 0;
  for (let i = 0; i < 20; i++) { run(0.1); heard = Math.max(heard, D.dogs.filter((d) => d.live && (d.st === 'investigate' || d.st === 'alert' || d.st === 'chase')).length); }
  check('a shot: the dogs in earshot come to see what it was', heard >= 1, heard + ' investigating');
  //  one close by, facing the player: it sees, closes, and bites
  const d = up[0];
  d.x = d.rx = me.x + 6; d.z = d.rz = me.z; d.y = 0; d.hd = Math.atan2(me.x - d.x, me.z - d.z); d.st = 'wander'; d.stT = 9; d.atkCd = 0;
  const b0 = bites;
  for (let i = 0; i < 60 && bites === b0; i++) run(0.1);
  check('one close by sees the player, closes in, and bites', bites > b0 && d.hasT, 'bitten ' + (bites - b0) + ' time(s); it is ' + d.st);
  //  hurt, it breaks off; killed, it lies there, and is cleared
  DOG.hurt(D, d, RULES.DMG, me.x, me.z);
  check('hurt, it breaks off rather than charging', d.hp === DOG.DOG_HP - RULES.DMG && (d.st === 'retreat' || d.st === 'reposition'), d.st);
  while (!d.dead) DOG.hurt(D, d, RULES.DMG, me.x, me.z);
  run(10);
  check('killed, it lies there, and is cleared after a while', deaths === 1 && !d.live);
  //  carried on from another's word
  const f = DOG.fullState(D);
  const E = DOG.makeDogs(D.env);
  DOG.adoptFull(E, f);
  const same = E.dogs.filter((q) => q.live).every((q) => { const o = D.dogs[q.slot]; return Math.abs(o.x - q.x) < 0.01 && Math.abs(o.z - q.z) < 0.01 && o.st === q.st && o.hp === q.hp && o.lord === q.lord; });
  check('carried on from another\'s word: the same dogs, where they were, doing what they were', DOG.fullOk(f) && same && E.dogs.filter((q) => q.live).length === D.dogs.filter((q) => q.live).length,
    E.dogs.filter((q) => q.live).length + ' dogs, ' + JSON.stringify(f).length + ' bytes');
  D0 = f;
}

//  ---- the room runs them (server/dogs.js) --------------------------------------------
let now = 1_000_000;
const R = new Relay({ moves: false });
const out = [];
const keep = (o) => { for (const [to, text] of o || []) out.push([to, JSON.parse(text)]); };
const say = (id, s, p) => { const r = R.handle(id, JSON.stringify({ s, p }), now); keep(r.out); return r; };
const A = 'p000000', B = 'p000001';
//  back on their feet (the dogs may have had them down while a scene was set up)
const heal = (id) => { const v = R.players.get(id); v.hp = 100; v.dead = false; v.bittenT = 0; };
keep(R.join(A, 'Aki'));
say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 });
keep(R.join(B, 'Ben'));
say(B, 'state', { x: ax - 40, y: 0, z: az, r: 0, w: 0 });
const C = R.creatures, RD = C.dogs;
check('two here: the room asks the host\'s game for its dogs', out.some(([to, m]) => to === A && m.s === 'dq') && C.taking.d === 1);
out.length = 0;
say(A, 'dfull', D0);
const own = out.find(([, m]) => m.s === 'own');
check('… carries on from them, and says so', own && own[1].p.d === 1 && C.own.d && RD.dogs.filter((d) => d.live).length === D0.k.length / DOG.FULL_N,
  RD.dogs.filter((d) => d.live).length + ' dogs taken');
out.length = 0;
for (let i = 0; i < 16; i++) { now += 60; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 }); }
const dv = out.filter(([, m]) => m.s === 'dv');
check('those over there are told the pack, nobody else', dv.length >= 1 && dv.every(([to]) => to === A) && dv.some(([, m]) => m.p.kf === 1 && m.p.k.length === RD.dogs.filter((d) => d.live).length * 7),
  dv.length + ' words, to ' + [...new Set(dv.map(([to]) => to))].join(','));
out.length = 0;
say(A, 'mob', { k: [1, 2, 3, 4, 5, 6, 7], kf: 1, g: null });
const passed = out.find(([, m]) => m.s === 'mob');
check('the host\'s own dogs are not passed on any more', passed && passed[1].p.k === undefined);

//  shots
const dog = RD.dogs.find((d) => d.live && !d.dead);
const put = (d, x, z) => { d.x = d.rx = x; d.z = d.rz = z; d.y = 0; d.rise = 1; };
put(dog, ax + 10, az); dog.hp = DOG.DOG_HP; dog.st = 'wander'; dog.stT = 0;
now += 300; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 });
put(dog, ax + 10, az);
out.length = 0;
say(A, 'dhit', { i: dog.slot, x: ax, z: az });
check('a shot at a dog in the open lands, for the gun\'s damage, and is not passed on', dog.hp === DOG.DOG_HP - RULES.DMG && !out.some(([, m]) => m.s === 'dhit'),
  DOG.DOG_HP + ' → ' + dog.hp + (R.lastRefusal ? '; last refused: ' + R.lastRefusal : ''));
now += 20;
say(A, 'dhit', { i: dog.slot });
check('the next, sooner than the gun can fire, does not', dog.hp === DOG.DOG_HP - RULES.DMG && /faster than the gun/.test(R.lastRefusal), R.lastRefusal);
now += 300;
say(B, 'dhit', { i: dog.slot });
check('nor one from this side of the tear', dog.hp === DOG.DOG_HP - RULES.DMG && /other side/.test(R.lastRefusal), R.lastRefusal);
let hid = null;
for (let r = 16; r < 90 && !hid; r += 2) for (let k = 0; k < 24 && !hid; k++) {
  const x = dog.x + Math.sin(k / 24 * 6.2832) * r, z = dog.z + Math.cos(k / 24 * 6.2832) * r;
  if (!F.clearAt(x, z, 0.6)) continue;
  const ro = { x, y: RULES.EYE, z }, dx = dog.x - x, dy = 1 - RULES.EYE, dz = dog.z - z, d = Math.hypot(dx, dy, dz);
  if (CITY.rayLazy(theCity(), ro, { x: dx / d, y: dy / d, z: dz / d }, d) < d - 6) hid = { x, z };
}
now += 300; say(A, 'state', { x: hid.x, y: 0, z: hid.z, r: 0, w: 1 });
put(dog, ax + 10, az);
const before = dog.hp;
say(A, 'dhit', { i: dog.slot });
check('nor one through a building', dog.hp === before && /line of sight/.test(R.lastRefusal), R.lastRefusal);

//  bites: the room decides them
{
  now += 300; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 });
  heal(A);
  const d = RD.dogs.find((q) => q.live && !q.dead && q !== dog);
  //  (alone with the player: with others about, the pack may send them in instead and this one hang back and watch)
  for (const q of RD.dogs) if (q.live && q !== d && Math.hypot(q.x - ax, q.z - az) < 120) DOG.despawnDog(RD.D, q);
  RD.D.holdSpawn = true;
  put(d, ax + 3, az); d.hd = Math.atan2(ax - d.x, az - d.z); d.hp = DOG.DOG_HP; d.st = 'wander'; d.stT = 9; d.atkCd = 0; d.lord = null;
  out.length = 0;
  let bitten = null;
  const seen = [];
  for (let i = 0; i < 200 && !bitten; i++) {
    now += 50; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 });
    const b = out.find(([to, m]) => to === A && m.s === 'hp' && m.p.src === 'dog'); if (b) bitten = b;
    if (seen[seen.length - 1] !== d.st) seen.push(d.st);
  }
  const va = R.players.get(A);
  check('a dog close by closes in and bites: the room takes 9 off, and tells the player it was a dog', bitten && va.hp === 100 - DOG.D_BITE_DMG,
    'hp ' + va.hp + (va.dead ? ' (down)' : '') + ', the dog ' + seen.join(' → ') + '; ' + d.tdist.toFixed(1) + ' m, sees ' + d.see.toFixed(2) + ', bite ready in ' + d.atkCd.toFixed(1) + ' s, bit ' + d.bit + ', A bitten ' + ((va.bittenT || 0) - now) + ' ms from now');
  //  nobody on this side of the tear is bitten
  now += 300; say(B, 'state', { x: ax - 40, y: 0, z: az, r: 0, w: 0 });
  const hpB = R.players.get(B).hp;
  for (let i = 0; i < 60; i++) { put(d, ax - 39, az); d.st = 'attack'; d.stT = 0.2; d.bit = false; now += 50; say(B, 'state', { x: ax - 40, y: 0, z: az, r: 0, w: 0 }); }
  check('nobody on this side of the tear is bitten', R.players.get(B).hp === hpB);
  heal(A); RD.D.holdSpawn = false;
}

//  the host's flayer and VECNA: where they stand, their orders
{
  now += 300; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 });
  const fx = ax + 30, fz = az;
  const HDQ = 255 / 6.2832;
  const mob = () => say(A, 'mob', { f: [0, Math.round(fx * 10), Math.round(fz * 10), 0, 900, 1, 0], v: [Math.round((ax - 50) * 10), Math.round(az * 10), Math.round(1 * HDQ), 1500, 1, 2, 0, 0], q: [0, Math.round((ax + 5) * 10), Math.round((az + 60) * 10), 0, 300, 1, 8 | 16], g: null });
  mob();
  check('the host\'s flayer, VECNA and gorgon, from its snapshot', RD.mf[0] && Math.abs(RD.mf[0].x - fx) < 0.1 && RD.vec && RD.vec.awake && RD.gors.length === 1 && RD.gors[0].lord === 'vec');
  const d = RD.dogs.find((q) => q.live && !q.dead && q.slot !== dog.slot);
  put(d, fx + 8, fz); d.st = 'wander'; d.lord = null;
  //  (nothing it knows of the players: with nothing to hunt, an escort keeps station)
  for (const q of RD.dogs) q.hasT = false;
  for (const pk of RD.D.packs) pk.tT = -99;
  say(A, 'dord', { o: [['l', d.slot, 1, 0], ['s', d.slot, DOG.D_ST.indexOf('escort')]] });
  let escorts = 0;
  for (let i = 0; i < 40; i++) { now += 50; mob(); say(A, 'state', { x: ax - 200, y: 0, z: az, r: 0, w: 1 }); if (d.st === 'escort') escorts++; }
  check('claimed by the host\'s flayer: it is the flayer\'s, and keeps station on it', d.lord === 'mf' && d.lordSlot === 0 && escorts > 30 && Math.hypot(d.x - fx, d.z - fz) < 30,
    d.lord + ' ' + d.st + ', ' + Math.hypot(d.x - fx, d.z - fz).toFixed(1) + ' m from it');
  out.length = 0;
  say(A, 'dord', { o: [['t', d.slot, Math.round(ax * 10), Math.round(az * 10), 5]] });
  check('handed a target: it knows where', d.hasT && Math.abs(d.tx - ax) < 0.1 && RD.t - d.seeT > 0.4);
  //  (a full district has no room for more — as in the game: a few far off are let go first)
  for (const q of RD.dogs.filter((q) => q.live && !q.lord && Math.hypot(q.x - fx, q.z - fz) > 100).slice(0, 4)) DOG.despawnDog(RD.D, q);
  const n0 = RD.dogs.filter((q) => q.live).length;
  const spots = [];
  for (let k = 0; k < 64 && spots.length < 5; k++) { const x = fx + Math.sin(k * 0.7) * (12 + k * 0.3), z = fz + Math.cos(k * 0.7) * (12 + k * 0.3); if (F.clearAt(x, z, 1.4)) spots.push([x, z]); }
  say(A, 'dord', { o: spots.map(([x, z]) => ['n', Math.round(x * 10), Math.round(z * 10), 1, 0, 0, 0, 0, 0, DOG.D_ST.indexOf('escort')]) });
  const sworn = RD.dogs.filter((q) => q.live && !q.dead && q.lord === 'mf' && q.lordSlot === 0);
  check('summoned: the flayer\'s retinue is made up to ' + DOG.RETINUE.mf + ', no more, each climbing out', sworn.length === DOG.RETINUE.mf && RD.dogs.filter((q) => q.live).length - n0 <= DOG.RETINUE.mf && sworn.some((q) => q.rise < 1),
    sworn.length + ' sworn to it');
  out.length = 0;
  now += 600; mob(); say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 });
  const dk = out.find(([to, m]) => to === A && m.s === 'dk');
  check('the host\'s game is told what the dogs know (its flayer and VECNA learn through them)', dk && Array.isArray(dk[1].p.k) && dk[1].p.k.length % 4 === 0 && dk[1].p.k.length > 0, dk && (dk[1].p.k.length / 4 + ' dogs with a target'));
  //  a dog linked to the flayer, shot: the flayer bleeds
  put(d, fx + 5, fz); d.hp = DOG.DOG_HP;
  now += 300; say(A, 'state', { x: fx + 15, y: 0, z: fz, r: 0, w: 1 });
  put(d, fx + 5, fz);
  out.length = 0;
  say(A, 'dhit', { i: d.slot });
  const sh = out.find(([to, m]) => to === A && m.s === 'dshare');
  check('a dog within the flayer\'s link, shot: the host\'s game is told, so the flayer bleeds too', sh && sh[1].p.d === RULES.DMG, JSON.stringify(sh && sh[1].p));
  //  a gorgon moves them on; VECNA's carry
  const g0 = RD.dogs.find((q) => q.live && !q.dead && !q.lord);
  put(g0, ax + 5 + 6, az + 60); g0.st = 'wander';
  const gx0 = g0.x;
  for (let i = 0; i < 10; i++) { now += 50; mob(); say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 }); }
  check('a gorgon moves them on (the host\'s, from its snapshot)', g0.x > gx0 + 0.05 || g0.st === 'alert', (g0.x - gx0).toFixed(2) + ' m, ' + g0.st);
  say(A, 'dord', { o: [['p', g0.slot, Math.round(ax * 10), Math.round((az + 1000) * 10)]] });
  check('carried into a wall or off the map: not moved', Math.abs(g0.z - (az + 1000)) > 100);
}

//  when nobody is over there: no dogs, and nothing sent
{
  now += 300; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 0 });
  out.length = 0;
  for (let i = 0; i < 6; i++) { now += 60; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 0 }); }
  check('nobody over there: the district is emptied, and nothing is sent', !RD.dogs.some((d) => d.live) && !out.some(([, m]) => m.s === 'dv'));
  now += 60; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 });
  for (let i = 0; i < 40; i++) { now += 50; say(A, 'state', { x: ax, y: 0, z: az, r: 0, w: 1 }); }
  check('someone crosses: it is stocked again in a couple of seconds', RD.dogs.filter((d) => d.live).length >= DOG.NDOG - 2 - 8, RD.dogs.filter((d) => d.live).length + ' up');
}

//  a minute of it, two players over there, the dogs on them: what a call costs
let worst = 0, sum = 0, n = 0, thrown = null, bytes0 = RD.bytes;
try {
  for (let i = 0; i < 1200; i++) {
    now += 50;
    const t0 = process.hrtime.bigint();
    const k = i % 2, x = ax + Math.sin(i / 80) * 20, z = az + Math.cos(i / 80) * 20;
    say(k ? B : A, 'state', k ? { x: x - 4, y: 0, z, r: 0, w: 1 } : { x, y: 0, z, r: 0, w: 1 });
    if (i % 40 === 0) say(A, 'shot', {});
    heal(A); R.players.get(B).hp = 100;
    const d = ms(t0); worst = Math.max(worst, d); sum += d; n++;
  }
} catch (e) { thrown = e; }
const engaged = RD.dogs.filter((d) => d.live && !d.dead && (d.st === 'chase' || d.st === 'attack' || d.st === 'reposition' || d.st === 'observe')).length;
check('a minute of the pack on two players: no error, and no call near the 10 ms a call has', !thrown && worst < 9.5,
  (thrown ? thrown.message + ' ' : '') + 'each call ' + (sum / n).toFixed(3) + ' ms on average, ' + worst.toFixed(2) + ' ms at worst; ' + engaged + ' dogs on them at the end; the room built ' + theCity().built() + ' insides');
check('and what it sends: a few KB a second to each over there', (RD.bytes - bytes0) / 60 / 2 < 8000, ((RD.bytes - bytes0) / 60 / 2 / 1024).toFixed(2) + ' KB/s each');

//  one left: given back
out.length = 0;
keep(R.leave(B));
const gave = out.find(([, m]) => m.s === 'own');
check('one left: the room gives the dogs back, with its last word on them', gave && gave[1].p.d === 0 && DOG.fullOk(gave[1].p.df) && !C.own.d, gave && (gave[1].p.df.k.length / DOG.FULL_N + ' dogs'));

//  a room woken from sleep says it runs nothing yet, and asks again
{
  const W = new Relay({ moves: false });
  W.join(A, 'Aki'); W.join(B, 'Ben'); W.woke = true;
  const wr = W.handle(A, JSON.stringify({ s: 'state', p: { x: 1, y: 0, z: 1, w: 1 } }), now).out.map(([to, t]) => [to, JSON.parse(t)]);
  const wo = wr.find(([, m]) => m.s === 'own');
  check('woken from sleep, the room says it runs no dogs yet, and asks the host again', wo && wo[1].p.d === 0 && wr.some(([to, m]) => to === A && m.s === 'dq'));
  let taken = false;
  for (let i = 0; i < 14 && !taken; i++) { const o = W.handle(A, JSON.stringify({ s: 'mob', p: { g: null } }), now + i).out.map(([, t]) => JSON.parse(t)); taken = o.some((m) => m.s === 'own' && m.p.d === 1); }
  check('… and with no answer from the host, it starts its own', taken && W.creatures.own.d);
}

console.log('\nTHE OTHER SIDE\'S DOGS — shared, and run by the room, in node\n');
console.log(results.join('\n'));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
