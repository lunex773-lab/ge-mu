'use strict';
//  ============================================================
//  THE LINE BETWEEN THE PHONES AND THE ROOM — the real game
//  ============================================================
//  Two real games and the room (the harness plays it with the room's real
//  code), each player's link slowed and made uneven as a phone's is
//  (setLag). Checked:
//
//    - the room's words about the other side carry its clock, and each game
//      draws a creature where the room has it now — not where it was when
//      the word left (it was 150–300 ms behind: lab/tools/sync_probe.js)
//    - another player's steps are placed on the clock they were taken by,
//      not on when they happened to land: a bunched-up run is spread back out
//    - fewer words: with the room running every creature, the host's game
//      says where the tear is once a second (it was eight), the room's word
//      about the day side's troop goes when it has something to say (it was
//      ten a second), and health and score ride only when they change
//    - a line that has gone dead without closing (a tunnel) is noticed, and
//      the game gets back in by itself; back in view, it checks at once
//
//    node lab/test/net.game.test.js     (about two minutes)

const { openRoom, sleep } = require('./harness/page.js');
const GOR = require('../../shared/gorgons.js');

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
const STAND = (x, z) => `(() => { carHitCd = 1e9; for (let r = 0; r < 60; r += 2) for (let k = 0; k < 12; k++) { const sx = ${x} + Math.sin(k * 0.52) * r, sz = ${z} + Math.cos(k * 0.52) * r;
  if (clearAt(sx, sz, 3)) { p.set(sx, EYE, sz); vy = 0; publishState(true); return JSON.stringify([sx, sz]); } } return null; })()`;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) * (x - m)))); };

