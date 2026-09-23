//  ============================================================
//  GameRoom, end to end, on a local workerd  (brief §36: "Cloudflare設定確認")
//  ============================================================
//  Starts `wrangler dev` — the same runtime Cloudflare runs, locally — and
//  talks to it as browsers would: fetches the page, opens WebSockets into
//  rooms, and checks what gets through.
//
//    npm run test:server        (or: node server/test/room.test.js)

import { spawn } from 'node:child_process';
import CITY from '../../shared/city.js';
import RULES from '../../shared/rules.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 8700 + Math.floor(Math.random() * 200);
const BASE = 'http://127.0.0.1:' + PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = []; let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else fail++; results.push((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '\n         ' + detail : '')); }

//  a player: a WebSocket and everything it has been sent
function join(room, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE.replace('http', 'ws') + '/ws?room=' + encodeURIComponent(room) + '&name=' + encodeURIComponent(name), { headers: { Origin: BASE } });
    const P = { ws, got: [], id: null };
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.s === '_welcome') { P.id = m.p.id; P.welcome = m.p; resolve(P); } else P.got.push(m); };
    ws.onerror = (e) => reject(new Error('socket error'));
    P.send = (s, p) => ws.send(JSON.stringify({ s, p }));
    P.of = (s) => P.got.filter((m) => m.s === s);
  });
}

