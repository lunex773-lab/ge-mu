'use strict';
//  ============================================================
//  SOAK — does anything pile up over a long session?
//  ============================================================
//  Plays for a while — firing without pause, a second player joining and
//  leaving over and over, the tear opening and the backside crossed —
//  and samples what should stay flat: geometries, materials and textures in
//  the scene, objects in it, DOM nodes, and the JS heap after a collection.
//
//    node lab/tools/soak.js [minutes]

const { openRoom, sleep } = require('../test/harness/page.js');
const MIN = +(process.argv[2] || 2);
const ev = (P, src) => P.eval((s) => window.__t.ev(s), src);
//  three.js's own counters only see what has been drawn, and the harness
//  does not draw, so the scene graph is walked instead: every distinct
//  geometry, material and texture reachable from it. The heap comes from
//  the DevTools protocol (performance.memory is rounded to coarse steps).
const SAMPLE = `(() => { const geo = new Set(), mat = new Set(), tex = new Set(); let objs = 0;
  scene.traverse((o) => { objs++; if (o.geometry) geo.add(o.geometry);
    for (const m of [].concat(o.material || [])) { mat.add(m); for (const k in m) if (m[k] && m[k].isTexture) tex.add(m[k]); } });
  return JSON.stringify({ geo: geo.size, mat: mat.size, tex: tex.size, objs, dom: document.getElementsByTagName('*').length }); })()`;

(async () => {
  const room = await openRoom();
  const rows = [];
  try {
    const A = await room.player({ room: 'soak', nick: 'Aki' });
    await A.join(); await sleep(3000);
    await ev(A, "mode = 'mobile'; fireHeld = true; ammo = 1e9; { const f = fire; fire = function () { window.__shots = (window.__shots || 0) + 1; return f.apply(this, arguments); }; } 1");
    const cdp = await A.page.context().newCDPSession(A.page);
    const t0 = Date.now();
    let k = 0, crossed = false;
    while (Date.now() - t0 < MIN * 60000) {
      const B = await room.player({ room: 'soak', nick: 'Ben' + k });      // someone arrives …
      await B.join(); await sleep(6000);
      await B.close(); await sleep(7000);                                  // … and leaves (dropped after the timeout)
      await ev(A, 'hp = HP_MAX; dead = false; ammo = 1e9; fireHeld = true; yaw += 1.1; 1');
      if (!crossed && Date.now() - t0 > MIN * 30000) {                     // halfway: over to the other side
        await A.eval(() => { window.__t.myKills = 9; window.__t.creditMyKill(); });
        for (let i = 0; i < 60 && !(await ev(A, 'rift.present')); i++) await sleep(250);
        await ev(A, 'setWorld(WS.BACK); 1'); crossed = true;
      }
      await cdp.send('HeapProfiler.collectGarbage');
      const s = JSON.parse(await ev(A, SAMPLE));
      s.heap = +((await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576).toFixed(2);
      s.shots = await ev(A, 'window.__shots || 0');
      s.t = Math.round((Date.now() - t0) / 1000); s.world = crossed ? 'back' : 'normal'; rows.push(s);
      console.log('  ' + String(s.t).padStart(4) + ' s  ' + s.world.padEnd(6) + '  fire() calls ' + String(s.shots).padStart(5) + '  geometries ' + s.geo + '  materials ' + s.mat + '  textures ' + s.tex + '  objects ' + s.objs + '  DOM ' + s.dom + '  heap ' + s.heap + ' MB');
      k++;
    }
    if (A.errors.length) console.log('page errors:', A.errors.slice(0, 3));
    await A.close();
  } finally { await room.close(); }
  //  the first sample after the crossing is the new baseline for that side
  const flat = (key) => { const n = rows.filter((r) => r.world === 'normal'), b = rows.filter((r) => r.world === 'back');
    const grow = (a) => a.length > 1 ? a[a.length - 1][key] - a[0][key] : 0; return [grow(n), grow(b)]; };
  console.log('\n  growth within each world (first → last sample): geometries ' + flat('geo') + ', materials ' + flat('mat') + ', textures ' + flat('tex') + ', objects ' + flat('objs') + ', DOM ' + flat('dom') + ', heap MB ' + flat('heap').map((x) => x.toFixed(2)));
})().catch((e) => { console.error(e); process.exit(2); });
