'use strict';
//  ============================================================
//  ABLATION E  (spec §25) — does the trained readout matter?
//  ============================================================
//  §25's last row: Neural Core + Player Model + learning. Compared on fights
//  the trainer never saw (held-out seeds), paired — every boss fights the
//  same fights — against:
//    D   the same stack with the core's untrained (random-sign) readout
//    D0  the same stack with no core at all
//  E − D is what the learning bought; E − D0 is what the core, trained, is
//  worth over not having one.
//
//    node lab/bench/ablation_e.js [fights-per-player]

const fs = require('fs');
const path = require('path');
const { runFight } = require('../sim/fight.js');
const { BOT_TYPES } = require('../sim/player_bot.js');
const { buildMockConnectome } = require('../core/connectome.js');
const C = require('../core/compress.js');
const { makeRng } = require('../core/rng.js');

const N = +(process.argv[2] || 40);
const graph = C.hybrid(buildMockConnectome({ nodes: 2000, seed: 0x5eed }), 500);
const trained = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'learn', 'readout.json'), 'utf8'));
const FIGHT = { brain: 'tactical', playerModel: true, difficulty: 'NORMAL', hpMax: 4000, maxT: 240, graph };
const BOSSES = { D0: { neural: false }, D: { neural: true }, E: { neural: true, readoutW: trained } };
const f = (x) => (x >= 0 ? '+' : '') + (100 * x).toFixed(1);
function ci(xs) {
  const rng = makeRng(99), B = 2000, means = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < xs.length; i++) s += xs[rng.int(xs.length)]; means.push(s / xs.length); }
  means.sort((a, b) => a - b);
  return '[' + f(means[Math.floor(B * 0.025)]) + ', ' + f(means[Math.floor(B * 0.975)]) + ']';
}

console.log('\n=== ABLATION E (' + N + ' held-out fights per player, NORMAL, 4000 HP) ===\n');
console.log('player        boss win  D0    D     E     E−D (95% CI)            E−D0 (95% CI)');
const all = { ED: [], ED0: [] };
for (const bot of BOT_TYPES) {
  const w = { D0: [], D: [], E: [] };
  for (let s = 1; s <= N; s++) {
    const seed = 500000 + s * 7919;           // never used by the trainer (it uses g*1000+1/2 and 90000x)
    for (const [k, cfg] of Object.entries(BOSSES)) {
      const m = runFight(Object.assign({ bot, seed }, FIGHT, cfg));
      w[k].push((m.winner === 'boss' ? 1 : 0) - (m.winner === 'player' ? 1 : 0));
    }
  }
  const mean = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
  const ed = w.E.map((x, i) => x - w.D[i]), ed0 = w.E.map((x, i) => x - w.D0[i]);
  all.ED.push(...ed); all.ED0.push(...ed0);
  console.log(bot.padEnd(13) + '          ' + f(mean(w.D0)).padStart(5) + ' ' + f(mean(w.D)).padStart(5) + ' ' + f(mean(w.E)).padStart(5)
    + '   ' + (f(mean(ed)) + ' ' + ci(ed)).padEnd(24) + f(mean(ed0)) + ' ' + ci(ed0));
}
const mean = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
console.log('\nall players                        ' + (f(mean(all.ED)) + ' ' + ci(all.ED)).padEnd(24) + f(mean(all.ED0)) + ' ' + ci(all.ED0));
console.log('\n  score per fight: +1 boss won, -1 player won, 0 timeout; shown ×100.');
console.log('  An interval containing 0 is not shown to be an effect.\n');
