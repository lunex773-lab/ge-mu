'use strict';
//  ============================================================
//  PHASE 10 — learning the readout, offline  (spec §20, §21, §25 E)
//  ============================================================
//
//  §20: never learn in the live game; learn in the simulation, evaluate,
//  export, and let the game run inference only. So:
//
//    Simulation   lab/sim — the same body, senses, fairness, player model
//                 and tactics the game runs, against all six bot types (§23),
//                 so it cannot learn to beat one kind of player
//    Trainer      evolution strategies (antithetic pairs, rank-shaped),
//                 because the thing being learned is small (one weight per
//                 motor neuron and a bias per action — 101 numbers) and the
//                 score is a whole fight, which has no gradient to follow
//    Evaluation   held-out seeds the trainer never saw
//    Export       lab/learn/readout.json, which lab/inline.js carries into
//                 index.html beside the graph it was trained on
//
//  The score is §21's shaped reward plus who won, not just "did the player
//  die": a boss rewarded only for kills learns to be a wall, not a fight.
//
//  What this trains is where he starts. Since B9b+ the room server goes on
//  learning it from real fights (server/mindstore.js: the same ES, a fight a
//  trial), in small steps and never further than a fixed distance from what
//  this wrote — §20's point, that the live game must not be able to break
//  him, held by a bound instead of by not learning at all.
//
//    node lab/learn/train_readout.js [generations] [population]

const fs = require('fs');
const path = require('path');
const { runFight } = require('../sim/fight.js');
const { BOT_TYPES } = require('../sim/player_bot.js');
const { buildMockConnectome } = require('../core/connectome.js');
const C = require('../core/compress.js');
const { NeuralCore } = require('../core/neural.js');
const { makeRng, gauss } = require('../core/rng.js');

const GENS = +(process.argv[2] || 40);
const POP = +(process.argv[3] || 20);                 // even: antithetic pairs
const SIGMA = 0.12, LR = 0.05;
const OUT = path.join(__dirname, 'readout.json');

//  the same graph the game carries (lab/inline.js)
const graph = C.hybrid(buildMockConnectome({ nodes: 2000, seed: 0x5eed }), 500);
const base = new NeuralCore(graph, { seed: 0xbeef }).getReadout();
const DIM = base.w.length + base.b.length;

const FIGHT = { brain: 'tactical', neural: true, playerModel: true, difficulty: 'NORMAL', hpMax: 2500, maxT: 120, graph };
function score(theta, seeds) {
  const ro = { v: 1, graph: base.graph, seed: base.seed, w: theta.slice(0, base.w.length), b: theta.slice(base.w.length) };
  let s = 0, n = 0;
  for (const bot of BOT_TYPES) for (const seed of seeds) {
    const m = runFight(Object.assign({ bot, seed, readoutW: ro }, FIGHT));
    s += (m.winner === 'boss' ? 1 : 0) - (m.winner === 'player' ? 1 : 0) + m.reward / 300;
    n++;
  }
  return s / n;
}

function train() {
  const rng = makeRng(0x7e41);
  let theta = base.w.concat(base.b);
  const m = new Float64Array(DIM), v = new Float64Array(DIM);       // Adam
  const log = [];
  const valSeeds = [900001, 900002, 900003];
  const baseVal = score(theta, valSeeds);
  console.log('gen   train (mean of pop)   val (held-out)   |θ-θ0|');
  console.log('  0          —              ' + baseVal.toFixed(3));
  let best = { val: baseVal, theta: theta.slice(), gen: 0 };
  for (let g = 1; g <= GENS; g++) {
    const seeds = [g * 1000 + 1, g * 1000 + 2];                    // new fights every generation
    const eps = [], fit = [];
    for (let i = 0; i < POP / 2; i++) {
      const e = new Float64Array(DIM); for (let d = 0; d < DIM; d++) e[d] = gauss(rng.next);
      const plus = theta.map((x, d) => x + SIGMA * e[d]), minus = theta.map((x, d) => x - SIGMA * e[d]);
      eps.push(e); fit.push(score(plus, seeds), score(minus, seeds));
    }
    //  rank shaping: only the order of the scores matters, not their scale
    const order = fit.map((f, i) => [f, i]).sort((a, b) => a[0] - b[0]);
    const rank = new Float64Array(fit.length);
    order.forEach(([, i], r) => { rank[i] = r / (fit.length - 1) - 0.5; });
    const grad = new Float64Array(DIM);
    for (let i = 0; i < eps.length; i++) {
      const w = rank[2 * i] - rank[2 * i + 1];
      for (let d = 0; d < DIM; d++) grad[d] += w * eps[i][d] / (POP * SIGMA);
    }
    for (let d = 0; d < DIM; d++) {
      m[d] = 0.9 * m[d] + 0.1 * grad[d]; v[d] = 0.999 * v[d] + 0.001 * grad[d] * grad[d];
      const mh = m[d] / (1 - Math.pow(0.9, g)), vh = v[d] / (1 - Math.pow(0.999, g));
      theta[d] += LR * mh / (Math.sqrt(vh) + 1e-8);
    }
    const mean = fit.reduce((a, x) => a + x, 0) / fit.length;
    let line = String(g).padStart(3) + '       ' + mean.toFixed(3).padStart(7);
    if (g % 5 === 0 || g === GENS) {
      const val = score(theta, valSeeds);
      line += '            ' + val.toFixed(3);
      if (val > best.val) best = { val, theta: theta.slice(), gen: g };
    }
    let dist = 0; for (let d = 0; d < DIM; d++) dist += (theta[d] - (d < base.w.length ? base.w[d] : base.b[d - base.w.length])) ** 2;
    line += '      ' + Math.sqrt(dist).toFixed(2);
    console.log(line);
    log.push({ g, mean });
  }
  const ro = { v: 1, graph: base.graph, seed: base.seed,
    w: best.theta.slice(0, base.w.length).map((x) => +x.toFixed(5)), b: best.theta.slice(base.w.length).map((x) => +x.toFixed(5)),
    trained: { generations: GENS, population: POP, sigma: SIGMA, lr: LR, bestGen: best.gen, valBefore: +baseVal.toFixed(4), valAfter: +best.val.toFixed(4),
               fights: GENS * POP * BOT_TYPES.length * 2, note: 'ES over the motor readout only; the connectome is fixed' } };
  fs.writeFileSync(OUT, JSON.stringify(ro, null, 1));
  console.log('\nbest held-out score ' + best.val.toFixed(3) + ' (gen ' + best.gen + ', untrained ' + baseVal.toFixed(3) + ') → ' + path.relative(process.cwd(), OUT));
}

if (require.main === module) train();
module.exports = { score, base };
