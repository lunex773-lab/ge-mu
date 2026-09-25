//  ============================================================
//  GameRoom, end to end, on a local workerd  (brief §36: "Cloudflare設定確認")
//  ============================================================
//  Starts `wrangler dev` — the same runtime Cloudflare runs, locally — and
//  talks to it as browsers would: fetches the page, opens WebSockets into
//  rooms, and checks what gets through.
//
//  With LIVE_URL set it starts nothing and checks the deployed site instead
//  (the deploy workflow does this after every deploy): the same checks, in
//  rooms of its own, with every wait stretched by the round trip to there,
//  and one more — that the page served is this checkout's index.html.
//
//    npm run test:server        (or: node server/test/room.test.js)
//    LIVE_URL=https://contour.<subdomain>.workers.dev node server/test/room.test.js

import { spawn } from 'node:child_process';
import CITY from '../../shared/city.js';
import RULES from '../../shared/rules.js';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import TF from '../../shared/traffic.js';
import { fingerprint } from '../fingerprint.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILD = fingerprint(ROOT);                   // the room server's code, as it is in this checkout
const PORT = 8700 + Math.floor(Math.random() * 200);
const LIVE = (process.env.LIVE_URL || '').replace(/\/+$/, '');
const BASE = LIVE || 'http://127.0.0.1:' + PORT;
//  live, the rooms are ours alone: nobody playing is in them, or disturbed
const ROOM = LIVE ? '_check-' + Math.random().toString(36).slice(2, 8) + '-' : '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let EXTRA = 0;                                     // ms: the round trip to a live room, and some
const wait = (ms) => sleep(ms + EXTRA);
//  what should arrive is waited for until it does (or 3 s go by): a busy
//  machine — a CI runner — is slow now and then, and a fixed pause once
//  read a state from before the death it was checking for. Fixed pauses
//  stay only where the check is that something does *not* arrive.
async function until(fn, ms = 3000) {
  const end = Date.now() + ms + EXTRA;
  while (!fn() && Date.now() < end) await sleep(20);
  return fn();
}

const results = []; let pass = 0, fail = 0;
//  each result is printed as it comes, so a run that stops half way still says how far it got
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  const line = (ok ? '  ok   ' : '  FAIL ') + name + (detail ? '\n         ' + detail : '');
  results.push(line); console.log(line);
}
//  what a player has been sent, kind by kind (for a check that fails)
const kinds = (P) => Object.entries(P.got.reduce((n, m) => (n[m.s] = (n[m.s] || 0) + 1, n), {})).map(([k, n]) => k + ' ' + n).join(', ');

//  a player: a WebSocket and everything it has been sent
function join(room, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE.replace('http', 'ws') + '/ws?room=' + encodeURIComponent(room) + '&name=' + encodeURIComponent(name), { headers: { Origin: BASE } });
    const P = { ws, got: [], id: null };
    const late = setTimeout(() => { reject(new Error('no welcome in 10 s')); try { ws.close(); } catch (e) {} }, 10000);
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.s === '_welcome') { clearTimeout(late); P.id = m.p.id; P.welcome = m.p; resolve(P); } else P.got.push(m); };
    ws.onerror = (e) => { clearTimeout(late); reject(new Error('socket error')); };
    P.send = (s, p) => ws.send(JSON.stringify({ s, p }));
    P.of = (s) => P.got.filter((m) => m.s === s);
  });
}

