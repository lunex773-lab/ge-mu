//  ============================================================
//  What Beelzebub learns, the room's side  (node, with a clock of our own)
//  ============================================================
//  The room (relay.js, creatures.js, boss.js) and his memory (mindstore.js)
//  together, as the two Durable Objects run them: what a player is told when
//  they arrive, what a player's game may tell the memory, and a fight the
//  room runs — with a candidate, scored, reported, and what he learned of the
//  players kept.
//
//    node server/test/learn.test.js

import { Relay } from '../relay.js';
import { MindStore, MIN_FIGHT } from '../mindstore.js';
import { MODES } from '../boss.js';
import { ROOM } from '../creatures.js';
import CITY from '../../shared/city.js';
import PM from '../../lab/core/player_model.js';

const results = []; let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else fail++; results.push((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '\n         ' + detail : '')); }

function mapStorage() {
  const m = new Map(), cp = (v) => (v === undefined ? v : structuredClone(v));
  return { m, async get(k) { return cp(m.get(k)); },
    async put(k, v) { if (typeof k === 'object') for (const [kk, vv] of Object.entries(k)) m.set(kk, cp(vv)); else m.set(k, cp(v)); },
    async delete(k) { for (const kk of [].concat(k)) m.delete(kk); } };
}
let now = 1_700_000_000_000;
const store = new MindStore(mapStorage(), { now: () => now });
const R = new Relay({ moves: false });
const sent = [];                                   // everything the room sent: [to, { s, p }]
const keep = (out) => { for (const [to, t] of out || []) sent.push([to, JSON.parse(t)]); };
//  what the GameRoom does after each message: the room's asks to the memory, its answers back
async function pump() { for (let i = 0; i < 3; i++) { const a = R.takeAsks(); if (!a.length) return; keep(R.mindSaid(await store.ask(a))); } }
const to = (id, s) => sent.filter(([t, m]) => (t === id || t === 'all') && m.s === s).map(([, m]) => m.p);
const say = async (id, s, p) => { keep(R.handle(id, JSON.stringify({ s, p }), now).out); await pump(); };

//  ---- arriving -------------------------------------------------------------------
//  Aki has fought him before, in another room
const pm = new PM.PlayerModel({});
await store.ask([{ k: 'save', players: { Aki: { t: now - 60000, m: pm.serialize(), f: 0.3 } } }]);
keep(R.join('p000000', 'Aki')); R.hello('p000000'); await pump();
let [m] = to('p000000', 'mind');
check('arriving, a player is told the readout, handed a candidate, and what is known of them', m && m.ro && m.ro.w.length === 91 && m.c && Number.isInteger(m.c.id) && m.me && m.me.f === 0.3);
const candA = m.c.id;

//  ---- what a player's game may say --------------------------------------------------
keep(R.handle('p000000', JSON.stringify({ s: 'state', p: { x: 0, y: 0, z: 0 } }), now).out);
now += 60000;
await say('p000000', 'mind', { r: candA + 2, s: 0.4, n: 45 });
check('a report for a candidate the player was not handed is refused', (await store.ask([{ k: 'stats' }]))[0].fights === 0 && /not your candidate/.test(R.lastRefusal), R.lastRefusal);
await say('p000000', 'mind', { r: candA, s: 0.4, n: 45 });
let [st] = await store.ask([{ k: 'stats' }]);
m = to('p000000', 'mind').pop();
check('its own, once: taken, and a new candidate comes back for its next fight', st.fights === 1 && m.c && m.c.id !== candA, st.fights + ' fight(s); next ' + (m.c && m.c.id));
now += 5000;
await say('p000000', 'mind', { r: candA, s: 0.4, n: 45 });
check('the same one again is not', (await store.ask([{ k: 'stats' }]))[0].fights === 1);
const candA2 = m.c.id;
keep(R.join('p000009', 'Zed')); R.hello('p000009'); await pump();   // (a brand-new player, here a second)
now += 1000;
await say('p000009', 'mind', { r: to('p000009', 'mind')[0].c.id, s: 5, n: 3000 });
check('a fight longer than the player has been here is not counted as one', (await store.ask([{ k: 'stats' }]))[0].fights === 1);
keep(R.leave('p000009'));
const mine = new PM.PlayerModel({}); const own = mine.serialize();
await say('p000000', 'mind', { m: own, f: 0.61 });
const [back] = (await store.ask([{ k: 'hello', id: 'x', name: 'Aki' }]));
check('what its game has learned of this player is kept, under the name the room knows', back.me && back.me.f === 0.61 && back.me.t === now);
now += 30000;
await say('p000000', 'mind', { m: { v: 1, junk: true }, f: 0.1 });
const [back2] = (await store.ask([{ k: 'hello', id: 'x', name: 'Aki' }]));
check('something that is not a player model is not', back2.me.f === 0.61 && /not a player model/.test(R.lastRefusal));

