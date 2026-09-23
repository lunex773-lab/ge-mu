'use strict';
//  ============================================================
//  PHASE 5 TESTS  (spec §13, §14, §15, §19, §33)
//  ============================================================
//  The questions that matter for "it remembers how I fight":
//    - does it name what the player did correctly, from what it can see?
//    - does it learn a habit, and predict it with confidence?
//    - does it stay unsure about a player who has no habit? (a model that is
//      confidently wrong is worse than none — it would anticipate noise)
//    - does it follow a player who changes, at the speed the difficulty sets?
//    - does it come back after a reload, and stay small?

const assert = require('assert');
const { PlayerModel, PlayerModelBank, BehaviorTracker, classify, BEHAVIORS, B, UNAVAILABLE_BEHAVIORS } = require('../core/player_model.js');
const { WorkingMemory, EpisodicMemory } = require('../core/memory.js');
const { WorldState, F } = require('../core/worldstate.js');
const { SensorLayer } = require('../core/sensors.js');
const { MIND } = require('../core/fairness.js');
const { makeRng } = require('../core/rng.js');

let pass = 0, fail = 0;
const results = [];
function test(name, fn) {
  try { fn(); pass++; results.push('  ok   ' + name); }
  catch (e) { fail++; results.push('  FAIL ' + name + '\n         ' + e.message); }
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, (what || '') + ' ' + a + ' not within ' + tol + ' of ' + b);

//  A WorldState that reads as `behavior` to anyone looking.
function wsFor(t, behavior, dist) {
  const w = new WorldState(); w.t = t;
  const v = w.v;
  v[F.has_target] = 1; v[F.player_visible] = 1; v[F.player_confidence] = 1; v[F.player_distance] = dist || 18;
  switch (behavior) {
    case 'attack': v[F.time_since_player_attack] = 0.1; v[F.player_attacking] = 0.9; break;
    case 'dodge_left': v[F.player_dodging] = 0.9; v[F.player_lateral_speed] = -7; break;
    case 'dodge_right': v[F.player_dodging] = 0.9; v[F.player_lateral_speed] = 7; break;
    case 'approach': v[F.player_radial_speed] = -6; break;
    case 'retreat': v[F.player_radial_speed] = 6; break;
    case 'strafe_left': v[F.player_lateral_speed] = -4.5; break;
    case 'strafe_right': v[F.player_lateral_speed] = 4.5; break;
    case 'hide': v[F.player_visible] = 0; v[F.player_confidence] = 0.6; v[F.los_blocked] = 1; break;
    case 'jump': v[F.player_airborne] = 1; v[F.player_vertical_speed] = 5; break;
    case 'wait': break;
  }
  return w;
}

//  A player bot: picks behaviours by `next(prev, rng)`, holds each for
//  0.5-1.1 s, and the model watches at 10 Hz. Consecutive repeats are
//  merged by the tracker (a behaviour is a change), so bots never repeat.
function play(model, steps, next, seed, dist) {
  const rng = makeRng(seed || 1);
  let t = model._t || 0, prev = model._prev || 'wait', emitted = 0;
  for (let k = 0; k < steps; k++) {
    let b = next(prev, rng, k);
    if (b === prev) b = b === 'wait' ? 'approach' : 'wait';
    const hold = 0.5 + rng.next() * 0.6;
    for (let s = 0; s < hold; s += 0.1) { t += 0.1; if (model.observe(wsFor(t, b, dist))) emitted++; }
    prev = b;
  }
  model._t = t; model._prev = prev;
  return emitted;
}
const cycle = (seq) => (prev, rng, k) => seq[k % seq.length];

// ================================================================ behaviours
test('every behaviour is named correctly from what the boss can see', () => {
  for (const b of BEHAVIORS) assert.strictEqual(BEHAVIORS[classify(wsFor(1, b))], b, b);
  const none = new WorldState();
  assert.strictEqual(classify(none), -1, 'no target, no behaviour');
});

test('behaviours the game does not have are declared, not invented', () => {
  for (const k of ['skill', 'heal']) assert.ok(UNAVAILABLE_BEHAVIORS[k]);
  for (const k of ['skill', 'heal']) assert.ok(!BEHAVIORS.includes(k));
});

test('flicker is not behaviour: a class has to hold 0.2 s; a dodge counts at once', () => {
  const tr = new BehaviorTracker();
  let n = 0, t = 0;
  for (let i = 0; i < 20; i++) { t += 0.1; if (tr.observe(wsFor(t, i % 2 ? 'strafe_left' : 'approach')) >= 0) n++; }
  assert.ok(n <= 1, 'flicker produced ' + n + ' behaviours');
  assert.strictEqual(tr.observe(wsFor(t + 0.1, 'dodge_right')), B.dodge_right, 'a dodge is instant');
});