//  the round trip to a room of its own: the middle of five pings. (Not the
//  slowest: one ping once took 5 s, every wait grew by 7.5 s, and in the
//  gaps the room went to sleep — hibernation, which forgets where players
//  were until they next say — so hits it should have judged were refused.)
async function roundTrip() {
  const P = await join(ROOM + 'rtt', 'rtt');
  //  (a room still on the last version, the minute after a deploy, is not this one)
  if (P.welcome.bd !== BUILD) { P.ws.close(); throw new Error('a room still runs build ' + P.welcome.bd + ', not ' + BUILD); }
  const all = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now(), n = P.of('ping').length;
    P.send('ping', { t: t0 });
    while (P.of('ping').length === n && Date.now() - t0 < 5000) await sleep(5);
    all.push(Date.now() - t0);
    await sleep(600);                             // pings are limited to 2 a second
  }
  P.ws.close();
  return all;
}
//  Just after a deploy the rooms are still moving to the new version: the
//  first sockets fail, or answer seconds late (both seen, a second after
//  deploying), or a room answers on the last version's code (seen: the
//  first rooms of a check on the old code, then moved over half way through
//  it). So, live, wait until a room answers promptly — the middle ping under
//  2 s — with this checkout's build, trying every few seconds for 90 s.
async function settled() {
  const end = Date.now() + 90000;
  let tries = 0, why = '';
  for (;;) {
    tries++;
    try {
      const all = await roundTrip(), mid = all.slice().sort((a, b) => a - b)[2];
      if (mid < 2000) return { all, mid, tries };
      why = 'slow (' + all.join(', ') + ' ms)';
    } catch (e) { why = e.message; }
    if (Date.now() > end) throw new Error('the rooms did not settle in 90 s (' + tries + ' tries, last: ' + why + ')');
    await sleep(3000);
  }
}

