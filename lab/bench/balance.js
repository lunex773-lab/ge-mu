'use strict';
//  ============================================================
//  BALANCE — how much health should he have?  (B8, §24)
//  ============================================================
//  B8 left his health to be measured: "1人で倒せるが、長い戦い". Read as
//  numbers, for one player in one life against the full stack at ADAPTIVE:
//
//    - a competent player (DODGER, DEFENSIVE, ADAPTIVE) wins 35-55% of the time
//    - and when they win it takes 2-4 minutes
//    - a careless one (AGGRESSIVE: stands in reach and trades) mostly loses
//
//  One life, because in the game a death means a long walk back from the
//  spawn and he mends while nobody is fighting him (B11).
//
//  The bots aim by formula, not by hand, so this sets the scale, not the
//  last word — the real number is whatever real players make of it.
//
//    node lab/bench/balance.js [fights-per-cell] [hp,hp,...]

const { runFight } = require('../sim/fight.js');
const { buildMockConnectome } = require('../core/connectome.js');
const C = require('../core/compress.js');

const N = +(process.argv[2] || 30);
const HPS = (process.argv[3] || '2000,3000,4000,5000,6000').split(',').map(Number);
const BOTS = ['DODGER', 'DEFENSIVE', 'ADAPTIVE', 'AGGRESSIVE', 'RANDOM'];
const graph = C.hybrid(buildMockConnectome({ nodes: 2000, seed: 0x5eed }), 500);
const pad = (s, n) => { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); };
const rp = (s, n) => { s = String(s); return ' '.repeat(Math.max(0, n - s.length)) + s; };

console.log('\n=== BALANCE (' + N + ' one-life fights per cell, full stack, ADAPTIVE, 6 min cap) ===\n');
console.log(pad('hp', 7) + BOTS.map((b) => rp(b.slice(0, 9), 22)).join(''));
console.log(pad('', 7) + BOTS.map(() => rp('pl.win  win-time', 22)).join(''));
const t0 = Date.now();
const table = {};
for (const hp of HPS) {
  let row = pad(hp, 7);
  for (const bot of BOTS) {
    let pw = 0; const times = [];
    for (let s = 1; s <= N; s++) {
      const m = runFight({ bot, seed: s * 7919 + hp, graph, difficulty: 'ADAPTIVE', hpMax: hp, maxT: 360, neural: true, playerModel: true });
      if (m.winner === 'player') { pw++; times.push(m.t); }
    }
    times.sort((a, b) => a - b);
    const med = times.length ? times[Math.floor(times.length / 2)] : NaN;
    (table[hp] = table[hp] || {})[bot] = { win: pw / N, med };
    row += rp((100 * pw / N).toFixed(0) + '%  ' + (Number.isNaN(med) ? '   —' : (med / 60).toFixed(1) + ' min'), 22);
  }
  console.log(row);
}
console.log('\n  pl.win = the player won in one life; win-time = median length of those wins.');
console.log('  ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s\n');
module.exports = { table };
