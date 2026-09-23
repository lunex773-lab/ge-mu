'use strict';
//  ============================================================
//  PHASE 4 TESTS  (spec §17, §18, §33)
//  ============================================================
//  What has to hold for "strong, but learnable": it reacts late by a known
//  amount, it only anticipates when it is sure and is sometimes wrong even
//  then, it cannot chain hits, every attack can be seen coming, and when it
//  adapts it gets smarter — never tougher.

const assert = require('assert');
const { FairnessController, DelayLine, MIND, BODY, LEVELS, TELEGRAPH_MIN, mindAt, ADAPT_START } = require('../core/fairness.js');
const { WorldState, F, FIELDS } = require('../core/worldstate.js');

let pass = 0, fail = 0;
const results = [];
function test(name, fn) {
  try { fn(); pass++; results.push('  ok   ' + name); }
  catch (e) { fail++; results.push('  FAIL ' + name + '\n         ' + e.message); }
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, (what || '') + ' ' + a + ' not within ' + tol + ' of ' + b);

function wsAt(t, dist, hp) {
  const w = new WorldState(); w.t = t;
  w.v[F.has_target] = 1; w.v[F.player_distance] = dist; w.v[F.self_health] = hp === undefined ? 1 : hp;
  return w;
}

// ================================================================ profiles
test('difficulties are ordered: each step up reads the player better', () => {
  for (let i = 1; i < LEVELS.length; i++) {
    const a = MIND[LEVELS[i - 1]], b = MIND[LEVELS[i]];
    assert.ok(b.reaction < a.reaction, 'reaction');
    assert.ok(b.prediction_strength > a.prediction_strength, 'prediction strength');
    assert.ok(b.prediction_threshold < a.prediction_threshold, 'threshold');
    assert.ok(b.error_rate < a.error_rate, 'error rate');
    assert.ok(b.exploration_rate < a.exploration_rate, 'exploration');
    assert.ok(b.memory_length > a.memory_length, 'memory');
  }
});

test('§18: mind and body are separate — ADAPTIVE never touches the body', () => {
  const f = new FairnessController({ difficulty: 'ADAPTIVE' });
  const body0 = JSON.stringify(f.body);
  assert.strictEqual(body0, JSON.stringify(BODY.NORMAL));
  f.setLevel(0); f.setLevel(1); f.setLevel(0.7);
  assert.strictEqual(JSON.stringify(f.body), body0, 'the body changed with the level');
  assert.notStrictEqual(JSON.stringify(f.mind), JSON.stringify(mindAt(0)), 'and the mind did move');
});

test('ADAPTIVE tops out at HARD\'s mind; NIGHTMARE has to be asked for', () => {
  const top = mindAt(1);
  for (const k of Object.keys(MIND.HARD)) near(top[k], MIND.HARD[k], 1e-9, k);
  near(mindAt(ADAPT_START).reaction, MIND.NORMAL.reaction, 1e-9, 'starts at NORMAL');
  near(mindAt(0).reaction, MIND.EASY.reaction, 1e-9, 'bottoms out at EASY');
});

// ================================================================ reaction
test('reaction delay: the brain sees the world exactly `reaction` seconds late', () => {
  const f = new FairnessController({ difficulty: 'NORMAL' });   // 0.32 s
  let seen = null;
  for (let i = 0; i <= 20; i++) {
    const t = +(i * 0.05).toFixed(2);
    seen = f.perceive(wsAt(t, 100 - i));                          // distance encodes the time it was true
    if (t < 0.32 - 1e-9) assert.strictEqual(seen, null, 'at ' + t + ' it should not have seen anything yet');
  }
  // now = 1.00; the newest state at least 0.32 s old is from t = 0.65 (distance 87)
  near(seen.get('player_distance'), 87, 1e-4, 'delayed distance');
});

