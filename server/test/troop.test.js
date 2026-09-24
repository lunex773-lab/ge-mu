//  ============================================================
//  The monkey troop, run by the room  (node, with a clock of our own)
//  ============================================================
//  shared/troop.js — how the troop walks, eats and rages, whoever runs it —
//  and server/troop.js with the room's own rules (relay.js): taken over from
//  the host, every shot at a monkey judged here, who took one down, the
//  bodies players' games throw, given back — and what a call costs.
//
//    node server/test/troop.test.js

import TROOP from '../../shared/troop.js';
import CITY from '../../shared/city.js';
import RULES from '../../shared/rules.js';
import { Relay } from '../relay.js';

const results = []; let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else fail++; results.push((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '\n         ' + detail : '')); }
const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;
const F = CITY.footprints(CITY.planBuildings());
function seeded(s) { return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }

//  ---- the troop itself (shared/troop.js) ----------------------------------------
{
  let t = 0, who = { x: 0, z: 0 }, woke = 0, calmed = 0, turned = 0;
  const T = TROOP.makeTroop({ now: () => t, nearest: () => who, spot: () => ({ x: who.x + 25, z: who.z }),
    onWake: () => woke++, onCalm: () => calmed++, onEnrage: () => turned++ }, null, null, seeded(9));
  check('a troop: ' + TROOP.NUM + ' on the streets, ' + TROOP.POOL + ' in reserve', T.monkeys.length === TROOP.NUM + TROOP.POOL && T.monkeys.filter(TROOP.inPlay).length === TROOP.NUM);
  //  two minutes of walking the pavements
  let inside = 0, moved = 0;
  const start = T.monkeys.slice(0, TROOP.NUM).map((m) => [m.wx, m.wz]);
  for (let i = 0; i < 2400; i++) {
    t += 0.05;
    for (const m of T.monkeys) if (TROOP.inPlay(m)) { TROOP.stepMonkey(T, m, 0.05); if (i > 200 && !F.clearAt(m.wx, m.wz, 0)) inside++; }
  }
  T.monkeys.slice(0, TROOP.NUM).forEach((m, k) => { if (Math.hypot(m.wx - start[k][0], m.wz - start[k][1]) > 20) moved++; });
  check('left alone, they walk the pavements (never into a building)', inside === 0 && moved >= TROOP.NUM * 0.7, moved + ' of ' + TROOP.NUM + ' walked on; ' + inside + ' steps inside a building');

  //  a body in the street: the nearest go and eat it, and it is gone
  const m0 = T.monkeys[0], { c } = TROOP.corpseSlot(T, 77);
  TROOP.placeCorpse(c, 77, m0.wx + 6, m0.wz, 0, 0, 5, false);
  let eaten = false, feeders = 0;
  for (let i = 0; i < 1200 && !eaten; i++) {
    t += 0.05; TROOP.assignFeeders(T);
    for (const m of T.monkeys) if (TROOP.inPlay(m)) TROOP.stepMonkey(T, m, 0.05);
    feeders = Math.max(feeders, T.monkeys.filter((m) => m.eating).length);
    if (!TROOP.stepCorpse(T, c, 0.05, true)) eaten = true;
  }
  check('a body in the street: the nearest go and eat it, and it is gone', eaten && feeders >= 1 && !c.active && !T.monkeys.some((m) => m.feedC === c), feeders + ' eating at once');

  //  a shot: the whole troop turns; the reserve comes; it runs at the players; it calms
  who = { x: m0.wx + 30, z: m0.wz };
  const hp0 = m0.hp;
  TROOP.hurt(T, m0, RULES.DMG);
  check('a shot: it is hurt, and the whole troop turns, once', m0.hp === hp0 - RULES.DMG && T.rageT === TROOP.RAGE_TIME && turned === 1 && T.monkeys.filter(TROOP.inPlay).every((m) => m.aggro));
  TROOP.hurt(T, T.monkeys[1], RULES.DMG);
  check('hitting them again does not restart the clock', turned === 1 && T.rageT === TROOP.RAGE_TIME);
  const d0 = Math.hypot(m0.wx - who.x, m0.wz - who.z);
  for (let i = 0; i < 40; i++) { t += 0.05; TROOP.stepRage(T, 0.05); for (const m of T.monkeys) if (TROOP.inPlay(m)) TROOP.stepMonkey(T, m, 0.05); }
  check('the reserve comes round the corner, and they run at the nearest player', woke >= TROOP.POOL && Math.hypot(m0.wx - who.x, m0.wz - who.z) < d0 - 5,
    woke + ' woken; ' + d0.toFixed(1) + ' m → ' + Math.hypot(m0.wx - who.x, m0.wz - who.z).toFixed(1) + ' m');
  const down = T.monkeys[2];
  while (TROOP.inPlay(down)) TROOP.hurt(T, down, RULES.DMG);
  let back = false, took = 0;
  for (let i = 0; i < 400 && !back; i++) { t += 0.05; took += 0.05; if (down.hp <= 0 && (down.corpseT > 0 || !down.deadFx)) TROOP.fallen(down, 0.05); TROOP.stepRage(T, 0.05); back = down.hp > 0; }
  check('one taken down gets back up in a rage, once its body has gone', back && took >= TROOP.BODY_TIME - 0.1, 'after ' + took.toFixed(1) + ' s');
  for (let i = 0; i < 1300; i++) { t += 0.05; TROOP.stepRage(T, 0.05); }
  check('a minute later it calms: the reserve goes, the rest walk on', T.rageT <= 0 && calmed === TROOP.POOL && T.monkeys.every((m) => !m.aggro) && T.monkeys.filter(TROOP.inPlay).length === TROOP.NUM - 0,
    T.monkeys.filter(TROOP.inPlay).length + ' in play');

  //  what everyone is told, and carrying on from it
  const snap = TROOP.troopArrays(T);
  const U = TROOP.makeTroop({ now: () => t, nearest: () => null, spot: () => null });
  TROOP.adopt(U, snap.m, snap.c, snap.r);
  const same = JSON.stringify(TROOP.troopArrays(U).m) === JSON.stringify(snap.m);
  //  (walking on from where each stands: a second later none has jumped anywhere)
  let stays = 0, far = 0;
  for (let i = 0; i < 20; i++) { t += 0.05; for (const m of U.monkeys) if (TROOP.inPlay(m)) TROOP.stepMonkey(U, m, 0.05); }
  U.monkeys.forEach((m, k) => { if (!TROOP.inPlay(m)) return; const d = Math.hypot(m.wx - T.monkeys[k].wx, m.wz - T.monkeys[k].wz); far = Math.max(far, d); if (d < 6.5) stays++; });
  check('a troop carried on from another\'s word: the same monkeys, where they were, walking on from there', same && stays === U.monkeys.filter(TROOP.inPlay).length,
    stays + ' of ' + U.monkeys.filter(TROOP.inPlay).length + ' within 6.5 m (a second at a run) of where they were a second later (the furthest ' + far.toFixed(1) + ' m)');
}