async function main() {
  const dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--log-level', 'warn'], { cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false' } });
  let log = ''; dev.stdout.on('data', (d) => { log += d; }); dev.stderr.on('data', (d) => { log += d; });
  try {
    let up = false;
    for (let i = 0; i < 120 && !up; i++) { await sleep(500); try { up = (await fetch(BASE + '/')).ok; } catch (e) {} }
    if (!up) throw new Error('wrangler dev did not start:\n' + log.slice(-2000));

    // ---- the page, and nothing else --------------------------------------
    const page = await fetch(BASE + '/');
    const html = await page.text();
    check('the game is served at /', page.ok && html.includes('CONTOUR'), page.status + ' ' + html.length + ' bytes');
    const notPublic = [];
    for (const f of ['/lab/README.md', '/server/room.js', '/wrangler.jsonc', '/package.json', '/SERVER_MIGRATION_ANALYSIS.md', '/README.md']) {
      const r = await fetch(BASE + f); if (r.status !== 404) notPublic.push(f + ' ' + r.status); await r.text();
    }
    check('nothing but the game is public', notPublic.length === 0, notPublic.join(', '));

    // ---- rooms -------------------------------------------------------------
    const A = await join('alpha', 'Aki'), B = await join('alpha', 'Ben'), C = await join('beta', 'Cho');
    check('the room names its players, in join order', A.id < B.id && /^p[0-9a-z]{6}$/.test(A.id), A.id + ' then ' + B.id);
    check('and says who is here and who runs the creatures', B.welcome.host === A.id && B.welcome.players.includes(A.id), JSON.stringify(B.welcome));
    A.send('state', { id: 'pzzzzzz', x: 1, y: 0, z: 2, r: 0 });
    await sleep(300);
    const st = B.of('state')[0];
    check('a state reaches the room, stamped with its real sender', st && st.f === A.id && st.p.id === A.id, JSON.stringify(st));
    check('and not another room', C.got.length === 0, JSON.stringify(C.got));

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
    const place = async (P, at) => { P.send('state', { x: at.x, y: at.y, z: at.z, r: 0, w: 0 }); await sleep(150); };
    await place(A, PA); await place(B, PB);
    B.send('hit', { by: 'pzzzzzz', t: A.id, d: 99999 });
    await sleep(300);
    const h = A.of('hurt')[0];
    check('a hit the room believes does the gun\'s damage, not what it claims', h && h.p.d === 20 && h.p.by === B.id && h.p.hp === 80, JSON.stringify(h));
    check('and is not passed on as a claim', A.of('hit').length === 0);
    await sleep(250); B.send('hit', { t: A.id }); await sleep(10); B.send('hit', { t: A.id });   // the second too soon after the first
    await sleep(300);
    check('two hits closer together than the gun can fire count once', A.of('hurt').length === 2, A.of('hurt').map((m) => m.p.hp).join(','));
    await place(A, hidden[0]); await place(B, hidden[1]); await sleep(250);
    B.send('hit', { t: A.id });
    await place(A, { x: 0, y: 0, z: -300 }); await place(B, PB); await sleep(250);
    B.send('hit', { t: A.id });
    await sleep(300);
    check('a hit through a building, or from out of range, does nothing', A.of('hurt').length === 2);
    await place(A, PA); await place(B, PB);
    for (let i = 0; i < 4; i++) { await sleep(250); B.send('hit', { t: A.id }); }
    await sleep(400);
    const kill = A.of('kill')[0];
    check('the fifth hit kills, and the room says whose kill it is', A.of('hurt').pop().p.hp === 0 && kill && kill.p.by === B.id && kill.p.v === A.id && B.of('kill').length === 1,
      JSON.stringify(kill));
    B.send('state', { x: PB.x, y: 0, z: PB.z, r: 0, w: 0 }); A.send('state', { x: PA.x, y: 0, z: PA.z, r: 0, w: 0, hp: 100 });
    await sleep(300);
    const sA = B.of('state').filter((m) => m.f === A.id).pop();
    check('and tells everyone the dead player is dead, whatever it says of itself', sA && sA.p.d === 1 && sA.p.hp === 0 && sA.p.kb === B.id, JSON.stringify(sA && sA.p));
    const hurtsAtDeath = A.of('hurt').length;
    await sleep(250); B.send('hit', { t: A.id }); await sleep(300);
    check('a dead player cannot be hit again', A.of('hurt').length === hurtsAtDeath && A.of('hurt').filter((m) => m.p.hp === 0).length === 1, hurtsAtDeath + ' hits landed in all');
    A.send('spawn', {}); await sleep(250);
    A.send('hurt', { d: 30 }); await sleep(250);
    const hps = A.of('hp').map((m) => m.p.hp);
    check('getting up, and a car or a creature reported against yourself, count on your own health', hps.join(',') === '100,70', hps.join(','));
    A.send('kill', { by: B.id, v: A.id, ds: 99 }); await sleep(200);
    check('a player cannot declare a kill', B.of('kill').length === 1);

    // ---- what a message may say ------------------------------------------
    B.send('mob', { m: [1, 2, 3] }); A.send('mob', { m: [4, 5, 6] });
    await sleep(300);
    check('only the host\'s creature snapshots are passed on', A.of('mob').length === 0 && B.of('mob').length === 1 && B.of('mob')[0].p.m[0] === 4);
    const before = A.got.length;
    B.send('ping', { id: B.id, t: 123 });
    B.send('nonsense', { a: 1 });
    B.ws.send('not json');
    B.send('state', { x: 'far', y: 0, z: 0 });
    await sleep(300);
    check('a ping comes back to its sender only', B.of('ping').length === 1 && A.of('ping').length === 0);
    check('unknown kinds, broken JSON and bad positions go nowhere', A.got.length === before, A.got.slice(before).map((m) => m.s).join(','));
    for (let i = 0; i < 60; i++) B.send('shot', {});
    await sleep(400);
    check('a flood is cut to each kind\'s rate', A.of('shot').length <= 20, A.of('shot').length + ' of 60 shots passed');

    // ---- leaving -------------------------------------------------------------
    B.ws.close();
    await sleep(500);
    check('when someone leaves, the room says so', A.of('leave').some((m) => m.p.id === B.id));
    const D = await join('alpha', 'Dai');
    check('a newcomer gets the next id, never a lower one', D.id > B.id && D.welcome.host === A.id, D.id);
    A.ws.close(); C.ws.close(); D.ws.close();
  } finally {
    dev.kill('SIGTERM');
  }
  console.log('\nGAMEROOM — on a local workerd\n');
  console.log(results.join('\n'));
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
