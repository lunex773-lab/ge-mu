'use strict';
//  ============================================================
//  PHASE 1 TESTS  (spec §33)
//  ============================================================
//  No framework, because adding one would mean adding npm to a repository
//  whose whole character is that it has no build step. assert plus a counter
//  is enough for a layer this size.

const assert = require('assert');
const { buildMockConnectome, analyse, CLASS, NT } = require('../core/connectome.js');
const C = require('../core/compress.js');

let pass = 0, fail = 0;
const results = [];
function test(name, fn) {
  try { fn(); pass++; results.push('  ok   ' + name); }
  catch (e) { fail++; results.push('  FAIL ' + name + '\n         ' + e.message); }
}

// ---------------------------------------------------------------- determinism
test('same seed produces a byte-identical graph', () => {
  const a = buildMockConnectome({ nodes: 800, seed: 1234 });
  const b = buildMockConnectome({ nodes: 800, seed: 1234 });
  assert.strictEqual(a.fingerprint(), b.fingerprint());
  assert.strictEqual(a.n, b.n);
  assert.strictEqual(a.m, b.m);
});

test('a different seed produces a different graph', () => {
  const a = buildMockConnectome({ nodes: 800, seed: 1234 });
  const b = buildMockConnectome({ nodes: 800, seed: 1235 });
  assert.notStrictEqual(a.fingerprint(), b.fingerprint());
});

// ------------------------------------------------------------------ structure
test('node count lands on its target', () => {
  for (const n of [100, 500, 1000, 2500, 5000]) {
    const g = buildMockConnectome({ nodes: n, seed: 7 });
    assert.strictEqual(g.n, n, 'wanted ' + n + ', built ' + g.n);
  }
});

test("Dale's principle holds: every neuron's outgoing synapses share its sign", () => {
  const g = buildMockConnectome({ nodes: 600, seed: 42 });
  const { start, w } = g.csr();
  for (let v = 0; v < g.n; v++) {
    const want = g.nodes[v].sign;
    for (let k = start[v]; k < start[v + 1]; k++) {
      const s = Math.sign(w[k]);
      assert.ok(want === 0 ? s === 0 : s === want,
        'neuron ' + v + ' (' + g.nodes[v].nt + ', sign ' + want + ') emitted ' + w[k]);
    }
  }
});

test('all seven functional classes are represented', () => {
  const g = buildMockConnectome({ nodes: 1200, seed: 3 });
  const a = analyse(g);
  for (const c of Object.keys(CLASS)) {
    assert.ok(a.classes[c] > 0, 'class ' + c + ' is empty');
  }
});

test('excitatory / inhibitory balance is in the intended band', () => {
  const g = buildMockConnectome({ nodes: 2000, seed: 11 });
  const a = analyse(g);
  assert.ok(a.eiRatio > 1.8 && a.eiRatio < 4.5, 'E/I ratio was ' + a.eiRatio);
  assert.ok(a.modulatory > 0, 'no modulatory neurons');
});

test('the degree distribution is heavy-tailed, not Poisson', () => {
  const g = buildMockConnectome({ nodes: 2000, seed: 5 });
  const a = analyse(g);
  //  A Poisson graph of this mean would put maxDegree within a few multiples
  //  of the mean. Hubs are the reason to use connectome topology at all, so
  //  this is the test that would catch the generator silently degenerating
  //  into a random graph.
  assert.ok(a.hubRatio > 4, 'max/mean degree was only ' + a.hubRatio);
  assert.ok(a.top1PctDegreeShare > 0.03, 'top 1% carried only ' + a.top1PctDegreeShare);
});

test('signal reaches motor neurons from sensory neurons', () => {
  const g = buildMockConnectome({ nodes: 1000, seed: 9 });
  assert.ok(analyse(g).reach > 0.9, 'reach was ' + analyse(g).reach);
});

test('almost nothing is left unwired', () => {
  const g = buildMockConnectome({ nodes: 1000, seed: 13 });
  const a = analyse(g);
  assert.ok(a.isolated / a.nodes < 0.02, a.isolated + ' isolated of ' + a.nodes);
});

