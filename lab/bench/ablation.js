'use strict';
//  ============================================================
//  ABLATION  (spec §25, §24)
//  ============================================================
//  "Connectome-inspired architectureが本当に意味があるのか を検証する".
//  Six bosses against six kinds of player, many fights each, same seeds for
//  every boss so they face the same fights:
//
//    A   通常FSM
//    B   FSM + Player Model
//    C   Neural Core (tactics + core, no player model)
//    D   Neural Core + Player Model
//    C0  tactics alone, no core, no model   — the control for C
//    D0  tactics + player model, no core    — the control for D
//
//  C against C0, and D against D0, is what the core itself contributes.
//  Until Phase 10 trains its readout the honest expectation is: nothing
//  much. The table says whether that expectation holds.
//
//  Each cell is a set of *campaigns*: the same kind of player met five times
//  in a row, the boss carrying its memory of them from one fight to the
//  next (D4). The first fight and the last two are reported apart, because
//  "it remembers how I fight" is a claim about the second meeting, not the
//  first — within one fight there are only ~20 wind-ups to learn from.
//
//    node lab/bench/ablation.js [campaigns-per-cell] [difficulty] [fights-per-campaign]

const { runFight } = require('../sim/fight.js');
const { BOT_TYPES } = require('../sim/player_bot.js');
const { buildMockConnectome } = require('../core/connectome.js');
const C = require('../core/compress.js');

const N = +(process.argv[2] || 10);
const DIFF = process.argv[3] || 'NORMAL';
const K = +(process.argv[4] || 5);
const graph = C.hybrid(buildMockConnectome({ nodes: 2000, seed: 0x5eed }), 500);

const CONFIGS = {
  A:  { brain: 'fsm', neural: false, playerModel: false },
  B:  { brain: 'fsm', neural: false, playerModel: true },
  C:  { brain: 'tactical', neural: true, playerModel: false },
  D:  { brain: 'tactical', neural: true, playerModel: true },
  C0: { brain: 'tactical', neural: false, playerModel: false },
  D0: { brain: 'tactical', neural: false, playerModel: true },
};

const pad = (s, n) => { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); };
const rp = (s, n) => { s = String(s); return ' '.repeat(Math.max(0, n - s.length)) + s; };
const pct = (x) => (100 * x).toFixed(0) + '%';

function cell(cfg, bot) {
  const first = acc(), late = acc();
  for (let s = 1; s <= N; s++) {
    let profile = null;
    for (let f = 1; f <= K; f++) {
      const m = runFight(Object.assign({ bot, seed: s * 7919 + f * 104729, graph, difficulty: DIFF, maxT: 180, profile }, cfg));
      profile = m.profile;
      if (f === 1) add(first, m);
      if (f > K - 2) add(late, m);
    }
  }
  return { first: done(first), late: done(late) };
}
function acc() { return { n: 0, boss: 0, player: 0, timeout: 0, surv: 0, swings: 0, landed: 0, resp: [], us: 0, reward: 0, faults: 0 }; }
function add(r, m) {
  r.n++; r[m.winner]++; r.surv += m.playerSurvival;
  r.swings += m.swings; r.landed += m.landed; r.us += m.brainUsPerDecision; r.reward += m.reward; r.faults += m.faults;
  if (m.prediction && m.prediction.responseTries) r.resp.push(m.prediction.response);
}
function done(r) {
  r.surv /= r.n; r.us /= r.n; r.reward /= r.n;
  r.hit = r.swings ? r.landed / r.swings : 0;
  r.respAcc = r.resp.length ? r.resp.reduce((a, x) => a + x, 0) / r.resp.length : NaN;
  return r;
}

console.log('\n=== ABLATION (' + N + ' campaigns of ' + K + ' fights per cell, ' + DIFF + ', boss 3000 HP, 180 s cap) ===');
console.log('    first = the first meeting; later = the last two, with what it remembers\n');
const t0 = Date.now();
const all = {};
const head = '  ' + pad('boss', 5) + rp('first: win', 11) + rp('hit', 6) + rp('later: win', 12) + rp('hit', 6)
  + rp('pl. alive s', 12) + rp('resp acc', 9) + rp('reward', 8) + rp('µs/dec', 8);
for (const bot of BOT_TYPES) {
  console.log(bot);
  console.log(head);
  for (const [name, cfg] of Object.entries(CONFIGS)) {
    const { first, late } = cell(cfg, bot);
    (all[name] = all[name] || []).push({ first, late });
    console.log('  ' + pad(name, 5) + rp(pct(first.boss / first.n), 11) + rp(pct(first.hit), 6)
      + rp(pct(late.boss / late.n), 12) + rp(pct(late.hit), 6) + rp(late.surv.toFixed(0), 12)
      + rp(Number.isNaN(late.respAcc) ? '—' : late.respAcc.toFixed(2), 9) + rp(late.reward.toFixed(0), 8) + rp(late.us.toFixed(0), 8)
      + (first.faults + late.faults ? '  faults ' + (first.faults + late.faults) : ''));
  }
  console.log('');
}
console.log('OVERALL (mean over the six kinds of player)');
console.log('  ' + pad('boss', 5) + rp('first: win', 11) + rp('hit', 6) + rp('later: win', 12) + rp('hit', 6) + rp('player win', 11) + rp('reward', 8));
for (const [name, rows] of Object.entries(all)) {
  const avg = (f) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
  console.log('  ' + pad(name, 5) + rp(pct(avg((r) => r.first.boss / r.first.n)), 11) + rp(pct(avg((r) => r.first.hit)), 6)
    + rp(pct(avg((r) => r.late.boss / r.late.n)), 12) + rp(pct(avg((r) => r.late.hit)), 6)
    + rp(pct(avg((r) => r.late.player / r.late.n)), 11) + rp(avg((r) => r.late.reward).toFixed(0), 8));
}
console.log('\n  ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s\n');