//  ---- a fight the room runs ------------------------------------------------------------
const F = CITY.footprints(CITY.planBuildings());
let gx = 0, gz = 0;
for (let x = -200; x < 200 && !gx; x += 3) for (let z = -200; z < 200; z += 3) if (F.clearAt(x, z, 12) && F.roof(x, z) === 0) { gx = x; gz = z; break; }
//  (what the learning adds to a call — beginning a fight, ending it, sending
//  what he learned — measured on its own: a call has 10 ms of CPU on the free
//  plan, and what a step of him costs is boss.test.js's to measure)
const cost = { begin: 0, end: 0, remember: 0 };
let boss = null;
function timeOf(o, k) { const f = o[k].bind(o); o[k] = (...a) => { const t0 = process.hrtime.bigint(); const r = f(...a); cost[k] = Math.max(cost[k], Number(process.hrtime.bigint() - t0) / 1e6); return r; }; }
const at = (id, x, z) => keep(R.handle(id, JSON.stringify({ s: 'state', p: { x, y: 0, z, r: 0, w: 0 } }), now).out);
await store.ask([{ k: 'save', players: { Ben: { t: now - 1000, m: pm.serialize(), f: 0.7 } } }]);
keep(R.join('p000001', 'Ben')); R.hello('p000001'); await pump();
const C = R.creatures; boss = C.boss;
for (const k of Object.keys(cost)) timeOf(boss, k);
check('two here: the room asks the memory for a candidate of its own', C.cand && C.cand.id > 0 && C.known.get('Ben').f === 0.7);
const roomCand = C.cand.id;
//  the host's word on the tear: the room takes him
keep(R.handle('p000000', JSON.stringify({ s: 'mob', p: { g: [gx * 10, 0, gz * 10, 0, 4242, 'p000000', 5000] } }), now).out);
at('p000000', gx + 10, gz + 4); at('p000001', gx - 8, gz + 12);
const fightWall = now;
for (let i = 0; i < 4; i++) { now += 50; at('p000000', gx + 10, gz + 4); await pump(); }
check('he stands up with it, knowing what the memory knows of both, fairness where it had settled for them', boss.st && boss.fightId === roomCand && boss.ai.bank.models.has('Aki') && boss.ai.bank.models.has('Ben') && Math.abs(boss.ai.fair.level - (0.61 + 0.7) / 2) < 1e-6,
  'fight ' + boss.fightId + ', level ' + boss.ai.fair.level.toFixed(3) + ', knows ' + [...boss.ai.bank.models.keys()].join(', '));
await pump();
check('and the room has the next candidate ready already', C.cand && C.cand.id !== roomCand);
//  a minute and a half of fighting (the players keep still, he swings), then shot down
//  (Aki keeps back for the first half, so he turns to Ben too)
for (let i = 0; i < 1800; i++) { now += 50; at('p000000', gx + (i < 900 ? 70 : 10), gz + 4); at('p000001', gx - 8, gz + 12); if (i % 200 === 0) await pump(); }
const tally = Object.assign({}, boss.ai.tally);
let shots = 0, before = (await store.ask([{ k: 'stats' }]))[0].fights;
while (boss.st && boss.st.mode !== 'dead' && shots < 2000) { now += 300; at('p000000', gx + 10, gz + 4); boss.shot('p000000', now); shots++; }
await pump();
[st] = await store.ask([{ k: 'stats' }]);
check('he falls: how the fight went goes to the memory', boss.st.mode === 'dead' && st.fights === before + 1 && tally.secs >= MIN_FIGHT,
  Math.round(tally.secs) + ' s fighting, ' + tally.landed + ' landed, ' + tally.whiff + ' swung at air; ' + shots + ' shots to bring him down; fights ' + before + ' → ' + st.fights);
const [ak] = await store.ask([{ k: 'hello', id: 'x', name: 'Aki' }]), [bn] = await store.ask([{ k: 'hello', id: 'x', name: 'Ben' }]);
check('with what he learned of both of them', ak.me.t > fightWall && bn.me.t > fightWall && JSON.stringify(ak.me.m) !== JSON.stringify(own) && JSON.stringify(bn.me.m) !== JSON.stringify(pm.serialize()),
  'last turned to Aki ' + ((now - ak.me.t) / 1000).toFixed(1) + ' s before he fell, Ben ' + ((now - bn.me.t) / 1000).toFixed(1) + '; the fight began ' + ((now - fightWall) / 1000).toFixed(1) + ' s before');
check('everything he said of them the memory could file (no room ids)', st.players === 2, st.players + ' remembered');

check('beginning a fight, ending it, and sending what he learned each cost a call little', Math.max(cost.begin, cost.end, cost.remember) < 3,
  Object.entries(cost).map(([k, v]) => k + ' ' + v.toFixed(2) + ' ms').join(', ') + ' at worst');

//  ---- given back ------------------------------------------------------------------------
sent.length = 0;
keep(R.leave('p000001')); await pump();
const given = to('p000000', 'mind');
check('one left: they are given what the room learned of them, with him', given.length === 1 && given[0].me && given[0].me.t === C.known.get('Aki').t);

console.log('\nWHAT BEELZEBUB LEARNS — the room\'s side, in node\n');
console.log(results.join('\n'));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
