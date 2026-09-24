'use strict';
//  ============================================================
//  NET COST — what each player sends, by kind, in each world
//  ============================================================
//  Two players in one room (the room server played by server/relay.js, as
//  in every game test), standing near each other: first in the daylight
//  city, then on the other side of the tear, where the dog packs are. For
//  each player it counts what it sends a second, by kind (bytes and
//  messages), and breaks the host's creature snapshot down by part.
//
//    node lab/tools/net_cost.js [game.html]      (about a minute)
//
//  Messages matter for the room's free plan (every 20 a player sends is a
//  request); bytes matter for a phone's data.

const { openRoom, sleep } = require('../test/harness/page.js');
if (process.argv[2]) process.env.LAB_GAME = require('path').resolve(process.argv[2]);
const ev = (P, src) => P.eval((s) => window.__t.ev(s), src);
const SECS = 8;

//  count every message out, by kind, and keep the last creature snapshot
const TAP = `(() => {
  window.__net = { by: {}, mob: null };                        // counted afresh…
  const c = MP.client;
  if (c.__tapped) return 1;                                     // …by the one tap there is
  const pub = c.publish, pre = mtopic(''); c.__tapped = true;
  c.publish = function (t, pl) {
    let k = t.slice(pre.length); if (k.slice(0, 6) === 'state/') k = 'state';
    const e = window.__net.by[k] || (window.__net.by[k] = { n: 0, b: 0 });
    e.n++; e.b += String(pl).length + k.length + 12;          // + the room's envelope, as sent
    if (k === 'mob') window.__net.mob = String(pl);
    return pub.apply(this, arguments);
  };
  return 1; })()`;

function table(title, by, secs) {
  const rows = Object.entries(by).sort((a, b) => b[1].b - a[1].b);
  const tb = rows.reduce((s, [, e]) => s + e.b, 0), tn = rows.reduce((s, [, e]) => s + e.n, 0);
  console.log('  ' + title.padEnd(30) + (tb / secs / 1024).toFixed(2).padStart(6) + ' KB/s  ' + (tn / secs).toFixed(1).padStart(5) + ' msg/s');
  for (const [k, e] of rows) console.log('      ' + k.padEnd(26) + (e.b / secs / 1024).toFixed(2).padStart(6) + ' KB/s  ' + (e.n / secs).toFixed(1).padStart(5) + ' msg/s');
}
function parts(json) {
  if (!json) return '  (no snapshot)';
  const m = JSON.parse(json);
  return '  host snapshot, ' + json.length + ' bytes: ' + Object.keys(m).map((k) => k + ' ' + JSON.stringify(m[k]).length).join(', ');
}

(async () => {
  const room = await openRoom();
  try {
    const A = await room.player({ room: 'netcost', nick: 'Aki' });
    await A.join(); await sleep(1500);
    const B = await room.player({ room: 'netcost', nick: 'Ben' });
    await B.join(); await sleep(4000);
    const stand = (P, dx) => ev(P, `carHitCd = 1e9; p.set(11 + ${dx}, EYE, 10); vy = 0; 1`);
    for (const [world, cross] of [['daylight city', false], ['the other side', true]]) {
      if (cross) {
        await A.eval(() => { window.__t.myKills = 9; window.__t.creditMyKill(); });
        for (let i = 0; i < 60 && !(await ev(A, 'rift.present')); i++) await sleep(250);
        await ev(A, 'setWorld(WS.BACK); 1'); await ev(B, 'setWorld(WS.BACK); 1');
        for (let i = 0; i < 40 && !(await ev(A, 'dogs.filter((d) => d.live).length > 20')); i++) await sleep(250);
      }
      await stand(A, 0); await stand(B, 3); await sleep(1500);
      await ev(A, TAP); await ev(B, TAP);
      await sleep(SECS * 1000);
      const a = JSON.parse(await ev(A, 'JSON.stringify(window.__net)')), b = JSON.parse(await ev(B, 'JSON.stringify(window.__net)'));
      const dogs = await ev(A, 'dogs.filter((d) => d.live).length');
      console.log('\n' + world + (cross ? ' (' + dogs + ' dogs up)' : ''));
      table('A, the host', a.by, SECS);
      table('B', b.by, SECS);
      console.log(parts(a.mob));
      if (cross) {
        //  does the other player still have the same dogs, where the host has them?
        const SNAP = "JSON.stringify(dogs.filter((d) => d.live).map((d) => [d.slot, +d.x.toFixed(1), +d.z.toFixed(1), d.netX === undefined ? null : +d.netX.toFixed(1), d.netZ === undefined ? null : +d.netZ.toFixed(1)]))";
        const da = JSON.parse(await ev(A, SNAP)), db = JSON.parse(await ev(B, SNAP)), bp = JSON.parse(await ev(B, 'JSON.stringify([p.x, p.z])'));
        const mb = new Map(db.map((d) => [d[0], d]));
        let near = 0, nearOff = 0, far = 0, farOff = 0, missing = 0;
        for (const d of da) {
          const o = mb.get(d[0]); if (!o) { missing++; continue; }
          const off = Math.hypot(o[3] - d[1], o[4] - d[2]), isNear = Math.abs(d[1] - bp[0]) < 110 && Math.abs(d[2] - bp[1]) < 110;
          if (isNear) { near++; nearOff = Math.max(nearOff, off); } else { far++; farOff = Math.max(farOff, off); }
        }
        console.log('  dogs: host ' + da.length + ', B ' + db.length + ' (missing at B ' + missing + '); near B ' + near + ' off by ≤ ' + nearOff.toFixed(1) + ' m; far ' + far + ' off by ≤ ' + farOff.toFixed(1) + ' m');
      }
    }
    const errs = A.errors.concat(B.errors);
    if (errs.length) console.log('\npage errors: ' + errs.slice(0, 3).join(' | '));
  } finally { await room.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
