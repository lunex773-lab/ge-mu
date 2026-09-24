//  ============================================================
//  The room's Beelzebub thinks with the game's brain  (node)
//  ============================================================
//  server/brain.js is a core worked out in advance (lab/inline.js), because
//  building one from the graph does not fit in a call's CPU time on the
//  room server. It must be the very core the game builds: the same graph
//  as index.html's, the same trained readout, and step for step the same
//  activity and the same scores.
//
//    node server/test/brain.test.js

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import brain from '../brain.js';

const require = createRequire(import.meta.url);
const { NeuralCore, CHANNELS } = require('../../lab/core/neural.js');
const { unpackGraph } = require('../../lab/core/connectome.js');
const { makeRng } = require('../../lab/core/rng.js');

const results = []; let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else fail++; results.push((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '\n         ' + detail : '')); }

//  the game's own: the graph and readout inlined into index.html
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const NC_GRAPH = JSON.parse(html.match(/const NC_GRAPH = (\{.*?\});\n/)[1]);
const NC_READOUT = JSON.parse(html.match(/const NC_READOUT = (\{.*?\}|null);\n/)[1]);

let t = process.hrtime.bigint();
const lap = () => { const n = process.hrtime.bigint(), d = Number(n - t) / 1e6; t = n; return d; };
lap();
const mine = NeuralCore.fromPrepared(brain.core);
const coldMs = lap();
const game = new NeuralCore(unpackGraph(NC_GRAPH), { seed: 0xbeef });
const trained = NC_READOUT ? game.setReadout(NC_READOUT) : false;
const gameMs = lap();

check('the same graph as the game\'s', brain.core.graph === game.g.fingerprint(), brain.core.graph);
check('and the same trained readout, fitted to it', brain.trained === true && trained === true);
check('made from what was worked out beforehand, cold, well inside a call\'s 10 ms', coldMs < 5,
  coldMs.toFixed(2) + ' ms (the game\'s way, from the graph: ' + gameMs.toFixed(2) + ' ms)');

//  the same inputs, step by step: activity and scores identical to the bit
const rng = makeRng(0x5eed), inputs = {};
let diff = 0, scoreDiff = 0, bestSame = 0;
for (let i = 0; i < 400; i++) {
  for (const c of CHANNELS) inputs[c] = rng.next() < 0.1 ? NaN : rng.next() * 1.2 - 0.1;   // now and then garbage, now and then out of range
  mine.step(inputs, i % 7 === 0 ? 0.05 : 0.1); game.step(inputs, i % 7 === 0 ? 0.05 : 0.1);
  for (let k = 0; k < mine.n; k++) if (mine.act[k] !== game.act[k]) diff++;
  const a = mine.readout(), b = game.readout();
  for (const k in a.scores) if (a.scores[k] !== b.scores[k]) scoreDiff++;
  if (a.best === b.best) bestSame++;
}
check('400 steps of the same inputs: the same activity in every neuron, and the same scores', diff === 0 && scoreDiff === 0 && bestSame === 400,
  diff + ' activations and ' + scoreDiff + ' scores differ; the same choice ' + bestSame + ' of 400 times');
check('and it stays healthy', mine.healthy() && mine.faults === 0);

console.log('\nTHE ROOM\'S BRAIN — in node\n');
console.log(results.join('\n'));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
