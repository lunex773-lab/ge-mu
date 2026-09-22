'use strict';
//  ============================================================
//  PHASE 2 TESTS  (spec §33)
//  ============================================================
//  The properties that matter for a Neural Core are not "does it produce a
//  number" — anything produces a number. They are: does it stay finite under
//  abuse, does it actually carry state between ticks, does the graph's
//  structure reach the output, and does it ever recover from being broken.

const assert = require('assert');
const { buildMockConnectome, CLASS } = require('../core/connectome.js');
const C = require('../core/compress.js');
const { NeuralCore, ACTIONS, CHANNELS } = require('../core/neural.js');

let pass = 0, fail = 0;
const results = [];
function test(name, fn) {
  try { fn(); pass++; results.push('  ok   ' + name); }
  catch (e) { fail++; results.push('  FAIL ' + name + '\n         ' + e.message); }
}

const G = () => C.hybrid(buildMockConnectome({ nodes: 2000, seed: 0x5eed }), 500);
const zero = () => { const o = {}; for (const c of CHANNELS) o[c] = 0; return o; };
const mid = () => { const o = {}; for (const c of CHANNELS) o[c] = 0.5; return o; };

// ---------------------------------------------------------------- determinism
test('the same graph and the same inputs give the same output', () => {
  const g = G();
  const a = new NeuralCore(g, { seed: 1 }), b = new NeuralCore(g, { seed: 1 });
  for (let i = 0; i < 40; i++) { a.step(mid(), 0.1); b.step(mid(), 0.1); }
  const ra = a.readout(), rb = b.readout();
  for (const act of ACTIONS) assert.strictEqual(ra.scores[act], rb.scores[act], act + ' diverged');
});

// ------------------------------------------------------------------- finiteness
test('output is finite for ordinary input', () => {
  const core = new NeuralCore(G(), { seed: 2 });
  for (let i = 0; i < 200; i++) {
    const r = core.step(mid(), 0.1);
    for (const act of ACTIONS) assert.ok(Number.isFinite(r.scores[act]), act + ' was ' + r.scores[act]);
  }
});

test('output survives hostile input: NaN, Infinity, out of range, missing, wrong type', () => {
  const core = new NeuralCore(G(), { seed: 3 });
  const hostile = [NaN, Infinity, -Infinity, 1e9, -1e9, 'nonsense', null, undefined, {}];
  for (let i = 0; i < 300; i++) {
    const inp = {};
    for (const c of CHANNELS) inp[c] = hostile[(i + c.length) % hostile.length];
    if (i % 3 === 0) delete inp[CHANNELS[i % CHANNELS.length]];   // missing channel entirely
    const r = core.step(inp, 0.1);
    for (const act of ACTIONS) assert.ok(Number.isFinite(r.scores[act]),
      act + ' went non-finite on hostile input at tick ' + i);
  }
  assert.ok(core.healthy(), 'core left in an unhealthy state');
});

test('a nonsense dt does not blow up the dynamics', () => {
  const core = new NeuralCore(G(), { seed: 4 });
  for (const dt of [0, -1, NaN, Infinity, 1e6, undefined]) {
    for (let i = 0; i < 20; i++) core.step(mid(), dt);
    assert.ok(core.healthy(), 'unhealthy after dt=' + dt);
  }
});

test('activation stays bounded however long it runs', () => {
  const core = new NeuralCore(G(), { seed: 5 });
  for (let i = 0; i < 2000; i++) core.step(i % 2 ? mid() : zero(), 0.1);
  for (let i = 0; i < core.n; i++) assert.ok(Math.abs(core.act[i]) <= 1.001, 'neuron ' + i + ' at ' + core.act[i]);
});

// --------------------------------------------------------------- temporal state
test('it has memory: the same input gives a different answer after a different history', () => {
  const g = G();
  const a = new NeuralCore(g, { seed: 6 }), b = new NeuralCore(g, { seed: 6 });
  //  different pasts
  for (let i = 0; i < 30; i++) a.step(zero(), 0.1);
  const hot = mid(); hot.player_distance = 0.05; hot.player_attacking = 1; hot.threat = 1;
  for (let i = 0; i < 30; i++) b.step(hot, 0.1);
  //  identical present
  const ra = a.step(mid(), 0.1), rb = b.step(mid(), 0.1);
  let diff = 0;
  for (const act of ACTIONS) diff += Math.abs(ra.scores[act] - rb.scores[act]);
  //  A stateless function would score exactly 0 here. That it does not is the
  //  single property separating this from a lookup table.
  assert.ok(diff > 1e-4, 'identical output after different histories — no state is being carried (diff ' + diff + ')');
});