test('through the real sensor: a sidestep to the boss\'s right is a dodge_right', () => {
  const s = new SensorLayer(), tr = new BehaviorTracker();
  const self = { x: 0, y: 0, z: 0, hd: 0, hp: 1, hpMax: 1 };
  const got = [];
  let t = 0, x = 0;
  // run to the boss's left (+x when it faces +z), then break hard to its right
  for (let i = 0; i < 12; i++) { x += 0.6; t += 0.1; const b = tr.observe(s.sense({ t, self, bodies: [{ id: 'a', x, y: 0, z: 20, hp: 100 }] })); if (b >= 0) got.push(BEHAVIORS[b]); }
  for (let i = 0; i < 3; i++) { x -= 0.8; t += 0.1; const b = tr.observe(s.sense({ t, self, bodies: [{ id: 'a', x, y: 0, z: 20, hp: 100 }] })); if (b >= 0) got.push(BEHAVIORS[b]); }
  assert.ok(got.includes('strafe_left'), 'the run: ' + got.join(','));
  assert.strictEqual(got[got.length - 1], 'dodge_right', 'the break: ' + got.join(','));
});

// ================================================================ learning a habit
test('§14/15: a habit is learned and predicted with confidence', () => {
  const m = new PlayerModel(MIND.NORMAL);
  play(m, 120, cycle(['attack', 'dodge_right', 'retreat', 'approach']));
  m.hist = [B.attack, B.dodge_right];
  const p = m.predict();
  assert.strictEqual(p.best, 'retreat');
  assert.ok(p.probs.retreat > 0.85, 'p=' + p.probs.retreat.toFixed(3));
  assert.ok(p.confidence >= MIND.EASY.prediction_threshold, 'even EASY would act on it: ' + p.confidence.toFixed(3));
});

test('§14: the pattern is reported as a sequence', () => {
  const m = new PlayerModel(MIND.NORMAL);
  play(m, 120, cycle(['attack', 'dodge_right', 'retreat', 'approach']));
  const pats = m.patterns();
  const s = pats.map((q) => q.seq.join('>'));
  assert.ok(s.some((q) => q.startsWith('attack>dodge_right>retreat')), s.slice(0, 4).join(' | '));
  assert.ok(pats.some((q) => q.seq.length === 4), 'a four-step pattern: ' + s.slice(0, 4).join(' | '));
});

test('§13: transitions and per-behaviour statistics are proper', () => {
  const m = new PlayerModel(MIND.NORMAL);
  play(m, 200, (prev, rng) => BEHAVIORS[rng.int(BEHAVIORS.length)], 3);
  for (const b of BEHAVIORS) {
    const tr = m.transitions(b);
    const sum = Object.values(tr).reduce((a, x) => a + x, 0);
    if (sum > 0) near(sum, 1, 1e-9, b + ' transitions');
  }
  const prof = m.profile(m._t);
  near(Object.values(prof).reduce((a, x) => a + x.frequency, 0), 1, 1e-9, 'frequencies');
  for (const b of BEHAVIORS) assert.ok(prof[b].success_rate > 0 && prof[b].success_rate < 1);
});

test('§13 success_rate: what worked for the player is remembered as working', () => {
  const m = new PlayerModel(MIND.NORMAL);
  let t = 0;
  for (let k = 0; k < 30; k++) {
    for (let s = 0; s < 5; s++) { t += 0.1; m.observe(wsFor(t, 'dodge_left')); }
    m.noteOutcome('boss_missed', t);
    for (let s = 0; s < 5; s++) { t += 0.1; m.observe(wsFor(t, 'approach')); }
    m.noteOutcome('player_hurt', t);
  }
  const p = m.profile(t);
  assert.ok(p.dodge_left.success_rate > 0.9, 'dodge ' + p.dodge_left.success_rate);
  assert.ok(p.approach.success_rate < 0.1, 'approach ' + p.approach.success_rate);
});

// ================================================================ not fooled by noise
test('§15: a player with no habit is never anticipated, even at NIGHTMARE', () => {
  const m = new PlayerModel(MIND.NIGHTMARE);
  const rng = makeRng(17);
  let over = 0, n = 0, sum = 0, t = 0, prev = -1;
  for (let k = 0; k < 1500; k++) {
    let b; do { b = rng.int(BEHAVIORS.length); } while (b === prev);
    prev = b;
    for (let s = 0; s < 6; s++) { t += 0.1; m.observe(wsFor(t, BEHAVIORS[b])); }
    const c = m.predict().confidence;
    if (k > 100) { n++; sum += c; if (c >= MIND.NIGHTMARE.prediction_threshold) over++; }
  }
  assert.ok(sum / n < 0.25, 'mean confidence ' + (sum / n).toFixed(3));
  assert.ok(over / n < 0.01, (100 * over / n).toFixed(2) + '% of predictions would have been acted on');
});