//  ---- the room runs it (server/troop.js) ------------------------------------------
let now = 1_000_000;
const R = new Relay({ moves: false });
const out = [];
const keep = (o) => { for (const [to, text] of o || []) out.push([to, JSON.parse(text)]); };
const say = (id, s, p) => { const r = R.handle(id, JSON.stringify({ s, p }), now); keep(r.out); return r; };
keep(R.join('p000000', 'Aki'));
//  the host has been running the troop: its snapshot, with one monkey near where Aki stands
const host = TROOP.makeTroop({ now: () => 0, nearest: () => null, spot: () => null });
let ax = 0, az = 0;
for (let x = -150; x < 150 && !ax; x += 3) for (let z = -150; z < 150; z += 3) if (F.clearAt(x, z, 14)) { ax = x; az = z; break; }
const mk = host.monkeys[3]; mk.wx = ax + 8; mk.wz = az;
const hs = TROOP.troopArrays(host);
say('p000000', 'state', { x: ax, y: 0, z: az, r: 0, w: 0 });
keep(R.join('p000001', 'Ben'));
say('p000001', 'state', { x: ax - 3, y: 0, z: az + 2, r: 0, w: 0 });
out.length = 0;
say('p000000', 'mob', { m: hs.m, c: hs.c, r: 0, g: null });
const own = out.find(([, m]) => m.s === 'own');
const C = R.creatures, RT = C.troop;
check('two here: the room takes the troop from the host\'s word, and says so', own && own[1].p.m === 1 && C.own.m && RT.T.monkeys[3].wx === ax + 8, JSON.stringify(own && own[1].p));
out.length = 0;
say('p000000', 'mob', { m: hs.m, c: hs.c, r: 0 });
const passed = out.find(([, m]) => m.s === 'mob');
check('and the host\'s own troop is not passed on after that', passed && passed[1].p.m === undefined && passed[1].p.r === undefined);
out.length = 0;
now += 150; say('p000001', 'state', { x: ax - 3, y: 0, z: az + 2, r: 0, w: 0 });
const sv = out.find(([, m]) => m.s === 'sv');
check('everyone is told the troop by the room', sv && sv[0] === 'all' && Array.isArray(sv[1].p.m) && sv[1].p.m.length === TROOP.NUM * 6, sv && ('sv: ' + sv[1].p.m.length / 6 + ' monkeys'));

