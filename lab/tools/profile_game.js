'use strict';
//  ============================================================
//  PROFILE — where a frame of the real game goes
//  ============================================================
//  The baseline for the Cloudflare / client-optimisation work
//  (SERVER_MIGRATION_ANALYSIS.md): run it before and after a change and
//  compare. Headless Chromium on this machine, drawing off for the JS
//  timings (software GL is not a phone GPU), then one real render for the
//  draw calls and triangles. Phones are slower by a factor this cannot
//  measure; the numbers are for comparing versions, not for promising FPS.
//
//    node lab/tools/profile_game.js [seconds] [out.json]
//
//  Prints, for the normal world and the backside: frame JS time (mean, p95,
//  p99), each subsystem's cost per frame, the functions with the most self
//  time, draw calls / triangles / what the triangles are, and the instance
//  buffers re-uploaded every frame.

const fs = require('fs');
const { openRoom, sleep } = require('../test/harness/page.js');

const SECS = +(process.argv[2] || 20);
const OUT = process.argv[3] || null;
const ev = (P, src) => P.eval((s) => window.__t.ev(s), src);
const WRAP = ['updateCity', 'updateCombat', 'updatePeers', 'updateMusic', 'updateEffects', 'updateDayNight', 'updateBackside',
  'updateQuality', 'updateHud', 'updateMinimap', 'publishState', 'publishMobs', 'cityCollide', 'supportHeight', 'poseMonkey',
  'updateDogs', 'updateGorgons', 'updateFlayers', 'updateVecna', 'updateRifts', 'updateBzb', 'updateSpores', 'updateLightning',
  'updateGateSync', 'updateTransition', 'wreckCollide', 'drawMap'];

const INSTRUMENT = `(() => {
  const S = window.__S = { on: false, t: {}, fr: [] };
  const W = (name) => { let f; try { f = eval(name); } catch (e) { return; } if (typeof f !== 'function') return;
    S.t[name] = { n: 0, s: 0, mx: 0 };
    const g = function () { const t0 = performance.now(); const r = f.apply(this, arguments); const ms = performance.now() - t0;
      if (S.on) { const q = S.t[name]; q.n++; q.s += ms; if (ms > q.mx) q.mx = ms; } return r; };
    eval(name + ' = g'); };
  ${JSON.stringify(WRAP)}.forEach(W);
  const of = frame; frame = function (now) { const t0 = performance.now(); of(now); if (S.on) S.fr.push(performance.now() - t0); };
  return 1; })()`;

const RENDER = `(() => {
  renderer.realRender(scene, camera); const i = renderer.info;
  const rows = []; let meshes = 0, inst = 0, instances = 0, skinned = 0;
  scene.traverse((o) => {
    if (o.isMesh) { meshes++; if (o.isInstancedMesh) { inst++; instances += o.count; } if (o.isSkinnedMesh) skinned++; }
    if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
    let vis = true; for (let q = o; q; q = q.parent) if (!q.visible) { vis = false; break; }
    if (!vis) return;
    const g = o.geometry; let t = 0;
    if (g && g.isBufferGeometry) t = (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) / 3;
    const n = o.isInstancedMesh ? o.count : 1;
    rows.push({ per: Math.round(t), n, tris: Math.round(t * n), cull: o.frustumCulled, mat: o.material && o.material.type });
  });
  rows.sort((a, b) => b.tris - a.tris);
  return JSON.stringify({ calls: i.render.calls, tris: i.render.triangles, geometries: i.memory.geometries, programs: (i.programs || []).length,
    meshes, inst, instances, skinned, visibleDrawables: rows.length,
    unculledTris: rows.filter((r) => !r.cull).reduce((s, r) => s + r.tris, 0), top: rows.slice(0, 12),
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null }); })()`;

