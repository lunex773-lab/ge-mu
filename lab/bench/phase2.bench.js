'use strict';
//  ============================================================
//  PHASE 2 BENCHMARK  (spec §28 budget, §24 CPU, §8 node count)
//  ============================================================
//  Phase 1's benchmark measured a bare propagation sweep and called it a lower
//  bound. This measures the real thing — sensory tuning curves, recurrence,
//  the modulatory pathway, integration and readout — so the node count can be
//  chosen from a number instead of from a guess.
//
//  Still a workstation. D8 is "never drop a frame", and that verdict belongs
//  to the phone; what transfers is the shape of the curve and the ratio
//  between sizes.

const { buildMockConnectome } = require('../core/connectome.js');
const C = require('../core/compress.js');
const { NeuralCore, ACTIONS, CHANNELS } = require('../core/neural.js');

const pad = (s, n) => { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); };
const rp = (s, n) => { s = String(s); return ' '.repeat(Math.max(0, n - s.length)) + s; };

const inputs = {};
for (const c of CHANNELS) inputs[c] = 0.5;

const SIZES = [100, 250, 500, 1000, 2500, 5000];
const FRAME = 16.7;   // one frame at 60 FPS

console.log('\n=== NEURAL CORE COST BY SIZE ===\n');
console.log(pad('nodes', 8) + rp('edges', 8) + rp('ms/tick', 10) + rp('% frame', 10)
  + rp('@10Hz', 9) + rp('@20Hz', 9) + rp('KB', 8) + '  verdict');

const rows = [];
for (const n of SIZES) {
  //  Built at 4x and compressed down, which is how it will really be made —
  //  measuring a natively-small graph would flatter the small sizes, because
  //  compression changes the degree distribution.
  const g = C.hybrid(buildMockConnectome({ nodes: n * 4, seed: 0x5eed }), n);
  const core = new NeuralCore(g, { seed: 0xbeef });
  for (let i = 0; i < 50; i++) core.step(inputs, 0.1);        // warm up the JIT

  const ITER = 2000;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < ITER; i++) core.step(inputs, 0.1);
  const per = Number(process.hrtime.bigint() - t0) / 1e6 / ITER;

  const share = per / FRAME * 100;
  //  The core does not run every frame. §28 puts it at 10-20 Hz, so the cost
  //  that matters is what it takes out of a second, not out of a frame.
  const sec10 = per * 10 / 1000 * 100;
  const sec20 = per * 20 / 1000 * 100;
  const kb = ((g.n * 4 * 4) + (g.m * 8) + (core.modIdx.length * 8)) / 1024;
  const verdict = share < 5 ? 'comfortable' : share < 15 ? 'workable'
                : share < 40 ? 'needs a lower rate' : 'too expensive';
  rows.push({ n, per, share });
  console.log(pad(n, 8) + rp(g.m, 8) + rp(per.toFixed(3), 10) + rp(share.toFixed(1) + '%', 10)
    + rp(sec10.toFixed(1) + '%', 9) + rp(sec20.toFixed(1) + '%', 9) + rp(kb.toFixed(0), 8)
    + '  ' + verdict);
}

//  ---- what a phone has to survive -------------------------------------
console.log('\n=== SCALED TO A PHONE ===\n');
console.log('  A mid-range phone runs this kind of scalar JS roughly 4-8x slower than');
console.log('  this machine. Both ends of that band, at 10 Hz, as a share of one second:\n');
console.log(pad('nodes', 8) + rp('4x slower', 12) + rp('8x slower', 12) + '  at 10 Hz');
for (const r of rows) {
  const a = r.per * 4 * 10 / 1000 * 100;
  const b = r.per * 8 * 10 / 1000 * 100;
  const ok = b < 3 ? 'fine' : b < 8 ? 'acceptable' : b < 20 ? 'marginal' : 'no';
  console.log(pad(r.n, 8) + rp(a.toFixed(2) + '%', 12) + rp(b.toFixed(2) + '%', 12) + '  ' + ok);
}

//  ---- does size buy anything? -----------------------------------------
//  §8: "最もノード数が多いものが最強とは考えない". The way to check is to ask
//  whether a bigger network actually distinguishes more situations, not
//  whether it costs more — which it obviously does.
console.log('\n=== DOES A BIGGER NETWORK DISCRIMINATE BETTER? ===\n');
const cases = [
  { player_distance: 0.02, player_visible: 1, threat: 0.9, self_health: 1.0 },
  { player_distance: 0.95, player_visible: 0, threat: 0.05, self_health: 1.0 },
  { player_distance: 0.20, player_visible: 1, threat: 1.0, self_health: 0.05, damage_recent: 1 },
  { player_distance: 0.50, player_visible: 0.2, cover: 1, threat: 0.4, self_health: 0.8 },
  { player_distance: 0.35, player_visible: 1, player_attacking: 1, threat: 0.8, self_health: 0.6 },
  { player_distance: 0.70, player_visible: 1, player_approaching: 1, threat: 0.3, self_health: 0.9 },
];
console.log(pad('nodes', 8) + rp('separation', 12) + rp('distinct best', 15) + '   meaning');
for (const n of SIZES) {
  const g = C.hybrid(buildMockConnectome({ nodes: n * 4, seed: 0x5eed }), n);
  const vecs = [];
  const bests = new Set();
  for (const patch of cases) {
    const core = new NeuralCore(g, { seed: 0xbeef });
    const inp = {};
    for (const c of CHANNELS) inp[c] = 0;
    Object.assign(inp, patch);
    for (let i = 0; i < 80; i++) core.step(inp, 0.1);
    const r = core.readout();
    vecs.push(ACTIONS.map((a) => r.scores[a]));
    bests.add(r.best);
  }
  //  Mean pairwise L1 distance between the action vectors the situations
  //  produce. Higher means the network is telling them further apart.
  let sum = 0, pairs = 0;
  for (let i = 0; i < vecs.length; i++) {
    for (let j = i + 1; j < vecs.length; j++) {
      let d = 0;
      for (let k = 0; k < ACTIONS.length; k++) d += Math.abs(vecs[i][k] - vecs[j][k]);
      sum += d; pairs++;
    }
  }
  const sep = sum / pairs;
  console.log(pad(n, 8) + rp(sep.toFixed(4), 12) + rp(bests.size + ' of ' + cases.length, 15)
    + '   ' + (sep > 0.30 ? 'strongly separated' : sep > 0.12 ? 'separated' : sep > 0.04 ? 'weak' : 'barely responding'));
}
console.log('\n  separation = mean L1 distance between the action vectors six different');
console.log('  situations produce. It measures whether the senses are reaching the');
console.log('  outputs at all — not whether the choices are good, which is untrained.\n');
