'use strict';
//  ============================================================
//  PHASE 3 TESTS  (spec §11, §12, §17, §33)
//  ============================================================
//  WorldState and the Sensor Layer, with no game attached. The game-side
//  checks — that the adapter reads the real objects without changing them —
//  are in phase3.game.test.js, because they need the real objects.
//
//  The tests that matter most here are the §17 ones: the boss must not know
//  where a player is when it cannot see or hear them, and it must not be able
//  to read anyone's controls even if somebody upstream offers them.

const assert = require('assert');
const { FIELDS, F, N_FIELDS, UNAVAILABLE, WorldState, validate, toChannels } = require('../core/worldstate.js');
const { SensorLayer, assertObservable } = require('../core/sensors.js');
const { makeGameAdapter } = require('../adapter/game_adapter.js');
const { NeuralCore, ACTIONS, CHANNELS } = require('../core/neural.js');
const { buildMockConnectome } = require('../core/connectome.js');
const C = require('../core/compress.js');
const { makeRng } = require('../core/rng.js');

let pass = 0, fail = 0;
const results = [];
function test(name, fn) {
  try { fn(); pass++; results.push('  ok   ' + name); }
  catch (e) { fail++; results.push('  FAIL ' + name + '\n         ' + e.message); }
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, (what || '') + ' ' + a + ' not within ' + tol + ' of ' + b);

// ---- a tiny world: boxes, and a ray against them --------------------------
function probeOf(boxes) {
  return (ox, oy, oz, dx, dy, dz, max) => {
    let best = Infinity;
    for (const b of boxes) {
      let t0 = 0, t1 = Infinity, ok = true;
      for (const [o, d, lo, hi] of [[ox, dx, b[0], b[1]], [oy, dy, b[2], b[3]], [oz, dz, b[4], b[5]]]) {
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { ok = false; break; } continue; }
        let a = (lo - o) / d, c = (hi - o) / d; if (a > c) [a, c] = [c, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) { ok = false; break; }
      }
      if (ok && t0 < best) best = t0;
    }
    return best < max ? best : Infinity;
  };
}
const OPEN = probeOf([]);
// a wall across the z axis at z = 20, 40 m wide, 10 m tall
const WALL = probeOf([[-20, 20, 0, 10, 19.5, 20.5]]);
// the same wall, long enough that a player running along behind it stays behind it
const LONG_WALL = probeOf([[-200, 200, 0, 10, 19.5, 20.5]]);

const SELF = { x: 0, y: 0, z: 0, hd: 0, hp: 1000, hpMax: 1000, vx: 0, vz: 0, cd: 0, state: 0, alt: 0, world: 0 };
function body(id, x, z, extra) { return Object.assign({ id, x, y: 0, z, fx: 0, fz: -1, hp: 100, hpMax: 100, dead: false, cloak: false, world: 0 }, extra || {}); }
function obs(t, bodies, extra) { return Object.assign({ t, self: SELF, bodies, events: [], probe: OPEN }, extra || {}); }

// ============================================================== the schema
test('schema: every field has a unique name and a sane range', () => {
  const names = new Set();
  for (const f of FIELDS) {
    assert.ok(!names.has(f[0]), 'duplicate ' + f[0]); names.add(f[0]);
    assert.ok(f[1] < f[2], f[0] + ' range is empty');
  }
  assert.strictEqual(N_FIELDS, FIELDS.length);
  assert.strictEqual(Object.keys(F).length, N_FIELDS);
});

test('schema: §11 items this game does not have are declared, not faked', () => {
  for (const k of ['stamina', 'defense_state', 'skill_state']) {
    assert.ok(UNAVAILABLE[k], k + ' should be listed as unavailable');
    assert.ok(!(k in F), k + ' should not be a field');
  }
});

test('a fresh WorldState is valid, and copies are exact', () => {
  const a = new WorldState();
  assert.deepStrictEqual(validate(a), []);
  a.set('player_distance', 12.5).set('threat', 0.4); a.t = 3;
  const b = a.clone();
  assert.deepStrictEqual(Array.from(b.v), Array.from(a.v));
  assert.strictEqual(b.t, 3);
});

test('sanitize: NaN, Infinity and out-of-range all land inside the schema', () => {
  const a = new WorldState();
  a.v[F.player_distance] = NaN; a.v[F.threat] = 9; a.v[F.player_bearing] = -Infinity; a.v[F.self_health] = -3;
  a.sanitize();
  assert.deepStrictEqual(validate(a), []);
});

