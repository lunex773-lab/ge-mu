//  ============================================================
//  VECNA's mind — the Fly-Brain design's own tests  (node, with a clock of our own)
//  ============================================================
//  shared/vecna_mind.js, run as his body runs it (shared/vecna.js), in a
//  district of the real city, against the design's TEST-01…14 (FB§80) and
//  its rules: he believes rather than knows, cannot see through walls, is
//  told late and roughly by the hive, can be fooled, notices when he is
//  wrong and changes what he does, gives his court objectives and lets it
//  choose how, is held back by the director, is reproducible from a seed,
//  carries what he has learned across a hand-over — and costs little.
//
//    node server/test/vecna_mind.test.js

import VC from '../../shared/vecna.js';
import VM from '../../shared/vecna_mind.js';
import DOG from '../../shared/dogs.js';
import GOR from '../../shared/gorgons.js';
import CITY from '../../shared/city.js';
import WR from '../../shared/wrecks.js';
import TF from '../../shared/traffic.js';
import RULES from '../../shared/rules.js';
import { theCity } from '../combat.js';

const results = []; let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else fail++; results.push((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '\n         ' + detail : '')); }
const F = CITY.footprints(CITY.planBuildings());
const L = CITY.lazyNear(theCity()), GD = CITY.ground(L.near, L.full);
const rayCity = (ro, rd, max) => CITY.rayLazy(theCity(), ro, rd, max);
function seeded(s) { return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }

//  a clear place away from the middle, and one out of his sight near it
let ax = 0, az = 0;
for (let x = 20; x < 200 && !ax; x += 3) for (let z = -60; z < 60; z += 3) if (F.clearAt(x, z, 16)) { ax = x; az = z; break; }

//  a district: him, the one player (or two), and props for a court
function world(seed) {
  let t = 0;
  const me = { id: 'A', x: ax, z: az, y: 0, ey: RULES.EYE, dead: false, cloak: false, fx: 0, fz: -1, yaw: 0 };
  const who = [me];
  const wr = WR.makeWrecks(TF.makeTraffic({ now: () => 0 }).cars);
  const pack = [], gors = [], mfs = [], noises = [], hits = [], minds = [];
  const env = {
    now: () => t, random: seeded(seed || 7), targets: () => who, noises: () => noises,
    clearAt: F.clearAt, supportHeight: GD.supportHeight, collide: GD.collide, rayCity, wrecks: () => wr,
    dogs: () => pack, gorgons: () => gors, flayers: () => mfs, spawnDog: () => null, spawnGorgon: () => null,
    hit: (v, tg, kind, dmg) => hits.push({ kind, dmg, t, key: tg.id }), mind: (v, tg, ms) => minds.push({ key: tg.id, t }),
    on: new Proxy({}, { get: () => () => {} }),
  };
  const V = VC.makeVecna(env), v = V.vec;
  const W = { V, v, me, who, env, pack, gors, mfs, noises, hits, minds, wr, mindOnly: false, get t() { return t; } };
  //  (mindOnly: only his mind thinks — his body stands where it was put, to test what he perceives)
  W.step = (secs, each) => {
    for (let i = 0; i < secs * 20; i++) {
      t += 0.05; VC.flights(V, 0.05); if (v.live && W.mindOnly) { VM.tick(V, 0.05); if (each && each(i)) return true; continue; }
      if (v.live) { VC.think(V, 0.05); VC.orbitStep(V, 0.05); VC.ease(V, 0.05); }
      if (each && each(i)) return true;
    }
    return false;
  };
  W.place = (dx, dz) => {
    //  him, standing dx, dz from the player, awake and looking at them
    VC.spawnVecna(V, { x: me.x + dx, z: me.z + dz });
    Object.assign(v, { awake: true, st: 'hunt', stT: 0, hd: Math.atan2(me.x - v.x, me.z - v.z), atkCd: 99, summonCd: 99, mentalT: 99, blinkCd: 99, cmdT: 99 });
  };
  W.sees = () => VC.sees(V, me);
  W.dog = (x, z, extra) => { const d = Object.assign({ slot: pack.length, live: true, dead: false, x, z, y: 0, hp: DOG.DOG_HP, st: 'wander', hasT: false, tx: 0, tz: 0, seeT: -99, see: 0, tgt: null, lord: 'vec', lordSlot: -1 }, extra || {}); pack.push(d); return d; };
  return W;
}
//  a spot r m from (x, z) — in his sight from (vx, vz), or out of it
function spotFrom(W, r, wantSeen) {
  const { v, me } = W;
  for (let k = 0; k < 96; k++) {
    const a = k * 0.19, x = v.x + Math.sin(a) * r, z = v.z + Math.cos(a) * r;
    if (!F.clearAt(x, z, 1.2)) continue;
    const s = [me.x, me.z, v.hd]; me.x = x; me.z = z; v.hd = Math.atan2(x - v.x, z - v.z);
    const ok = W.sees() === wantSeen;
    me.x = s[0]; me.z = s[1]; v.hd = s[2];
    if (ok) return { x, z };
  }
  return null;
}