test('the memory fades: a disturbance decays back toward rest', () => {
  const core = new NeuralCore(G(), { seed: 7 });
  //  Settle first and record where "quiet" actually is.
  //
  //  The obvious version of this test measures mean |activation| and expects
  //  it to fall. That is the wrong quantity: a network with a bias term has a
  //  non-zero resting state — here the recurrence amplifies a +/-0.06 bias to
  //  about 0.23 — and a strong input can perfectly well drive some neurons
  //  *toward* zero, so raw energy after a disturbance can sit below rest and
  //  the test fails on a network that is behaving correctly. What has to decay
  //  is the distance from rest, which is what "it forgets" actually means.
  for (let i = 0; i < 200; i++) core.step(zero(), 0.1);
  const rest = Float32Array.from(core.act);
  const from = (c) => { let s = 0; for (let i = 0; i < c.n; i++) s += Math.abs(c.act[i] - rest[i]); return s / c.n; };

  const hot = mid(); hot.threat = 1; hot.player_attacking = 1; hot.player_distance = 0.05;
  for (let i = 0; i < 60; i++) core.step(hot, 0.1);
  const disturbed = from(core);
  assert.ok(disturbed > 1e-3, 'the input did not disturb the network at all (' + disturbed + ')');

  for (let i = 0; i < 20; i++) core.step(zero(), 0.1);
  const soon = from(core);
  for (let i = 0; i < 200; i++) core.step(zero(), 0.1);
  const later = from(core);

  assert.ok(soon < disturbed, 'no decay in the first 2 s: ' + disturbed.toFixed(4) + ' -> ' + soon.toFixed(4));
  assert.ok(later < disturbed * 0.2,
    'the disturbance persisted: ' + disturbed.toFixed(4) + ' -> ' + later.toFixed(4));
});

test('the tick rate does not change the behaviour', () => {
  const g = G();
  const fast = new NeuralCore(g, { seed: 8 }), slow = new NeuralCore(g, { seed: 8 });
  //  two seconds of game time, at 20 Hz and at 10 Hz
  for (let i = 0; i < 40; i++) fast.step(mid(), 0.05);
  for (let i = 0; i < 20; i++) slow.step(mid(), 0.1);
  let diff = 0;
  for (const act of ACTIONS) diff += Math.abs(fast.readout().scores[act] - slow.readout().scores[act]);
  //  Not identical — different sampling cannot be — but close, or a phone
  //  that drops the core to a lower rate would be fighting a different boss.
  assert.ok(diff < 0.25, 'rate changed the outcome by ' + diff.toFixed(3));
});

// ------------------------------------------------------------- does input matter
test('different situations produce different preferences', () => {
  const g = G();
  const seen = new Set();
  const cases = {
    'right on top of us': { player_distance: 0.02, player_visible: 1, threat: 0.9, self_health: 1 },
    'far and unseen':     { player_distance: 0.95, player_visible: 0, threat: 0.05, self_health: 1 },
    'badly hurt':         { player_distance: 0.2, player_visible: 1, threat: 1, self_health: 0.05, damage_recent: 1 },
    'behind cover':       { player_distance: 0.5, player_visible: 0.2, cover: 1, threat: 0.4, self_health: 0.8 },
  };
  const out = {};
  for (const [name, patch] of Object.entries(cases)) {
    const core = new NeuralCore(g, { seed: 9 });
    const inp = Object.assign(zero(), patch);
    for (let i = 0; i < 60; i++) core.step(inp, 0.1);
    const r = core.readout();
    out[name] = r.best;
    seen.add(ACTIONS.map((a) => r.scores[a].toFixed(3)).join(','));
  }
  //  It need not pick a *sensible* action — that is the Tactical Brain's job
  //  in Phase 6, and an untrained core has no reason to be wise. What it must
  //  do is respond at all; a core that returns the same vector for "the player
  //  is inside your guard" and "the player is 90 m away and invisible" has no
  //  information flowing from its senses to its outputs.
  assert.strictEqual(seen.size, Object.keys(cases).length,
    'some situations produced identical output: ' + JSON.stringify(out));
});