async function main() {
  //  its own process group, so that stopping it stops wrangler's children too
  const dev = LIVE ? null : spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--log-level', 'warn'],
    { cwd: ROOT, detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false' } });
  let log = ''; if (dev) { dev.stdout.on('data', (d) => { log += d; }); dev.stderr.on('data', (d) => { log += d; }); }
  try {
    let up = false;
    for (let i = 0; i < 120 && !up; i++) { if (dev || i) await sleep(500); try { up = (await fetch(BASE + '/')).ok; } catch (e) { if (LIVE) log = String(e.cause || e); } }
    if (!up) throw new Error((LIVE ? BASE + ' did not answer: ' : 'wrangler dev did not start:\n') + log.slice(-2000));
    if (LIVE) {
      const { all, mid: rtt, tries } = await settled();
      //  at most 1.5 s more, so no gap in a sequence nears the ~10 s a room waits before it sleeps
      EXTRA = Math.min(1500, Math.ceil(rtt * 1.5));
      console.log('LIVE ' + BASE + ' — settled after ' + tries + ' tr' + (tries === 1 ? 'y' : 'ies') + '; round trip ' + rtt + ' ms (' + all.join(', ') + '), every wait +' + EXTRA + ' ms');
    }

    // ---- the page, and nothing else --------------------------------------
    let page = await fetch(BASE + '/'), html = await page.text();
    check('the game is served at /', page.ok && html.includes('CONTOUR'), page.status + ' ' + html.length + ' characters');
    if (LIVE) {
      //  a new page takes a little while to reach every edge after a deploy
      //  (once the check read the one before, 872 359 characters for 869 789):
      //  asked again every 5 s, for up to 2 minutes
      const mine = readFileSync(path.join(ROOT, 'index.html'), 'utf8'), t0 = Date.now();
      while (html !== mine && Date.now() - t0 < 120000) { await sleep(5000); page = await fetch(BASE + '/', { cache: 'no-store' }); html = await page.text(); }
      check('and it is this checkout\'s index.html', html === mine, html.length + ' characters served, ' + mine.length + ' here, after ' + Math.round((Date.now() - t0) / 1000) + ' s');
    }
    const notPublic = [];
    for (const f of ['/lab/README.md', '/server/room.js', '/wrangler.jsonc', '/package.json', '/SERVER_MIGRATION_ANALYSIS.md', '/README.md']) {
      const r = await fetch(BASE + f); if (r.status !== 404) notPublic.push(f + ' ' + r.status); await r.text();
    }
    check('nothing but the game is public', notPublic.length === 0, notPublic.join(', '));

    // ---- rooms -------------------------------------------------------------
    const A = await join(ROOM + 'alpha', 'Aki'), B = await join(ROOM + 'alpha', 'Ben'), C = await join(ROOM + 'beta', 'Cho');
    check('the room names its players, in join order', A.id < B.id && /^p[0-9a-z]{6}$/.test(A.id), A.id + ' then ' + B.id);
    check('and says who is here and who runs the creatures', B.welcome.host === A.id && B.welcome.players.includes(A.id), JSON.stringify(B.welcome));
    A.send('state', { id: 'pzzzzzz', x: 1, y: 0, z: 2, r: 0 });
    const st = await until(() => B.of('state')[0]);
    check('a state reaches the room, stamped with its real sender', st && st.f === A.id && st.p.id === A.id, JSON.stringify(st));
    check('and not another room', C.got.filter((m) => m.s !== 'mind').length === 0, kinds(C));

    // ---- shots between players: the room judges them ----------------------
    //  two places in the same street (a clear line), and one round the corner
    //  of a building from the first (no line) — found in the shared city
    const L = CITY.lazyCity();
    const clear = (a, b) => { const dx = b.x - a.x, dy = b.y + 1.1 - (a.y + RULES.EYE), dz = b.z - a.z, d = Math.hypot(dx, dy, dz);
      return CITY.rayLazy(L, { x: a.x, y: a.y + RULES.EYE, z: a.z }, { x: dx / d, y: dy / d, z: dz / d }, d) >= d - 0.4; };
    const PA = { x: 0, y: 0, z: 10 }, PB = { x: 0, y: 0, z: 40 };
    let hidden = null;
    for (let x = 16; x < 50 && !hidden; x += 2) for (const z of [-4, 4]) { const c = { x, y: 0, z: 60 }, a = { x, y: 0, z }; if (!clear(a, c)) { hidden = [a, c]; break; } }
    check('the shared city has a clear street and a building in the way', clear(PA, PB) && hidden, JSON.stringify(hidden));
    const place = async (P, at) => { P.send('state', { x: at.x, y: at.y, z: at.z, r: 0, w: 0 }); await wait(150); };
    await place(A, PA); await place(B, PB);
    B.send('hit', { by: 'pzzzzzz', t: A.id, d: 99999 });
    const h = await until(() => A.of('hurt')[0]);
    check('a hit the room believes does the gun\'s damage, not what it claims', h && h.p.d === 20 && h.p.by === B.id && h.p.hp === 80,
      h ? JSON.stringify(h) : 'nothing came; A was sent: ' + kinds(A) + ' | B was sent: ' + kinds(B));
    check('and is not passed on as a claim', A.of('hit').length === 0);
    await wait(250); B.send('hit', { t: A.id }); await sleep(10); B.send('hit', { t: A.id });   // the second too soon after the first
    await until(() => A.of('hurt').length >= 2); await wait(300);
    check('two hits closer together than the gun can fire count once', A.of('hurt').length === 2, A.of('hurt').map((m) => m.p.hp).join(','));
    await place(A, hidden[0]); await place(B, hidden[1]); await wait(250);
    B.send('hit', { t: A.id });
    //  out of range: someone who arrives 340 m away (a first step may be
    //  anywhere; the room would not believe A walked there)
    const E = await join(ROOM + 'alpha', 'Eve');
    await place(E, { x: 0, y: 0, z: -300 }); await place(B, PB); await wait(250);
    B.send('hit', { t: E.id });
    await wait(300);
    check('a hit through a building, or from out of range, does nothing', A.of('hurt').length === 2 && E.of('hurt').length === 0);
    E.ws.close();
    await place(A, PA); await place(B, PB);
    for (let i = 0; i < 4; i++) { await wait(250); B.send('hit', { t: A.id }); }
    const kill = await until(() => B.of('kill').length && A.of('kill')[0]);
    const lastHurt = A.of('hurt').pop();
    check('the fifth hit kills, and the room says whose kill it is', lastHurt && lastHurt.p.hp === 0 && kill && kill.p.by === B.id && kill.p.v === A.id && B.of('kill').length === 1,
      JSON.stringify(kill));
    B.send('state', { x: PB.x, y: 0, z: PB.z, r: 0, w: 0 }); A.send('state', { x: PA.x, y: 0, z: PA.z, r: 0, w: 0, hp: 100 });
    const lastA = () => B.of('state').filter((m) => m.f === A.id).pop();
    await until(() => lastA() && lastA().p.d === 1);
    const sA = lastA();
    check('and tells everyone the dead player is dead, whatever it says of itself', sA && sA.p.d === 1 && sA.p.hp === 0 && sA.p.kb === B.id, JSON.stringify(sA && sA.p));
    const hurtsAtDeath = A.of('hurt').length;
    await wait(250); B.send('hit', { t: A.id }); await wait(300);
    check('a dead player cannot be hit again', A.of('hurt').length === hurtsAtDeath && A.of('hurt').filter((m) => m.p.hp === 0).length === 1, hurtsAtDeath + ' hits landed in all');
    A.send('spawn', {}); await until(() => A.of('hp').length >= 1);
    A.send('hurt', { d: 30 }); await until(() => A.of('hp').length >= 2);
    const hps = A.of('hp').map((m) => m.p.hp);
    check('getting up, and a car or a creature reported against yourself, count on your own health', hps.join(',') === '100,70', hps.join(','));
    A.send('kill', { by: B.id, v: A.id, ds: 99 }); await wait(200);
    check('a player cannot declare a kill', B.of('kill').length === 1);

    // ---- where players are (server/move.js) ------------------------------
    A.send('state', { x: PA.x, y: 0, z: PA.z, r: 0, w: 0 });   // the first step after getting up may be anywhere: this is it
    await wait(150);
    const fromA = () => B.of('state').filter((m) => m.f === A.id).length, seenA = fromA();
    A.send('state', { x: 250, y: 0, z: 250, r: 0, w: 0 });
    const pos = await until(() => A.of('pos')[0]);
    await wait(200);
    check('a step across the city is not passed on, and the player is told where the room has them',
      pos && pos.p.x === PA.x && pos.p.z === PA.z && fromA() === seenA, JSON.stringify(pos && pos.p) + ', ' + (fromA() - seenA) + ' passed on');

    // ---- what a message may say ------------------------------------------
    B.send('mob', { m: [1, 2, 3] }); A.send('mob', { m: [4, 5, 6] });
    await until(() => B.of('mob').length >= 1); await wait(200);
    check('only the host\'s creature snapshots are passed on', A.of('mob').length === 0 && B.of('mob').length === 1 && B.of('mob')[0].p.m[0] === 4);
    const before = A.got.length;
    B.send('ping', { id: B.id, t: 123 });
    B.send('nonsense', { a: 1 });
    B.ws.send('not json');
    B.send('state', { x: 'far', y: 0, z: 0 });
    await until(() => B.of('ping').length >= 1); await wait(200);
    check('a ping comes back to its sender only', B.of('ping').length === 1 && A.of('ping').length === 0);
    check('unknown kinds, broken JSON and bad positions go nowhere', A.got.length === before, A.got.slice(before).map((m) => m.s).join(','));
    for (let i = 0; i < 60; i++) B.send('shot', {});
    await wait(400);
    check('a flood is cut to each kind\'s rate', A.of('shot').length <= 20, A.of('shot').length + ' of 60 shots passed');

    // ---- Beelzebub's memory (server/mindstore.js; a live check's rooms have one of their own) ----
    const hello = await until(() => A.of('mind')[0], 5000);
    check('arriving, a player is handed his readout and a candidate for the fights its game runs',
      hello && hello.p.ro && hello.p.ro.w.length === 91 && hello.p.c && Number.isInteger(hello.p.c.id), hello ? 'readout at step ' + hello.p.ro.gen + ', candidate ' + hello.p.c.id : kinds(A));
    A.send('mind', { r: hello.p.c.id + 7, s: null, n: 0 });
    await wait(400);
    const stillOne = A.of('mind').length === 1;
    A.send('mind', { r: hello.p.c.id, s: null, n: 0 });          // (no fight: handed out again, and nothing learned)
    const next = await until(() => A.of('mind')[1], 5000);
    check('a report for its own candidate is taken, and a candidate comes back for the next fight (the same: it was never fought); for any other, nothing',
      stillOne && next && next.p.c && Number.isInteger(next.p.c.id), next ? 'next ' + next.p.c.id : kinds(A));
    const mind = await fetch(BASE + '/mind').then((r) => r.json()).catch((e) => ({ error: String(e) }));
    check('/mind says how his learning is going (and names nobody)', Number.isInteger(mind.gen) && Number.isInteger(mind.players) && !JSON.stringify(mind).includes('Aki'),
      JSON.stringify(mind).slice(0, 160));

    // ---- the day side's traffic (server/traffic.js): two in a room of their own ----
    const G1 = await join(ROOM + 'gamma', 'Gus'), G2 = await join(ROOM + 'gamma', 'Gil');
    const tq = await until(() => G1.of('tq')[0], 5000);
    //  G1's game hands over its traffic (a city fresh from the seed, its clock at 42 s)
    const city = TF.fullState(TF.makeTraffic({ now: () => 42 }));
    G1.send('tfull', city);
    const tOwn = await until(() => G2.of('own').find((m) => m.p.t === 1), 5000);
    for (let i = 0; i < 6; i++) { G1.send('state', { x: 30, y: 0, z: 6, r: 0, w: 0 }); G2.send('state', { x: 32, y: 0, z: 6, r: 0, w: 0 }); await sleep(60); }
    const tv = await until(() => G2.of('tv')[0], 5000);
    const told = tv ? (tv.p.c || []).length / 6 + (tv.p.f || []).length / 7 + (tv.p.w || []).length / 6 : 0;
    check('two in a room: it asks the host\'s game for its traffic, carries on from it, and tells each player the whole city',
      tq && tOwn && tv && Math.abs(tv.p.t - 42) < 3 && told === 361, (tq ? 'asked; ' : 'not asked; ') + (tv ? 'first word ' + JSON.stringify(tv.p).length + ' bytes, ' + told + ' told, clock ' + tv.p.t : kinds(G2)));

    // ---- the other side's dogs (server/dogs.js), in the same room ----
    //  G1's game had none (it was on the day side): the room starts with an
    //  empty district, stocks it as they cross, and tells only those over there
    const dq = G1.of('dq')[0];
    G1.send('dfull', { k: [] });
    const dOwn = await until(() => G2.of('own').find((m) => m.p.d === 1), 5000);
    for (let i = 0; i < 30; i++) { G1.send('state', { x: 30, y: 0, z: 6, r: 0, w: 1 }); G2.send('state', { x: 32, y: 0, z: 6, r: 0, w: i < 15 ? 0 : 1 }); await sleep(60); }
    const dvG1 = G1.of('dv'), dvG2 = G2.of('dv'), lastDv = dvG1.filter((m) => m.p.kf === 1).pop();
    const up = lastDv ? lastDv.p.k.length / 7 : 0;
    check('two in a room: it asks the host\'s game for its dogs, carries on (none: it stocks the district as they cross), and tells only those over there',
      dq && dOwn && up >= 20 && dvG2.length < dvG1.length && dvG2.length > 0,
      (dq ? 'asked; ' : 'not asked; ') + up + ' dogs up after 1.8 s; words to the one over there all along ' + dvG1.length + ', to the one who crossed later ' + dvG2.length);
    G1.ws.close(); G2.ws.close();

    // ---- leaving -------------------------------------------------------------
    B.ws.close();
    await until(() => A.of('leave').some((m) => m.p.id === B.id));
    check('when someone leaves, the room says so', A.of('leave').some((m) => m.p.id === B.id));
    const D = await join(ROOM + 'alpha', 'Dai');
    check('a newcomer gets the next id, never a lower one', D.id > B.id && D.welcome.host === A.id, D.id);
    A.ws.close(); C.ws.close(); D.ws.close();
  } finally {
    if (dev) try { process.kill(-dev.pid, 'SIGTERM'); } catch (e) {}
  }
  console.log('\nGAMEROOM — ' + (LIVE ? 'live at ' + BASE : 'on a local workerd') + ': ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
