'use strict';
//  ============================================================
//  GATE SYNC — every player in a room sees the same tear
//  ============================================================
//  Not a Neural Core test, but Beelzebub stands in front of the tear
//  (BEELZEBUB.md B1), so the tear being in one place for everyone is a
//  precondition of Phase 7. Separate browser contexts are separate phones:
//  their own localStorage, their own id, messages relayed between them.
//
//    S1 a late joiner adopts the room's tear
//    S2 a tear restored from last visit yields to the room's
//    S3 a tear saved in another room is not brought in
//    S4 a newcomer who missed the room's tear converges on it
//    S5 two opened at once converge on the lower owner id (the first one in)
//    S6 the title-screen save heartbeat keeps the saved tear
//    S7 the storm room starts everyone through the same tear
//
//  Run: node lab/test/gatesync.game.test.js   (about three minutes)

const { openRoom, sleep } = require('./harness/page.js');

function withGate(P) {
  P.gate = () => P.page.evaluate(() => {
    const r = window.__t.rift;
    return { present: r.present, x: +r.x.toFixed(1), z: +r.z.toFixed(1), seed: r.seed, owner: r.owner,
             restored: r.restored, settle: +window.__t.gateSettle.toFixed(2), id: window.__t.MP.id };
  });
  return P;
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
}
const same = (a, b) => a.present && b.present && a.seed === b.seed && a.x === b.x && a.z === b.z;
const fmt = (g) => g.present ? `(${g.x},${g.z}) seed=${g.seed} owner=${g.owner}${g.restored ? ' RESTORED' : ''}` : 'no gate';

async function openFor(P) {
  // the ordinary way: the tenth kill
  await P.eval(() => { window.__t.myKills = 9; window.__t.creditMyKill(); });
}

