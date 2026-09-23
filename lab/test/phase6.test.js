'use strict';
//  ============================================================
//  PHASE 6 TESTS  (spec §16, §30, §32, §33)
//  ============================================================
//  The Tactical Brain, the Action Selector, the fallback, the body it drives,
//  and the arena they are tested in — then the whole chain end to end, and
//  the one claim that matters most: meeting the same player again, it does
//  better than the first time.

const assert = require('assert');
const { TacticalBrain, SafeBrain } = require('../core/tactics.js');
const { FsmBrain } = require('../core/fsm_brain.js');
const { BossBody, ATTACKS } = require('../core/boss_body.js');
const { FairnessController, TELEGRAPH_MIN } = require('../core/fairness.js');
const { WorldState, F, validate } = require('../core/worldstate.js');
const { EpisodicMemory } = require('../core/memory.js');
const { ACTIONS } = require('../core/neural.js');
const { makeRng } = require('../core/rng.js');
const { Arena } = require('../sim/arena.js');
const { runFight } = require('../sim/fight.js');
const { buildMockConnectome } = require('../core/connectome.js');
const C = require('../core/compress.js');

let pass = 0, fail = 0;
const results = [];
function test(name, fn) {
  try { fn(); pass++; results.push('  ok   ' + name); }
  catch (e) { fail++; results.push('  FAIL ' + name + '\n         ' + e.message); }
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, (what || '') + ' ' + a + ' not within ' + tol + ' of ' + b);

//  A view: the boss at the origin facing +z, the player believed at (x, z).
function view(x, z, extra) {
  const w = new WorldState(); w.t = 10;
  const v = w.v;
  v[F.has_target] = 1; v[F.player_visible] = 1; v[F.player_confidence] = 1;
  v[F.target_x] = x; v[F.target_z] = z; v[F.player_distance] = Math.hypot(x, z);
  v[F.self_x] = 0; v[F.self_z] = 0; v[F.self_heading] = 0; v[F.self_health] = 1;
  if (extra) for (const k of Object.keys(extra)) v[F[k]] = extra[k];
  return w;
}
const OPEN = { blocked: () => false, ground: () => 0 };
function bodyInfo(ready, extra) {
  return Object.assign({ ready: (k) => ready.includes(k), alt: 0, canFly: true, canGuard: true }, extra || {});
}
function ctx(v, ready, extra) {
  return Object.assign({ view: v, readout: null, gated: null, memory: { episodic: new EpisodicMemory() },
    body: bodyInfo(ready || ['reap', 'whirl', 'dash']), fair: new FairnessController({ difficulty: 'NORMAL', seed: 3 }),
    rng: makeRng(5), now: 10, targetId: 'p', respond: null }, extra || {});
}
const brainT0 = () => { const b = new TacticalBrain(); b.o.minHold = 0; return b; };
// a fairness controller that never refuses and never jitters, to test decisions not dice
function exactFair() {
  const f = new FairnessController({ difficulty: 'NIGHTMARE', seed: 1 });
  f.mind.exploration_rate = 0; f.mind.attack_accuracy = 1;
  return f;
}

// ================================================================ decisions
test('in reach and ready: it swings', () => {
  const d = brainT0().decide(ctx(view(0, 6), ['reap', 'whirl'], { fair: exactFair() }));
  assert.strictEqual(d.action, 'attack'); assert.ok(['reap', 'whirl'].includes(d.attack), d.attack);
});

test('far away: it closes in, and flies when it is far enough to be worth it', () => {
  const b = brainT0();
  const near_ = b.decide(ctx(view(0, 25), [], { fair: exactFair() }));
  assert.ok(['chase', 'intercept', 'ambush'].includes(near_.action), near_.action);
  const far = brainT0().decide(ctx(view(0, 60), [], { fair: exactFair() }));
  assert.strictEqual(far.action, 'chase'); assert.strictEqual(far.fly, true);
});

