'use strict';
//  ============================================================
//  PHASE 1 BENCHMARK  (spec §8 comparison, §33 stress test)
//  ============================================================
//  Node counts are a parameter to be measured, not a constant to be chosen —
//  §8 says so twice. This prints the table that decision gets made from.
//
//  These numbers are from a workstation and are therefore an upper bound on
//  what is affordable, not a budget. The budget is whatever the phone says in
//  Phase 2, and the only figure here that transfers is the *shape* of the
//  curve: how cost grows with node count, and which strategy keeps the graph
//  conducting as the budget tightens.

const { buildMockConnectome, analyse } = require('../core/connectome.js');
const C = require('../core/compress.js');

const SIZES = [100, 500, 1000, 2500, 5000];

function ms(fn) {
  const t0 = process.hrtime.bigint();
  const r = fn();
  return { r, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
}

function pad(s, n) { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); }
function rpad(s, n) { s = String(s); return ' '.repeat(Math.max(0, n - s.length)) + s; }

console.log('\n=== BUILD COST BY SIZE (spec §8) ===\n');
console.log(pad('nodes', 8) + rpad('edges', 9) + rpad('build ms', 10) + rpad('csr ms', 9)
  + rpad('mean deg', 10) + rpad('hub x', 7) + rpad('reach', 8) + rpad('E/I', 7) + rpad('bytes~', 10));

const built = {};
for (const n of SIZES) {
  const b = ms(() => buildMockConnectome({ nodes: n, seed: 0x5eed }));
  const g = b.r;
  built[n] = g;
  const c = ms(() => g.csr());
  const a = analyse(g);
  //  A CSR is two Int32Arrays and a Float32Array; that is the memory the
  //  Neural Core will actually hold, so it is the number worth printing.
  const bytes = (g.n + 1) * 4 + g.m * 4 + g.m * 4;
  console.log(pad(n, 8) + rpad(g.m, 9) + rpad(b.ms.toFixed(1), 10) + rpad(c.ms.toFixed(1), 9)
    + rpad(a.meanDegree, 10) + rpad(a.hubRatio, 7) + rpad(a.reach, 8)
    + rpad(a.eiRatio, 7) + rpad((bytes / 1024).toFixed(0) + 'K', 10));
}

//  ---- a stand-in for one inference pass -------------------------------
//  Not the Neural Core — that is Phase 2 — but the same memory traffic: one
//  sweep of every edge, accumulating into a per-node activation. Whatever the
//  dynamics turn out to be, they cannot be cheaper than this, so it is a fair
//  lower bound on the per-tick cost.
function sweepCost(g, iters) {
  const { start, idx, w } = g.csr();
  const act = new Float32Array(g.n).fill(0.1);
  const next = new Float32Array(g.n);
  const t0 = process.hrtime.bigint();
  for (let it = 0; it < iters; it++) {
    next.fill(0);
    for (let v = 0; v < g.n; v++) {
      const a = act[v];
      if (a === 0) continue;
      for (let k = start[v]; k < start[v + 1]; k++) next[idx[k]] += a * w[k];
    }
    for (let i = 0; i < g.n; i++) act[i] = Math.tanh(next[i]);
  }
  return Number(process.hrtime.bigint() - t0) / 1e6 / iters;
}

console.log('\n=== ONE PROPAGATION SWEEP (lower bound on a Neural Core tick) ===\n');
console.log(pad('nodes', 8) + rpad('ms/tick', 10) + rpad('@10Hz', 10) + rpad('@20Hz', 10) + '   verdict');
for (const n of SIZES) {
  const g = built[n];
  const per = sweepCost(g, 200);
  //  A 60 FPS frame is 16.7 ms. The spec's §28 budget puts the core at
  //  10-20 Hz, so the question is what share of one frame it costs when it
  //  does run, not what it costs every frame.
  const at10 = per * 10 / 1000 * 100;   // % of one second
  const at20 = per * 20 / 1000 * 100;
  const frameShare = per / 16.7 * 100;
  const verdict = frameShare < 6 ? 'comfortable'
                : frameShare < 18 ? 'workable'
                : frameShare < 45 ? 'tight — needs a lower rate'
                : 'too expensive for a phone';
  console.log(pad(n, 8) + rpad(per.toFixed(3), 10) + rpad(at10.toFixed(1) + '%', 10)
    + rpad(at20.toFixed(1) + '%', 10) + '   ' + verdict + '  (' + frameShare.toFixed(1) + '% of a frame)');
}

//  ---- strategy comparison ---------------------------------------------
console.log('\n=== COMPRESSION STRATEGIES, 5000 -> 500 (spec §8) ===\n');
console.log(pad('strategy', 12) + rpad('nodes', 8) + rpad('edges', 9) + rpad('mean deg', 10)
  + rpad('reach', 8) + rpad('isolated', 10) + rpad('ms', 7));
for (const row of C.compare(built[5000], 500)) {
  console.log(pad(row.strategy, 12) + rpad(row.nodes, 8) + rpad(row.edges, 9)
    + rpad(row.meanDegree, 10) + rpad(row.reach, 8) + rpad(row.isolated, 10) + rpad(row.ms, 7));
}

console.log('\n=== THE SAME, UNDER HARD COMPRESSION 5000 -> 150 ===\n');
console.log(pad('strategy', 12) + rpad('nodes', 8) + rpad('edges', 9) + rpad('mean deg', 10)
  + rpad('reach', 8) + rpad('isolated', 10) + rpad('ms', 7));
for (const row of C.compare(built[5000], 150)) {
  console.log(pad(row.strategy, 12) + rpad(row.nodes, 8) + rpad(row.edges, 9)
    + rpad(row.meanDegree, 10) + rpad(row.reach, 8) + rpad(row.isolated, 10) + rpad(row.ms, 7));
}
console.log('\n  reach = fraction of motor neurons still receiving signal from any sense.');
console.log('  A strategy that scores well on size and badly on reach has produced');
console.log('  a smaller graph, not a working one.\n');