async function phase(A, label) {
  await ev(A, '(() => { const S = window.__S; for (const k in S.t) { S.t[k].n = 0; S.t[k].s = 0; S.t[k].mx = 0; } S.fr = []; S.on = true; return 1; })()');
  const up0 = JSON.parse(await ev(A, '(() => { const v = []; scene.traverse((o) => { if (o.isInstancedMesh) v.push(o.instanceMatrix.version); }); return JSON.stringify(v); })()'));
  const cdp = await A.page.context().newCDPSession(A.page);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  await sleep(SECS * 1000);
  const { profile } = await cdp.send('Profiler.stop');
  await ev(A, 'window.__S.on = false; 1');
  const S = JSON.parse(await ev(A, 'JSON.stringify(window.__S)'));
  const up1 = JSON.parse(await ev(A, '(() => { const v = []; scene.traverse((o) => { if (o.isInstancedMesh) v.push({ v: o.instanceMatrix.version, b: o.instanceMatrix.array.byteLength }); }); return JSON.stringify(v); })()'));
  const fr = S.fr.slice().sort((a, b) => a - b), n = fr.length;
  let hot = 0, hotBytes = 0;
  up1.forEach((o, k) => { if (o.v - (up0[k] || 0) > n * 0.8) { hot++; hotBytes += o.b; } });
  const nodes = new Map(profile.nodes.map((x) => [x.id, x])), self = new Map();
  let total = 0;
  for (let k = 0; k < profile.samples.length; k++) {
    const cf = nodes.get(profile.samples[k]).callFrame, us = profile.timeDeltas[k] || 0;
    const key = (cf.functionName || '(anon)') + (cf.url ? ' @' + cf.url.split('/').pop() + ':' + (cf.lineNumber + 1) : '');
    self.set(key, (self.get(key) || 0) + us); total += us;
  }
  return {
    label, frames: n,
    frame: { mean: fr.reduce((s, x) => s + x, 0) / Math.max(1, n), p50: fr[n >> 1], p95: fr[Math.floor(n * 0.95)], p99: fr[Math.floor(n * 0.99)], max: fr[n - 1] },
    subsystems: Object.entries(S.t).map(([k, q]) => ({ name: k, calls: q.n, usPerFrame: Math.round(q.s / Math.max(1, n) * 1000), worstUs: Math.round(q.mx * 1000) }))
      .filter((s) => s.calls).sort((a, b) => b.usPerFrame - a.usPerFrame),
    selfTime: [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, us]) => ({ fn: k, ms: +(us / 1000).toFixed(1), pct: +(100 * us / total).toFixed(1) })),
    uploads: { meshes: hot, kbPerFrame: Math.round(hotBytes / 1024) },
    render: JSON.parse(await ev(A, RENDER)),
  };
}

function show(r) {
  const f = r.frame;
  console.log('\n== ' + r.label + ' — ' + r.frames + ' frames; frame JS mean ' + f.mean.toFixed(2) + ' ms, p50 ' + f.p50.toFixed(2) + ', p95 ' + f.p95.toFixed(2) + ', p99 ' + f.p99.toFixed(2) + ', max ' + f.max.toFixed(2));
  console.log('   subsystem            calls   µs/frame   worst µs');
  for (const s of r.subsystems) console.log('   ' + s.name.padEnd(18) + String(s.calls).padStart(8) + String(s.usPerFrame).padStart(11) + String(s.worstUs).padStart(11));
  console.log('   most self time (drawing off):');
  for (const t of r.selfTime.slice(0, 15)) console.log('   ' + String(t.ms).padStart(8) + ' ms ' + String(t.pct).padStart(5) + '%  ' + t.fn);
  const R = r.render;
  console.log('   render: ' + R.calls + ' draw calls, ' + (R.tris / 1000).toFixed(0) + 'k triangles (' + (R.unculledTris / 1000).toFixed(0) + 'k in meshes that are never frustum-culled), '
    + R.programs + ' programs, ' + R.meshes + ' meshes (' + R.inst + ' instanced, ' + R.instances + ' instances), ' + R.visibleDrawables + ' visible drawables, heap ' + R.heapMB + ' MB');
  console.log('   instance buffers re-uploaded every frame: ' + r.uploads.meshes + ' meshes, ' + r.uploads.kbPerFrame + ' KB a frame');
  console.log('   biggest triangle sources: ' + R.top.slice(0, 6).map((t) => t.per + '×' + t.n + (t.cull ? '' : ' (no cull)')).join(', '));
}

(async () => {
  const room = await openRoom();
  const res = {};
  try {
    const A = await room.player({ room: 'profile', nick: 'Aki' });
    await A.join(); await sleep(4000);
    await ev(A, INSTRUMENT);
    res.normal = await phase(A, 'NORMAL world, solo');
    await A.eval(() => { window.__t.myKills = 9; window.__t.creditMyKill(); });
    for (let i = 0; i < 80 && !(await ev(A, 'rift.present')); i++) await sleep(250);
    await ev(A, 'setWorld(WS.BACK); 1');
    await sleep(12000);
    res.back = await phase(A, 'BACK world, solo (this client runs every mob)');
    res.errors = A.errors.slice(0, 5);
    await A.close();
  } finally { await room.close(); }
  show(res.normal); show(res.back);
  if (res.errors.length) console.log('\npage errors:', res.errors);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
})().catch((e) => { console.error(e); process.exit(2); });