test('it cannot choose what it cannot do: no swing while the fairness gate refuses', () => {
  const f = exactFair();
  f.noteLanded('p', 9.9, 0.2);                                  // it just hit them: relief window
  for (let i = 0; i < 20; i++) {
    const d = brainT0().decide(ctx(view(0, 5), ['reap', 'whirl'], { fair: f, rng: makeRng(i) }));
    assert.ok(d.action !== 'attack' && d.action !== 'use_skill', 'swung during relief: ' + d.action);
  }
});

test('the guardian goes home when it has been drawn too far (B5)', () => {
  const b = brainT0(); b.gate = { x: 0, z: -120 };
  const d = b.decide(ctx(view(0, 10), ['reap']));
  assert.strictEqual(d.action, 'retreat'); assert.ok(d.move && d.move.z < -100, JSON.stringify(d.move));
  assert.strictEqual(d.reason.leashed, true);
});

test('badly hurt and under fire, backing off is on the table', () => {
  const d = brainT0().decide(ctx(view(0, 30, { self_health: 0.1, damage_taken_recent: 0.2, threat: 0.8 }), [], { fair: exactFair() }));
  const names = d.reason.candidates.map((c) => c.action);
  assert.ok(names.includes('retreat'), names.join(','));
});

test('§30: every decision says why, and the parts add up', () => {
  const d = brainT0().decide(ctx(view(0, 6), ['reap', 'whirl'], { fair: exactFair() }));
  assert.ok(d.reason.candidates.length >= 2);
  for (const c of d.reason.candidates) {
    const sum = c.rule + c.neural + c.prediction + c.position + c.threat - c.risk - c.cooldown + c.commit;
    near(sum, c.utility, 0.005, c.action);
  }
});

test('commitment: near-equal options do not make it dither', () => {
  const b = new TacticalBrain();                                // default minHold 0.5 s
  const f = exactFair(); f.mind.exploration_rate = 0.3;
  let switches = 0, last = null;
  for (let i = 0; i < 100; i++) {
    // a player circling at 5 m/s, 20 m out, with the situation shifting under it
    const ang = i * 0.025;
    const c = ctx(view(Math.sin(ang) * 20, Math.cos(ang) * 20, { player_attacking: i % 20 < 10 ? 0.8 : 0 }), [], { fair: f, now: 10 + i * 0.1, rng: makeRng(i) });
    const a = b.decide(c).action;
    if (last && a !== last) switches++;
    last = a;
  }
  assert.ok(switches <= 10, switches + ' changes of mind in 10 s');
});

test('temperature: zero is always the best; higher explores', () => {
  const run = (temp) => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const b = brainT0(); const f = exactFair(); f.mind.exploration_rate = temp;
      seen.add(b.decide(ctx(view(0, 20, { player_attacking: 0.8, player_facing_me: 0.8, damage_taken_recent: 0.05 }), [], { fair: f, rng: makeRng(i) })).action);
    }
    return seen.size;
  };
  assert.strictEqual(run(0), 1);
  assert.ok(run(0.5) > 1);
});

test('what the neural core adds is a tilt, never a door: infeasible stays infeasible', () => {
  const b = brainT0(); b.o.neuralWeight = 5;                    // absurdly strong
  const readout = { scores: Object.fromEntries(ACTIONS.map((a) => [a, a === 'attack' ? 1 : 0])) };
  const d = b.decide(ctx(view(0, 40), [], { readout, fair: exactFair() }));   // nothing ready, far away
  assert.notStrictEqual(d.action, 'attack');
});

test('a learned answer moves the aim: "you go right when I lunge"', () => {
  const b = brainT0();
  const respond = (k) => (k === 'dash' ? { action: 'right', weight: 0.9, move: [0, 9] } : null);
  const d = b.decide(ctx(view(0, 20), ['dash'], { fair: exactFair(), respond }));
  assert.strictEqual(d.attack, 'dash');
  // the boss faces +z; its right is -x
  assert.ok(d.aim.x < -3, 'aimed at x=' + d.aim.x.toFixed(2) + ', not to its right of the player');
  const plain = brainT0().decide(ctx(view(0, 20), ['dash'], { fair: exactFair() }));
  near(plain.aim.x, 0, 0.5, 'without the model it aims at them');
});