test('toChannels gives exactly the Neural Core\'s channels, all in 0..1, under fuzz', () => {
  const rng = makeRng(7);
  const a = new WorldState();
  for (let n = 0; n < 2000; n++) {
    for (let i = 0; i < N_FIELDS; i++) {
      const r = rng.next();
      a.v[i] = r < 0.05 ? NaN : r < 0.1 ? Infinity : r < 0.15 ? -1e9 : (rng.next() - 0.5) * 1000;
    }
    const ch = toChannels(a);
    assert.deepStrictEqual(Object.keys(ch).sort(), [...CHANNELS].sort());
    for (const k of CHANNELS) assert.ok(ch[k] >= 0 && ch[k] <= 1, k + '=' + ch[k]);
  }
});

// ============================================================== sight
test('a player in front is seen, at the right distance and on the right side', () => {
  const s = new SensorLayer();
  // facing +z, a right-handed Y-up world: the boss's right is -x
  const ws = s.sense(obs(0.1, [body('a', -10, 10)]));
  assert.strictEqual(ws.get('player_visible'), 1);
  near(ws.get('player_distance'), Math.hypot(10, 10), 1e-3, 'distance');
  near(ws.get('player_bearing'), Math.PI / 4, 1e-3, 'bearing (+ is right)');
  const ws2 = new SensorLayer().sense(obs(0.1, [body('a', 10, 10)]));
  near(ws2.get('player_bearing'), -Math.PI / 4, 1e-3, 'bearing (- is left)');
});

test('behind it and far, a player is not seen; behind it and close, they are', () => {
  const far = new SensorLayer().sense(obs(0.1, [body('a', 0, -40)]));
  assert.strictEqual(far.get('player_visible'), 0);
  assert.strictEqual(far.get('has_target'), 0, 'never seen or heard: nobody to attend to');
  const close = new SensorLayer().sense(obs(0.1, [body('a', 0, -8)]));
  assert.strictEqual(close.get('player_visible'), 1);
});

test('a wall blocks sight, and says so', () => {
  const s = new SensorLayer();
  s.sense(obs(0.1, [body('a', 0, 10)], { probe: WALL }));           // in front of the wall: seen
  const ws = s.sense(obs(0.2, [body('a', 0, 30)], { probe: WALL }));  // behind it
  assert.strictEqual(ws.get('player_visible'), 0);
  assert.strictEqual(ws.get('los_blocked'), 1);
  assert.ok(ws.get('player_cover') >= 0.6, 'broken line of sight is cover: ' + ws.get('player_cover'));
});

// ============================================================== §17 no wallhack
test('§17: behind a wall, the belief stops where it last knew — it does not follow', () => {
  const s = new SensorLayer();
  let t = 0;
  // walk from z=10 toward the wall at 5 m/s, in view
  for (let z = 10; z <= 18; z += 0.5) s.sense(obs(t += 0.1, [body('a', 0, z)], { probe: LONG_WALL }));
  // now slip behind the wall and run 60 m sideways, out of sight, for 12 s
  let x = 0;
  for (let i = 0; i < 120; i++) { x += 0.5; s.sense(obs(t += 0.1, [body('a', x, 24)], { probe: LONG_WALL })); }
  assert.strictEqual(s.ws.get('player_visible'), 0, 'the test is only meaningful if they stayed hidden');
  const b = s.beliefs().find((q) => q.id === 'a');
  assert.ok(b, 'still remembered');
  assert.ok(Math.abs(b.x) < 3, 'the belief followed them sideways to x=' + b.x + ' (truth x=' + x + ')');
  assert.ok(b.z < 26, 'the belief extrapolated only a little along the last velocity: z=' + b.z);
  const ws = s.ws;
  assert.ok(ws.get('player_confidence') < 0.2, 'confidence should have faded: ' + ws.get('player_confidence'));
  assert.ok(ws.get('time_since_seen') > 11, 'time since seen ' + ws.get('time_since_seen'));
});