test('inhibition is load-bearing: silencing the inhibitory population changes the answer', () => {
  const g = G();
  const a = new NeuralCore(g, { seed: 10 });
  const b = new NeuralCore(g, { seed: 10 });
  //  Knock out inhibition by hand, the crudest possible lesion. Reaching
  //  into b.w rather than into the graph is the point: the core owns its own
  //  weights, so lesioning one core must leave every other core intact.
  for (let v = 0; v < b.n; v++) {
    if (g.nodes[v].sign >= 0) continue;
    for (let k = b.start[v]; k < b.start[v + 1]; k++) b.w[k] = 0;
  }
  //  and the control must genuinely be untouched
  let aliveInA = 0;
  for (let v = 0; v < a.n; v++) {
    if (g.nodes[v].sign >= 0) continue;
    for (let k = a.start[v]; k < a.start[v + 1]; k++) if (a.w[k] !== 0) aliveInA++;
  }
  assert.ok(aliveInA > 0, 'lesioning one core also lesioned the control — weights are shared');
  for (let i = 0; i < 60; i++) { a.step(mid(), 0.1); b.step(mid(), 0.1); }
  let diff = 0;
  for (const act of ACTIONS) diff += Math.abs(a.readout().scores[act] - b.readout().scores[act]);
  assert.ok(diff > 1e-3, 'removing every inhibitory synapse changed nothing (diff ' + diff + ')');
});

test('modulatory neurons change gain without driving anything themselves', () => {
  const g = G();
  const on = new NeuralCore(g, { seed: 11, modStrength: 0.85 });
  const off = new NeuralCore(g, { seed: 11, modStrength: 0 });
  for (let i = 0; i < 60; i++) { on.step(mid(), 0.1); off.step(mid(), 0.1); }
  let diff = 0;
  for (const act of ACTIONS) diff += Math.abs(on.readout().scores[act] - off.readout().scores[act]);
  assert.ok(diff > 1e-4, 'the modulatory pathway is inert (diff ' + diff + ')');
});

// ----------------------------------------------------------------- readout shape
test('the readout is well formed', () => {
  const core = new NeuralCore(G(), { seed: 12 });
  const r = core.step(mid(), 0.1);
  assert.ok(ACTIONS.includes(r.best), 'best was ' + r.best);
  let sum = 0;
  for (const a of ACTIONS) {
    assert.ok(r.scores[a] >= 0 && r.scores[a] <= 1, a + ' out of 0..1: ' + r.scores[a]);
    sum += r.share[a];
  }
  assert.ok(Math.abs(sum - 1) < 1e-5, 'shares summed to ' + sum);
  assert.ok(Number.isFinite(r.confidence));
});

test('every action has motor neurons behind it', () => {
  const core = new NeuralCore(G(), { seed: 13 });
  for (let a = 0; a < ACTIONS.length; a++) {
    assert.ok(core.mStart[a + 1] > core.mStart[a], ACTIONS[a] + ' has an empty motor pool');
  }
});

// -------------------------------------------------------------------- recovery
test('a corrupted core is detected and recovers on its own (§32)', () => {
  const core = new NeuralCore(G(), { seed: 14 });
  for (let i = 0; i < 20; i++) core.step(mid(), 0.1);
  core.act[0] = NaN; core.act[1] = 1e30;
  assert.ok(!core.healthy(), 'corruption not detected');
  let r = null;
  for (let i = 0; i < 20; i++) r = core.step(mid(), 0.1);       // the 16-tick check must fire
  assert.ok(core.healthy(), 'core did not recover');
  assert.ok(core.faults > 0, 'recovery happened silently — a fault must be counted');
  for (const a of ACTIONS) assert.ok(Number.isFinite(r.scores[a]));
});

test('it runs on a tiny graph without dividing by zero', () => {
  const g = C.hybrid(buildMockConnectome({ nodes: 60, seed: 15 }), 40);
  const core = new NeuralCore(g, { seed: 15 });
  for (let i = 0; i < 50; i++) {
    const r = core.step(mid(), 0.1);
    for (const a of ACTIONS) assert.ok(Number.isFinite(r.scores[a]));
  }
});

// ------------------------------------------------------------- introspection
test('the debug views work and stay cheap to ask for', () => {
  const core = new NeuralCore(G(), { seed: 16 });
  for (let i = 0; i < 30; i++) core.step(mid(), 0.1);
  const act = core.activity();
  for (const c of Object.keys(CLASS)) assert.ok(Number.isFinite(act[c]), c + ' activity was ' + act[c]);
  const snap = core.snapshot();
  assert.strictEqual(snap.act.length, core.n);
  assert.ok(snap.act instanceof Int8Array, 'snapshot must be compact for replay');
});

test('a step allocates nothing that grows', () => {
  const core = new NeuralCore(G(), { seed: 17 });
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 4000; i++) core.step(mid(), 0.1);
  global.gc && global.gc();
  const after = process.memoryUsage().heapUsed;
  //  The readout object is allocated per call and that is fine; what must not
  //  happen is the state arrays growing. A few hundred KB of readouts over
  //  4000 ticks is expected, tens of megabytes is a leak.
  assert.ok(after - before < 24 * 1024 * 1024,
    'heap grew by ' + ((after - before) / 1048576).toFixed(1) + ' MB over 4000 ticks');
});

console.log('\nPHASE 2 — Neural Core\n');
console.log(results.join('\n'));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