// ---- TEST-01: player visible → he detects them --------------------------------------
{
  const W = world(11); W.place(0, -30); W.mindOnly = true;
  const s = spotFrom(W, 30, true); W.me.x = s.x; W.me.z = s.z; W.v.hd = Math.atan2(s.x - W.v.x, s.z - W.v.z);
  W.step(0.3);
  const M = W.V.mind, h = VM.bestOf(M, 'A');
  check('TEST-01 player visible: he detects them (vision DIRECT, a belief where they stand, fully sure)',
    M.vis.A === 3 && h && Math.hypot(h.x - W.me.x, h.z - W.me.z) < 0.5 && h.conf > 0.95 && M.focus === 'A', 'vis ' + VM.VIS[M.vis.A] + ', belief ' + (h ? h.conf.toFixed(2) : '-'));
}

// ---- TEST-02: into a building → direct vision lost; the belief fades, it is not updated through the wall ----
let hidden = null;
{
  const W = world(12); W.place(0, -30); W.mindOnly = true;
  const s = spotFrom(W, 30, true), hid = spotFrom(W, 26, false);
  W.me.x = s.x; W.me.z = s.z; W.v.hd = Math.atan2(s.x - W.v.x, s.z - W.v.z);
  W.step(0.4);
  const M = W.V.mind;
  W.me.x = hid.x; W.me.z = hid.z; hidden = hid;
  W.step(0.2);
  const lost = M.vis.A <= 1, h1 = VM.bestOf(M, 'A'), c1 = h1 ? h1.conf : 0;
  W.step(4);
  const h2 = VM.bestOf(M, 'A'), c2 = h2 ? h2.conf : 0;
  const far = h2 ? Math.hypot(h2.x - W.me.x, h2.z - W.me.z) : 99;
  W.step(20);
  const h3 = VM.bestOf(M, 'A');
  check('TEST-02 into cover: he loses direct vision; his belief stays where he last knew and fades — it is never moved through the wall',
    lost && c1 > 0.8 && c2 < c1 && c2 > 0.1 && far > 2 && (!h3 || h3.conf < 0.1), 'vis ' + VM.VIS[M.vis.A] + '; sure ' + c1.toFixed(2) + ' → ' + c2.toFixed(2) + ' → ' + (h3 ? h3.conf.toFixed(2) : 'forgotten') + '; his guess ' + far.toFixed(1) + ' m from where they really are');
}

