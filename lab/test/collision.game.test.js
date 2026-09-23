'use strict';
//  ============================================================
//  COLLISION — cheaper, and exactly the same pushes  (optimisation A3)
//  ============================================================
//  cityNear now hands back a neighbourhood listed once at load, and
//  cityCollide skips a building whose walls are all out of reach. Both are
//  checked here, in the real game, against the originals (kept below
//  verbatim) at 20,000 random places, heights and body sizes: the same
//  buildings in the same order, the same push-out to the last bit, the same
//  floor underfoot.
//
//    node lab/test/collision.game.test.js

const { openRoom, sleep } = require('./harness/page.js');
const ev = (P, src) => P.eval((s) => window.__t.ev(s), src);

(async () => {
  const room = await openRoom();
  let res;
  try {
    const A = await room.player({ room: 'coll', nick: 'Aki' });
    await A.join(); await sleep(2000);
    res = JSON.parse(await ev(A, `(() => {
      const _o = [];
      function oldNear(x, z) {
        _o.length = 0;
        const bi = Math.round(x / PITCH), bj = Math.round(z / PITCH);
        for (let oi = -1; oi <= 1; oi++) for (let oj = -1; oj <= 1; oj++) {
          const a = cBucket.get((bi + oi) + ',' + (bj + oj));
          if (a) for (let i = 0; i < a.length; i++) _o.push(a[i]);
        }
        return _o;
      }
      function oldCollide(pos, feetY, headY, rad) {
        for (let pass = 0; pass < 2; pass++) {
          const near = oldNear(pos.x, pos.z);
          for (let i = 0; i < near.length; i++) {
            const walls = near[i].walls;
            for (let j = 0; j < walls.length; j++) {
              const b = walls[j];
              if (headY <= b.y0 || feetY >= b.y1) continue;
              const minx = b.x0 - rad, maxx = b.x1 + rad, minz = b.z0 - rad, maxz = b.z1 + rad;
              if (pos.x > minx && pos.x < maxx && pos.z > minz && pos.z < maxz) {
                const dxL = pos.x - minx, dxR = maxx - pos.x, dzL = pos.z - minz, dzR = maxz - pos.z;
                if (Math.min(dxL, dxR) < Math.min(dzL, dzR)) pos.x = dxL < dxR ? minx : maxx;
                else pos.z = dzL < dzR ? minz : maxz;
              }
            }
          }
        }
      }
      function oldSupport(x, z, feetY) {
        let s = 0; const step = 0.62, near = oldNear(x, z);
        for (let i = 0; i < near.length; i++) {
          const r = near[i];
          if (x < r.bounds.x0 || x > r.bounds.x1 || z < r.bounds.z0 || z > r.bounds.z1) continue;
          for (const b of r.slabs) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && b.y1 <= feetY + step && b.y1 > s) s = b.y1;
          for (const m of r.ramps) if (x >= m.x0 && x <= m.x1 && z >= m.z0 && z <= m.z1) {
            const ry = m.yA + (m.yB - m.yA) * Math.max(0, Math.min(1, (z - m.z0) / (m.z1 - m.z0)));
            if (ry <= feetY + step && ry > s) s = ry;
          }
        }
        return s;
      }
      let seed = 11; const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
      let lists = 0, pushes = 0, moved = 0, floors = 0, bad = [];
      for (let n = 0; n < 20000; n++) {
        //  mostly in and around buildings, some far outside the city
        const b = cityB[rnd() * cityB.length | 0];
        const x = n % 10 ? b.cx + (rnd() - 0.5) * (b.hw * 2 + 6) : (rnd() - 0.5) * 1600;
        const z = n % 10 ? b.cz + (rnd() - 0.5) * (b.hd * 2 + 6) : (rnd() - 0.5) * 1600;
        const feet = rnd() < 0.5 ? 0 : Math.floor(rnd() * 6) * FH + rnd() * 0.4, rad = 0.3 + rnd() * 1.2;
        const a = cityNear(x, z), o = oldNear(x, z);
        if (a.length !== o.length || a.some((r, i) => r !== o[i])) bad.push('near ' + x.toFixed(1) + ',' + z.toFixed(1));
        lists++;
        const p1 = new THREE.Vector3(x, 0, z), p2 = new THREE.Vector3(x, 0, z);
        cityCollide(p1, feet, feet + 1.7, rad); oldCollide(p2, feet, feet + 1.7, rad);
        if (p1.x !== p2.x || p1.z !== p2.z) bad.push('push ' + x.toFixed(1) + ',' + z.toFixed(1) + ': ' + p1.x + ',' + p1.z + ' vs ' + p2.x + ',' + p2.z);
        pushes++; if (p2.x !== x || p2.z !== z) moved++;
        const s1 = supportHeight(x, z, feet), s2 = oldSupport(x, z, feet);
        if (s1 !== s2) bad.push('floor ' + s1 + ' vs ' + s2); if (s2 > 0) floors++;
      }
      return JSON.stringify({ lists, pushes, moved, floors, bad: bad.slice(0, 5), nbad: bad.length }); })()`));
    res.errors = A.errors.slice(0, 3);
    await A.close();
  } finally { await room.close(); }
  const ok = res.nbad === 0 && res.moved > 1000 && res.floors > 1000 && !res.errors.length;
  console.log('\nCOLLISION — the same answers, cheaper\n');
  console.log((ok ? '  ok   ' : '  FAIL ') + 'cityNear, cityCollide and supportHeight agree with the originals everywhere');
  console.log('         ' + res.lists + ' places; ' + res.moved + ' of them pushed out of a wall, ' + res.floors + ' standing on a floor'
    + (res.nbad ? '; ' + res.nbad + ' disagreements: ' + res.bad.join(' | ') : '') + (res.errors.length ? '; page errors: ' + res.errors.join(' | ') : ''));
  console.log('\n  ' + (ok ? 1 : 0) + ' passed, ' + (ok ? 0 : 1) + ' failed\n');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