test('reaction delay: its own body is never delayed', () => {
  const f = new FairnessController({ difficulty: 'EASY' });
  let v;
  for (let i = 0; i <= 20; i++) v = f.perceive(wsAt(i * 0.05, 50, 1 - i * 0.04));
  near(v.get('self_health'), 1 - 20 * 0.04, 1e-6, 'self health is current');
  const selfFields = FIELDS.filter((q) => q[4] === 'self').map((q) => q[0]);
  assert.ok(selfFields.includes('self_cooldown') && selfFields.length >= 5, selfFields.join(','));
});

test('delay line: slots are reused, never reallocated', () => {
  const d = new DelayLine(8);
  const slots = d.slots.slice();
  for (let i = 0; i < 100; i++) d.push(wsAt(i * 0.1, i));
  for (let i = 0; i < 8; i++) assert.strictEqual(d.slots[i], slots[i]);
  near(d.read(9.9, 0.3).get('player_distance'), 96, 1e-6);
  assert.strictEqual(d.read(9.9, 5), null, 'older than the ring holds: nothing, not a wrong answer');
});

// ================================================================ prediction
const PRED = (conf) => ({ probs: { dodge_right: 0.7, dodge_left: 0.2, retreat: 0.1 }, confidence: conf });

test('§15: below the threshold it does not anticipate at all', () => {
  const f = new FairnessController({ difficulty: 'NORMAL' });   // threshold 0.62
  assert.strictEqual(f.gatePrediction(PRED(0.61)), null);
  assert.ok(f.gatePrediction(PRED(0.63)));
  assert.strictEqual(f.gatePrediction(null), null);
  assert.strictEqual(f.gatePrediction({ probs: {}, confidence: NaN }), null);
});

test('§17: even a confident read is sometimes wrong, at the configured rate', () => {
  for (const lvl of LEVELS) {
    const f = new FairnessController({ difficulty: lvl, seed: 99 });
    let wrong = 0; const N = 20000;
    for (let i = 0; i < N; i++) if (f.gatePrediction(PRED(0.99)).action !== 'dodge_right') wrong++;
    near(wrong / N, MIND[lvl].error_rate, 0.012, lvl + ' error rate');
  }
});

test('the weight it may put on a prediction scales with strength and confidence', () => {
  const easy = new FairnessController({ difficulty: 'EASY', seed: 1 }).gatePrediction(PRED(0.9));
  const hard = new FairnessController({ difficulty: 'HARD', seed: 1 }).gatePrediction(PRED(0.9));
  near(easy.weight, 0.30 * 0.9, 1e-9); near(hard.weight, 0.85 * 0.9, 1e-9);
});

test('aim: it leads a moving target only as far as it is allowed, and scatters', () => {
  const run = (lvl) => {
    const f = new FairnessController({ difficulty: lvl, seed: 4 });
    let lead = 0, spread = 0; const N = 4000, o = {};
    for (let i = 0; i < N; i++) { f.aim(0, 0, 10, 0, o); lead += o.x; spread += o.z * o.z; }
    return { lead: lead / N, spread: Math.sqrt(spread / N) };
  };
  const e = run('EASY'), n = run('NIGHTMARE');
  near(e.lead, 10 * 0.55 * 0.30, 0.1, 'easy lead'); near(n.lead, 10 * 0.97 * 1.0, 0.1, 'nightmare lead');
  assert.ok(e.spread > n.spread * 5, 'easy should scatter far more: ' + e.spread.toFixed(3) + ' vs ' + n.spread.toFixed(3));
});

// ================================================================ attacks
test('no stun-lock: after landing a hit it must leave that player alone for a while', () => {
  const f = new FairnessController({ difficulty: 'NIGHTMARE' });
  assert.ok(f.mayAttack('a', 10));
  f.noteAttack(10); f.noteLanded('a', 10.2, 0.2);
  assert.ok(!f.mayAttack('a', 10.3), 'right after the hit');
  assert.ok(f.mayAttack('b', 10.3), 'someone else is fair game');
  assert.ok(f.mayAttack('a', 10.2 + BODY.NIGHTMARE.relief + 0.01), 'and the window ends');
});

