//  ============================================================
//  Beelzebub, run by the room  (node, with a clock of our own)
//  ============================================================
//  server/boss.js with the room's own rules (relay.js) and the shared city,
//  as the room on Cloudflare runs it — and what each call costs, since a
//  call there has 10 ms of CPU on the free plan.
//
//    node server/test/boss.test.js

import { Relay } from '../relay.js';
import { RoomBoss, MODES } from '../boss.js';
import CITY from '../../shared/city.js';
import RULES from '../../shared/rules.js';

const results = []; let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else fail++; results.push((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '\n         ' + detail : '')); }
const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;

let now = 1_000_000;
const R = new Relay({ moves: false });
R.join('p000000', 'Aki'); R.join('p000001', 'Ben');
const at = (id, x, z, w = 0) => R.handle(id, JSON.stringify({ s: 'state', p: { x, y: 0, z, r: 0, w } }), now);
const F = CITY.footprints(CITY.planBuildings());

//  a tear in an open street, and two players nearby
let gx = 0, gz = 0;
for (let x = -200; x < 200 && !gx; x += 3) for (let z = -200; z < 200; z += 3) if (F.clearAt(x, z, 12) && F.roof(x, z) === 0) { gx = x; gz = z; break; }
const boss = new RoomBoss(R);
boss.hearGate([gx * 10, 0, gz * 10, 0, 4242, 'p000000', 5000]);
at('p000000', gx + 10, gz + 4); at('p000001', gx - 8, gz + 12);

let t0 = process.hrtime.bigint(); boss.step(now); const coreMs = ms(t0);
now += 50; t0 = process.hrtime.bigint(); boss.step(now); const mindMs = ms(t0);
check('the first call makes his core, the next the rest of his mind, and nothing more', boss.ai && !boss.st,
  coreMs.toFixed(2) + ' ms, ' + mindMs.toFixed(2) + ' ms');
now += 50; t0 = process.hrtime.bigint(); boss.step(now); const upMs = ms(t0);
const s0 = boss.snapshot();
check('the next stands him up in front of the tear, in the open street', s0 && Math.hypot(s0[0] / 10 - gx, s0[1] / 10 - gz) < 20 && F.clearAt(s0[0] / 10, s0[1] / 10, 2) && F.roof(s0[0] / 10, s0[1] / 10) === 0,
  JSON.stringify(s0) + ' in ' + upMs.toFixed(2) + ' ms');
check('with two to fight, 60% more of him than for one', s0 && s0[5] === Math.round(RULES.BZB_HP * 1.6), 'hpMax ' + (s0 && s0[5]));

//  a minute: the players keep still, he thinks and swings; what a call costs
let worst = 0, sum = 0, n = 0, swings = 0, lastSeq = s0[7], thrown = null;
try {
  for (let i = 0; i < 1200; i++) {
    now += 50;
    at('p000000', gx + 10, gz + 4); at('p000001', gx - 8, gz + 12);
    const t = process.hrtime.bigint(); boss.step(now); const d = ms(t);
    worst = Math.max(worst, d); sum += d; n++;
    const s = boss.snapshot(); if (s && s[7] !== lastSeq) { swings++; lastSeq = s[7]; }
  }
} catch (e) { thrown = e; }
check('a minute of him, near two players: no error, he thinks ten times a second, and he swings', !thrown && boss.ai.thinks > 550 && swings > 0,
  (thrown ? thrown.message + ' ' : '') + boss.ai.thinks + ' decisions, ' + swings + ' swings, now ' + MODES[boss.snapshot()[6]]);
check('and no call reaches the 10 ms a call has', Math.max(worst, coreMs, mindMs, upMs) < 9.5,
  'each call ' + (sum / n).toFixed(3) + ' ms on average, ' + worst.toFixed(2) + ' ms at worst; his core ' + coreMs.toFixed(2) + ', his mind ' + mindMs.toFixed(2) + ', standing up ' + upMs.toFixed(2));

//  shots at him
const hp0 = boss.snapshot()[4];
now += 400; at('p000000', gx + 10, gz + 4);
const got = boss.shot('p000000', now);
check('a shot from the open street lands', got > 0 && boss.snapshot()[4] < hp0, hp0 + ' → ' + boss.snapshot()[4]);
now += 10;
check('the next, sooner than the gun can fire, does not', boss.shot('p000000', now) === 0, R.lastRefusal);
//  from behind a building: find a spot with a wall between it and him
const s1 = boss.snapshot(), bx = s1[0] / 10, bz = s1[1] / 10, city = (await import('../combat.js')).theCity();
let hid = null;
for (let r = 20; r < 90 && !hid; r += 2) for (let k = 0; k < 24 && !hid; k++) {
  const x = bx + Math.sin(k / 24 * 6.2832) * r, z = bz + Math.cos(k / 24 * 6.2832) * r;
  if (!F.clearAt(x, z, 0.6)) continue;
  const blocked = [[1.2], [2.6], [3.6], [4.3]].every(([hy]) => { const ro = { x, y: RULES.EYE, z }, dx = bx - x, dy = hy - RULES.EYE, dz = bz - z, d = Math.hypot(dx, dy, dz);
    return CITY.rayLazy(city, ro, { x: dx / d, y: dy / d, z: dz / d }, d) < d - 2; });
  if (blocked) hid = { x, z };
}
now += 400; at('p000001', hid.x, hid.z);
const before = boss.snapshot()[4];
check('from behind a building, nothing', hid && boss.shot('p000001', now) === 0 && boss.snapshot()[4] === before, R.lastRefusal);

//  down he goes, and stays down at this tear (B7)
at('p000000', gx + 10, gz + 4);
let shots = 0;
while (boss.snapshot()[6] !== MODES.indexOf('dead') && shots < 2000) { now += 300; at('p000000', gx + 10, gz + 4); boss.step(now); boss.shot('p000000', now); shots++; }
check('shot enough, he falls', boss.snapshot()[6] === MODES.indexOf('dead') && boss.slain.has(4242), shots + ' shots');
for (let i = 0; i < 220; i++) { now += 50; boss.step(now); }
check('and is gone once he has lain there', boss.snapshot() === null);
for (let i = 0; i < 100; i++) { now += 50; boss.step(now); }
check('and does not rise again at the same tear', boss.snapshot() === null);
boss.hearGate([(gx + 30) * 10, 0, gz * 10, 0, 777, 'p000000', 0]);
for (let i = 0; i < 3; i++) { now += 50; boss.step(now); }
check('a new tear gets a new guardian', boss.snapshot() && boss.snapshot()[10] === 777);

//  taken over from a host that had him
const B2 = new RoomBoss(R);
B2.hearGate([gx * 10, 0, gz * 10, 0, 999, 'p000000', 0]);
B2.adopt([Math.round((gx + 3) * 10), Math.round(gz * 10), 0, 64, 3000, 6400, 0, 17, -1, -1, 999]);
const a = B2.snapshot();
check('taken over from what the host last said: where he was, and how hurt', a && a[0] === Math.round((gx + 3) * 10) && a[4] === 3000 && a[5] === 6400 && a[7] === 17, JSON.stringify(a));
now += 50; B2.step(now);
check('and he carries on from there', B2.snapshot() && B2.snapshot()[4] === 3000);

console.log('\nBEELZEBUB, RUN BY THE ROOM — in node\n');
console.log(results.join('\n'));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