test('§24 accuracy: on a noisy habit it gets close to the best any model could', () => {
  //  First-order Markov player: after each behaviour, a favourite next one
  //  70% of the time, anything else otherwise. The best possible accuracy
  //  is 0.70; a model that only counted frequencies would get ~0.1.
  const fav = {}; BEHAVIORS.forEach((b, i) => { fav[b] = BEHAVIORS[(i * 3 + 1) % BEHAVIORS.length]; });
  const m = new PlayerModel(MIND.HARD);
  play(m, 300, (prev, rng) => (rng.next() < 0.7 ? fav[prev] : BEHAVIORS[rng.int(BEHAVIORS.length)]), 5);
  m.hits = m.tries = 0;
  play(m, 1500, (prev, rng) => (rng.next() < 0.7 ? fav[prev] : BEHAVIORS[rng.int(BEHAVIORS.length)]), 6);
  const acc = m.accuracy().overall;
  //  a repeat of the previous behaviour is merged away, which nudges the true
  //  ceiling above 0.70; anything within 0.08 of it is learning the habit
  assert.ok(acc > 0.62, 'accuracy ' + acc.toFixed(3));
});

// ================================================================ forgetting
//  200 rounds of attack -> dodge_right -> retreat, then the player switches to
//  attack -> retreat -> dodge_right. How many rounds until "after an attack"
//  is predicted to be a retreat? (Asked of the one-step context, so the old
//  habit's evidence has to actually fade rather than be sidestepped.)
function flipTime(mind) {
  const m = new PlayerModel(mind);
  play(m, 600, cycle(['attack', 'dodge_right', 'retreat']));
  for (let k = 1; k <= 400; k++) {
    play(m, 3, cycle(['attack', 'retreat', 'dodge_right']));
    const saved = m.hist; m.hist = [B.attack];
    const best = m.predict().best; m.hist = saved;
    if (best === 'retreat') return k;
  }
  return Infinity;
}
test('a player who changes is followed — faster with a short memory', () => {
  const easy = flipTime(MIND.EASY), nm = flipTime(MIND.NIGHTMARE);
  assert.ok(Number.isFinite(easy) && Number.isFinite(nm), 'never adapted: ' + easy + ' / ' + nm);
  assert.ok(easy < nm, 'EASY (memory 60) took ' + easy + ', NIGHTMARE (memory 1000) took ' + nm);
});

// ================================================================ persistence
test('D4: a saved profile predicts the same after a reload, and stays small', () => {
  const m = new PlayerModel(MIND.NORMAL);
  play(m, 5000, (prev, rng) => (rng.next() < 0.6 ? cycle(['attack', 'dodge_left', 'retreat'])(0, 0, BEHAVIORS.indexOf(prev) + 1) : BEHAVIORS[rng.int(10)]), 9);
  const json = JSON.stringify(m.serialize());
  assert.ok(json.length < 16 * 1024, json.length + ' bytes');
  const r = new PlayerModel(MIND.NORMAL);
  assert.ok(r.restore(JSON.parse(json)));
  for (const h of [[B.attack, B.dodge_left], [B.retreat], [B.wait, B.jump], []]) {
    m.hist = h.slice(); r.hist = h.slice();
    const a = m.predict(), b = r.predict();
    for (const k of BEHAVIORS) near(a.probs[k], b.probs[k], 0.01, k);
    near(a.confidence, b.confidence, 0.01, 'confidence');
  }
});

test('D4: a corrupt or foreign profile is refused and changes nothing', () => {
  const m = new PlayerModel(MIND.NORMAL);
  play(m, 50, cycle(['attack', 'retreat']));
  const before = JSON.stringify(m.serialize());
  for (const bad of [null, {}, { v: 2 }, { v: 1, vocab: 'x', ctx: {}, band: [] },
                     { v: 1, vocab: BEHAVIORS.join(','), ctx: { 1: [NaN] }, band: [[], [], []] }]) assert.ok(!m.restore(bad));
  assert.strictEqual(JSON.stringify(m.serialize()), before);
});

test('D7: one model per player name, the least recently seen forgotten first', () => {
  const bank = new PlayerModelBank({ cap: 3 });
  bank.get('a', 1); bank.get('b', 2); bank.get('c', 3); bank.get('a', 4); bank.get('d', 5);
  assert.deepStrictEqual([...bank.models.keys()].sort(), ['a', 'c', 'd']);
  const back = new PlayerModelBank();
  assert.ok(back.restore(JSON.parse(JSON.stringify(bank.serialize()))));
  assert.strictEqual(back.models.size, 3);
});

