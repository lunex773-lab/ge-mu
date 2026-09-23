//  ============================================================
//  The room's rules, on their own  (node, with a clock of our own)
//  ============================================================
//  The Relay decides what is true in a room; here it runs without
//  Cloudflare and with time that can be moved forward, so what takes
//  seconds in a game (a banana coming back) takes none.
//
//    node server/test/relay.test.js

import { Relay } from '../relay.js';
import ITEMS from '../../shared/items.js';

const results = []; let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else fail++; results.push((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '\n         ' + detail : '')); }

let now = 1_000_000;
const R = new Relay();
R.join('p000000', 'Aki'); R.join('p000001', 'Ben');
const say = (from, s, p) => { const r = R.handle(from, JSON.stringify({ s, p }), now); return r.out.map(([to, t]) => [to, JSON.parse(t)]); };
const at = (id, x, z, w = 0) => say(id, 'state', { x, y: 0, z, r: 0, w });

// ---- pickups -------------------------------------------------------------
const items = ITEMS.layout();
const bi = items.findIndex((it) => it.k === 'banana'), ci = items.findIndex((it) => it.k === 'compass'), ri = items.findIndex((it) => it.k === 'rot');
const B0 = items[bi];
check('the layout: 8 fresh, 12 rotten, 5 compasses, in that order', items.length === 25 && bi === 0 && ri === 8 && ci === 20);

at('p000000', B0.x + 20, B0.z); now += 100;
let out = say('p000000', 'take', { i: bi });
check('too far away to pick it up: nothing', out.length === 0);

at('p000000', B0.x + 0.5, B0.z); now += 100;
say('p000000', 'hurt', { d: 50 }); now += 100;
out = say('p000000', 'take', { i: bi });
const took = out.find(([to, m]) => m.s === 'took'), gone = out.find(([to, m]) => m.s === 'item');
check('within reach: it is yours, and the room heals you', took && took[0] === 'p000000' && took[1].p.hp === 90, JSON.stringify(took));
check('and tells everyone it is gone', gone && gone[0] === 'all' && gone[1].p.a === 0 && gone[1].p.i === bi);

at('p000001', B0.x, B0.z + 0.5); now += 100;
out = say('p000001', 'take', { i: bi });
check('the next one there finds nothing', out.length === 0);

now += (ITEMS.RESPAWN.banana - 1) * 1000; out = at('p000001', B0.x, B0.z);
check('it is not back a second early', !out.some(([, m]) => m.s === 'item'));
now += 1500; out = at('p000001', B0.x, B0.z);
const back = out.find(([, m]) => m.s === 'item');
check('and is back on time, for everyone', back && back[0] === 'all' && back[1].p.a === 1 && back[1].p.i === bi);

const Rot = items[ri];
at('p000001', Rot.x, Rot.z, 0); now += 100;
out = say('p000001', 'take', { i: ri });
check('a rotten banana is on the other side of the tear: not from this one', out.length === 0);
at('p000001', Rot.x, Rot.z, 1); now += 100;
out = say('p000001', 'take', { i: ri });
check('from over there, it is', out.some(([, m]) => m.s === 'took'));

const C = items[ci];
at('p000000', C.x, C.z); now += 100;
out = say('p000000', 'take', { i: ci });
const tc = out.find(([, m]) => m.s === 'took');
check('a compass is yours, and heals nobody', tc && tc[1].p.hp === undefined);
out = say('p000000', 'take', { i: 999 });
check('a pickup that does not exist is nothing', out.length === 0);

// ---- a player cannot heal itself any more ----------------------------------
say('p000000', 'hurt', { d: 30 });
const hp0 = R.players.get('p000000').hp;
out = say('p000000', 'heal', { d: 40 });
check('"heal" is not a thing a player may say', out.length === 0 && R.players.get('p000000').hp === hp0);

console.log('\nTHE ROOM\'S RULES — in node\n');
console.log(results.join('\n'));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
