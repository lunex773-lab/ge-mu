'use strict';
//  ============================================================
//  PHASE 11 — what he costs, in the real game
//  ============================================================
//  D8 is "never drop a frame", and the only honest measurement of that is a
//  phone. What can be measured here is what he adds to a frame, on this
//  machine: the time spent in his whole update (brain, body, animation,
//  sound, bar) per frame, once the JIT has warmed — mean, p99 and worst —
//  and the draw calls and triangles his body adds when he is on screen. The
//  report scales those to a phone at 4-8x slower.
//
//    node lab/test/phase11.game.test.js

const { openRoom, sleep } = require('./harness/page.js');

const results = [];
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  results.push((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '\n         ' + detail : ''));
}
const ev = (P, src) => P.eval((s) => window.__t.ev(s), src);

(async () => {
  const room = await openRoom();
  try {
    //  Rendering off while timing: software GL here draws a frame a second,
    //  which would leave a handful of samples, all with a cold JIT. His cost
    //  does not depend on drawing — the draw calls are counted separately,
    //  with one real render.
    const A = await room.player({ room: 'p11', nick: 'Aki' });
    await A.join(); await sleep(3000);
    await A.eval(() => { window.__t.myKills = 9; window.__t.creditMyKill(); });
    for (let i = 0; i < 120 && !(await ev(A, 'bzb.live')); i++) await sleep(250);
    // face him from 12 m, and time every call of his update
    await ev(A, `(() => {
      p.set(bzb.x + Math.sin(bzb.hd) * 12, p.y, bzb.z + Math.cos(bzb.hd) * 12);
      yaw = Math.atan2(-(bzb.x - p.x), -(bzb.z - p.z)); pitch = 0.2; todHours = 13;
      window.__bz = { on: false, off: false, ms: [], fr: { on: [], off: [] } };
      //  every whole frame too (all of the game's JS, drawing off): with him, and
      //  with his update skipped, in alternating blocks so drift cancels
      const origFrame = frame;
      frame = function (now) { const t0 = performance.now(); origFrame(now); const S = window.__bz; if (S.on) S.fr[S.off ? 'off' : 'on'].push(performance.now() - t0); };
      const orig = updateBzb;
      updateBzb = function (dt) {
        const S = window.__bz; yaw = Math.atan2(-(bzb.x - p.x), -(bzb.z - p.z)); hp = HP_MAX;
        if (S.off) return;
        const t0 = performance.now(); orig(dt); const ms = performance.now() - t0; if (S.on) S.ms.push(ms); };
      return 1; })()`);
    //  the first seconds are the JIT compiling him; a phone pays that once too,
    //  but it is not what he costs a frame
    await sleep(6000);
    await ev(A, 'window.__bz.on = true; bzbAI.thinks = 0; bzbAI.thinkUs = 0; 1');
    for (let k = 0; k < 10; k++) { await ev(A, 'window.__bz.off = ' + (k % 2 === 1)); await sleep(5000); }
    const st = JSON.parse(await ev(A, `(() => {
      const q = (arr) => { const a = arr.slice().sort((x, y) => x - y), n = a.length;
        return { n, mean: a.reduce((s, x) => s + x, 0) / Math.max(1, n), p50: a[n >> 1], p99: a[Math.floor(n * 0.99)], max: a[n - 1], over: a.filter((x) => x > 1).length }; };
      const S = window.__bz;
      return JSON.stringify({ him: q(S.ms), on: q(S.fr.on), off: q(S.fr.off), thinks: bzbAI.thinks, us: Math.round(bzbAI.thinkUs / Math.max(1, bzbAI.thinks)) }); })()`));
    const us = (ms) => (ms * 1000).toFixed(0) + ' µs';
    const h = st.him;
    check('his whole update, per frame, stays far inside a frame on this machine',
      //  p99 was 1.5-2.7 ms across runs here: the page's garbage collection
      //  lands in whoever is running (his stack allocates ~90 KB a second,
      //  the same as the plain FSM's), and the clock ticks in 100 µs
      h.mean < 0.4 && h.p99 < 3 && h.n > 150,
      'mean ' + us(h.mean) + ', median ' + us(h.p50) + ', p99 ' + us(h.p99) + ', worst ' + us(h.max) + ' over ' + h.n + ' frames ('
      + h.over + ' over 1 ms); ' + st.thinks + ' decisions at ~' + st.us + ' µs; at 4-8x on a phone: mean ~'
      + (h.mean * 4000).toFixed(0) + '-' + (h.mean * 8000).toFixed(0) + ' µs of a 16 667 µs frame');
    //  and nothing of his hides elsewhere in the frame (garbage, the scene
    //  graph): the whole frame's mean moves by about his own cost. Its slow
    //  tail is reported, not judged — at the harness's few frames a second a
    //  p99 is the second-worst frame of a block, and the page collects
    //  garbage whoever allocated it
    check('the whole frame costs about what his update does, and no more',
      st.on.n > 50 && st.off.n > 50 && st.on.mean - st.off.mean < h.mean + 0.25,
      'whole frame JS with him: mean ' + us(st.on.mean) + ', p99 ' + us(st.on.p99) + ', worst ' + us(st.on.max) + ' (' + st.on.n + ' frames); '
      + 'without: mean ' + us(st.off.mean) + ', p99 ' + us(st.off.p99) + ', worst ' + us(st.off.max) + ' (' + st.off.n + ')');

    // draw calls and triangles with him on screen, and without — one real render each
    const count = (hide) => ev(A, `(() => { bzb.rig.group.visible = ${!hide}; renderer.realRender(scene, camera); const r = renderer.info.render;
      bzb.rig.group.visible = true; return JSON.stringify({ calls: r.calls, tris: r.triangles }); })()`).then(JSON.parse);
    const withHim = await count(false), without = await count(true);
    const dc = withHim.calls - without.calls, dt = withHim.tris - without.tris;
    //  six skinned materials (the eye among them), four wings, the cape, three
    //  scythe meshes and the sigil
    check('his body is fifteen draw calls, no more', dc > 0 && dc <= 15, '+' + dc + ' draw calls, +' + (dt / 1000).toFixed(1) + 'k triangles');
    check('no page errors', A.errors.length === 0, A.errors.slice(0, 3).join(' | '));
    await A.close();
  } finally { await room.close(); }
  console.log('\nPHASE 11 — his cost in the real game\n');
  console.log(results.join('\n'));
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
