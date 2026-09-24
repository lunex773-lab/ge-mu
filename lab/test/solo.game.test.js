'use strict';
//  ============================================================
//  NO ROOM SERVER — the game plays alone, and keeps knocking
//  ============================================================
//  Without the public MQTT broker there is nowhere else to go: when the
//  room server does not answer (a copy with no server, or a day's free
//  requests used up), the game must go on alone — pickups its own, as they
//  were before rooms — and join the room by itself once the server is back.
//
//    node lab/test/solo.game.test.js     (about half a minute)

const { openRoom, sleep } = require('./harness/page.js');

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
  const room = await openRoom();
  try {
    const A = await room.player({ room: 'solo', nick: 'Aki' });
    A.serverDown(true);
    await A.join();
    await sleep(3000);
    const net = await ev(A, "document.getElementById('net-status').textContent");
    check('the server does not answer: the game says SOLO and plays on', /SOLO/.test(net) && !(await ev(A, 'MP.connected')), net);
    await ev(A, 'applyDamage(50, null); 1');
    const hp0 = await ev(A, 'hp');
    const b0 = JSON.parse(await ev(A, 'JSON.stringify({ x: bananas[0].x, z: bananas[0].z })'));
    await ev(A, 'p.set(' + b0.x + ', EYE, ' + b0.z + '); 1');
    const ate = await until(A, '!bananas[0].active && hp === ' + Math.min(100, hp0 + 40), 5);
    check('alone, a banana is simply eaten', ate, 'hp ' + hp0 + ' → ' + (await ev(A, 'hp')));
    A.serverDown(false);
    const back = await until(A, 'MP.connected', 40);
    const net2 = await ev(A, "document.getElementById('net-status').textContent");
    check('the server answers again: the game joins the room by itself', back && /ONLINE/.test(net2), net2 + ' after ' + (await ev(A, 'SRV.tries')) + ' tries');
    check('no page errors', A.errors.length === 0, A.errors.slice(0, 3).join(' | '));
    await A.close();
  } finally {
    await room.close();
  }
  console.log('\nNO ROOM SERVER\n');
  console.log(results.join('\n'));
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