// ----------------------------------------------------------------- robustness
test('no NaN or Infinity anywhere in the graph', () => {
  const g = buildMockConnectome({ nodes: 1500, seed: 21 });
  for (const e of g.edges) {
    assert.ok(Number.isFinite(e.w), 'edge weight ' + e.w);
    assert.ok(Number.isFinite(e.conf), 'edge confidence ' + e.conf);
    assert.ok(e.w > 0, 'weight must be a positive magnitude, got ' + e.w);
  }
  const { w } = g.csr();
  for (let i = 0; i < w.length; i++) assert.ok(Number.isFinite(w[i]), 'csr weight ' + w[i]);
});

test('a tiny graph still builds rather than dividing by zero', () => {
  const g = buildMockConnectome({ nodes: 10, seed: 1 });
  assert.ok(g.n === 10 && g.m > 0);
  const a = analyse(g);
  assert.ok(Number.isFinite(a.density) && Number.isFinite(a.meanDegree));
});

// ---------------------------------------------------------------- compression
test('every strategy hits its node target without overshooting', () => {
  const g = buildMockConnectome({ nodes: 2000, seed: 17 });
  for (const name of Object.keys(C.STRATEGIES)) {
    const c = C.STRATEGIES[name](g, 500);
    assert.ok(c.n <= 520, name + ' returned ' + c.n + ' nodes for a target of 500');
    assert.ok(c.n > 100, name + ' collapsed to ' + c.n + ' nodes');
  }
});

test('path preservation keeps the graph conducting under hard compression', () => {
  const g = buildMockConnectome({ nodes: 3000, seed: 23 });
  //  Tested at 5% of the original, not 20%. At a gentle ratio both strategies
  //  score 1.0 and the comparison says nothing — the failure mode this module
  //  exists to avoid only appears once the budget is genuinely tight, which
  //  is also the regime a phone will actually run in.
  const path = analyse(C.byPath(g, 150));
  const degree = analyse(C.byDegree(g, 150));
  assert.ok(path.reach > 0.8, 'path strategy reach was ' + path.reach);
  assert.ok(path.reach >= degree.reach,
    'path (' + path.reach + ') did not beat degree (' + degree.reach + ')');
});

test('compressed graphs renumber cleanly and keep every edge in range', () => {
  const g = buildMockConnectome({ nodes: 1500, seed: 31 });
  const c = C.hybrid(g, 400);
  for (const e of c.edges) {
    assert.ok(e.src >= 0 && e.src < c.n, 'src out of range: ' + e.src);
    assert.ok(e.dst >= 0 && e.dst < c.n, 'dst out of range: ' + e.dst);
  }
  for (let i = 0; i < c.n; i++) assert.strictEqual(c.nodes[i].id, i, 'node ids must be positional');
  //  and the CSR must still build over the renumbered set
  const { start, idx } = c.csr();
  assert.strictEqual(start[c.n], c.m);
  for (let i = 0; i < idx.length; i++) assert.ok(idx[i] >= 0 && idx[i] < c.n);
});

test('compression is deterministic too', () => {
  const g = buildMockConnectome({ nodes: 1200, seed: 77 });
  for (const name of Object.keys(C.STRATEGIES)) {
    const a = C.STRATEGIES[name](g, 300).fingerprint();
    const b = C.STRATEGIES[name](g, 300).fingerprint();
    assert.strictEqual(a, b, name + ' is not reproducible');
  }
});

test('edge pruning removes edges and leaves nodes alone', () => {
  const g = buildMockConnectome({ nodes: 1000, seed: 41 });
  const s = C.simplify(g, 0.5);
  assert.strictEqual(s.n, g.n);
  assert.ok(Math.abs(s.m - g.m * 0.5) < g.m * 0.02, 'kept ' + s.m + ' of ' + g.m);
});

test('community detection produces several communities, not one blob', () => {
  const g = buildMockConnectome({ nodes: 1500, seed: 53 });
  const lab = C.communities(g, 1);
  const uniq = new Set(Array.from(lab));
  assert.ok(uniq.size > 2, 'found only ' + uniq.size + ' communities');
  assert.ok(uniq.size < g.n / 2, 'found ' + uniq.size + ' communities — no grouping happened');
});

// ------------------------------------------------------------------- report
console.log('\nPHASE 1 — Mock Connectome / Graph / Compression\n');
console.log(results.join('\n'));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