test('§17: a shot heard from behind the wall puts it back near the shooter, not on them', () => {
  const s = new SensorLayer({ seed: 11 });
  s.sense(obs(0.1, [body('a', 0, 10)], { probe: WALL }));
  s.sense(obs(0.2, [body('a', 30, 60)], { probe: WALL }));
  const ev = [{ type: 'shot', by: 'a', x: 30, y: 0, z: 60 }];
  const ws = s.sense(obs(0.3, [body('a', 30, 60)], { probe: WALL, events: ev }));
  const b = s.beliefs().find((q) => q.id === 'a');
  const err = Math.hypot(b.x - 30, b.z - 60), d = Math.hypot(30, 60);
  assert.ok(err < d * 0.06 * 4, 'heard position error ' + err.toFixed(2) + ' m is more than 4 sigma');
  assert.ok(ws.get('player_attacking') > 0.8, 'a shot is an attack');
  assert.ok(ws.get('player_noise') > 0.4, 'and it was loud');
  assert.strictEqual(ws.get('player_visible'), 0);
});

test('§17: a shot too far away to hear teaches it nothing', () => {
  const s = new SensorLayer();
  const ws = s.sense(obs(0.1, [body('a', 0, -300)], { events: [{ type: 'shot', by: 'a', x: 0, y: 0, z: -300 }] }));
  assert.strictEqual(ws.get('has_target'), 0);
});

test('§17: a cloak hides at range and only shimmers up close', () => {
  const far = new SensorLayer().sense(obs(0.1, [body('a', 0, 30, { cloak: true })]));
  assert.strictEqual(far.get('player_visible'), 0);
  const close = new SensorLayer().sense(obs(0.1, [body('a', 0, 8, { cloak: true })]));
  near(close.get('player_visible'), 0.35, 1e-6, 'cloaked visibility');
});

test('§17: offering it the controls is an error in strict mode', () => {
  const s = new SensorLayer({ strict: true });
  for (const bad of [
    obs(0.1, [body('a', 0, 10)], { keys: { KeyW: true } }),
    obs(0.1, [body('a', 0, 10, { wantFire: true })]),
    obs(0.1, [body('a', 0, 10, { joystick: { x: 1 } })]),
    obs(0.1, [body('a', 0, 10)], { events: [{ type: 'shot', by: 'a', input: 'fire' }] }),
  ]) assert.throws(() => s.sense(bad), /player input/);
  assert.doesNotThrow(() => assertObservable(obs(0.1, [body('a', 0, 10)])));
});

test('§17: and outside strict mode, controls passed in change nothing at all', () => {
  const clean = new SensorLayer(), dirty = new SensorLayer();
  let t = 0;
  for (let i = 0; i < 40; i++) {
    t += 0.1;
    const z = 30 - i * 0.5, x = Math.sin(i * 0.3) * 4;
    const a = clean.sense(obs(t, [body('a', x, z)]));
    const b = dirty.sense(obs(t, [body('a', x, z, { wantFire: i % 3 === 0, keys: { KeyA: true }, aimYaw: 1.2 })],
                             { input: { fire: true }, joystick: { x: 1, y: 0 } }));
    assert.deepStrictEqual(Array.from(b.v), Array.from(a.v), 'tick ' + i);
  }
});

// ============================================================== motion
test('velocity is measured from what it saw: approaching and retreating', () => {
  const s = new SensorLayer();
  let t = 0, ws;
  for (let z = 60; z > 30; z -= 0.6) ws = s.sense(obs(t += 0.1, [body('a', 0, z)]));   // 6 m/s toward it
  near(ws.get('player_speed'), 6, 0.3, 'speed');
  near(ws.get('player_radial_speed'), -6, 0.3, 'radial');
  near(ws.get('player_approaching'), 6 / 10.2, 0.04, 'approaching');
  assert.strictEqual(ws.get('player_retreating'), 0);
  const r = new SensorLayer();
  for (let z = 30; z < 60; z += 0.6) ws = r.sense(obs(t += 0.1, [body('a', 0, z)]));
  near(ws.get('player_retreating'), 6 / 10.2, 0.04, 'retreating');
});

test('a sharp sideways reversal reads as a dodge; running straight does not', () => {
  const s = new SensorLayer();
  let t = 0, x = 0, ws;
  for (let i = 0; i < 20; i++) { x += 0.6; ws = s.sense(obs(t += 0.1, [body('a', x, 25)])); }
  assert.ok(ws.get('player_dodging') < 0.05, 'straight run flagged as dodge: ' + ws.get('player_dodging'));
  for (let i = 0; i < 2; i++) { x -= 0.7; ws = s.sense(obs(t += 0.1, [body('a', x, 25)])); }
  assert.ok(ws.get('player_dodging') > 0.6, 'reversal not flagged: ' + ws.get('player_dodging'));
});

