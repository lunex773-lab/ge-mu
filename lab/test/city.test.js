'use strict';
//  ============================================================
//  THE CITY, SHARED  (B4: one source for the game and the room server)
//  ============================================================
//  shared/city.js builds the city without three.js, so the room server can
//  judge shots against the same walls the players see. When it was written
//  it was checked against the city the game built on its own, number for
//  number; the game now builds its city from it. What this keeps checking:
//  that the city in the browser (the inlined copy, in the browser's maths)
//  and the city in node (what the server runs) are the same — every
//  building, and every building's bounds, walls, slabs, ramps, shots, door
//  and stair — and that a ray stops at the same place in both.
//
//    node lab/test/city.test.js

const assert = require('assert');
const { openRoom, sleep } = require('./harness/page.js');
const C = require('../../shared/city.js');
const ev = (P, src) => P.eval((s) => window.__t.ev(s), src);

(async () => {
  const room = await openRoom();
  const results = []; let pass = 0, fail = 0;
  const test = (name, fn) => { try { const d = fn(); pass++; results.push('  ok   ' + name + (d ? '\n         ' + d : '')); } catch (e) { fail++; results.push('  FAIL ' + name + '\n         ' + e.message.slice(0, 400)); } };
  try {
    const A = await room.player({ room: 'city', nick: 'Aki' });
    await A.join(); await sleep(1000);
    const game = JSON.parse(await ev(A, `JSON.stringify({
      buildings: buildingList.map((b) => ({ cx: b.cx, cz: b.cz, hw: b.hw, hd: b.hd, h: b.h, mat: b.mat, type: b.type, floors: b.floors })),
      recs: cityB.map((r) => ({ cx: r.cx, cz: r.cz, hw: r.hw, hd: r.hd, h: r.h, accH: r.accH, bounds: r.bounds, slabs: r.slabs, walls: r.walls, ramps: r.ramps, shots: r.shots, door: r.door, stair: r.stair, acc: r.acc })) })`));
    const shared = C.buildCity();
    test('the same buildings, in the same order', () => { assert.deepStrictEqual(shared.buildings, game.buildings); return shared.buildings.length + ' buildings'; });
    test('every building the same inside: bounds, walls, slabs, ramps, shots, door, stair', () => {
      const pick = (r) => ({ cx: r.cx, cz: r.cz, hw: r.hw, hd: r.hd, h: r.h, accH: r.accH, bounds: r.bounds, slabs: r.slabs, walls: r.walls, ramps: r.ramps, shots: r.shots, door: r.door, stair: r.stair, acc: r.acc });
      assert.strictEqual(shared.recs.length, game.recs.length);
      let boxes = 0;
      shared.recs.forEach((r, i) => { assert.deepStrictEqual(pick(r), game.recs[i], 'building ' + i); boxes += r.walls.length + r.slabs.length + r.ramps.length + r.shots.length; });
      return boxes + ' boxes compared';
    });
    //  and a ray through the shared city lands where the game's does
    const rays = JSON.parse(await ev(A, `(() => { let seed = 5; const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
      const out = []; const ro = new THREE.Vector3(), rd = new THREE.Vector3();
      for (let i = 0; i < 3000; i++) { ro.set((rnd() - 0.5) * 700, rnd() * 40, (rnd() - 0.5) * 700); rd.set(rnd() - 0.5, (rnd() - 0.5) * 0.4, rnd() - 0.5).normalize();
        const max = 5 + rnd() * 300; out.push([ro.x, ro.y, ro.z, rd.x, rd.y, rd.z, max, rayCity(ro, rd, max), rayCity(ro, rd)]); }
      return JSON.stringify(out); })()`));
    test('a ray through the shared city stops where the game\'s does', () => {
      let hits = 0;
      for (const r of rays) {
        const ro = { x: r[0], y: r[1], z: r[2] }, rd = { x: r[3], y: r[4], z: r[5] };
        const a = C.rayCity(shared.recs, ro, rd, r[6]), b = C.rayCity(shared.recs, ro, rd);
        const ga = r[7] === null ? Infinity : r[7], gb = r[8] === null ? Infinity : r[8];
        if (!Object.is(a, ga) || !Object.is(b, gb)) throw new Error('ray ' + JSON.stringify(r) + ': shared ' + a + '/' + b);
        if (b < Infinity) hits++;
      }
      return rays.length + ' rays, ' + hits + ' of them hit something';
    });
    //  and the footprints the room's creatures stand and walk among
    const spots = JSON.parse(await ev(A, `(() => { let seed = 9; const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
      const out = []; for (let i = 0; i < 20000; i++) { const x = (rnd() - 0.5) * 720, z = (rnd() - 0.5) * 720, m = rnd() * 2.5;
        out.push([x, z, m, clearAt(x, z, m) ? 1 : 0, bzbRoof(x, z)]); }
      return JSON.stringify(out); })()`));
    test('the footprints: clear or not, and the roof over it, as the game has them', () => {
      const F = C.footprints(C.planBuildings());
      let blocked = 0, roofed = 0;
      for (const s of spots) {
        const c = F.clearAt(s[0], s[1], s[2]) ? 1 : 0, r = F.roof(s[0], s[1]);
        if (c !== s[3] || r !== s[4]) throw new Error('at ' + JSON.stringify(s) + ': shared clear ' + c + ', roof ' + r);
        if (!c) blocked++; if (r > 0) roofed++;
      }
      return spots.length + ' spots, ' + blocked + ' inside a footprint, ' + roofed + ' under a roof';
    });
    //  walking about inside it (shared/city.js ground): the game, with every
    //  building built, and the room, building each only when first stood in,
    //  give the same floor underfoot, push a body out of the same walls, find
    //  the same building, and take the same way to the door and up the stairs
    {
      const rnd = C.mulberry32(0xd06);
      const B = shared.buildings, Q = [];
      for (let i = 0; i < 6000; i++) {
        let x, z;
        if (i % 3) { const b = B[(rnd() * B.length) | 0]; x = b.cx + (rnd() * 2 - 1) * (b.hw + 2); z = b.cz + (rnd() * 2 - 1) * (b.hd + 2); }
        else { x = (rnd() * 2 - 1) * 360; z = (rnd() * 2 - 1) * 360; }
        const y = rnd() < 0.5 ? 0 : Math.floor(rnd() * 6) * C.FH + rnd() * 1.5;
        const t = B[(rnd() * B.length) | 0], tx = rnd() < 0.5 ? t.cx + (rnd() - 0.5) * t.hw : x + (rnd() - 0.5) * 60, tz = rnd() < 0.5 ? t.cz + (rnd() - 0.5) * t.hd : z + (rnd() - 0.5) * 60;
        Q.push([+x.toFixed(3), +z.toFixed(3), +y.toFixed(3), +tx.toFixed(3), +tz.toFixed(3), Math.floor(rnd() * 6) * C.FH]);
      }
      const ask = (G, id) => Q.map(([x, z, y, tx, tz, ty]) => {
        const pos = { x, z }; G.collide(pos, y + 0.05, y + 0.95, 0.42);
        const b = G.bldAt(x, z), w = G.navNext(x, z, y, tx, tz, ty);
        return [G.supportHeight(x, z, y + 0.5), pos.x, pos.z, b ? id(b) : -1, w ? [w.x, w.z] : null];
      });
      const inGame = JSON.parse(await ev(A, `(() => { const Q = ${JSON.stringify(Q)}; const G = { supportHeight, collide: (p, f, h, r) => { const v = new THREE.Vector3(p.x, 0, p.z); cityCollide(v, f, h, r); p.x = v.x; p.z = v.z; }, bldAt, navNext };
        return JSON.stringify((${ask.toString()})(G, (b) => cityB.indexOf(b))); })()`));
      const L = C.lazyCity(), LN = C.lazyNear(L), G = C.ground(LN.near, LN.full);
      const inRoom = ask(G, (b) => shared.recs.findIndex((r) => r.cx === b.cx && r.cz === b.cz));
      test('walking about inside: the same floor, walls, building and way, in the game and in the room', () => {
        let inside = 0, pushed = 0, routed = 0;
        Q.forEach((q, i) => {
          assert.deepStrictEqual(inRoom[i], inGame[i], 'at ' + JSON.stringify(q));
          if (inGame[i][3] >= 0) inside++; if (inGame[i][1] !== q[0] || inGame[i][2] !== q[1]) pushed++; if (inGame[i][4]) routed++;
        });
        return Q.length + ' places: ' + inside + ' inside a building, ' + pushed + ' pushed out of a wall, ' + routed + ' sent by a door or a stair; the room built ' + L.built() + ' of ' + B.length + ' insides';
      });
    }
    //  the other side's wrecks (shared/wrecks.js): where the game has them, the
    //  room has them — from the same seed and the same cars' shapes
    {
      const inGame = JSON.parse(await ev(A, 'buildWrecks(); JSON.stringify(wrecks)'));
      const WR = require('../../shared/wrecks.js'), TF = require('../../shared/traffic.js');
      const inRoom = JSON.parse(JSON.stringify(WR.makeWrecks(TF.makeTraffic({ now: () => 0 }).cars)));
      test('the wrecks on the other side: the same in the game and in the room', () => {
        assert.deepStrictEqual(inRoom, inGame);
        return inGame.filter(Boolean).length + ' wrecks';
      });
    }
    await A.close();
  } finally { await room.close(); }
  console.log('\nTHE CITY, SHARED — the same city for the game and the server\n');
  console.log(results.join('\n'));
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
