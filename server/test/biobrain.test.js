//  ============================================================
//  BIO-BRAIN — the three great ones' common brain, on its own  (node)
//  ============================================================
//  shared/biobrain.js against the design texts: one brain, three genomes,
//  and the same player met three ways (ACIS AC§10–§12, §35–§36); feelings
//  that change judgement and never pick the act (BB§6); memory that keeps
//  what mattered and forgets the rest (BB§7, §28); a model of the player
//  that guesses, is wrong and notices (BB§12, AC§17); strategies that wear
//  out, and one who will not let go of his (AC§14); what is kept between
//  fights (AC§37); the slow brain's proposals checked (AC§22–§23); the cost.
//
//    node server/test/biobrain.test.js

import BB from '../../shared/biobrain.js';

const results = []; let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else fail++; results.push((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '\n         ' + detail : '')); }
function seeded(s) { return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
//  a fight's worth of seconds, the player doing `act` each 0.4 s at distance d
function run(B, t0, secs, key, obs, ctx) {
  let t = t0;
  for (; t < t0 + secs; t += 0.05) {
    BB.tick(B, t, 0.05, Object.assign({ hp: B.hp, d: obs(t).d, minions: B.minions }, ctx || {}));
    BB.observe(B, t, key, obs(t));
  }
  return t;
}
const CANDS = [
  { id: 'close_in_and_strike', tags: ['attack', 'pursue'], utility: 0.9, risk: 0.35 },
  { id: 'back_away', tags: ['retreat', 'reposition'], utility: 0.55, risk: 0.05, survival: 1 },
  { id: 'call_the_children', tags: ['summon', 'command'], utility: 0.55, risk: 0.05, survival: 0.9 },
  { id: 'watch_and_wait', tags: ['observe', 'hold', 'probe'], utility: 0.5, info: 0.6, risk: 0 },
];
function tally(B, t, n, rnd, cands) {
  const c = {};
  for (let i = 0; i < n; i++) { const d = BB.decide(B, t, cands || CANDS, rnd); c[d.id] = (c[d.id] || 0) + 1; }
  return c;
}
const top = (c) => Object.keys(c).sort((a, b) => c[b] - c[a])[0];

// ---- three genomes, one brain ------------------------------------------------------------
{
  const ids = BB.IDS;
  const P = ids.map((id) => BB.make(id).P);
  check('three genomes on one brain: VECNA, the Mind Flayer, Beelzebub — each at rest already judges differently',
    ids.join(',') === 'vecna,mind_flayer,beelzebub' && P[2].tempo > P[0].tempo && P[1].standoff > P[0].standoff && P[1].riskTolerance < P[2].riskTolerance,
    ids.map((id, i) => id + ' tempo ' + P[i].tempo.toFixed(2) + ' standoff ' + P[i].standoff.toFixed(2) + ' risk ' + P[i].riskTolerance.toFixed(2)).join(' | '));
}

// ---- AC§35: the same player running at each of them -------------------------------------------
{
  const got = {};
  for (const id of BB.IDS) {
    const B = BB.make(id), rnd = seeded(7);
    B.minions = 3;
    //  twenty seconds of being watched from 30 m, then the player runs in
    let t = run(B, 0, 20, 'p1', () => ({ d: 30, vr: 0, vl: 0 }));
    for (let i = 0; i < 12; i++) { BB.event(B, t, 'approach', { key: 'p1', d: 30 - i * 2, speed: 7 }); t = run(B, t, 0.25, 'p1', () => ({ d: 30 - i * 2, vr: 7, vl: 0 })); }
    got[id] = { c: tally(B, t, 200, rnd), st: B.strat.name, m: BB.moodOf(B) };
  }
  const v = top(got.vecna.c), m = top(got.mind_flayer.c), b = top(got.beelzebub.c);
  check('the same player running at them, met three ways: VECNA holds and watches, the Mind Flayer backs off or sends its children, Beelzebub goes in',
    v === 'watch_and_wait' && (m === 'back_away' || m === 'call_the_children') && b === 'close_in_and_strike' && got.mind_flayer.m.fear > got.vecna.m.fear * 3 && got.beelzebub.m.anger > got.vecna.m.anger,
    Object.entries(got).map(([id, g]) => id + ' [' + g.st + '] ' + JSON.stringify(g.c)).join(' | '));
}

// ---- BB§6: feelings change judgement, not the act ------------------------------------------------
{
  const B = BB.make('mind_flayer'), before = Object.assign({}, B.P);
  BB.event(B, 1, 'hurt', { amt: 0.12, key: 'p1', d: 12 });
  const after = B.P;
  //  and afraid, it still weighs every candidate — the fear only moves the weights
  const d = BB.decide(B, 1, CANDS, seeded(3));
  check('a wound frightens the Mind Flayer: it tolerates less risk, wants more distance, sees more threat — and still weighs every option',
    after.riskTolerance < before.riskTolerance - 0.1 && after.standoff > before.standoff + 0.2 && after.threatSense > before.threatSense && d.evals.length >= 3,
    'risk ' + before.riskTolerance.toFixed(2) + ' → ' + after.riskTolerance.toFixed(2) + ', standoff ' + before.standoff.toFixed(2) + ' → ' + after.standoff.toFixed(2) + ', ' + d.evals.length + ' weighed');
}
{
  //  AC§8.6: his rage — stronger, quicker, and simpler (fewer things weighed: easier to read)
  const B = BB.make('beelzebub'), k0 = B.P.candidates, t0 = B.P.tempo;
  for (let i = 0; i < 6; i++) { BB.event(B, i, 'hurt', { amt: 0.04, key: 'p1' }); BB.event(B, i + 0.5, 'escape', { key: 'p1', d: 40 }); }
  check('Beelzebub\'s rage: every wound and every escape feeds it — he comes round quicker, and weighs fewer things (stronger, and easier to read)',
    B.affect.anger > 0.8 && B.P.tempo > t0 + 0.2 && B.P.candidates < k0 && B.P.retreat < 0.05,
    'anger ' + B.affect.anger.toFixed(2) + ', tempo ' + t0.toFixed(2) + ' → ' + B.P.tempo.toFixed(2) + ', weighs ' + k0 + ' → ' + B.P.candidates);
  let t = 6;
  for (let i = 0; i < 6; i++) { BB.tick(B, t, 0.5, { hp: 0.6, d: 12 }); t += 0.5; BB.event(B, t, 'blocked', { key: 'p1' }); }
  check('… and at the top of it he goes berserk', B.strat.name === 'BERSERK' && B.phase >= 2, B.strat.name + ', phase ' + BB.GENOMES.beelzebub.phases[B.phase]);
}

// ---- AC§6.8: VECNA's divine calm ------------------------------------------------------------------
{
  const B = BB.make('vecna');
  run(B, 0, 6, 'p1', () => ({ d: 40, vr: 0, vl: 1 }));
  const calm = B.meta.calm, tempo = B.P.tempo, said = B.say.some((q) => q.sit === 'calm');
  BB.event(B, 6.1, 'hurt', { amt: 0.2, key: 'p1' }); BB.event(B, 6.2, 'hurt', { amt: 0.2, key: 'p1' });
  run(B, 6.3, 2, 'p1', () => ({ d: 10, vr: 5, vl: 0 }), { hp: 0.6 });
  check('VECNA untroubled and sure of himself falls into DIVINE CALM — slower, watching, and he says so; hurt hard, the calm breaks',
    calm && tempo < 1 && said && !B.meta.calm, 'calm ' + calm + ' (tempo ' + tempo.toFixed(2) + ', said ' + said + '), after two heavy wounds: ' + B.meta.state);
}

// ---- AC§11, §36: the same dodge again and again ------------------------------------------------------
{
  const out = {};
  for (const id of BB.IDS) {
    const B = BB.make(id); B.minions = 3;
    let t = 0;
    for (let i = 0; i < 8; i++) { BB.event(B, t, 'dodged', { key: 'p1', how: 'jump' }); t = run(B, t, 1, 'p1', () => ({ d: 18, vr: 0, vl: 0, jumping: true })); }
    t = run(B, t, 3, 'p1', () => ({ d: 18, vr: 0, vl: 0 }));
    out[id] = { fact: B.sem.player_jumps ? +B.sem.player_jumps.p.toFixed(2) : 0, st: B.strat.name, said: B.say.map((q) => q.text) };
  }
  check('the player jumps every time: all three notice it (a fact they now hold) — VECNA turns to COUNTER; Beelzebub will not change what he does',
    out.vecna.fact > 0.5 && out.mind_flayer.fact > 0.5 && out.beelzebub.fact > 0.5 && out.vecna.st === 'COUNTER' && (out.beelzebub.st === 'ATTACK' || out.beelzebub.st === 'OVERCOME' || out.beelzebub.st === 'BERSERK'),
    Object.entries(out).map(([id, o]) => id + ' ' + o.fact + ' [' + o.st + ']').join(' | '));
  const vl = out.vecna.said.join(' / ');
  check('… and VECNA tells them he has seen it', /跳ぶ|避け方/.test(vl), vl);
}

// ---- AC§7.7: the Mind Flayer's children -----------------------------------------------------------------
{
  const B = BB.make('mind_flayer'); B.minions = 5;
  let t = run(B, 0, 4, 'p1', () => ({ d: 35, vr: 0, vl: 0 }), { minions: 5 });
  const f0 = B.affect.fear;
  for (let i = 0; i < 5; i++) { BB.event(B, t, 'minion_lost', { n: 1 }); t = run(B, t, 1, 'p1', () => ({ d: 30, vr: 1, vl: 0 }), { minions: 4 - i, hp: 0.45 }); }
  t = run(B, t, 3, 'p1', () => ({ d: 20, vr: 2, vl: 0 }), { minions: 0, hp: 0.42 });
  check('the Mind Flayer loses its children one by one: more afraid with each — and, none left and hurt, it turns and fights (DESPERATE)',
    B.affect.fear > f0 && B.strat.name === 'DESPERATE' && B.phase === 3 && B.say.concat(B.log).some((q) => /子|DESPERATE/.test(q.text || q.m)),
    'fear ' + f0.toFixed(2) + ' → ' + B.affect.fear.toFixed(2) + ', ' + B.strat.name + ', phase ' + BB.GENOMES.mind_flayer.phases[B.phase]);
}

// ---- BB§12, AC§17: a model of the player, wrong and noticing ------------------------------------------------------
{
  const B = BB.make('vecna');
  //  the player strafes left, then right, then left… for a while (a habit), then does the opposite
  let t = 0;
  for (let i = 0; i < 40; i++) t = run(B, t, 0.45, 'p1', () => ({ d: 20, vr: 0, vl: i % 2 ? 4 : -4 }));
  const acc1 = B.opp.p1.acc, pred = B.wm.pred;
  let low = 1;
  for (let i = 0; i < 16; i++) { t = run(B, t, 0.45, 'p1', () => ({ d: 20, vr: -4, vl: 0 })); low = Math.min(low, B.opp.p1.acc); }
  check('it learns the player\'s habit and predicts it; when they change, the prediction fails, it says so, and wants to think it over — then learns the new one',
    acc1 > 0.6 && pred && pred.conf > 0.3 && low < acc1 - 0.1 && B.log.some((e) => e.k === 'error') && B.slow.want === 'surprise' && B.opp.p1.acc > low,
    'accuracy on the habit ' + acc1.toFixed(2) + ' (' + (pred && pred.a) + ' ' + (pred && pred.conf) + '), when it changed ' + low.toFixed(2) + ', then ' + B.opp.p1.acc.toFixed(2));
}

// ---- BB§13–§14: a strategy that stops working ----------------------------------------------------------------
{
  const B = BB.make('vecna'); B.strat.name = 'DESTROY';
  let t = 0;
  for (let i = 0; i < 10; i++) { BB.event(B, t, 'hit', { key: 'p1', act: 'a' + (i % 2) }); t += 0.3; }
  for (let i = 0; i < 14; i++) { BB.event(B, t, 'miss', { key: 'p1', act: 'a' + (i % 2) }); t = run(B, t, 0.5, 'p1', () => ({ d: 20, vr: 0, vl: 3 })); }
  const deg = B.meta.degradation;
  check('a strategy that has stopped working degrades — and VECNA lets go of it', deg > 0.15 && B.strat.name !== 'DESTROY', 'degradation ' + deg.toFixed(2) + ', now ' + B.strat.name);
  const Z = BB.make('beelzebub'); Z.strat.name = 'ATTACK';
  t = 0;
  for (let i = 0; i < 10; i++) { BB.event(Z, t, 'hit', { key: 'p1', act: 'a' + (i % 2) }); t += 0.3; }
  for (let i = 0; i < 14; i++) { BB.event(Z, t, 'miss', { key: 'p1', act: 'a' + (i % 2) }); t = run(Z, t, 0.5, 'p1', () => ({ d: 5, vr: 0, vl: 3 })); }
  check('… Beelzebub, read and failing, knows it — and hits anyway (pride)', Z.meta.degradation > 0.15 && Z.strat.name !== 'ADAPT' && Z.log.some((e) => /anyway/.test(e.m)),
    'degradation ' + Z.meta.degradation.toFixed(2) + ', still ' + Z.strat.name + '; biases ' + Z.meta.biases.join(','));
}

// ---- BB§19: what it could have done instead --------------------------------------------------------------------
{
  const B = BB.make('vecna'); B.strat.name = 'DESTROY';
  for (let i = 0; i < 6; i++) BB.result(B, i, 'watch_and_wait', 1);
  B.dec = null;
  BB.decide(B, 10, CANDS.map((c) => (c.id === 'close_in_and_strike' ? Object.assign({}, c, { utility: 3 }) : c)), null);
  const chose = B.dec.id;
  BB.result(B, 11, chose, -1);
  check('it chose, it failed, and it weighs what the others it considered would have done (a counterfactual, from the few best)',
    chose === 'close_in_and_strike' && B.log.some((e) => e.k === 'counterfactual' && /watch_and_wait/.test(e.m)), B.log.filter((e) => e.k === 'counterfactual').map((e) => e.m).join(' '));
}

// ---- BB§7, §28: memory keeps what mattered ------------------------------------------------------------------
{
  const B = BB.make('mind_flayer', 'EASY');
  let t = 0;
  for (let i = 0; i < 200; i++) { BB.event(B, t, i % 25 === 0 ? 'hurt' : 'miss', { key: 'p1', amt: 0.15 }); t += 0.5; }
  const kept = B.epi.length, big = B.epi.filter((e) => e.k === 'hurt').length;
  check('episodic memory is bounded by its difficulty, and what is kept is what mattered (every heavy wound, of 200 events)',
    kept <= BB.DIFFICULTY.EASY.memory && big === 8, kept + ' kept (cap ' + BB.DIFFICULTY.EASY.memory + '), ' + big + ' of 8 wounds among them');
}

// ---- AC§37: the next fight ----------------------------------------------------------------------------------
{
  const B = BB.make('vecna');
  let t = 0;
  BB.event(B, t, 'seen', { key: 'Aki', d: 30, name: 'Aki' });
  for (let i = 0; i < 6; i++) { BB.event(B, t, 'dodged', { key: 'Aki', how: 'jump' }); t = run(B, t, 1, 'Aki', () => ({ d: 30, vr: 0, vl: 0, jumping: true })); }
  BB.event(B, t, 'hurt', { key: 'Aki', amt: 0.1 });
  const rec = BB.memoryOf(B, 'Aki'), js = JSON.stringify(rec);
  const N = BB.make('vecna');
  const ok = BB.recall(N, 'Aki', JSON.parse(js));
  N.say.length = 0;
  BB.event(N, 100, 'seen', { key: 'Aki', d: 30, name: 'Aki' });
  const line = N.say.map((q) => q.text).join(' / ');
  check('what it learned of a player is kept (small) and read back into the next fight: it remembers them — and says so',
    ok && js.length < 400 && N.opp.Aki.dodge.jump === 6 && N.rel.Aki.respect > 0.1 && N.sem.player_jumps && /Aki|覚えて|また|前/.test(line),
    js.length + ' bytes: ' + js + ' → "' + line + '"');
  const bad = BB.make('vecna');
  check('… and a record that is not one is refused, or its bad parts ignored', !BB.recall(bad, 'x', { v: 2 }) && BB.recall(bad, 'x', { v: 1, o: { a: 'lots', r: 1e9, d: [1, 2] }, f: { 'rm -rf': 1, player_ok: 7 } }) && bad.opp.x.aggression === 0.5 && !bad.sem['rm -rf'] && !bad.sem.player_ok);
}

// ---- AC§20–§23: the slow brain proposes; the genome disposes ------------------------------------------------------
{
  const B = BB.make('beelzebub');
  run(B, 0, 3, 'p1', () => ({ d: 10, vr: 2, vl: 0 }));
  const ctx = BB.llmContext(B, 'phase'), cs = JSON.stringify(ctx);
  check('what the slow brain is shown is small, in the genome\'s terms, and only what it has perceived and believes (no positions)',
    cs.length < 1400 && ctx.strategies.indexOf('BERSERK') >= 0 && !/"x":|"z":/.test(cs) && ctx.player && ctx.player.range_m === Math.round(B.opp.p1.range), cs.length + ' chars');
  const good = BB.validateThought(B, { strategyProposal: { strategy: 'pursue', confidence: 0.9, reason: 'they flee' }, intent: { primary: 'pressure' }, dialogue: '逃がさんッ！<script>x</script> https://evil.example' });
  const alien = BB.validateThought(B, { strategyProposal: { strategy: 'STAY_SAFE' }, intent: { primary: 'delete_world' }, dialogue: '' });
  const junk = BB.validateThought(B, 'not json');
  check('its proposals are checked: only this boss\'s own strategies, known intents, a short plain line — the rest is dropped',
    good && good.strategy === 'PURSUE' && good.intent === 'pressure' && good.dialogue === '逃がさんッ！x' && alien === null && junk === null, JSON.stringify(good));
  BB.adoptThought(B, 5, good, 'llm');
  const before = B.strat.scores.PURSUE;
  BB.tick(B, 5.5, 0.5, { hp: 1, d: 10 });
  check('… and a proposal taken is one voice among its own: it leans the strategy while it lasts, and its line is said',
    B.strat.scores.PURSUE > (before || 0) && B.say.some((q) => q.src === 'llm') && B.log.some((e) => e.k === 'thought'), 'PURSUE ' + (before || 0).toFixed(2) + ' → ' + B.strat.scores.PURSUE.toFixed(2));
  const W = BB.make('vecna'); W.slow.want = 'phase';
  const w1 = BB.wantsThought(W, 100, 30); W.slow.want = 'surprise';
  const w2 = BB.wantsThought(W, 110, 30), w3 = BB.wantsThought(W, 131, 30);
  check('slow thoughts come on events, and no more often than allowed', w1 === 'phase' && w2 === null && w3 === 'surprise');
}

// ---- handed over whole; and what it costs ---------------------------------------------------------------------
{
  const B = BB.make('mind_flayer');
  run(B, 0, 5, 'p1', () => ({ d: 25, vr: 1, vl: 2 }));
  BB.event(B, 5, 'hurt', { key: 'p1', amt: 0.05 });
  const f = BB.fullState(B), s = JSON.stringify(f), C = BB.adoptFull(JSON.parse(s));
  check('handed over whole (a room taking a boss from a game) and taken back as it was', BB.fullOk(f) && C && JSON.stringify(C) === s && !BB.adoptFull({ v: 1, id: 'nobody' }), s.length + ' bytes');
  const all = BB.IDS.map((id) => BB.make(id)), rnd = seeded(11);
  let t = 0; const t0 = process.hrtime.bigint();
  for (let i = 0; i < 20000; i++) {
    const B2 = all[i % 3]; t += 0.05 / 3;
    BB.tick(B2, t, 0.05, { hp: 0.8, d: 20, minions: 2 });
    BB.observe(B2, t, 'p' + (i % 2), { d: 20, vr: (i % 7) - 3, vl: (i % 5) - 2 });
    if (i % 10 === 0) BB.decide(B2, t, CANDS, rnd);
  }
  const us = Number(process.hrtime.bigint() - t0) / 1000 / 20000;
  check('what a step costs (tick and observe every step, a decision every tenth): a few microseconds', us < 40, us.toFixed(2) + ' µs a step');
}

console.log('\nBIO-BRAIN — the three great ones\' common brain\n');
console.log(results.join('\n'));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
