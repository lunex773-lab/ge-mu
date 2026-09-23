//  ============================================================
//  GameRoom, end to end, on a local workerd  (brief §36: "Cloudflare設定確認")
//  ============================================================
//  Starts `wrangler dev` — the same runtime Cloudflare runs, locally — and
//  talks to it as browsers would: fetches the page, opens WebSockets into
//  rooms, and checks what gets through.
//
//    npm run test:server        (or: node server/test/room.test.js)

import { spawn } from 'node:child_process';
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
    const hidden = [];
    for (const f of ['/lab/README.md', '/server/room.js', '/wrangler.jsonc', '/package.json', '/SERVER_MIGRATION_ANALYSIS.md', '/README.md']) {
      const r = await fetch(BASE + f); if (r.status !== 404) hidden.push(f + ' ' + r.status); await r.text();
    }
    check('nothing but the game is public', hidden.length === 0, hidden.join(', '));

    // ---- rooms -------------------------------------------------------------
    const A = await join('alpha', 'Aki'), B = await join('alpha', 'Ben'), C = await join('beta', 'Cho');
    check('the room names its players, in join order', A.id < B.id && /^p[0-9a-z]{6}$/.test(A.id), A.id + ' then ' + B.id);
    check('and says who is here and who runs the creatures', B.welcome.host === A.id && B.welcome.players.includes(A.id), JSON.stringify(B.welcome));
    A.send('state', { id: 'pzzzzzz', x: 1, y: 0, z: 2, r: 0 });
    await sleep(300);
    const st = B.of('state')[0];
    check('a state reaches the room, stamped with its real sender', st && st.f === A.id && st.p.id === A.id, JSON.stringify(st));
    check('and not another room', C.got.length === 0, JSON.stringify(C.got));

    // ---- what a message may say ------------------------------------------
    B.send('hit', { by: 'pzzzzzz', t: A.id, d: 99999 });
    await sleep(300);
    const h = A.of('hit')[0];
    check('a hit does the gun\'s damage, not what it claims', h && h.p.d === 20 && h.p.by === B.id, JSON.stringify(h));
    B.send('mob', { m: [1, 2, 3] }); A.send('mob', { m: [4, 5, 6] });
    await sleep(300);
    check('only the host\'s creature snapshots are passed on', A.of('mob').length === 0 && B.of('mob').length === 1 && B.of('mob')[0].p.m[0] === 4);
    B.send('ping', { id: B.id, t: 123 });
    B.send('nonsense', { a: 1 });
    B.ws.send('not json');
    B.send('state', { x: 'far', y: 0, z: 0 });
    await sleep(300);
    check('a ping comes back to its sender only', B.of('ping').length === 1 && A.of('ping').length === 0);
    check('unknown kinds, broken JSON and bad positions go nowhere', A.got.every((m) => ['state', 'hit', 'leave'].includes(m.s)) && A.of('state').length === 0,
      A.got.map((m) => m.s).join(','));
    for (let i = 0; i < 40; i++) B.send('hit', { t: A.id });
    await sleep(400);
    check('a flood of hits is cut to the gun\'s rate', A.of('hit').length <= 10, A.of('hit').length + ' of 41 hits passed');

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