(async () => {
  const room = await openRoom({ creatures: true });
  try {
    const A = await room.player({ room: 'net', nick: 'Aki' });
    const B = await room.player({ room: 'net', nick: 'Ben' });
    await A.join(); await sleep(2000);
    await ev(A, 'window.__t.noRender(); MFS.holdSpawn = true; MFS.spawnCd = 1e9; VS.holdSpawn = true; 1');
    await ev(A, 'setWorld(WS.BACK); 1');
    const at = JSON.parse(await ev(A, STAND(11, 10)));
    await until(A, 'dogs.filter((d) => d.live).length >= 30', 40);
    await B.join();
    await until(A, 'MP.srvOwns.d', 15); await until(B, 'MP.srvOwns.d', 15);
    await ev(B, 'window.__t.noRender(); setWorld(WS.BACK); 1');
    await ev(B, STAND(at[0] + 5, at[1]));
    const R = room.rooms.get('net').relay, RD = R.creatures.dogs;
    RD.M.holdSpawn = true; RD.V.holdSpawn = true;
    for (let i = 0; i < 3; i++) GOR.spawnGorgon(RD.G, { x: at[0] + 40 + i * 8, z: at[1] + 20 });
    const ids = [...R.players.keys()];
    const immortal = () => { for (const id of ids) { const pl = R.players.get(id); if (pl) { pl.hp = 1e6; pl.dead = false; } } };
    A.setLag(40, 30); B.setLag(90, 30);
    //  they walk a circle each, every frame, and fire now and then (the district hears it)
    const WALK = (ph) => `(() => { const t0 = Date.now(), f = updatePeers; updatePeers = function (dt, now) {
      const a = ${ph} + (Date.now() - t0) / 1000 * 4 / 14, x = ${at[0]} + Math.sin(a) * 14, z = ${at[1]} + Math.cos(a) * 14;
      if (clearAt(x, z, 1)) p.set(x, EYE, z);
      if (Math.random() < 0.004) MP.client.publish(mtopic('shot'), JSON.stringify({ id: MP.id }));
      return f(dt, now); }; return 1; })()`;
    await Promise.all([ev(A, WALK(0)), ev(B, WALK(3))]);
    await sleep(3000);

    // ---- the creatures, where the room has them now -----------------------------------------
    {
      const SEEN = `JSON.stringify([].concat(dogs.filter((d) => d.live && !d.dead).map((d) => ['d' + d.slot, d.x, d.z]), gorgons.filter((g) => g.live && !g.dead).map((g) => ['g' + g.slot, g.x, g.z])))`;
      const hist = [], seen = { A: [], B: [] };
      const roomNow = () => { const m = new Map(); for (const d of RD.dogs) if (d.live && !d.dead) m.set('d' + d.slot, [d.x, d.z]); for (const g of RD.gorgons) if (g.live && !g.dead) m.set('g' + g.slot, [g.x, g.z]); return m; };
      const t0 = Date.now();
      while (Date.now() - t0 < 12000) {
        immortal();
        const tR = Date.now(); hist.push([tR, roomNow()]);
        const [sa, sb] = await Promise.all([ev(A, SEEN), ev(B, SEEN)]);
        const tS = (tR + Date.now()) / 2;
        seen.A.push([tS, JSON.parse(sa)]); seen.B.push([tS, JSON.parse(sb)]);
        await sleep(100);
      }
      const pos = JSON.parse(await ev(A, 'JSON.stringify([p.x, p.z])'));
      const roomAt = (t) => { let lo = 0; for (let i = 0; i < hist.length; i++) if (hist[i][0] <= t) lo = i; return hist[lo][1]; };
      const err = (who, delay) => { const e = []; for (const [t, s] of seen[who]) { const Rm = roomAt(t - delay); for (const [k, x, z] of s) { const r = Rm.get(k); if (r && Math.hypot(r[0] - pos[0], r[1] - pos[1]) < 70) e.push(Math.hypot(r[0] - x, r[1] - z)); } } return e; };
      const behind = (who) => { let best = 0, bm = mean(err(who, 0)); for (let d = 50; d <= 600; d += 50) { const m = mean(err(who, d)); if (m < bm) { bm = m; best = d; } } return best; };
      const eA = err('A', 0), eB = err('B', 0), bA = behind('A'), bB = behind('B');
      const words = await ev(A, "typeof NETL !== 'undefined' && Number.isFinite(NETL.off)");
      check('the room\'s words carry its clock, and each screen draws the creatures where the room has them now, not where they were',
        words && eA.length > 50 && bA <= 50 && bB <= 50 && mean(eA) < 0.3 && mean(eB) < 0.3,
        eA.length + ' sightings; behind the room by ' + bA + ' / ' + bB + ' ms (it was 150–300); off by ' + mean(eA).toFixed(2) + ' / ' + mean(eB).toFixed(2) + ' m on average');
    }

    // ---- the other player's steps, on the clock they were taken by ---------------------------------
    {
      await ev(A, `(() => { const q = [...MP.peers.values()][0]; window.__arr = []; const f = upsertPeer; upsertPeer = function (s) { const r = f(s); if (s.id !== MP.id) window.__arr.push(performance.now()); return r; }; return 1; })()`);
      B.setLag(90, 120);                                   // (a bad patch: steps bunch up on the way)
      await sleep(5000);
      const [arr, buf] = JSON.parse(await ev(A, 'JSON.stringify([window.__arr.slice(-40), [...MP.peers.values()][0].buf.map((b) => b.t)])'));
      const gaps = (a) => a.slice(1).map((t, i) => t - a[i]);
      const ga = gaps(arr), gb = gaps(buf);
      check('another player\'s steps are placed on the clock they were taken by: a bunched-up run is spread back out',
        sd(ga) > 25 && sd(gb) < sd(ga) * 0.5, 'the gaps between steps as they landed: ±' + sd(ga).toFixed(0) + ' ms; as placed: ±' + sd(gb).toFixed(0) + ' ms (' + mean(gb).toFixed(0) + ' ms apart)');
      B.setLag(90, 30);
    }

    // ---- fewer words -------------------------------------------------------------------------
    {
      const COUNT = `(() => { window.__n = { up: {}, down: {}, hpk: 0, st: 0 }; const on = onNet; onNet = function (t, msg, bytes) { let k = t.slice(t.lastIndexOf('/') + 1); if (/^p0/.test(k)) { k = 'state'; window.__n.st++; if (msg && (msg.hp !== undefined || msg.k !== undefined)) window.__n.hpk++; }
        window.__n.down[k] = (window.__n.down[k] || 0) + 1; return on(t, msg, bytes); };
        const c = MP.client, pub = c.__netPub || c.publish, pre = mtopic(''); c.__netPub = pub; c.publish = function (t, pl) { let k = t.slice(pre.length); if (k.slice(0, 6) === 'state/') k = 'state'; window.__n.up[k] = (window.__n.up[k] || 0) + 1; return pub.apply(this, arguments); }; return 1; })()`;
      await Promise.all([ev(A, COUNT), ev(B, COUNT)]);
      await sleep(8000);
      const [nA, nB] = await Promise.all([ev(A, 'JSON.stringify(window.__n)'), ev(B, 'JSON.stringify(window.__n)')]).then((a) => a.map((s) => JSON.parse(s)));
      const owns = await ev(A, 'MP.srvOwns.b && MP.srvOwns.m && MP.srvOwns.t && MP.srvOwns.d');
      const mob = (nA.up.mob || 0) / 8, sv = (nB.down.sv || 0) / 8, hpk = nB.hpk / Math.max(1, nB.st);
      check('fewer words: the host says where the tear is once a second, the troop\'s word goes when it has something to say, health and score only when they change',
        owns && mob <= 1.3 && sv <= 1.6 && hpk < 0.2,
        'the host\'s tear ' + mob.toFixed(1) + '/s (it was 8), the room\'s troop word ' + sv.toFixed(1) + '/s (it was 10), health and score in ' + (hpk * 100).toFixed(0) + '% of the other\'s steps (it was all)');
    }

    // ---- a line gone dead without closing ------------------------------------------------------------
    {
      A.setLag(0, 0); B.setLag(0, 0);
      const id0 = await ev(B, 'MP.id');
      B.setDead(true);
      const t0 = Date.now();
      const noticed = await until(B, `!MP.connected || MP.id !== ${JSON.stringify(id0)}`, 15);
      const took = (Date.now() - t0) / 1000;
      B.setDead(false);
      const back = await until(B, 'MP.connected && MP.srvOwns.d', 30);
      check('a line gone dead without closing is noticed, and the game gets back in by itself',
        noticed && took < 9.5 && back, 'noticed after ' + took.toFixed(1) + ' s; back in and the room running the other side again: ' + back +
        (back ? '' : ' — ' + await ev(B, 'JSON.stringify({ id: MP.id, c: MP.connected, own: MP.srvOwns, rs: SRV.ws && SRV.ws.readyState, tries: SRV.tries, net: netStatus.textContent, w: wState })') + ' room: ' + [...R.players.keys()].join(',') + ' ' + JSON.stringify(R.creatures.own)));
      //  back in view: it asks the room at once, rather than waiting on its next ping
      const before = await ev(B, 'MP.lastPing');
      await ev(B, 'MP.lastPing = performance.now(); MP.probeT = 0; netWake(); 1');
      const asked = await ev(B, `MP.probeT > 0 && MP.lastPing > ${before}`);
      const answered = await until(B, 'MP.probeT === 0 && MP.connected', 5);
      check('back in view, it asks the room at once, and a live line answers', asked && answered);
    }

    const errs = A.errors.concat(B.errors);
    check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  } finally {
    await room.close();
  }
  console.log('\nTHE LINE: ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