(async () => {
  const room = await openRoom();
  const player = (o) => room.player(o).then(withGate);

  // ---- S1: late joiner sees the room's tear -------------------------------
  console.log('\nS1 late joiner');
  {
    const A = await player({ room: 'r1', nick: 'A' });
    await A.join(); await sleep(3500);
    await openFor(A); await sleep(500);
    const a = await A.gate();
    check('S1 opener has a tear', a.present, fmt(a));
    const B = await player({ room: 'r1', nick: 'B' });
    await B.join(); await sleep(4000);
    const b = await B.gate();
    check('S1 joiner has the same tear', same(a, b), 'A ' + fmt(a) + ' | B ' + fmt(b));
    await A.close(); await B.close();
  }

  // ---- S2: a stale tear from last visit to the same room ------------------
  console.log('\nS2 stale restore, same room');
  {
    const A = await player({ room: 'r2', nick: 'A' });
    await A.join(); await sleep(3500);
    await openFor(A); await sleep(500);
    const a = await A.gate();
    const save = { k: 12, u: true, w: 0, t: Date.now(), r: 'r2',
                   g: [a.x + 120, 0, a.z - 80, 0, 424242, 'p0000001', Date.now() - 120000] };
    const B = await player({ room: 'r2', nick: 'B', save });
    await B.join(); await sleep(300);
    const b0 = await B.gate();
    check('S2 restored tear goes up while listening', b0.present && b0.restored, fmt(b0));
    await sleep(4000);
    const b = await B.gate(), a2 = await A.gate();
    check('S2 joiner yields to the room tear', same(a2, b), 'A ' + fmt(a2) + ' | B ' + fmt(b));
    check('S2 room tear did not move', a2.seed === a.seed && a2.x === a.x, fmt(a2));
    await A.close(); await B.close();
  }

  // ---- S3: a tear saved in another room ------------------------------------
  console.log('\nS3 saved in a different room');
  {
    const A = await player({ room: 'r3', nick: 'A' });
    await A.join(); await sleep(1000);
    const save = { k: 3, u: false, w: 0, t: Date.now(), r: 'elsewhere',
                   g: [50, 0, 60, 0, 777, 'p0000001', Date.now() - 30000] };
    const B = await player({ room: 'r3', nick: 'B', save });
    await B.join(); await sleep(4000);
    const b = await B.gate(), a = await A.gate();
    check('S3 other-room tear is not brought in', !b.present && !a.present, 'A ' + fmt(a) + ' | B ' + fmt(b));
    await B.close();
    const save2 = { k: 11, u: true, w: 0, t: Date.now(), r: 'elsewhere', g: [50, 0, 60, 0, 777, 'p0000001', Date.now() - 30000] };
    const C = await player({ room: 'r3', nick: 'C', save: save2 });
    await C.join(); await sleep(8500);
    const c = await C.gate(), a3 = await A.gate();
    check('S3 unlocked player opens a fresh tear here, room follows',
      same(a3, c) && c.seed !== 777, 'A ' + fmt(a3) + ' | C ' + fmt(c));
    await A.close(); await C.close();
  }

  // ---- S4: newcomer with a lower id who missed the room's tear -------------
  //  (the room names players in join order, so the newcomer's id is the
  //  higher one; before the room server it could be lower, and was tested so)
  console.log('\nS4 newcomer, packets lost while listening');
  {
    const A = await player({ room: 'r4', nick: 'A' });
    await A.join(); await sleep(3500);
    await openFor(A); await sleep(300);
    await A.eval(() => { window.__t.rift.born = Date.now() - 90000; });   // it has stood a while
    const a = await A.gate();
    const D = await player({ room: 'r4', nick: 'D', save: { k: 15, u: true, w: 0, t: Date.now(), r: 'r4', g: null } });
    D.setDrop(true);
    await D.join(); await sleep(7000);
    const d0 = await D.gate();
    check('S4 deaf newcomer opened its own (the setup)', d0.present && d0.seed !== a.seed, fmt(d0));
    D.setDrop(false);
    await sleep(16000);
    const d = await D.gate(), a2 = await A.gate();
    check('S4 established tear keeps its place', a2.seed === a.seed && a2.x === a.x, 'A ' + fmt(a2));
    check('S4 newcomer converges on it', same(a2, d), 'A ' + fmt(a2) + ' | D ' + fmt(d));
    await A.close(); await D.close();
  }

  // ---- S5: two open at the same moment ------------------------------------
  console.log('\nS5 simultaneous opening');
  {
    const A = await player({ room: 'r5', nick: 'A' });
    const B = await player({ room: 'r5', nick: 'B' });
    await A.join(); await sleep(1500); await B.join(); await sleep(3500);   // A first: the lower id
    const low = await A.eval(() => window.__t.MP.id);
    A.setDrop(true); B.setDrop(true);
    await openFor(A); await openFor(B); await sleep(500);
    const a0 = await A.gate(), b0 = await B.gate();
    check('S5 two different tears (the setup)', a0.present && b0.present && a0.seed !== b0.seed, fmt(a0) + ' | ' + fmt(b0));
    A.setDrop(false); B.setDrop(false);
    await sleep(16000);
    const a = await A.gate(), b = await B.gate();
    check('S5 converge on the lower owner id', same(a, b) && a.owner === low, 'A ' + fmt(a) + ' | B ' + fmt(b) + ' | lower ' + low);
    await A.close(); await B.close();
  }

  // ---- S6: title-screen heartbeat keeps the saved tear --------------------
  console.log('\nS6 title-screen save, solo restore');
  {
    const save = { k: 12, u: true, w: 0, t: Date.now(), r: 'r6', g: [30, 0, 40, 1.2, 99, 'pqqqqqq', Date.now() - 50000] };
    const A = await player({ room: 'r6', nick: 'A', save });
    await A.eval(() => window.__t.saveGate());
    const st = JSON.parse(await A.eval(() => localStorage.getItem('contour.rift')));
    check('S6 heartbeat before joining keeps the tear', st.g && st.g[4] === 99 && st.r === 'r6', JSON.stringify(st.g) + ' r=' + st.r);
    await A.join(); await sleep(4500);
    const a = await A.gate();
    check('S6 alone: the saved tear stands and is confirmed', a.present && a.seed === 99 && !a.restored && a.x === 30, fmt(a));
    const B = await player({ room: 'r6', nick: 'B' });
    await B.join(); await sleep(4000);
    const b = await B.gate();
    check('S6 and others get it', same(a, b), fmt(b));
    await A.close(); await B.close();
  }

  // ---- S7: storm start in a room that already has a tear -------------------
  console.log('\nS7 storm room');
  {
    const A = await player({ room: 'ストシン', nick: 'A' });
    await A.join(); await sleep(5000);
    const a = await A.gate();
    const aw = await A.eval(() => ({ w: window.__t.wState, B: window.__t.WS.BACK, x: window.__t.p.x, z: window.__t.p.z }));
    check('S7 first player starts through the tear', a.present && aw.w === aw.B && Math.hypot(aw.x - a.x, aw.z - a.z) < 12,
      fmt(a) + ` at (${aw.x.toFixed(1)},${aw.z.toFixed(1)})`);
    const B = await player({ room: 'ストシン', nick: 'B' });
    await B.join(); await sleep(5000);
    const b = await B.gate();
    const bw = await B.eval(() => ({ w: window.__t.wState, B: window.__t.WS.BACK, x: window.__t.p.x, z: window.__t.p.z }));
    check('S7 second player uses the same tear', same(a, b) && bw.w === bw.B && Math.hypot(bw.x - b.x, bw.z - b.z) < 12,
      fmt(b) + ` at (${bw.x.toFixed(1)},${bw.z.toFixed(1)})`);
    await A.close(); await B.close();
  }

  // ---- rage ----------------------------------------------------------------
  {
    const A = await player({ room: 'r8', nick: 'A' });
    const r = await A.eval(() => ({ t: window.__t.RAGE_TIME, html: document.getElementById('rage-t').textContent }));
    check('rage lasts 60 s', r.t === 60 && r.html === '60', JSON.stringify(r));
    await A.close();
  }

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n${pass}/${results.length} passed`);
  await room.close();
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