// ================================================================ §32 fallback
test('§32: a brain that throws is replaced by the FSM, and tried again later', () => {
  const bad = { decide() { throw new Error('boom'); } };
  const fb = new FsmBrain();
  const safe = new SafeBrain(bad, fb, { coolOff: 5 });
  const d = safe.decide(ctx(view(0, 6), ['reap']));
  assert.strictEqual(d.faulted, true); assert.strictEqual(safe.faults, 1); assert.ok(/boom/.test(safe.lastError));
  let calls = 0; safe.brain = { decide() { calls++; return new TacticalBrain().decide(ctx(view(0, 6), ['reap'])); }, util: new Float64Array(10) };
  safe.decide(ctx(view(0, 6), ['reap'], { now: 12 }));
  assert.strictEqual(calls, 0, 'still cooling off');
  const ok = safe.decide(ctx(view(0, 6), ['reap'], { now: 16 }));
  assert.strictEqual(calls, 1); assert.strictEqual(ok.faulted, false);
});

test('§32: NaN in the utilities, or a non-finite aim, counts as a fault', () => {
  const nanBrain = new TacticalBrain();
  const orig = nanBrain.decide.bind(nanBrain);
  nanBrain.decide = (c) => { const d = orig(c); nanBrain.util[0] = NaN; return d; };
  const safe = new SafeBrain(nanBrain, new FsmBrain());
  assert.strictEqual(safe.decide(ctx(view(0, 6), ['reap'])).faulted, true);
});

test('§32: a brain that keeps running over budget is benched', () => {
  const slow = { util: new Float64Array(10), decide(c) { const t = Date.now(); while (Date.now() - t < 6) {} return new FsmBrain().decide(c); } };
  const safe = new SafeBrain(slow, new FsmBrain(), { budgetMs: 4, strikes: 3 });
  const f = [0, 1, 2].map((i) => safe.decide(ctx(view(0, 6), ['reap'], { now: 10 + i * 0.1 })).faulted);
  assert.deepStrictEqual(f, [false, false, true]);
});

test('the FSM itself never throws on garbage', () => {
  const w = new WorldState(); w.v.fill(NaN);
  assert.doesNotThrow(() => new FsmBrain().decide(ctx(w, [])));
  assert.doesNotThrow(() => new FsmBrain().decide(ctx(new WorldState(), [])));
});