test('facing: turned toward it reads 1, turned away reads 0', () => {
  const to = new SensorLayer().sense(obs(0.1, [body('a', 0, 20, { fx: 0, fz: -1 })]));
  near(to.get('player_facing_me'), 1, 1e-6, 'facing');
  const away = new SensorLayer().sense(obs(0.1, [body('a', 0, 20, { fx: 0, fz: 1 })]));
  assert.strictEqual(away.get('player_facing_me'), 0);
});

// ============================================================== events
test('damage taken is summed over 3 s as a share of its health, then forgotten', () => {
  const s = new SensorLayer();
  s.sense(obs(1.0, [body('a', 0, 20)], { events: [{ type: 'hit', victim: 'self', by: 'a', dmg: 40 }] }));
  let ws = s.sense(obs(1.5, [body('a', 0, 20)], { events: [{ type: 'hit', victim: 'self', by: 'a', dmg: 60 }] }));
  near(ws.get('damage_taken_recent'), 100 / 1000, 1e-6, 'recent damage');
  near(ws.get('time_since_damaged'), 0, 1e-6);
  assert.ok(ws.get('threat') > 0.3, 'being hurt is threatening');
  ws = s.sense(obs(5.0, [body('a', 0, 20)]));
  assert.strictEqual(ws.get('damage_taken_recent'), 0);
  near(ws.get('time_since_damaged'), 3.5, 1e-4);
});

// ============================================================== several players
test('it attends to the nearer player, but one who is hurting it takes over', () => {
  const s = new SensorLayer();
  let ws = s.sense(obs(0.1, [body('near', 0, 15), body('far', 20, 70)]));
  assert.strictEqual(s.target.id, 'near');
  const hits = [];
  for (let i = 0; i < 6; i++) hits.push({ type: 'hit', victim: 'self', by: 'far', dmg: 20 });
  ws = s.sense(obs(0.2, [body('near', 0, 15), body('far', 20, 70)], { events: hits }));
  assert.strictEqual(s.target.id, 'far');
  near(ws.get('player_distance'), Math.hypot(20, 70), 1e-3);
});

test('a slightly better candidate does not make it flip back and forth', () => {
  const s = new SensorLayer();
  let t = 0, flips = 0, last = null;
  for (let i = 0; i < 100; i++) {
    // two players at almost the same distance, swapping who is nearer
    const w = Math.sin(i * 0.7) * 0.8;
    s.sense(obs(t += 0.1, [body('a', -6, 20 + w), body('b', 6, 20 - w)]));
    if (last && s.target.id !== last) flips++;
    last = s.target.id;
  }
  assert.ok(flips <= 1, 'flipped ' + flips + ' times');
});

test('the dead and the other side of the tear are not there', () => {
  const s = new SensorLayer();
  const ws = s.sense(obs(0.1, [body('d', 0, 10, { dead: true }), body('b', 0, 12, { world: 1 })]));
  assert.strictEqual(ws.get('has_target'), 0);
  assert.strictEqual(ws.get('players_known'), 0);
});

// ============================================================== the ray budget (D8)
test('D8: however many players are in view, a tick casts at most 1 + quota sight rays', () => {
  let rays = 0;
  const counted = (...a) => { rays++; return OPEN(...a); };
  const s = new SensorLayer();
  const crowd = []; for (let i = 0; i < 8; i++) crowd.push(body('p' + i, (i - 4) * 5, 25 + i));
  let t = 0, worst = 0;
  for (let k = 0; k < 30; k++) {
    rays = 0;
    s.sense(obs(t += 0.1, crowd, { probe: counted, solid: () => false }));
    worst = Math.max(worst, rays);
  }
  assert.ok(worst <= 1 + s.o.losQuota, 'a tick cast ' + worst + ' rays');
  assert.strictEqual(s.ws.get('players_known'), 8, 'and everyone still gets looked at in turn');
});

