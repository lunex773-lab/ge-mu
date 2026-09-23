'use strict';
//  ============================================================
//  PHASE 12 TESTS — the crowd and the traffic, cheaper, not different
//  ============================================================
//  A2 changed how the traffic and the crowd are written, not what they do:
//
//    putTRS             a car part's matrix, straight into the buffer
//    frameRoot/Joint    a walker's limbs without the Object3D rig
//    lanes / gapAhead   each lane keeps its own cars instead of every car
//                       checking every other one
//
//  Each is taken from index.html and checked against what it replaced:
//  three.js's own Object3D matrices, and a scan of every car.
//
//    node lab/test/phase12.test.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const three = path.join(__dirname, '..', '.cache', 'three.min.js');
if (!fs.existsSync(three)) require('./harness/page.js').build();
const THREE = require(three);

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function slice(from, to) {
  const a = html.indexOf(from), b = html.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('could not find ' + JSON.stringify(from.slice(0, 40)) + ' in index.html');
  return html.slice(a, b);
}
const M = new Function('THREE', slice('  //  The same matrix, written straight', '  const near = (v)') + '\nreturn { putTRS, frameRoot, frameJoint, putFrame };')(THREE);
const L = new Function('PITCH', slice('  const lanes = new Map();', '  function updateCar(') + '\nreturn { lanes, laneOf, laneMove, gapAhead };');

let pass = 0, fail = 0;
const results = [];
function test(name, fn) {
  try { fn(); pass++; results.push('  ok   ' + name); }
  catch (e) { fail++; results.push('  FAIL ' + name + '\n         ' + e.message); }
}
let seed = 3;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
const close = (a, b, eps) => Math.abs(a - b) <= eps;
const fakeInst = (n) => ({ instanceMatrix: { array: new Float32Array(n * 16) } });

test('putTRS writes the matrix Object3D makes for rotation (0, yaw, roll, YXZ), any scale', () => {
  const o = new THREE.Object3D(), inst = fakeInst(1);
  for (let i = 0; i < 20000; i++) {
    const x = (rnd() - 0.5) * 700, y = rnd() * 3, z = (rnd() - 0.5) * 700, ry = (rnd() - 0.5) * 20, rz = (rnd() - 0.5) * 0.6;
    const sx = rnd() * 5, sy = rnd() * 2, sz = rnd() * 5;
    o.position.set(x, y, z); o.rotation.set(0, ry, rz, 'YXZ'); o.scale.set(sx, sy, sz); o.updateMatrix();
    M.putTRS(inst, 0, x, y, z, Math.cos(ry), Math.sin(ry), Math.cos(rz), Math.sin(rz), sx, sy, sz);
    const ref = new Float32Array(o.matrix.elements);
    for (let k = 0; k < 16; k++) if (!close(ref[k], inst.instanceMatrix.array[k], 1e-4)) throw new Error('element ' + k + ': ' + ref[k] + ' vs ' + inst.instanceMatrix.array[k]);
  }
});

test("a walker's limbs, solved directly, match the Object3D rig", () => {
  const mk = (par, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); par.add(o); return o; };
  const sk = new THREE.Object3D();
  const lu = mk(sk, -0.1, 0.9, 0), ll = mk(lu, 0, -0.44, 0), fl = mk(ll, 0, -0.42, 0);
  const au = mk(sk, 0.25, 1.44, 0), al = mk(au, 0, -0.30, 0);
  const R = new Float64Array(12), A = new Float64Array(12), B = new Float64Array(12), inst = fakeInst(1);
  const same = (obj, f, what) => {
    M.putFrame(inst, 0, f); const ref = new Float32Array(obj.matrixWorld.elements);
    for (let k = 0; k < 16; k++) if (!close(ref[k], inst.instanceMatrix.array[k], 1e-4)) throw new Error(what + ' element ' + k + ': ' + ref[k] + ' vs ' + inst.instanceMatrix.array[k]);
  };
  for (let i = 0; i < 20000; i++) {
    const x = (rnd() - 0.5) * 700, y = rnd() * 0.05, z = (rnd() - 0.5) * 700, h = (rnd() - 0.5) * 20, lean = (rnd() - 0.5) * 0.3;
    const a1 = (rnd() - 0.5) * 2, a2 = rnd(), a3 = (rnd() - 0.5) * 1.4;
    sk.position.set(x, y, z); sk.rotation.set(0, h, lean, 'YXZ'); lu.rotation.x = a1; ll.rotation.x = a2; au.rotation.x = a3; al.rotation.x = 0.28;
    sk.updateMatrixWorld(true);
    M.frameRoot(R, x, y, z, Math.cos(h), Math.sin(h), Math.cos(lean), Math.sin(lean)); same(sk, R, 'torso');
    M.frameJoint(R, A, -0.1, 0.9, 0, a1); same(lu, A, 'thigh');
    M.frameJoint(A, B, 0, -0.44, 0, a2); same(ll, B, 'shin');
    M.frameJoint(B, A, 0, -0.42, 0, 0); same(fl, A, 'foot');
    M.frameJoint(R, A, 0.25, 1.44, 0, a3); same(au, A, 'upper arm');
    M.frameJoint(A, B, 0, -0.30, 0, 0.28); same(al, B, 'forearm');
  }
});

test('the gap to the car ahead is the same as checking every car, as they drive and turn', () => {
  const PITCH = 66, lanes = L(PITCH), cars = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let k = 0; k < 160; k++) { const d = dirs[rnd() * 4 | 0]; cars.push({ i: (rnd() * 11 | 0) - 5, j: (rnd() * 11 | 0) - 5, di: d[0], dj: d[1], s: rnd() }); }
  const brute = (a) => { let ahead = Infinity; for (const o of cars) if (o !== a && o.i === a.i && o.j === a.j && o.di === a.di && o.dj === a.dj && o.s > a.s) ahead = Math.min(ahead, (o.s - a.s) * PITCH); return ahead; };
  for (const c of cars) lanes.laneMove(c, lanes.laneOf(c));
  let checks = 0, finite = 0;
  for (let step = 0; step < 400; step++) {
    for (const c of cars) {
      const want = brute(c), got = lanes.gapAhead(c);
      if (want !== got) throw new Error('step ' + step + ': ' + got + ' but every car says ' + want);
      checks++; if (want < Infinity) finite++;
      c.s += rnd() * 0.08;                       // drive, and at the end of the edge, turn
      if (c.s >= 1) { c.s -= 1; c.i += c.di; c.j += c.dj; const d = dirs[rnd() * 4 | 0]; c.di = d[0]; c.dj = d[1];
        if (Math.abs(c.i) > 5 || Math.abs(c.j) > 5) { c.i = Math.max(-5, Math.min(5, c.i)); c.j = Math.max(-5, Math.min(5, c.j)); } }
      const nl = lanes.laneOf(c); if (nl !== c.lane) lanes.laneMove(c, nl);
    }
  }
  results.push('         (' + checks + ' checks, ' + finite + ' with a car ahead)');
});

console.log('\nPHASE 12 — traffic and crowd: the same answers, cheaper\n');
console.log(results.join('\n'));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