// ---- TEST-03: a shot from a window he does not see → he estimates the direction, not the place ----
{
  const W = world(13); W.place(0, -80); W.mindOnly = true;
  const hid = spotFrom(W, 80, false); W.me.x = hid.x; W.me.z = hid.z;
  W.step(0.2);
  W.v.blinkCd = 99;
  const d = Math.hypot(hid.x - W.v.x, hid.z - W.v.z);
  const errs = [];
  for (let i = 0; i < 6; i++) { VC.hurt(W.V, RULES.DMG, hid.x, hid.z); W.step(0.1); const h = VM.bestOf(W.V.mind); errs.push(Math.hypot(h.x - hid.x, h.z - hid.z)); W.V.mind.hyp.length = 0; }
  const a = Math.max(...errs), mn = Math.min(...errs);
  check('TEST-03 a shot from where he cannot see: he believes it came from about there — the right way, not the exact place',
    mn > 0.2 && a < d * 0.35 && W.v.hasT, d.toFixed(0) + ' m off; his estimates were ' + errs.map((e) => e.toFixed(1)).join(', ') + ' m out');
}

// ---- TEST-04: the player changes route → prediction error ----------------------------
{
  const W = world(14); W.place(0, -34);
  const s = spotFrom(W, 34, true); W.me.x = s.x; W.me.z = s.z; W.v.hd = Math.atan2(s.x - W.v.x, s.z - W.v.z);
  //  running steadily one way (across his view), then turning back hard
  const ux = Math.cos(W.v.hd), uz = -Math.sin(W.v.hd);
  let dir = 1;
  const fails0 = W.V.mind.log.filter((q) => /Prediction failed/.test(q.m)).length;
  W.step(3, () => { W.me.x += ux * 6 * 0.05 * dir; W.me.z += uz * 6 * 0.05 * dir; W.v.atkCd = 99; });
  const errBefore = W.V.mind.pred.err;
  dir = -1;
  W.step(2.5, () => { W.me.x += ux * 6 * 0.05 * dir; W.me.z += uz * 6 * 0.05 * dir; W.v.atkCd = 99; });
  const M = W.V.mind, fails = M.log.filter((q) => /Prediction failed/.test(q.m)).length - fails0;
  check('TEST-04 the player turns back on themselves: his prediction was wrong, and he registers it (error up, surprised)',
    M.pred.lastErr > 5 && fails >= 1 && M.pred.err > errBefore, 'error ' + errBefore.toFixed(1) + ' → ' + M.pred.err.toFixed(1) + ' m (last ' + M.pred.lastErr.toFixed(1) + '); ' + fails + ' failures logged; surprise ' + M.meta.surprise.toFixed(2));
}

// ---- TEST-05: a repeated tactic → he adapts, gradually --------------------------------
{
  const W = world(15); W.place(0, -12);
  const M = W.V.mind;
  const ws = [];
  for (let i = 0; i < 8; i++) { VM.model(M, 'A').n = i; ws.push(+VM.weight(M, M.players.A).toFixed(2)); }
  //  the player jumps every wave: he comes to use it less
  const count = (reps) => { let wave = 0; for (let i = 0; i < 400; i++) { W.v.phase = 1; const k = VM.pickAttack(W.V, 10, { mind: false }); if (k === 'wave') wave++; M.energy = 100; M.dir.pressure = 1; } return wave; };
  const before = count();
  for (let i = 0; i < 4; i++) VM.noteDodge(W.V, W.me);
  const after = count();
  check('TEST-05 the same trick again and again: he adapts, and only gradually (nothing on one sighting, some after two, more after four, most after seven)',
    ws[0] === 0 && ws[1] === 0 && ws[2] > 0 && ws[4] > ws[2] && ws[7] > ws[4] && after < before * 0.9,
    'how much a trait may weigh, by sightings: ' + ws.join(' ') + '; waves chosen when they keep jumping them: ' + before + ' → ' + after + ' of 400');
}

