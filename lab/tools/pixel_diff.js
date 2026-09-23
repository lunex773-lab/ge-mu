'use strict';
//  ============================================================
//  PIXEL DIFF — does an optimisation change the picture?
//  ============================================================
//  Renders the same views with two copies of the game (same seed, loop
//  stopped, traffic frozen, same time of day) and compares the pixels.
//  An optimisation that only changes what is *not* seen should come out
//  identical, or differ in a handful of pixels where two surfaces fight
//  for the same depth.
//
//    node lab/tools/pixel_diff.js <before.html> [after.html]   (after: index.html)
//    CITY_ONLY=1 …   compare only what is placed without Math.random (see below)

const fs = require('fs');
const path = require('path');
const { openRoom, sleep } = require('../test/harness/page.js');
const BEFORE = process.argv[2], AFTER = process.argv[3] || '', OUT = process.env.PIXEL_OUT || null;   // PIXEL_OUT=dir saves the differing views
const W = 320, H = 180;
const ev = (P, src) => P.eval((s) => window.__t.ev(s), src);
const VIEWS = [[12, 40, 0], [-150, 33, 1.2], [200, -33, 2.6], [-33, -220, 4.0], [66, 180, 5.3], [0, 0, 0.8], [250, 250, 3.9], [-260, 100, 0.3]];
async function shoot(file) {
  process.env.LAB_GAME = file;
  const room = await openRoom();
  try {
    const A = await room.player({ room: 'px', nick: 'Aki', seed: 777 });
    await A.join(); await sleep(2500);
    const out = JSON.parse(await ev(A, `(() => {
      frame = () => {};                                    // stop the loop: nothing moves between views
      //  CITY_ONLY: keep only what is placed the same way on every load — the
      //  static city, the ground and the sky. Trees, neon, traffic and crowds
      //  come from Math.random, and three.js draws its object ids from the same
      //  sequence, so any change that creates objects reshuffles them.
      if (${!!process.env.CITY_ONLY}) scene.traverse((o) => {
        if (!(o.isMesh || o.isSprite || o.isPoints || o.isLine)) return;
        const keep = o === sky || o.material === groundMat || (o.isInstancedMesh && o.instanceMatrix.usage !== THREE.DynamicDrawUsage && o !== trunks && o !== leaves);
        if (!keep) o.visible = false;
      });
      todHours = 13; if (typeof updateDayNight === 'function') updateDayNight(0);
      renderer.setPixelRatio(1); renderer.setSize(${W}, ${H}, false); camera.aspect = ${W / H}; camera.updateProjectionMatrix();
      const gl = renderer.getContext(), buf = new Uint8Array(${W * H * 4}), shots = [];
      for (const [x, z, h] of ${JSON.stringify(VIEWS)}) {
        camera.position.set(x, 1.7, z); camera.rotation.set(-0.05, h, 0, 'YXZ'); sky.position.set(x, 0, z);
        renderer.realRender(scene, camera);
        gl.readPixels(0, 0, ${W}, ${H}, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        shots.push(Array.from(buf));
      }
      return JSON.stringify(shots); })()`));
    await A.close();
    return out;
  } finally { await room.close(); }
}
(async () => {
  const a = await shoot(BEFORE), b = await shoot(AFTER);
  let worst = 0;
  a.forEach((sa, k) => {
    const sb = b[k]; let diff = 0, big = 0;
    for (let i = 0; i < sa.length; i += 4) {
      const d = Math.max(Math.abs(sa[i] - sb[i]), Math.abs(sa[i + 1] - sb[i + 1]), Math.abs(sa[i + 2] - sb[i + 2]));
      if (d > 2) diff++; if (d > 40) big++;
    }
    worst = Math.max(worst, diff);
    console.log('view ' + k + ': ' + diff + ' of ' + (W * H) + ' pixels differ' + (big ? ' (' + big + ' by a lot)' : ''));
    if (OUT && diff) for (const [tag, px] of [['a', sa], ['b', sb]]) {   // PPM, bottom row first as GL reads it
      const rows = []; for (let y = H - 1; y >= 0; y--) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; rows.push(px[i], px[i + 1], px[i + 2]); }
      fs.writeFileSync(path.join(OUT, 'view' + k + tag + '.ppm'), Buffer.concat([Buffer.from('P6 ' + W + ' ' + H + ' 255\n'), Buffer.from(rows)]));
    }
  });
  console.log(worst === 0 ? '\nidentical' : '\nlargest difference: ' + worst + ' pixels (' + (100 * worst / (W * H)).toFixed(2) + '%)');
})().catch((e) => { console.error(e); process.exit(2); });
