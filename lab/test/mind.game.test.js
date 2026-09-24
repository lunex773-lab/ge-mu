'use strict';
//  ============================================================
//  WHAT BEELZEBUB LEARNS — the real game, with his memory on the server
//  ============================================================
//  The real game against the room's real code, with his memory
//  (server/mindstore.js) as the BossMind object runs it, in this process.
//  Checked:
//
//    - arriving, a phone is told his readout and handed a candidate
//    - alone, the phone runs him with that candidate, and tallies the fight
//    - when the room takes him over, the phone reports how its fight went,
//      and what he learned of this player is kept on the server, by name
//    - the room runs its own fight with a candidate of its own, knowing
//      what the server knows of the players
//    - given back, the phone carries on with what the room learned of it
//    - a readout the server has learned reaches a phone that arrives later,
//      which fights with it — and keeps it for when there is no server
//
//    node lab/test/mind.game.test.js     (about two minutes)

const { openRoom, sleep } = require('./harness/page.js');

const results = [];
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  const line = (ok ? '  ok   ' : '  FAIL ') + name + (detail ? '\n         ' + detail : '');
  results.push(line); console.log(line);
}
const ev = (P, src) => P.eval((s) => window.__t.ev(s), src);
async function until(P, src, secs) {
  for (let i = 0; i < secs * 10; i++) { if (await ev(P, src)) return true; await sleep(100); }
  return false;
}
//  stand a player d metres from him, facing him, in the open, and well
const near = (P, d) => ev(P, `(() => { carHitCd = 1e9; hp = HP_MAX; dead = false; const a = Math.atan2(p.x - bzb.x, p.z - bzb.z) || 0;
  for (let k = 0; k < 32; k++) { const aa = a + k * 0.196, x = bzb.x + Math.sin(aa) * ${d}, z = bzb.z + Math.cos(aa) * ${d};
    if (!clearAt(x, z, 0.8)) continue;
    p.set(x, EYE, z); vy = 0; yaw = Math.atan2(-(bzb.x - x), -(bzb.z - z)); publishState(true); return 1; }
  return 0; })()`);

(async () => {
  const room = await openRoom({ creatures: true });
  const store = room.mind;
  const stats = async () => (await store.ask([{ k: 'stats' }]))[0];
  try {
    const A = await room.player({ room: 'mindroom', nick: 'Aki' });
    await A.join();
    const told = await until(A, 'MP.mindCand && bzbServerRo()', 10);
    const cand = JSON.parse(await ev(A, 'JSON.stringify({ id: MP.mindCand && MP.mindCand.id, gen: (bzbServerRo() || {}).gen })'));
    check('arriving, the phone is told his readout and handed a candidate', told && Number.isInteger(cand.id) && cand.gen === 0, JSON.stringify(cand));

    // ---- alone: the phone runs him, with the candidate ------------------------------
    await sleep(1500);
    await A.eval(() => { window.__t.myKills = 9; window.__t.creditMyKill(); });
    const up = await until(A, 'bzb.live && bzbAI && bzbAI.body', 30);
    const run = JSON.parse(await ev(A, `JSON.stringify({ id: bzbFight && bzbFight.id, w0: +bzbAI.core.mSign[0].toFixed(5), tally: !!bzbAI.tally })`));
    const c = store.es.pairs.flatMap((p) => [p.seed * 2, p.seed * 2 + 1]).includes(cand.id);
    check('alone, the phone runs him with that candidate, and tallies the fight', up && run.id === cand.id && run.tally && c, JSON.stringify(run));
    //  a fight: stand close and keep on your feet, until he has fought long enough to say something
    let secs = 0;
    for (let i = 0; i < 180 && secs < 24; i++) { await near(A, 6); await sleep(500); secs = await ev(A, 'bzbAI.tally ? bzbAI.tally.secs : 0'); }
    const t1 = JSON.parse(await ev(A, 'JSON.stringify(Object.assign({}, bzbAI.tally, { score: BR.fightScore(bzbAI) }))'));
    check('the fight is tallied as it goes', t1.secs >= 20 && t1.score && Number.isFinite(t1.score.s), JSON.stringify(t1));

    // ---- a second player: the room takes him; the phone reports -------------------------
    const f0 = (await stats()).fights;
    const B = await room.player({ room: 'mindroom', nick: 'Ben' });
    await B.join();
    const taken = await until(A, 'MP.srvOwns.b && !(bzbAI && bzbAI.body)', 10);
    await sleep(800);
    const s1 = await stats();
    const [aki] = await store.ask([{ k: 'hello', id: 'x', name: 'Aki' }]);
    check('the room takes him: the phone reports how its fight went', taken && s1.fights === f0 + 1 && !(await ev(A, 'bzbFight')), 'fights ' + f0 + ' → ' + s1.fights);
    check('and what he learned of this player is kept on the server, by name', aki.me && aki.me.m && Date.now() - aki.me.t < 5000, aki.me ? 'saved ' + (Date.now() - aki.me.t) + ' ms ago' : 'nothing kept');
    const nextCand = await until(A, 'MP.mindCand && MP.mindCand.id !== ' + cand.id, 5);
    check('and is handed a new candidate for its next fight', nextCand);

    // ---- the room's own fight -------------------------------------------------------------
    const R = room.rooms.get('mindroom').relay, boss = R.creatures.boss;
    await until(A, 'bzb.live', 5);
    await sleep(500);
    check('the room runs its fight with a candidate of its own, knowing what the server knows of the players',
      boss.st && boss.fightId !== null && boss.ai.tally && boss.ai.bank.models.has('Aki'),
      'fight ' + boss.fightId + '; knows ' + [...boss.ai.bank.models.keys()].join(', '));

    // ---- given back ---------------------------------------------------------------------
    await ev(A, `(() => { const f = onRoomMind; window.__me = null; onRoomMind = function (m) { if (m.me) window.__me = m.me.t; return f(m); }; return 1; })()`);
    await B.close();
    const back = await until(A, '!MP.srvOwns.b && bzbAI && bzbAI.body', 10);
    const me = await until(A, 'window.__me', 5);
    const fightingAgain = await until(A, 'bzbFight !== null && !!bzbAI.tally', 5);
    check('given back: the phone carries on, with what the room learned of it, in a fight of its own', back && me && fightingAgain,
      'told of me: ' + (await ev(A, 'window.__me')) + '; fight ' + (await ev(A, 'bzbFight && bzbFight.id')));

    // ---- a readout learned: a phone arriving later fights with it ------------------------
    //  (as if a step had been taken: what the fights say is the store's business, tested in node)
    store.es.theta = store.es.theta.map((x, d) => (d === 0 ? x + 0.04 : x)); store.es.gen = 7;
    const C = await room.player({ room: 'otherroom', nick: 'Cho' });
    await C.join();
    const heard = await until(C, '(bzbServerRo() || {}).gen === 7', 10);
    const w0 = +(store.es.theta[0]).toFixed(5);
    const uses = await ev(C, `(() => { if (!bzbAI) bzbAI = bzbMakeAI(); bzbUseReadout(); return +bzbAI.core.mSign[0].toFixed(5); })()`);
    check('a readout the server has learned reaches a phone arriving later, which fights with it', heard && Math.abs(uses - w0) < 1e-4, 'server ' + w0 + ', phone ' + uses);
    const kept = await ev(C, `JSON.parse(localStorage.getItem(BZ_RO)).gen`);
    check('and keeps it, for when there is no server', kept === 7);

    const errs = A.errors.concat(C.errors);
    check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  } finally {
    await room.close();
  }
  console.log('\nWHAT BEELZEBUB LEARNS, IN THE GAME: ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