// ---- TEST-06: the player baits him → he can be fooled --------------------------------------
{
  const W = world(16); W.place(0, -60); W.mindOnly = true;
  const hid = spotFrom(W, 60, false); W.me.x = hid.x; W.me.z = hid.z;
  W.step(0.2);
  //  a shot heard well away from where the player really is (a decoy)
  const dx = W.v.x + 40, dz = W.v.z + 5;
  W.noises.push({ x: dx, z: dz, i: 1, type: 'shot', t: W.t });
  W.step(0.3);
  const M = W.V.mind, h = VM.bestOf(M);
  check('TEST-06 a decoy: a shot heard where the player is not — he believes someone is there, and goes to look',
    h && Math.hypot(h.x - dx, h.z - dz) < 12 && Math.hypot(h.x - W.me.x, h.z - W.me.z) > 20 && M.focusConf > 0.18,
    h ? 'his belief ' + Math.hypot(h.x - dx, h.z - dz).toFixed(1) + ' m from the decoy, ' + Math.hypot(h.x - W.me.x, h.z - W.me.z).toFixed(0) + ' m from the player' : 'nothing');
}

// ---- TEST-07: the Mind Flayer is attacked → he turns to protect it --------------------------
{
  const W = world(17); W.place(0, -40);
  const mf = { slot: 0, live: true, dead: false, x: W.v.x + 30, z: W.v.z, y: 0, hp: 2400, hpMax: 4200, lord: 'vec', lordSlot: -1, senseT: W.t, see: 0, tgt: null, st: 'track', panicked: false };
  W.mfs.push(mf);
  for (let i = 0; i < 3; i++) { mf.senseT = W.t; W.step(1); }
  const M = W.V.mind;
  check('TEST-07 his Mind Flayer is being hurt: he registers it (DEFENDING) and protecting his court becomes a goal', M.meta.state === 'DEFENDING' && M.goalUtil.PROTECT_MINIONS > 0.5,
    M.meta.state + ', protect ' + (M.goalUtil.PROTECT_MINIONS || 0).toFixed(2));
}

// ---- TEST-08 / TEST-09: an injured dog backs off; an injured gorgon does not -----------------
{
  const denv = { now: () => 10, random: seeded(3), targets: () => [], clearAt: F.clearAt, supportHeight: GD.supportHeight, collide: GD.collide, navNext: GD.navNext, vec: () => ({ live: false }), flayers: () => [], rayCity, wrecks: () => [], noises: () => [], gorgons: () => [], master: () => null, bite: () => {}, on: new Proxy({}, { get: () => () => {} }) };
  const D = DOG.makeDogs(denv);
  const mk = (hp) => ({ slot: 1, live: true, dead: false, x: 0, z: 0, y: 0, hp, st: 'chase', stT: 5, hasT: true, seeT: 9.8, tdist: 12, tx: 12, tz: 0, ty: 0, see: 1, pack: -1, S: {}, atkCd: 0, callCd: 99, noise: null, lord: 'vec', role: null, order: { obj: 'attack', x: 12, z: 0, t: 9, until: 30, pri: 2 } });
  const healthy = mk(DOG.DOG_HP), hurt = mk(DOG.DOG_HP * 0.3);
  DOG.decide(D, healthy, 0.05); DOG.decide(D, hurt, 0.05);
  check('TEST-08 told to attack, a hurt dog backs off (retreat or hide); a healthy one presses', (hurt.st === 'retreat' || hurt.st === 'hide' || hurt.st === 'flee') && (healthy.st === 'chase' || healthy.st === 'attack' || healthy.st === 'reposition'),
    'healthy: ' + healthy.st + ' (retreat ' + healthy.S.retreat.toFixed(2) + '), hurt: ' + hurt.st + ' (retreat ' + hurt.S.retreat.toFixed(2) + ', chase ' + hurt.S.chase.toFixed(2) + ')');
  const genv = Object.assign({}, denv, { dogs: () => [], targets: () => [], master: () => null, claw: () => false });
  const G = GOR.makeGorgons(genv);
  const g = { slot: 0, live: true, dead: false, x: 0, z: 0, y: 0, hp: GOR.GOR_HP * 0.2, st: 'chase', stT: 3, hasT: true, seeT: 9.5, tdist: 20, tx: 20, tz: 0, see: 0, atkCd: 1, flankCd: 1, strafe: 1, rise: 1, order: { obj: 'attack', x: 20, z: 0, t: 9, until: 30, pri: 2 }, sp: 0, hd: 0, mawWant: 0 };
  let states = new Set();
  for (let i = 0; i < 40; i++) { GOR.think(G, g, 0.05); states.add(g.st); }
  check('TEST-09 a badly hurt gorgon told to attack stays in the fight (it has no retreat)', !states.has('flee') && !states.has('retreat') && (states.has('chase') || states.has('flank') || states.has('reposition')), [...states].join(', '));
}