// ================================================================ the response model
//  The boss winds up; the player (believed at target_x/z) answers. `move`
//  is how the player moves once they have seen it: (radial, lateral) m/s.
function answer(m, t0, kind, move, strafe) {
  // the boss at the origin, the player 15 m out along +z
  let x = 0, z = 15;
  const view = (t) => { const w = wsFor(t, 'wait'); w.v[F.target_x] = x; w.v[F.target_z] = z; w.v[F.self_x] = 0; w.v[F.self_z] = 0; return w; };
  m.noteBossWindup(kind, view(t0));
  for (let t = t0 + 0.05; t <= t0 + 1.25; t += 0.05) {
    const after = t - t0 > 0.3;
    // lateral + is the boss's right: it faces +z, so its right is -x
    const vr = after ? move[0] : 0, vl = after ? move[1] : strafe;
    z += vr * 0.05; x -= vl * 0.05;
    m.observe(view(t));
  }
  return t0 + 1.3;
}
test('response model: "when I lunge, you go right" is learned — despite strafing either way before', () => {
  const m = new PlayerModel(MIND.NORMAL);
  let t = 1;
  for (let k = 0; k < 20; k++) t = answer(m, t, 'dash', [1, 9], k % 2 ? 7 : -7);   // strafing both ways, always breaks right
  const p = m.predictResponse('dash');
  assert.strictEqual(p.best, 'right');
  assert.ok(p.confidence > MIND.NORMAL.prediction_threshold, 'confidence ' + p.confidence.toFixed(3));
  near(p.move[1], 9, 0.8, 'lateral speed'); near(p.move[0], 1, 0.8, 'radial speed');
  assert.strictEqual(m.predictResponse('reap').confidence, 0, 'and it knows nothing about the reap yet');
});
test('response model: survives a reload', () => {
  const m = new PlayerModel(MIND.NORMAL);
  let t = 1;
  for (let k = 0; k < 12; k++) t = answer(m, t, 'reap', [8, 0], 0);
  const r = new PlayerModel(MIND.NORMAL);
  assert.ok(r.restore(JSON.parse(JSON.stringify(m.serialize()))));
  const a = m.predictResponse('reap'), b = r.predictResponse('reap');
  assert.strictEqual(b.best, 'away'); near(b.confidence, a.confidence, 0.01); near(b.move[0], a.move[0], 0.05);
});

// ================================================================ memory (§19)
test('§19 working memory: means and trends over the last seconds', () => {
  const wm = new WorkingMemory({ seconds: 30, hz: 2 });
  for (let i = 0; i <= 60; i++) { const w = new WorldState(); w.t = i * 0.5; w.v[F.player_distance] = 50 - i * 0.5; wm.observe(w); }
  near(wm.trend('player_distance', 10, 30), -1, 1e-4, 'closing at 1 m/s');
  near(wm.mean('player_distance', 2, 30), 21, 0.51, 'recent mean');
  assert.throws(() => wm.mean('nope', 1, 1));
});

test('§19 episodic memory: what failed is counted where it failed', () => {
  const em = new EpisodicMemory({ cap: 16 });
  for (let i = 0; i < 3; i++) em.record(10 + i, 'boss_attack_failed', 'reap', 'close');
  em.record(14, 'boss_attack_landed', 'reap', 'mid');
  near(em.successRate('reap', 30, 15, 'close'), 1 / 5, 1e-9, 'close reaps');
  near(em.successRate('reap', 30, 15, 'mid'), 2 / 3, 1e-9, 'mid reaps');
  near(em.successRate('whirl', 30, 15), 0.5, 1e-9, 'no record: even odds, not NaN');
  assert.strictEqual(em.count_('boss_attack_failed', 3.5, 15), 1, 'only the last 3.5 s (the miss at t=12)');
  assert.strictEqual(em.count_('boss_attack_failed', 2, 15), 0, 'and nothing in the last 2 s');
  for (let i = 0; i < 40; i++) em.record(20 + i, 'ambush_success', 'dive', 'far');
  assert.strictEqual(em.count, 16, 'bounded');
  assert.throws(() => em.record(1, 'made_up'));
});

// ================================================================ cost
test('cost: a tick of observe + predict stays in the microseconds', () => {
  const m = new PlayerModel(MIND.HARD);
  play(m, 300, (prev, rng) => BEHAVIORS[rng.int(10)], 2);
  const ws = []; for (let i = 0; i < 200; i++) ws.push(wsFor(m._t + i * 0.1, BEHAVIORS[(i >> 3) % 10]));
  const N = 20000, t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) { m.observe(ws[i % 200]); if (i % 5 === 0) m.predict(); }
  const us = Number(process.hrtime.bigint() - t0) / 1e3 / N;
  assert.ok(us < 20, us.toFixed(2) + ' µs per tick');
  results.push('         (' + us.toFixed(2) + ' µs per tick, predict every 5th)');
});

console.log('\nPHASE 5 — Player Model / Memory\n');
console.log(results.join('\n'));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