//  shots
const m3 = RT.T.monkeys[3];
const hp0 = m3.hp;
now += 300; say('p000000', 'state', { x: ax, y: 0, z: az, r: 0, w: 0 });
out.length = 0;
say('p000000', 'mobhit', { i: 3, d: 999 });
check('a shot at a monkey in the open lands, for the gun\'s damage, and is not passed on', m3.hp === hp0 - RULES.DMG && !out.some(([, m]) => m.s === 'mobhit') && RT.T.rageT > 0,
  hp0 + ' → ' + m3.hp + (R.lastRefusal ? '; last refused: ' + R.lastRefusal : ''));
now += 20;
say('p000000', 'mobhit', { i: 3 });
check('the next, sooner than the gun can fire, does not', m3.hp === hp0 - RULES.DMG && /faster than the gun/.test(R.lastRefusal), R.lastRefusal);
now += 300; say('p000001', 'state', { x: ax - 3, y: 0, z: az + 2, r: 0, w: 1 });
say('p000001', 'mobhit', { i: 3 });
check('nor one from the other side of the tear', m3.hp === hp0 - RULES.DMG && /other side/.test(R.lastRefusal), R.lastRefusal);
//  from behind a building
let hid = null;
for (let r = 16; r < 90 && !hid; r += 2) for (let k = 0; k < 24 && !hid; k++) {
  const x = m3.wx + Math.sin(k / 24 * 6.2832) * r, z = m3.wz + Math.cos(k / 24 * 6.2832) * r;
  if (!F.clearAt(x, z, 0.6)) continue;
  const ro = { x, y: RULES.EYE, z }, dx = m3.wx - x, dy = 1.05 - RULES.EYE, dz = m3.wz - z, d = Math.hypot(dx, dy, dz);
  if (CITY.rayLazy((await import('../combat.js')).theCity(), ro, { x: dx / d, y: dy / d, z: dz / d }, d) < d - 6) hid = { x, z };
}
now += 300; say('p000001', 'state', { x: hid.x, y: 0, z: hid.z, r: 0, w: 0 });
const before = m3.hp;
say('p000001', 'mobhit', { i: 3 });
check('nor one through a building', m3.hp === before && /line of sight/.test(R.lastRefusal), R.lastRefusal);
//  taken down: the room says whose
m3.wx = ax + 8; m3.wz = az; m3.rx = m3.wx; m3.rz = m3.wz;
out.length = 0;
let shots = 0;
while (TROOP.inPlay(m3) && shots < 10) { now += 300; m3.wx = ax + 8; m3.wz = az; say('p000000', 'state', { x: ax, y: 0, z: az, r: 0, w: 0 }); say('p000000', 'mobhit', { i: 3 }); shots++; }
const death = out.find(([, m]) => m.s === 'mdeath');
check('taken down: the room tells everyone whose it was', death && death[0] === 'all' && death[1].p.i === 3 && death[1].p.by === 'p000000', JSON.stringify(death && death[1].p) + ' after ' + shots + ' more');
check('and the host can no longer say so', say('p000000', 'mdeath', { i: 5, by: 'p000000', s: 1 }).drop === 'refused mdeath');