test('pressure budget: no more attacks per 6 s than the difficulty allows', () => {
  for (const lvl of LEVELS) {
    const f = new FairnessController({ difficulty: lvl });
    let n = 0;
    for (let t = 0; t < 6; t += 0.05) if (f.mayAttack('x', t)) { f.noteAttack(t); n++; }
    assert.strictEqual(n, BODY[lvl].pressure, lvl);
  }
});

test('every attack can be seen coming: no wind-up under the floor, at any difficulty', () => {
  for (const lvl of LEVELS) {
    const f = new FairnessController({ difficulty: lvl });
    for (const base of [0.1, 0.3, 0.45, 0.55, 0.9]) assert.ok(f.telegraph(base) >= TELEGRAPH_MIN, lvl + ' ' + base);
    near(f.telegraph(1.0), BODY[lvl].telegraph, 1e-9);
  }
});

// ================================================================ ADAPTIVE
function fight(f, secs, bossPerSec, playerPerSec, deathsEvery) {
  let t = 0, nextDeath = deathsEvery || Infinity;
  while (t < secs) {
    t += 1;
    f.noteBossHurt(bossPerSec, t);
    if (playerPerSec) f.noteLanded('p', t, playerPerSec);
    if (t >= nextDeath) { f.notePlayerDied(t); nextDeath += deathsEvery; }
    f.adapt(t, 1);
  }
  return f.level;
}

test('ADAPTIVE: a player walking all over it gets read more closely', () => {
  const f = new FairnessController();
  const l = fight(f, 180, 1 / 90, 0);                // boss dies in 90 s, player untouched
  assert.ok(l > ADAPT_START + 0.3, 'level only reached ' + l.toFixed(3));
  assert.ok(f.mind.reaction < MIND.NORMAL.reaction, 'and it reacts faster');
});

test('ADAPTIVE: a player being taken apart gets an easier read', () => {
  const f = new FairnessController();
  const l = fight(f, 180, 1 / 1200, 1 / 25, 25);     // player dies every 25 s, boss barely scratched
  assert.ok(l < ADAPT_START - 0.25, 'level only fell to ' + l.toFixed(3));
});

test('ADAPTIVE: a fair fight is left alone', () => {
  const f = new FairnessController();
  const l = fight(f, 300, 1 / 300, 1 / 60);
  near(l, ADAPT_START, 0.02, 'level drifted');
});

test('ADAPTIVE: with nothing happening it does not drift', () => {
  const f = new FairnessController();
  for (let t = 1; t < 600; t++) f.adapt(t, 1);
  assert.strictEqual(f.level, ADAPT_START);
});

test('D4: where ADAPTIVE settled survives a reload; garbage is refused', () => {
  const a = new FairnessController(); a.setLevel(0.83);
  const b = new FairnessController();
  assert.ok(b.restore(JSON.parse(JSON.stringify(a.serialize()))));
  near(b.level, 0.83, 1e-4); near(b.mind.reaction, a.mind.reaction, 1e-4);
  for (const bad of [null, {}, { v: 1, level: NaN }, { v: 2, level: 0.5 }, { v: 1, level: 'x' }]) assert.ok(!b.restore(bad));
  near(b.level, 0.83, 1e-4, 'unchanged by garbage');
});

test('deterministic under a seed', () => {
  const run = () => { const f = new FairnessController({ seed: 7, difficulty: 'HARD' }), out = [], o = {};
    for (let i = 0; i < 200; i++) { const g = f.gatePrediction(PRED(0.9)); f.aim(0, 0, 5, 5, o); out.push(g.action, o.x, o.z); }
    return out; };
  assert.deepStrictEqual(run(), run());
});

console.log('\nPHASE 4 — FairnessController\n');
console.log(results.join('\n'));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