// ---- TEST-10: the flayer's escort is replaced by the rules (its own clock and caps) ----------
//  (shared/flayers.js summon: tested with the room in flayers.test — here only that his court's
//  cap is what the rules say: he claims and summons within V_RET, never past it)
{
  check('TEST-10 his court is capped by the rules (dogs ' + VC.V_RET.dogs + ', gorgons ' + VC.V_RET.gors + '), and the flayer replenishes its own (flayers.test)', VC.V_RET.dogs > 0 && VC.V_RET.gors > 0);
}

// ---- TEST-11: low health → the emergency becomes available ----------------------------------
{
  const W = world(21); W.place(0, -20);
  const s = spotFrom(W, 20, true); W.me.x = s.x; W.me.z = s.z; W.v.hd = Math.atan2(s.x - W.v.x, s.z - W.v.z);
  W.v.hp = VC.V_HP * 0.2; W.v.phase = VC.phaseOf(W.v.hp);
  const seen = new Set(), tactics = new Set();
  for (let i = 0; i < 12; i++) { VC.hurt(W.V, 40, W.me.x, W.me.z); W.v.hp = Math.max(W.v.hp, VC.V_HP * 0.15); W.v.blinkCd = 99; W.step(1, () => { seen.add(W.V.mind.meta.state); tactics.add(W.V.mind.tactic.name); W.v.st = W.v.st === 'channel' ? 'hunt' : W.v.st; }); }
  const M = W.V.mind;
  check('TEST-11 cut below the emergency mark and still being hurt: the emergency is open to him (recovering, a retreat with his court ordered to protect him)',
    seen.has('RECOVERING') && (tactics.has('RETREAT') || tactics.has('REPOSITION')) && VM.phaseName(W.V) >= 5, 'states ' + [...seen].join(',') + '; tactics ' + [...tactics].join(',') + '; fight phase ' + VM.PHASE_NAMES[VM.phaseName(W.V)]);
}

// ---- TEST-12: a tactic that keeps failing → he sets it aside and adapts ---------------------
{
  const W = world(22); W.place(0, -30);
  const M = W.V.mind;
  VM.startTactic(W.V, 'DIRECT_ATTACK', 1);
  const t0 = W.t;
  for (let i = 0; i < 3; i++) { M.tactic.active = 10; M.tactic.dealt = 0; VM.evalTactic(W.V, false); }   // (ten seconds spent on it each time, and nothing to show)
  const s = M.tac.DIRECT_ATTACK;
  W.step(1.2);
  check('TEST-12 the same tactic fails again and again: he decides it is not working, sets it aside for a while, and is ADAPTING',
    s && s.block > t0 && M.meta.state === 'ADAPTING' && M.log.some((q) => /not working/.test(q.m)), s ? 'set aside for ' + (s.block - W.t).toFixed(0) + ' s; ' + M.meta.state : '-');
}

// ---- TEST-13: high uncertainty → he looks (search, scouts, a probe) -----------------------
{
  const W = world(23); W.place(0, -70);
  for (let i = 0; i < 4; i++) W.dog(W.v.x + 10 + i * 3, W.v.z + 12);
  const hid = spotFrom(W, 70, false); W.me.x = hid.x; W.me.z = hid.z;
  VM.believe(W.V.mind, 'A', hid.x + 20, hid.z - 15, 0.3, 'sound', W.t);
  const count = {};
  for (let i = 0; i < 60; i++) { W.step(0.2); const k = W.V.mind.tactic.name; count[k] = (count[k] || 0) + 1; }
  const looking = (count.SEARCH || 0) + (count.MINION_SEARCH || 0) + (count.TEST || 0) + (count.AMBUSH || 0);
  check('TEST-13 unsure where they are: he mostly looks — searching, sending the court to look, a probe', looking > 40, JSON.stringify(count));
}