// ================================================================ the body
function swingAt(kind, tx, tz, bodyOpts) {
  const f = new FairnessController({ difficulty: 'NORMAL' });
  const b = new BossBody(OPEN, Object.assign({ fairness: f }, bodyOpts || {}));
  if (kind === 'dive') { b.mode = 'fly'; b.alt = 8; }
  const hits = [];
  assert.ok(b.attack(kind, tx, tz), kind + ' refused');
  for (let t = 0; t < 4; t += 0.05) b.step(0.05, t, [{ id: 'p', x: tx, z: tz, y: 0, alive: true }], { hit: (id, dmg) => hits.push(dmg) });
  return { hits, body: b };
}
test('body: the reap takes what is in its arc and in reach, and nothing else', () => {
  assert.strictEqual(swingAt('reap', 0, 8).hits.length, 1, 'in front, 8 m');
  assert.strictEqual(swingAt('reap', 0, 10).hits.length, 0, 'in front, 10 m');
  // it turns toward the aim while winding up, so test "behind" with a target that is not the aim
  const f = new FairnessController();
  const b = new BossBody(OPEN, { fairness: f }); b.attack('reap', 0, 5);
  let hit = 0;
  for (let t = 0; t < 2; t += 0.05) b.step(0.05, t, [{ id: 'q', x: 0, z: -4, y: 0, alive: true }], { hit: () => hit++ });
  assert.strictEqual(hit, 0, 'behind it');
});
test('body: the whirl reaches all round; the dash carries it most of the way', () => {
  const f = new FairnessController();
  const b = new BossBody(OPEN, { fairness: f }); b.attack('whirl', 0, 5);
  let hit = 0;
  for (let t = 0; t < 3; t += 0.05) b.step(0.05, t, [{ id: 'q', x: 0, z: -9, y: 0, alive: true }], { hit: () => hit++ });
  assert.strictEqual(hit, 1, 'behind it, 9 m');
  const r = swingAt('dash', 0, 28);
  assert.strictEqual(r.hits.length, 1, 'a 28 m lunge connects');
  assert.ok(r.body.z > 20, 'and it travelled: z=' + r.body.z.toFixed(1));
});
test('body: every wind-up respects the fairness floor', () => {
  for (const lvl of ['EASY', 'NORMAL', 'HARD', 'NIGHTMARE']) {
    const b = new BossBody(OPEN, { fairness: new FairnessController({ difficulty: lvl }) });
    b.attack('reap', 0, 5);
    assert.ok(b.atk.wind >= TELEGRAPH_MIN, lvl);
  }
});
test('body: a wing guard blunts shots from the front, not from behind', () => {
  const b = new BossBody(OPEN, { hpMax: 1000 }); b.guard();
  near(b.hurt(20, 0, 10), 10, 1e-9, 'front'); near(b.hurt(20, 0, -10), 20, 1e-9, 'behind');
});

// ================================================================ the arena
test('arena: rays and walls agree', () => {
  const a = new Arena({ seed: 1 });
  const bx = a.boxes[0], cx = (bx[0] + bx[1]) / 2, cz = (bx[4] + bx[5]) / 2;
  assert.ok(a.blocked(cx, cz, 1)); assert.ok(a.solid(cx, 1, cz));
  assert.ok(!a.los(cx - 30, 1.5, cz, cx + 30, 1.5, cz), 'through a building');
  assert.ok(!a.blocked(a.spawnBoss.x, a.spawnBoss.z, 1.2), 'the guardian starts in the open');
});

// ================================================================ end to end (§33)
const graph = C.hybrid(buildMockConnectome({ nodes: 2000, seed: 0x5eed }), 500);
test('§33: WorldState → Sensor → Neural Core → Tactical Brain → Action, every boss, every kind of player', () => {
  for (const bot of ['AGGRESSIVE', 'DEFENSIVE', 'RANGED', 'DODGER', 'RANDOM', 'ADAPTIVE']) {
    for (const cfg of [{ brain: 'fsm', playerModel: false }, { brain: 'tactical', neural: true, playerModel: true }]) {
      const m = runFight(Object.assign({ bot, seed: 11, graph, maxT: 60, replay: true }, cfg));
      assert.strictEqual(m.faults, 0, bot + ' ' + cfg.brain + ' faulted');
      assert.ok(m.decisions > 50, 'decisions ' + m.decisions);
      for (const r of m.replay) assert.ok(ACTIONS.includes(r.decision.action), r.decision.action);
    }
  }
});

test('§31 replay: every decision can be re-read with its state, prediction and reasons', () => {
  const m = runFight({ bot: 'DODGER', seed: 5, graph, maxT: 30, replay: true });
  const r = m.replay[m.replay.length - 1];
  for (const k of ['t', 'ws', 'prediction', 'neural', 'decision', 'reward', 'boss', 'player']) assert.ok(k in r, k);
  const w = new WorldState(); for (const k of Object.keys(r.ws)) if (k !== 't') w.v[F[k]] = r.ws[k];
  assert.deepStrictEqual(validate(w), []);
  assert.ok(r.decision.reason && r.decision.reason.candidates.length > 0);
});

