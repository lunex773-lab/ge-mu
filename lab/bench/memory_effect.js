'use strict';
//  ============================================================
//  DOES REMEMBERING HELP?  (spec §40, §24 adaptation, §25)
//  ============================================================
//  The ablation's "first meeting vs later" columns compare different fights,
//  and the fight-to-fight spread (±20 points of win rate at these sample
//  sizes) is as large as any effect memory could have — a boss with no
//  memory at all "improved" by 22 points between its first and later fights
//  on nothing but the dice. So this measures it the way it has to be
//  measured: paired.
//
//  For each campaign: four fights to get to know the player, then the fifth
//  fight twice, on the same seed — once with what it remembers, once with
//  a blank profile. The only difference between the pair is the memory.
//  RANDOM is the control: a player with no habits has nothing to remember,
//  so its difference should sit at zero.
//
//    node lab/bench/memory_effect.js [campaigns] [config: D0|D|B] [difficulty] [players, comma-separated]

const { runFight } = require('../sim/fight.js');
const { buildMockConnectome } = require('../core/connectome.js');
const C = require('../core/compress.js');
const { makeRng } = require('../core/rng.js');

const N = +(process.argv[2] || 40);
const CFG = process.argv[3] || 'D0';
const DIFF = process.argv[4] || 'NORMAL';
const BOTS = (process.argv[5] || 'DODGER,DEFENSIVE,ADAPTIVE,AGGRESSIVE,RANDOM').split(',');
const CONFIGS = {
  B:  { brain: 'fsm', neural: false, playerModel: true },
  D:  { brain: 'tactical', neural: true, playerModel: true },
  D0: { brain: 'tactical', neural: false, playerModel: true },
};
const graph = C.hybrid(buildMockConnectome({ nodes: 2000, seed: 0x5eed }), 500);
const pad = (s, n) => { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); };
const rp = (s, n) => { s = String(s); return ' '.repeat(Math.max(0, n - s.length)) + s; };

//  95% bootstrap interval of the mean of paired differences
function ci(xs) {
  const rng = makeRng(99), B = 2000, means = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < xs.length; i++) s += xs[rng.int(xs.length)]; means.push(s / xs.length); }
  means.sort((a, b) => a - b);
  return [means[Math.floor(B * 0.025)], means[Math.floor(B * 0.975)]];
}

console.log('\n=== MEMORY EFFECT, paired (' + N + ' campaigns per player, boss ' + CFG + ', ' + DIFF + ') ===\n');
console.log(pad('player', 12) + rp('hit: blank', 11) + rp('remembered', 11) + rp('Δ hit', 8) + rp('95% CI', 18)
  + rp('win: blank', 11) + rp('remembered', 11) + rp('Δ win', 8) + rp('95% CI', 18));
const t0 = Date.now();
for (const bot of BOTS) {
  const dHit = [], dWin = [];
  let hb = 0, hr = 0, wb = 0, wr = 0;
  for (let s = 1; s <= N; s++) {
    let profile = null;
    for (let f = 1; f <= 4; f++) profile = runFight(Object.assign({ bot, seed: s * 7919 + f * 104729, graph, maxT: 180, profile, difficulty: DIFF }, CONFIGS[CFG])).profile;
    const seed = s * 7919 + 5 * 104729;
    const blank = runFight(Object.assign({ bot, seed, graph, maxT: 180, profile: null, difficulty: DIFF }, CONFIGS[CFG]));
    const rem = runFight(Object.assign({ bot, seed, graph, maxT: 180, profile, difficulty: DIFF }, CONFIGS[CFG]));
    const hB = blank.swings ? blank.landed / blank.swings : 0, hR = rem.swings ? rem.landed / rem.swings : 0;
    dHit.push(hR - hB); hb += hB; hr += hR;
    const wB = blank.winner === 'boss' ? 1 : 0, wR = rem.winner === 'boss' ? 1 : 0;
    dWin.push(wR - wB); wb += wB; wr += wR;
  }
  const m = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
  const f = (x) => (x >= 0 ? '+' : '') + (100 * x).toFixed(1);
  const ch = ci(dHit), cw = ci(dWin);
  console.log(pad(bot, 12) + rp((100 * hb / N).toFixed(1) + '%', 11) + rp((100 * hr / N).toFixed(1) + '%', 11) + rp(f(m(dHit)), 8)
    + rp('[' + f(ch[0]) + ', ' + f(ch[1]) + ']', 18)
    + rp((100 * wb / N).toFixed(0) + '%', 11) + rp((100 * wr / N).toFixed(0) + '%', 11) + rp(f(m(dWin)), 8)
    + rp('[' + f(cw[0]) + ', ' + f(cw[1]) + ']', 18));
}
console.log('\n  Δ = remembered − blank on the same fight, in percentage points. An interval that');
console.log('  does not contain 0 is an effect; one that does is not shown to be one.');
console.log('  ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s\n');