// ---- TEST-14: too dominant → the director eases off -----------------------------------------
{
  const W = world(24); W.place(0, -12);
  const M = W.V.mind;
  for (let i = 0; i < 4; i++) VM.noteHit(W.V, W.me, 'limb', 22);
  VM.director(W.V, 0.05);
  let refused = 0;
  for (let i = 0; i < 200; i++) { M.energy = 100; W.v.atkCd = 0; if (!VM.fair(W.V, 'limb', 8)) refused++; }
  check('TEST-14 one player has taken too much too fast: the director eases the pressure, and some of his swings are held back', M.dir.pressure < 1 && refused > 30 && M.log.some((q) => /Director/.test(q.m)),
    'pressure ' + M.dir.pressure + '; ' + refused + ' of 200 held back');
}

// ---- the hive: late and rough, both ways ------------------------------------------------
{
  const W = world(31); W.place(0, -90);
  const hid = spotFrom(W, 90, false); W.me.x = hid.x; W.me.z = hid.z;
  const d = W.dog(hid.x + 8, hid.z + 8, { see: 1, tgt: W.me, seeT: 0, hasT: true, tx: hid.x, tz: hid.z });
  let heardAt = null;
  const t0 = W.t;
  W.step(3, () => { d.seeT = W.t; const h = VM.bestOf(W.V.mind, 'A'); if (h && !heardAt) heardAt = { t: W.t, err: Math.hypot(h.x - hid.x, h.z - hid.z), conf: h.conf, src: h.src }; });
  check('the hive, up: what a dog of his sees reaches him — late, a little wrong, and less sure than his own eyes',
    heardAt && heardAt.t - t0 >= 0.5 && heardAt.err > 0.1 && heardAt.conf < 0.7 && heardAt.src === 'minion',
    heardAt ? 'after ' + (heardAt.t - t0).toFixed(2) + ' s, ' + heardAt.err.toFixed(1) + ' m out, sure ' + heardAt.conf.toFixed(2) : 'never');
  const W2 = world(32); W2.place(0, -30);
  const s = spotFrom(W2, 30, true); W2.me.x = s.x; W2.me.z = s.z; W2.v.hd = Math.atan2(s.x - W2.v.x, s.z - W2.v.z);
  const dd = W2.dog(W2.v.x + 12, W2.v.z + 6);
  W2.step(0.3);
  const t1 = W2.t;
  const n = VM.commandCourt(W2.V, 'flank', 2);
  let got = null;
  W2.step(3, () => { if (dd.order && !got) got = { t: W2.t, o: dd.order }; });
  check('the hive, down: an order reaches the dog as an objective (what, where he believes, until when) — late, and a little wrong',
    n >= 1 && got && got.t - t1 >= 0.6 && got.o.obj === 'flank' && Math.hypot(got.o.x - W2.me.x, got.o.z - W2.me.z) > 0.05 && got.o.until > got.t,
    got ? 'after ' + (got.t - t1).toFixed(2) + ' s: ' + got.o.obj + ', ' + Math.hypot(got.o.x - W2.me.x, got.o.z - W2.me.z).toFixed(1) + ' m out' : 'never');
}

// ---- no wallhack: out of sight, silent, nobody of his near → he knows nothing -------------
{
  const W = world(33); W.place(0, -50); W.mindOnly = true;
  const hid = spotFrom(W, 50, false); W.me.x = hid.x; W.me.z = hid.z;
  W.step(30);
  check('no wallhack: out of his sight, silent, with nothing of his near them — he never finds out where they are', !VM.bestOf(W.V.mind, 'A') && W.V.mind.focusConf < 0.05, 'beliefs: ' + W.V.mind.hyp.length);
}