test('D8: with solid() available, cover costs no rays at all', () => {
  let rays = 0;
  const counted = (...a) => { rays++; return OPEN(...a); };
  const s = new SensorLayer();
  let t = 0;
  for (let k = 0; k < 16; k++) s.sense(obs(t += 0.1, [body('a', 0, 20)], { probe: counted, solid: (x, y, z) => x > 1 && x < 3 }));
  assert.strictEqual(rays, 16, 'one sight ray per tick and nothing else, got ' + rays);
  assert.ok(s.ws.get('player_cover') > 0 && s.ws.get('self_cover') > 0, 'the wall at x=1..3 is found around both');
});

test('§17 under the budget: a player not looked at this tick is not moved by the truth', () => {
  const s = new SensorLayer();
  let t = 0;
  s.sense(obs(t += 0.1, [body('main', 0, 12), body('other', 8, 30)]));   // first look at both
  s.o.losQuota = 0; s.o.losEvery = 99;                                    // then nobody but the target
  const before = s.beliefs().find((q) => q.id === 'other');
  for (let k = 0; k < 10; k++) s.sense(obs(t += 0.1, [body('main', 0, 12), body('other', 8 + k * 3, 30)]));
  const after = s.beliefs().find((q) => q.id === 'other');
  assert.strictEqual(s.target.id, 'main');
  assert.strictEqual(after.x, before.x, 'moved from ' + before.x + ' to ' + after.x + ' without being looked at');
});

// ============================================================== robustness
test('garbage observations still give a valid WorldState', () => {
  const s = new SensorLayer();
  const junk = [
    { t: NaN },
    { t: 1, self: { x: NaN, hp: 'x' }, bodies: [null, { id: 'q', x: Infinity, z: NaN }], events: [null, { type: 'hit' }] },
    { t: 2, self: null, bodies: [{ id: 'q', x: 1e12, z: -1e12, hp: -5 }] },
    { t: 3, bodies: [{ id: 0, x: 5, z: 5 }], probe: () => NaN },
    {},
  ];
  for (const o of junk) assert.deepStrictEqual(validate(s.sense(o)), [], JSON.stringify(o));
});

test('deterministic: the same observations give the same states, bit for bit', () => {
  const run = () => {
    const s = new SensorLayer({ seed: 5 }), out = [];
    let t = 0;
    for (let i = 0; i < 80; i++) {
      t += 0.1;
      const ev = i % 9 === 0 ? [{ type: 'shot', by: 'a', x: 40, y: 0, z: 50 }] : [];
      out.push(...s.sense(obs(t, [body('a', 40 + Math.sin(i) * 3, 50)], { probe: WALL, events: ev })).v);
    }
    return out;
  };
  assert.deepStrictEqual(run(), run());
});

// ============================================================== the adapter
function fakeGame() {
  const peers = new Map();
  peers.set('p2', { cur: { x: 5, y: 0, z: 30 }, yaw: Math.PI, hp: 70, dead: false, inv: false, w: 0 });
  peers.set('p3', { cur: { x: -8, y: 3.5, z: 12 }, yaw: 0, hp: 100, dead: false, inv: true, w: 0 });
  let T = 0, rays = 0;
  const G = {
    now: () => T, p: { x: 0, y: 1.68, z: 20 }, EYE: 1.68, yaw: () => Math.PI, hp: () => 90, HP_MAX: 100,
    dead: () => false, cloak: () => false, world: () => 0,
    MP: { id: 'p1', peers },
    rayCity: (ro, rd) => { rays++; return Infinity; },
  };
  return { G, tick: (dt) => { T += dt; }, rays: () => rays };
}
function deepFreeze(o, seen = new Set()) {
  if (!o || typeof o !== 'object' || seen.has(o)) return o;
  seen.add(o);
  if (o instanceof Map) { for (const v of o.values()) deepFreeze(v, seen); }
  else for (const k of Object.keys(o)) deepFreeze(o[k], seen);
  return Object.freeze(o);
}

test('adapter: reads a frozen game without writing to it', () => {
  'use strict';
  const { G, tick } = fakeGame();
  deepFreeze(G);                          // a write would throw under 'use strict'
  const A = makeGameAdapter(G), s = new SensorLayer({ strict: true });
  const boss = { x: 0, y: 0, z: 0, hd: 0, hp: 5000, hpMax: 5000, world: 0 };
  for (let i = 0; i < 50; i++) {
    tick(0.1);
    if (i % 7 === 0) A.noteShot('p2', 5, 1, 30);
    const o = A.observe(boss, 0);
    assert.strictEqual(o.bodies.length, 3);
    s.sense(o); A.drain();
  }
  assert.strictEqual(s.ws.get('players_known'), 3 - 1, 'the cloaked one at 14 m is not made out');
});

