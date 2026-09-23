'use strict';
//  ============================================================
//  THE GAME ON ITS ROOM SERVER  (B2)
//  ============================================================
//  The real game, two players, served by `wrangler dev` — the Worker and
//  the GameRoom Durable Object running on a local workerd, the runtime
//  Cloudflare uses — instead of the public MQTT broker. Checked:
//
//    - the page finds the server on its own origin and uses it (not the broker)
//    - the room names the players; the first one in runs the creatures
//    - they see each other, the creatures reach the second player, chat works
//    - a forged hit claiming 99999 damage does the gun's 20
//    - a dropped connection comes back by itself, under a new name, and the
//      other player sees the old one leave
//    - when the host leaves, the other player takes over the creatures
//
//    node lab/test/server.game.test.js     (about two minutes)

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { openRoom, build, sleep, ROOT, CACHE } = require('./harness/page.js');

const results = [];
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  results.push((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '\n         ' + detail : ''));
}
const ev = (P, src) => P.eval((s) => window.__t.ev(s), src);
async function until(P, src, secs) {
  for (let i = 0; i < secs * 4; i++) { if (await ev(P, src)) return true; await sleep(250); }
  return false;
}

(async () => {
  //  the harness's copy of the game (local three.js, test hooks) as the site
  build();
  const SITE = path.join(CACHE, 'site');
  fs.mkdirSync(SITE, { recursive: true });
  fs.copyFileSync(path.join(CACHE, 'game.html'), path.join(SITE, 'index.html'));
  fs.copyFileSync(path.join(CACHE, 'three.min.js'), path.join(SITE, 'three.min.js'));
  const PORT = 8900 + Math.floor(Math.random() * 90), URL = 'http://127.0.0.1:' + PORT + '/';
  const dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--assets', SITE, '--log-level', 'warn'],
    { cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false' } });
  let log = ''; dev.stdout.on('data', (d) => { log += d; }); dev.stderr.on('data', (d) => { log += d; });
  const room = await openRoom();
  try {
    let up = false;
    for (let i = 0; i < 120 && !up; i++) { await sleep(500); try { up = (await fetch(URL)).ok; } catch (e) {} }
    if (!up) throw new Error('wrangler dev did not start\n' + log.slice(-1500));

    const A = await room.player({ room: 'srv', nick: 'Aki', url: URL });
    await A.join();
    await until(A, 'MP.connected', 15);
    const B = await room.player({ room: 'srv', nick: 'Ben', url: URL });
    await B.join();
    const both = (await until(A, 'MP.connected && MP.client.server', 15)) && (await until(B, 'MP.connected && MP.client.server', 15));
    check('both find the room server on their own origin and use it, not the broker', both, log.slice(-300));
    const ids = JSON.parse(await ev(A, 'JSON.stringify({ a: MP.id })'));
    const idB = await ev(B, 'MP.id');
    check('the room names them, in the order they came', /^p[0-9a-z]{6}$/.test(ids.a) && ids.a < idB, ids.a + ' then ' + idB);

    const seen = (await until(A, 'MP.peers.has(' + JSON.stringify(idB) + ')', 10)) && (await until(B, 'MP.peers.has(' + JSON.stringify(ids.a) + ')', 10));
    check('they see each other', seen);
    check('the first one in runs the creatures, and the other is sent them',
      (await until(A, 'MP.host === MP.id && mobPub()', 10)) && (await until(B, 'MP.host !== MP.id && performance.now() - MP.mobT < 2000', 10)));

    await ev(A, "document.getElementById('chat-input').value = 'やあ'; sendChat(); 1");
    const chat = (await until(A, "document.getElementById('chat-log').textContent.includes('やあ')", 5)) && (await until(B, "document.getElementById('chat-log').textContent.includes('やあ')", 5));
    check('chat reaches everyone, the sender included', chat);

    // ---- a forged hit ----------------------------------------------------
    await ev(A, 'hp = HP_MAX; updateHpUI(); 1');
    await ev(B, 'MP.client.publish(mtopic("hit"), JSON.stringify({ by: "p000000", t: ' + JSON.stringify(ids.a) + ', d: 99999 })); 1');
    await sleep(1000);
    const hpA = await ev(A, 'hp');
    check('a hit claiming 99999 damage does the gun\'s 20', hpA === 80, 'hp ' + hpA);

    // ---- the connection drops, and comes back --------------------------------
    await ev(B, 'SRV.ws.close(); 1');
    const reconnecting = await until(B, '!MP.connected', 3);
    const back = await until(B, 'MP.connected', 15);
    const idB2 = await ev(B, 'MP.id');
    check('a dropped connection comes back by itself', reconnecting && back, 'new id ' + idB2);
    const oldGone = await until(A, '!MP.peers.has(' + JSON.stringify(idB) + ') && MP.peers.has(' + JSON.stringify(idB2) + ')', 10);
    check('and the other player sees the old one leave and the new one arrive', oldGone);

    // ---- the host leaves ---------------------------------------------------
    await A.close();
    const took = await until(B, 'MP.host === MP.id && mobPub()', 12);
    check('when the host leaves, the other player takes over the creatures', took);

    const errs = A.errors.concat(B.errors);
    check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await B.close();
  } finally {
    await room.close();
    dev.kill('SIGTERM');
  }
  console.log('\nTHE GAME ON ITS ROOM SERVER\n');
  console.log(results.join('\n'));
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