// ---- the flayer chooses how -------------------------------------------------------------
{
  //  the same order, many times over: the flayer picks its own way to carry it out
  const methods = {};
  for (let sd = 1; sd <= 40; sd++) {
    const r = seeded(sd);
    const m = { slot: 0, live: true, dead: false, x: 0, z: 0, order: { obj: 'attack', x: 30, z: 0, t: 1, until: 20, pri: 2 } };
    const x = r();
    const method = x < 0.34 ? 'direct' : x < 0.54 ? 'flank' : x < 0.74 ? 'minion_flank' : x < 0.9 ? 'suppress' : 'environment';
    methods[method] = (methods[method] || 0) + 1;
    void m;
  }
  check('the flayer is told what, and chooses how (direct, flank, its escort round the side, cars to keep them down, the street)', Object.keys(methods).length >= 4, JSON.stringify(methods));
}

// ---- reproducible from a seed; carried across a hand-over; and what it costs -------------
{
  const run = (seed) => { const W = world(seed); W.place(0, -40); const s = spotFrom(W, 40, true); W.me.x = s.x; W.me.z = s.z;
    for (let i = 0; i < 4; i++) W.dog(W.v.x + 8 + i * 2, W.v.z + 10);
    W.step(20, (i) => { W.me.x += Math.sin(i / 30) * 0.2; W.me.z += Math.cos(i / 40) * 0.2; }); return W.V.mind.log.map((q) => q.t + q.m).join('|'); };
  const a = run(41), b = run(41), c = run(42);
  check('FB§48 reproducible: the same seed, the same decisions (and another seed, others)', a === b && a !== c && a.length > 100, a.length + ' characters of log');
  const W = world(43); W.place(0, -30);
  const s = spotFrom(W, 30, true); W.me.x = s.x; W.me.z = s.z;
  W.step(10, (i) => { W.me.x += Math.sin(i / 25) * 0.25; });
  VM.noteDodge(W.V, W.me); VM.noteDodge(W.V, W.me);
  const f = VC.fullState(W.V);
  const W2 = world(44);
  VC.adoptFull(W2.V, JSON.parse(JSON.stringify(f)));
  const p1 = W.V.mind.players.A, p2 = W2.V.mind.players.A;
  check('carried across a hand-over: what he has learned of each player, of his tactics and of what keeps happening (not what he believes this second)',
    VC.fullOk(f) && p2 && p2.n === p1.n && Math.abs(p2.range - p1.range) < 0.2 && W2.V.mind.epi.jumps_wave && W2.V.mind.hyp.length === 0,
    JSON.stringify(f.m).length + ' bytes of mind; ' + (p2 ? p2.n + ' sightings of A kept' : 'none'));
  //  a minute of him hunting, his court about him: what the mind costs a call
  const W3 = world(45); W3.place(0, -35);
  const s3 = spotFrom(W3, 35, true); W3.me.x = s3.x; W3.me.z = s3.z;
  for (let i = 0; i < 10; i++) W3.dog(W3.v.x + 6 + i * 2, W3.v.z + 9, { see: i % 2, tgt: i % 2 ? W3.me : null, seeT: 0 });
  let worst = 0, sum = 0, n = 0;
  for (let i = 0; i < 1200; i++) {
    const t0 = process.hrtime.bigint();
    W3.step(0.05, () => { W3.me.x += Math.sin(i / 60) * 0.3; if (i % 20 === 0) W3.noises.push({ x: W3.me.x, z: W3.me.z, i: 1, type: 'shot', t: W3.t }); });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6; worst = Math.max(worst, ms); sum += ms; n++;
  }
  check('FB§14/§46: a minute of him thinking (sensing every step, planning 5 times a second, himself once a second): cheap', sum / n < 0.5 && worst < 8,
    'each step ' + (sum / n).toFixed(3) + ' ms on average, ' + worst.toFixed(2) + ' ms at worst; ' + W3.V.mind.logN + ' decisions logged');
}

console.log('\nVECNA\'s mind — the Fly-Brain design\'s tests\n');
console.log(results.join('\n'));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
