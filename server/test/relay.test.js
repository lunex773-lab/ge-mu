//  ============================================================
//  The room's rules, on their own  (node, with a clock of our own)
//  ============================================================
//  The Relay decides what is true in a room; here it runs without
//  Cloudflare and with time that can be moved forward, so what takes
//  seconds in a game (a banana coming back) takes none.
//
//    node server/test/relay.test.js

import { Relay } from '../relay.js';
import { SPEED, LIMIT } from '../move.js';
import ITEMS from '../../shared/items.js';
import RULES from '../../shared/rules.js';

const results = []; let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else fail++; results.push((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '\n         ' + detail : '')); }

let now = 1_000_000;
const R = new Relay({ moves: false });                // the pickups, with players set down where each needs to be
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

// ---- where players are (move.js), as every room on Cloudflare checks it ------
const M = new Relay();
M.join('p000000', 'Aki'); M.join('p000001', 'Ben');
const go = (id, x, z, w = 0, dt = 66) => { now += dt; return M.handle(id, JSON.stringify({ s: 'state', p: { x, y: 0, z, r: 0, w } }), now).out.map(([to, t]) => [to, JSON.parse(t)]); };
const told = (o) => o.some(([, m]) => m.s === 'state');
const putBack = (o) => { const f = o.find(([, m]) => m.s === 'pos'); return f && f[1].p; };
const last = (id) => { const h = M.players.get(id).hist; return [h[h.length - 3], h[h.length - 1]]; };

let x = 11, z = 10, dir = 1, refused = 0;
go('p000000', x, z); go('p000001', x + 3, z);
for (let i = 0; i < 455; i++) {                        // 30 s, running flat out, back and forth
  z += dir * RULES.RUN * 0.066; if (Math.abs(z) > 300) dir = -dir;
  if (!told(go('p000000', x, z))) refused++;
}
check('running flat out for 30 s: every step believed', refused === 0, refused + ' refused');

//  nothing for 3 s, then all of it at once, inward (past 40 at once the
//  per-kind rate limit drops the rest — dropped, not refused: nobody is put back)
now += 3000; dir = z > 0 ? -1 : 1;
const before = M.moveRefused;
for (let i = 0; i < 45; i++) { z += dir * RULES.RUN * 0.066; go('p000000', x, z, 0, 1); }
check('a 3 s stall, then its 3 s of running all at once: believed', M.moveRefused === before, (M.moveRefused - before) + ' refused; ' + M.lastMoveRefusal);

const was = last('p000000');                          // where the room has them
let o = go('p000000', was[0] + 150, was[1]);
const pb = putBack(o);
check('a 150 m jump is not passed on, and the player is told where the room has them', !told(o) && pb && pb.x === was[0] && pb.z === was[1], JSON.stringify(pb));
check('and it is not where shots or pickups are judged from', last('p000000').join() === was.join());
o = go('p000000', was[0], was[1]); z = was[1];
check('back where it was, the next step is believed', told(o));

let got = 0, t0 = now, caught = -1, x0 = x;           // twice running speed
for (let i = 0; i < 152 && caught < 0; i++) { x += 2 * RULES.RUN * 0.066; o = go('p000000', x, z); if (told(o)) got = x - x0; else caught = (now - t0) / 1000; }
check('twice running speed is caught within 10 s', caught > 0 && caught < 10, 'after ' + caught.toFixed(1) + ' s');
check('and got no further than running allows, and what can be held in hand', got <= SPEED * caught + SPEED * 4 + 40 + 1,
  got.toFixed(0) + ' m in ' + caught.toFixed(1) + ' s');
x = x0; now += 5000; go('p000000', x, z);             // (a rest, back where it was believed)

//  what the room cannot see: a creature's shove, VECNA's pull — a jump
//  bigger than a stall's worth of running is taken on the other side only
now += 5000; o = go('p000001', 14, 10); o = go('p000001', 14 + 80, 10);
check('in daylight, 80 m at once is not', !told(o));
go('p000001', 14, 10, 1, 2000);                          // through the tear (free)
now += 5000; o = go('p000001', 14 + 80, 10, 1);
check('on the other side, where a stamp and a pull can come together, it is', told(o));

o = go('p000001', 150, -150, 0, 2000);
check('crossing the tear, the game may put you anywhere', told(o));
o = go('p000001', 200, -150, 1, 800);
check('but not back through it at once', !told(o));
o = go('p000001', 200, -150, 1, 1500);
check('a moment later, yes', told(o));

M.handle('p000001', JSON.stringify({ s: 'hurt', p: { d: 100 } }), now);
M.handle('p000001', JSON.stringify({ s: 'spawn', p: {} }), now);
o = go('p000001', -250, 250);
check('getting back up, anywhere', told(o));
o = go('p000001', LIMIT + 1, 250, 0, 60000);
check('but never outside the city', !told(o));

let answers = 0;
now += 600;
for (let i = 0; i < 6; i++) if (putBack(go('p000001', 100, 100, 0, 60))) answers++;
check('a run of refused steps gets one answer, not one each', answers === 1, answers + ' answers to 6 steps in 0.36 s');

console.log('\nTHE ROOM\'S RULES — in node\n');
console.log(results.join('\n'));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
