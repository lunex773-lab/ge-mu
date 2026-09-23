'use strict';
//  ============================================================
//  VIEW COST — draw calls and triangles over many views of the city
//  ============================================================
//  One view says little: the camera decides what is drawn. This stands at
//  40 street positions (fixed seed), looks 8 ways from each, and renders
//  every view, in the normal world and the backside, reporting the mean
//  draw calls and triangles. For A/B comparisons:
//
//    node lab/tools/view_cost.js                         this index.html
//    LAB_GAME=/path/to/old.html node lab/tools/view_cost.js   another copy
//
//  aspect: 2.1 (a phone held sideways) by default; pass 0.5 for upright.

const { openRoom, sleep } = require('../test/harness/page.js');
const ASPECT = +(process.argv[2] || 2.1);
const ev = (P, src) => P.eval((s) => window.__t.ev(s), src);
//  Software GL takes about a second to draw one view of the city, so the
//  views are not drawn: each is counted with the same test three.js runs
//  before drawing (visible, in the frustum unless frustumCulled is off), which
//  is what renderer.info would report.
const VIEWS = `(() => {
  camera.aspect = ${ASPECT}; camera.updateProjectionMatrix();
  const fr = new THREE.Frustum(), pm = new THREE.Matrix4();
  let seed = 7; const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  const poses = [];
  while (poses.length < 320) { const x = (rnd() * 2 - 1) * 300, z = (rnd() * 2 - 1) * 300;
    if (clearAt(x, z, 1.5)) for (let h = 0; h < 8; h++) poses.push([x, z, h * Math.PI / 4]); }
  const drawn = [];
  (function walk(o) { if (!o.visible) return;
    if (o.isMesh || o.isLine || o.isPoints || o.isSprite) drawn.push(o);
    for (const c of o.children) walk(c); })(scene);
  const trisOf = (o) => { const g = o.geometry; if (!g || !g.isBufferGeometry) return 0;
    const n = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0);
    return (o.isMesh ? n / 3 : 0) * (o.isInstancedMesh ? o.count : 1); };
  let calls = 0, tris = 0, sCalls = 0, sTris = 0;
  //  the static city: instanced meshes whose instances never move — the part a
  //  change to the city's batching affects; the rest moves with the traffic
  const isStatic = (o) => o.isInstancedMesh && o.instanceMatrix.usage !== THREE.DynamicDrawUsage;
  for (const [x, z, h] of poses) {
    camera.position.set(x, 1.7, z); camera.rotation.set(0, h, 0, 'YXZ'); sky.position.set(x, 0, z);
    scene.updateMatrixWorld(); camera.updateMatrixWorld();
    pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); fr.setFromProjectionMatrix(pm);
    for (const o of drawn) {
      if (o.frustumCulled && !(o.isSprite ? fr.intersectsSprite(o) : fr.intersectsObject(o))) continue;
      const c = Array.isArray(o.material) ? o.geometry.groups.length || 1 : 1, t = trisOf(o);
      calls += c; tris += t; if (isStatic(o)) { sCalls += c; sTris += t; }
    }
  }
  const V = poses.length;
  return JSON.stringify({ views: V, calls: +(calls / V).toFixed(1), ktris: +(tris / V / 1000).toFixed(0), sCalls: +(sCalls / V).toFixed(1), sKtris: +(sTris / V / 1000).toFixed(0) }); })()`;
(async () => {
  const room = await openRoom();
  try {
    const A = await room.player({ room: 'views', nick: 'Aki', seed: 12345 });
    await A.join(); await sleep(3000);
    await ev(A, 'updateCity = () => {}; 1');            // the traffic stands still: every copy sees the same street
    const normal = JSON.parse(await ev(A, VIEWS));
    await ev(A, 'setWorld(WS.BACK); 1'); await sleep(500);
    const back = JSON.parse(await ev(A, VIEWS));
    const f = (r) => r.calls + ' calls / ' + r.ktris + 'k tris (static city ' + r.sCalls + ' / ' + r.sKtris + 'k)';
    console.log('aspect ' + ASPECT + ' — normal: ' + f(normal) + ' | backside: ' + f(back) + '  (' + normal.views + ' views each)');
    if (A.errors.length) console.log('page errors:', A.errors.slice(0, 3));
    await A.close();
  } finally { await room.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