test('deterministic: the same seed is the same fight', () => {
  const a = runFight({ bot: 'ADAPTIVE', seed: 21, graph, maxT: 60 }), b = runFight({ bot: 'ADAPTIVE', seed: 21, graph, maxT: 60 });
  for (const k of ['winner', 't', 'swings', 'landed', 'bossTaken', 'bossDealt', 'reward']) assert.strictEqual(a[k], b[k], k);
});

// ================================================================ it remembers
test('§40: meeting the same dodger again, what it remembers makes it land more (paired, HARD)', () => {
  //  Paired, as lab/bench/memory_effect.js explains: four fights to learn the
  //  player, then the fifth twice on the same seed, with and without the
  //  profile. At NORMAL the fairness gate damps the effect below what 30
  //  campaigns can show; HARD is where it is meant to bite.
  let sum = 0, better = 0, worse = 0;
  const N = 30, cfg = { neural: false, difficulty: 'HARD', maxT: 180, graph };
  for (let s = 1; s <= N; s++) {
    let profile = null;
    for (let f = 1; f <= 4; f++) profile = runFight(Object.assign({ bot: 'DODGER', seed: s * 7919 + f * 104729, profile }, cfg)).profile;
    const seed = s * 7919 + 5 * 104729;
    const a = runFight(Object.assign({ bot: 'DODGER', seed, profile: null }, cfg));
    const b = runFight(Object.assign({ bot: 'DODGER', seed, profile }, cfg));
    const d = (b.swings ? b.landed / b.swings : 0) - (a.swings ? a.landed / a.swings : 0);
    sum += d; if (d > 0) better++; if (d < 0) worse++;
  }
  results.push('         (hit rate +' + (100 * sum / N).toFixed(1) + ' points with memory; better in ' + better + ', worse in ' + worse + ' of ' + N + ')');
  assert.ok(sum / N > 0.03, 'mean paired gain ' + (sum / N).toFixed(3));
  assert.ok(better > worse * 1.5, better + ' better vs ' + worse + ' worse');
});

test('§40 control: a player with no habits gives it nothing to remember', () => {
  //  (RANDOM dodges in any direction at all; at 100 campaigns the paired
  //  difference is +0.3 [-2.8, +3.2]. 30 campaigns carry about +/-5.5 of noise.)
  let sum = 0;
  const N = 30, cfg = { neural: false, difficulty: 'HARD', maxT: 120, graph };
  for (let s = 1; s <= N; s++) {
    let profile = null;
    for (let f = 1; f <= 4; f++) profile = runFight(Object.assign({ bot: 'RANDOM', seed: s * 7919 + f * 104729, profile }, cfg)).profile;
    const seed = s * 7919 + 5 * 104729;
    const a = runFight(Object.assign({ bot: 'RANDOM', seed, profile: null }, cfg));
    const b = runFight(Object.assign({ bot: 'RANDOM', seed, profile }, cfg));
    sum += (b.swings ? b.landed / b.swings : 0) - (a.swings ? a.landed / a.swings : 0);
  }
  assert.ok(Math.abs(sum / N) < 0.055, 'a phantom effect of ' + (sum / N).toFixed(3));
  results.push('         (control: ' + (100 * sum / N >= 0 ? '+' : '') + (100 * sum / N).toFixed(1) + ' points)');
});

test('cost: a tactical decision is well inside a phone\'s budget', () => {
  const m = runFight({ bot: 'RANDOM', seed: 3, graph, maxT: 60 });
  assert.ok(m.brainUsPerDecision < 150, m.brainUsPerDecision.toFixed(1) + ' µs');
  results.push('         (' + m.brainUsPerDecision.toFixed(1) + ' µs per decision at 10 Hz, core + model + tactics)');
});

console.log('\nPHASE 6 — Tactical Brain / Action Selector / Boss AI Lab\n');
console.log(results.join('\n'));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
