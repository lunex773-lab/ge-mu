//  ============================================================
//  Beelzebub's memory on the server  (node, storage in a Map)
//  ============================================================
//  server/mindstore.js as the BossMind Durable Object runs it: players
//  remembered by name, the newest kept; the readout learning fight by fight,
//  in small steps, never far from what the lab trained, and going back to
//  the best it has done when it does worse.
//
//    node server/test/mind.test.js

import { MindStore, THETA0, SIGMA, BATCH, STEP_MAX, RADIUS, WINDOW, EXPIRE_MS, MAX_PLAYERS, eps, distance, readoutOf } from '../mindstore.js';
import BRAIN from '../brain.js';
import NEURAL from '../../lab/core/neural.js';
import PM from '../../lab/core/player_model.js';

const results = []; let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else fail++; results.push((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '\n         ' + detail : '')); }

//  the Durable Object storage's calls, over a Map (values copied, as storage does)
function mapStorage() {
  const m = new Map(), cp = (v) => (v === undefined ? v : structuredClone(v));
  return {
    m,
    async get(k) { return cp(m.get(k)); },
    async put(k, v) { if (typeof k === 'object') for (const [kk, vv] of Object.entries(k)) m.set(kk, cp(vv)); else m.set(k, cp(v)); },
    async delete(k) { for (const kk of [].concat(k)) m.delete(kk); },
  };
}
let clock = 1_700_000_000_000;
const now = () => clock;
function seeded(s) { return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
const DIM = THETA0.length;
const theta = (ro) => ro.w.concat(ro.b);

//  ---- a fresh memory ------------------------------------------------------------
let S = mapStorage(), M = new MindStore(S, { now, random: seeded(7) });
let [h] = await M.ask([{ k: 'hello', id: 'p000000', name: 'Aki' }]);
const core = NEURAL.NeuralCore.fromPrepared(BRAIN.core);
check('a fresh memory hands out the lab\'s readout, and the game\'s core takes it', h.ro && theta(h.ro).every((x, d) => Math.abs(x - THETA0[d]) < 1e-9) && core.setReadout(h.ro), 'gen ' + h.ro.gen);
const c0 = h.c, e0 = eps(Math.floor(c0.id / 2));
check('and a candidate: the lab\'s readout nudged SIGMA along a direction of its own', core.setReadout(c0) && theta(c0).every((x, d) => Math.abs(x - (THETA0[d] + SIGMA * e0[d])) < 2e-5),
  'id ' + c0.id + ', ' + distance(theta(c0)).toFixed(3) + ' from the lab');
check('it knows nothing of a player it has never met', h.me === null);

//  ---- players --------------------------------------------------------------------
const pm = new PM.PlayerModel({}), model = pm.serialize();
await M.ask([{ k: 'save', players: { Aki: { t: clock - 5000, m: model, f: 0.42 }, p000003: { t: clock, m: model }, '': { t: clock, m: model } } }]);
[h] = await M.ask([{ k: 'hello', id: 'p000001', name: 'Aki' }]);
check('what is saved of a player comes back when they arrive, by name', h.me && h.me.f === 0.42 && new PM.PlayerModel({}).restore(h.me.m));
const [st0] = await M.ask([{ k: 'stats' }]);
check('a room\'s id, or no name at all, is not filed', st0.players === 1, st0.players + ' remembered');
await M.ask([{ k: 'save', players: { Aki: { t: clock - 9000, m: model, f: 0.9 } } }]);
[h] = await M.ask([{ k: 'hello', id: 'p000001', name: 'Aki' }]);
check('an older account of them does not replace a newer one', h.me.f === 0.42);
await M.ask([{ k: 'save', players: { Aki: { t: clock - 1000, m: model, f: 0.5 } } }]);
[h] = await M.ask([{ k: 'hello', id: 'p000001', name: 'Aki' }]);
check('a newer one does', h.me.f === 0.5);
await M.ask([{ k: 'save', players: { Big: { t: clock, m: { junk: 'x'.repeat(20000) } }, Odd: { t: clock, m: model, f: 3 }, Bad: { t: NaN, m: model } } }]);
const [st1] = await M.ask([{ k: 'stats' }]);
check('nothing too big or malformed is kept', st1.players === 1, st1.players + ' remembered');
const many = {};
for (let i = 0; i < MAX_PLAYERS + 5; i++) many['n' + i] = { t: clock - 100000 + i, m: model };
await M.ask([{ k: 'save', players: many }]);
const [st2] = await M.ask([{ k: 'stats' }]);
[h] = await M.ask([{ k: 'hello', id: 'x', name: 'n0' }]);
const [h2] = await M.ask([{ k: 'hello', id: 'x', name: 'Aki' }]);
check('no more than ' + MAX_PLAYERS + ' are remembered: whoever was seen longest ago goes', st2.players === MAX_PLAYERS && h.me === null && h2.me && ![...S.m.keys()].includes('p:n0'),
  st2.players + ' remembered, ' + [...S.m.keys()].filter((k) => k.startsWith('p:')).length + ' stored');

//  ---- candidates and reports ---------------------------------------------------------
S = mapStorage(); M = new MindStore(S, { now, random: seeded(11) });
let [a] = await M.ask([{ k: 'cand', for: 'room' }]); let [b] = await M.ask([{ k: 'cand', for: 'room' }]);
check('the two fights of a pair: along +ε, then along -ε', b.c.id === a.c.id + 1 && theta(a.c).every((x, d) => Math.abs(x + theta(b.c)[d] - 2 * THETA0[d]) < 4e-5));
await M.ask([{ k: 'report', id: a.c.id, s: 0.8, n: 150 }]);
let [s1] = await M.ask([{ k: 'stats' }]);
check('one fight of a pair in: nothing moves yet', s1.gen === 0 && s1.fights === 1);
await M.ask([{ k: 'report', id: b.c.id, s: -0.4, n: 150 }]);
[s1] = await M.ask([{ k: 'stats' }]);
const oneIn = s1.gen === 0;
//  BATCH pairs, the + fight the better each time: the readout steps along the mean of their ε
const es1 = [eps(Math.floor(a.c.id / 2))];
for (let i = 1; i < BATCH; i++) {
  const [x] = await M.ask([{ k: 'cand', for: 'room' }]), [y] = await M.ask([{ k: 'cand', for: 'room' }]);
  es1.push(eps(Math.floor(x.c.id / 2)));
  await M.ask([{ k: 'report', id: x.c.id, s: 0.5, n: 150 }, { k: 'report', id: y.c.id, s: 0.1, n: 150 }]);
}
[s1] = await M.ask([{ k: 'stats' }]);
let [c] = await M.ask([{ k: 'cand', for: 'room' }]);
const moved = theta(c.ro).map((x, d) => x - THETA0[d]);
const along = es1.map((e) => moved.reduce((x, y, d) => x + y * e[d], 0));
check('a pair in: nothing moves yet; ' + BATCH + ' in: the readout steps towards the better fights (+ε), no number by more than ' + STEP_MAX,
  oneIn && s1.gen === 1 && along.every((x) => x > 0) && moved.every((x) => Math.abs(x) <= STEP_MAX + 1e-5),
  'moved ' + distance(theta(c.ro)).toFixed(4) + '; the largest change ' + Math.max(...moved.map(Math.abs)).toFixed(4) + '; along each ε ' + along.map((x) => x.toFixed(2)).join(' '));
const before = JSON.stringify(M.es.theta);
check('a report twice, or for something never handed out, changes nothing', M.report(a.c.id, 5, 200) === 'not a candidate now' && M.report(12345678, 1, 100) === 'not a candidate now' && JSON.stringify(M.es.theta) === before);
check('a fight too short to say anything is not taken', M.report(c.c.id, 3, 5) === 'not a fight' && M.es.pairs.find((p) => p.seed === Math.floor(c.c.id / 2)).out[0] === 0);
const [d1] = await M.ask([{ k: 'cand', for: 'room' }]);
check('… and that candidate is handed out again, straight away', d1.c.id === c.c.id);
const [d2] = await M.ask([{ k: 'cand', for: 'room' }]);
clock += EXPIRE_MS + 1000;
const [d3] = await M.ask([{ k: 'cand', for: 'room' }]);
check('one never reported is handed out again after a while', d2.c.id === c.c.id + 1 && d3.c.id === c.c.id, d2.c.id + ', then ' + d3.c.id);
const [back] = await M.ask([{ k: 'report', id: d3.c.id, s: 0.1, n: 60, for: 'p000002' }]);
check('whoever reports gets a new candidate for their next fight', back && back.k === 'cand' && back.for === 'p000002' && back.c.id !== d3.c.id);

//  ---- it learns: fights scored by how close the candidate is to a readout we chose --------
S = mapStorage(); M = new MindStore(S, { now, random: seeded(3) });
const dir = eps(99), dn = Math.sqrt(dir.reduce((x, y) => x + y * y, 0));
const target = THETA0.map((x, d) => x + dir[d] / dn * 1.0);                  // 1.0 from the lab: inside RADIUS
const noise = seeded(5);
const fightWith = (th) => -Math.sqrt(th.reduce((x, y, d) => x + (y - target[d]) ** 2, 0)) + (noise() - 0.5) * 0.004;
const far0 = distance(target) - 0, far = (th) => Math.sqrt(th.reduce((x, y, d) => x + (y - target[d]) ** 2, 0));
for (let i = 0; i < 1600; i++) {
  const [q] = await M.ask([{ k: 'cand', for: 'room' }]);
  await M.ask([{ k: 'report', id: q.c.id, s: fightWith(theta(q.c)), n: 150 }]);
}
const [s2] = await M.ask([{ k: 'stats' }]);
check('over many fights the readout moves towards what wins them', far(M.es.theta) < far0 * 0.8,
  'from ' + far0.toFixed(3) + ' to ' + far(M.es.theta).toFixed(3) + ' away, in ' + s2.gen + ' steps (' + s2.reverts + ' times back to the best)');
check('and never further from the lab than ' + RADIUS, distance(M.es.theta) <= RADIUS + 1e-4, distance(M.es.theta).toFixed(4));

//  pushed hard in one direction for ever, it stops at the edge
S = mapStorage(); M = new MindStore(S, { now, random: seeded(13) });
const away = THETA0.map((x, d) => x + dir[d] / dn * 50);
for (let i = 0; i < 3000; i++) {
  const [q] = await M.ask([{ k: 'cand', for: 'room' }]);
  const th = theta(q.c);
  await M.ask([{ k: 'report', id: q.c.id, s: -Math.sqrt(th.reduce((x, y, d) => x + (y - away[d]) ** 2, 0)) / 10, n: 150 }]);
}
check('fights that would pull him anywhere cannot pull him further than ' + RADIUS + ' from the lab', Math.abs(distance(M.es.theta) - RADIUS) < 0.05, distance(M.es.theta).toFixed(4));

//  ---- going back to the best --------------------------------------------------------
S = mapStorage(); M = new MindStore(S, { now, random: seeded(17) });
let fights = 0;
async function fight(s) { const [q] = await M.ask([{ k: 'cand', for: 'room' }]); await M.ask([{ k: 'report', id: q.c.id, s: s + (fights++ % 3) * 0.01, n: 100 }]); }
for (let i = 0; i < WINDOW; i++) await fight(0.5);
const good = M.es.best && M.es.best.theta.slice();
for (let i = 0; i < WINDOW - 1; i++) await fight(-0.5);
const wandered = JSON.stringify(M.es.theta) !== JSON.stringify(good);
await fight(-0.5);
check('a window of fights clearly worse than his best: he goes back to it', good && wandered && M.es.reverts === 1 && JSON.stringify(M.es.theta) === JSON.stringify(good),
  M.es.reverts + ' time(s); ' + M.es.log.filter((l) => l.includes('back')).slice(-1)[0]);

//  ---- kept, and started again when the lab retrains him --------------------------------
const M2 = new MindStore(S, { now });
const [s3] = await M2.ask([{ k: 'stats' }]);
check('a memory made again from the same storage carries on where it was', s3.gen === M.es.gen && s3.fights === M.es.fights && JSON.stringify(M2.es.theta) === JSON.stringify(M.es.theta));
const es = S.m.get('es'); es.mark = 'another-brain'; S.m.set('es', es);
const M3 = new MindStore(S, { now });
const [s4] = await M3.ask([{ k: 'stats' }]);
check('a readout learned for another brain is not used: it starts again from the lab', s4.gen === 0 && s4.fromLab === 0);
check('readoutOf: the game\'s readout format', JSON.stringify(Object.keys(readoutOf(THETA0))) === '["v","graph","seed","w","b"]' && DIM === 101);

console.log('\nBEELZEBUB\'S MEMORY — in node\n');
console.log(results.join('\n'));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