test('adapter: never touches Math.random', () => {
  const { G, tick } = fakeGame();
  const A = makeGameAdapter(G), s = new SensorLayer();
  const real = Math.random; let calls = 0;
  Math.random = () => { calls++; return real(); };
  try {
    for (let i = 0; i < 50; i++) { tick(0.1); A.noteShot('p2', 5, 1, 30); s.sense(A.observe({ x: 0, y: 0, z: 0, hd: 0, hp: 1, hpMax: 1 }, 0)); A.drain(); }
  } finally { Math.random = real; }
  assert.strictEqual(calls, 0);
});

test('adapter: the local player is reported as others see them — feet, facing, HP bar', () => {
  const { G } = fakeGame();
  const o = makeGameAdapter(G).observe({ x: 0, y: 0, z: 0, hd: 0 }, 0);
  const me = o.bodies[0];
  assert.strictEqual(me.id, 'p1');
  near(me.y, 0, 1e-9, 'feet, not eyes');
  near(me.fz, 1, 1e-9, 'yaw π looks down +z, toward… '); near(me.fx, 0, 1e-9);
  assert.strictEqual(me.hp, 90);
  for (const k of Object.keys(me)) assert.ok(!/key|input|joy|touch|want|aim/i.test(k), 'input-like field ' + k);
});

test('adapter: no per-tick allocation of bodies or events; overflow is counted, not thrown', () => {
  const { G, tick } = fakeGame();
  const A = makeGameAdapter(G);
  const o1 = A.observe({ x: 0, y: 0, z: 0, hd: 0 }, 0);
  const ids = o1.bodies.slice();
  for (let i = 0; i < 100; i++) A.noteShot('p2', 0, 0, 0);
  tick(0.1);
  const o2 = A.observe({ x: 0, y: 0, z: 0, hd: 0 }, 0);
  assert.strictEqual(o2, o1, 'the observation object is reused');
  for (let i = 0; i < ids.length; i++) assert.strictEqual(o2.bodies[i], ids[i], 'body ' + i + ' was reallocated');
  assert.strictEqual(o2.events.length, 64);
  assert.strictEqual(A.stats().dropped, 36);
  A.drain();
  assert.strictEqual(A.observe({ x: 0, y: 0, z: 0, hd: 0 }, 0).events.length, 0);
});

// ============================================================== into the core
test('end to end: sensor -> channels -> Neural Core tells an ambush from a duel', () => {
  const g = C.hybrid(buildMockConnectome({ nodes: 2000, seed: 0x5eed }), 500);
  const run = (make) => {
    const s = new SensorLayer({ seed: 3 }), core = new NeuralCore(g, { seed: 0xbeef });
    const ch = {};
    let t = 0;
    for (let i = 0; i < 80; i++) { t += 0.1; core.step(toChannels(s.sense(make(t, i)), ch), 0.1); }
    return core.readout();
  };
  // a player hiding behind a wall, heard once
  const hidden = run((t, i) => obs(t, [body('a', 10, 45)], { probe: WALL,
    events: i === 5 ? [{ type: 'shot', by: 'a', x: 10, y: 0, z: 45 }] : [] }));
  // a player in the open, close, facing it and shooting, while it takes damage
  const duel = run((t, i) => obs(t, [body('a', Math.sin(i * 0.4) * 3, 9)], {
    events: [{ type: 'shot', by: 'a', x: 0, y: 0, z: 9 }].concat(i % 4 === 0 ? [{ type: 'hit', victim: 'self', by: 'a', dmg: 25 }] : []) }));
  let l1 = 0;
  for (const a of ACTIONS) {
    assert.ok(Number.isFinite(duel.scores[a]) && Number.isFinite(hidden.scores[a]), a + ' not finite');
    l1 += Math.abs(duel.scores[a] - hidden.scores[a]);
  }
  // Phase 2's own discrimination benchmark rates 0.12+ as "separated"
  assert.ok(l1 > 0.12, 'the two situations are barely distinguishable: L1=' + l1.toFixed(4));
});

console.log('\nPHASE 3 — WorldState / Sensor Layer / Game Adapter\n');
console.log(results.join('\n'));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