//  a body thrown by a player's game
say('p000001', 'corpse', { c: 4242, x: Math.round(ax * 10), z: Math.round(az * 10), vx: 30, vz: 0, k: 7 });
check('a body a player\'s game threw: the room\'s troop has it too', RT.T.corpses.some((c) => c.active && c.cid === 4242));

//  a minute of it, two players about, raging: what a call costs
let worst = 0, sum = 0, n = 0, thrown = null;
try {
  for (let i = 0; i < 1200; i++) {
    now += 50;
    const t0 = process.hrtime.bigint();
    say(i % 2 ? 'p000001' : 'p000000', 'state', i % 2 ? { x: ax - 3, y: 0, z: az + 2, r: 0, w: 0 } : { x: ax, y: 0, z: az, r: 0, w: 0 });
    const d = ms(t0); worst = Math.max(worst, d); sum += d; n++;
  }
} catch (e) { thrown = e; }
check('a minute of the troop raging round two players: no error, and no call near the 10 ms a call has', !thrown && worst < 9.5,
  (thrown ? thrown.message + ' ' : '') + 'each call ' + (sum / n).toFixed(3) + ' ms on average, ' + worst.toFixed(2) + ' ms at worst');

//  one left: given back
out.length = 0;
keep(R.leave('p000001'));
const gave = out.find(([, m]) => m.s === 'own');
check('one left: the room gives the troop back, with its last word on it', gave && gave[1].p.m === 0 && Array.isArray(gave[1].p.t.m) && !C.own.m, JSON.stringify(gave && Object.keys(gave[1].p)));

//  a host's word that is not a troop is not taken for one
{
  const V = new Relay({ moves: false });
  V.join('p000000', 'Aki'); V.join('p000001', 'Ben');
  const o = V.handle('p000000', JSON.stringify({ s: 'mob', p: { m: [4, 5, 6], g: null } }), now).out.map(([, t]) => JSON.parse(t));
  const o2 = V.handle('p000000', JSON.stringify({ s: 'mob', p: { m: [0, 1, 2, -5, 0, 0], g: null } }), now + 1).out.map(([, t]) => JSON.parse(t));
  check('a host\'s word that is not a troop is not taken for one', !V.creatures.own.m && !o.concat(o2).some((m) => m.s === 'own' && m.p.m === 1) && V.creatures.taking.m === 3);
}

//  a room woken from sleep says it runs nothing yet
const W = new Relay({ moves: false });
W.join('p000000', 'Aki'); W.join('p000001', 'Ben'); W.woke = true;
const wr = W.handle('p000000', JSON.stringify({ s: 'state', p: { x: 1, y: 0, z: 1 } }), now).out.map(([to, t]) => [to, JSON.parse(t)]);
const wo = wr.find(([, m]) => m.s === 'own');
check('woken from sleep, the room first tells everyone it runs nothing yet', wo && wo[0] === 'all' && wo[1].p.b === 0 && wo[1].p.m === 0);
//  … and the host's next word, without the troop (it thinks the room has it): after nine, the room starts its own
let taken = false;
for (let i = 0; i < 10 && !taken; i++) { const o = W.handle('p000000', JSON.stringify({ s: 'mob', p: { g: null } }), now + i).out.map(([, t]) => JSON.parse(t)); taken = o.some((m) => m.s === 'own' && m.p.m === 1); }
check('… and without a word of the troop from the host, it starts one of its own', taken && W.creatures.own.m && W.creatures.troop.T.monkeys.filter(TROOP.inPlay).length === TROOP.NUM);

console.log('\nTHE MONKEY TROOP — shared, and run by the room, in node\n');
console.log(results.join('\n'));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
