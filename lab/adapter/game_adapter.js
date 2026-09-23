'use strict';
//  ============================================================
//  GAME ADAPTER — the read side  (spec §4 game_adapter/state_adapter, §12)
//  ============================================================
//
//  The one piece of the Neural Core that knows the engine exists. It turns
//  the game's own objects — `p`, `MP.peers`, `rayCity` — into the plain
//  observation the Sensor Layer reads, and it is the only file allowed to.
//  Everything above the sensor sees numbers.
//
//  Three promises, each of which the Phase 3 tests check against the real
//  game rather than take on trust:
//
//    read-only    it never writes to a game object. Observing the world must
//                 not change it; the existing mobs have to behave exactly as
//                 they did before this existed.
//    no dice      it never calls Math.random. The game's randomness is one
//                 shared stream; an observer that drew from it would shift
//                 every roll the mobs make after it.
//    no inputs    it reads where a player stands and which way their avatar
//                 faces — what anyone looking at them would see — and never
//                 the keys, the stick or the fire button (§17).
//
//  It also allocates nothing per tick: the observation, its bodies and its
//  event ring are built once and refilled (D8).
//
//  `G` is a handle the host builds from its own closures. In the lab tests it
//  comes from the test page's hooks; in Phase 7 the inlined block builds it
//  from the variables it sits next to. Fields read:
//
//    G.now()            game seconds (cityT)
//    G.p, G.EYE         the local player's eye position, and its height
//    G.yaw()            the local avatar's facing (same convention as peers)
//    G.hp(), G.HP_MAX   the local player's health, as their HP bar shows it
//    G.dead(), G.cloak(), G.world()
//    G.MP               .id and .peers (cur, yaw, hp, dead, inv, w)
//    G.rayCity(ro, rd, max)  (max: nothing past it matters), and optionally
//                       G.rayWrecks, G.WS_BACK
//    G.clearAt(x, z, m) the game's footprint lookup, for "a wall close by"
//    G.Vec3             a constructor for the ray origin/direction (THREE.Vector3)

const EVENTS = 64;

function makeGameAdapter(G) {
  const ro = G.Vec3 ? new G.Vec3() : { x: 0, y: 0, z: 0 };
  const rd = G.Vec3 ? new G.Vec3() : { x: 0, y: 0, z: 0 };
  const bodies = [];
  const pool = [];
  const evPool = [];
  for (let i = 0; i < EVENTS; i++) evPool.push({ type: '', by: null, victim: null, x: 0, y: 0, z: 0, dmg: 0, hpMax: 100, t: 0 });
  const events = [];
  let evN = 0, dropped = 0;
  let selfWorld = 0;

  function body(i) {
    let b = pool[i];
    if (!b) { b = { id: null, x: 0, y: 0, z: 0, fx: 0, fz: 1, hp: 0, hpMax: 100, dead: false, cloak: false, world: 0 }; pool[i] = b; }
    return b;
  }

  //  A ray into the city. Distances past `max` do not matter to anyone
  //  asking, so the answer is capped rather than computed further.
  function probe(ox, oy, oz, dx, dy, dz, max) {
    ro.x = ox; ro.y = oy; ro.z = oz; rd.x = dx; rd.y = dy; rd.z = dz;
    let d = G.rayCity(ro, rd, max);
    if (G.rayWrecks && selfWorld === G.WS_BACK) d = Math.min(d, G.rayWrecks(ro, rd));
    return d < max ? d : Infinity;
  }

  //  Inside a building's footprint? Height is not considered: a player on an
  //  upper floor is inside one, and that is cover.
  function solid(x, y, z) { return !G.clearAt(x, z, 0.15); }

  const obs = { t: 0, self: null, bodies, events, allies: 0, probe, solid: G.clearAt ? solid : null };

  // one function for every peer, made once — a for-of over the Map would
  // build an [id, peer] pair per player per tick
  let fillN = 0;
  function fillPeer(peer, id) {
    const b = body(fillN++);
    const yaw = peer.yaw || 0;
    b.id = id; b.x = peer.cur.x; b.y = peer.cur.y; b.z = peer.cur.z;
    b.fx = -Math.sin(yaw); b.fz = -Math.cos(yaw);
    b.hp = peer.hp; b.hpMax = 100; b.dead = !!peer.dead; b.cloak = !!peer.inv;
    b.world = peer.w === undefined ? 0 : peer.w | 0;
  }

  function push(type, by, victim, x, y, z, dmg, hpMax) {
    if (evN >= EVENTS) { dropped++; return; }   // a burst bigger than the ring drops what does not fit, never the frame
    const e = evPool[evN++];
    e.type = type; e.by = by; e.victim = victim; e.x = x; e.y = y; e.z = z;
    e.dmg = dmg; e.hpMax = hpMax; e.t = G.now();
  }

  return {
    //  Called by the host where the game already knows these things happened.
    //  Each is something the boss could have seen or heard: a muzzle flash
    //  and a bang, a round striking it, its own blade connecting.
    noteShot(by, x, y, z) { push('shot', by, null, x, y, z, 0, 100); },
    noteHit(victim, by, dmg, hpMax) { push('hit', by, victim, 0, 0, 0, dmg, hpMax || 100); },
    noteSwing() { push('swing', 'self', null, 0, 0, 0, 0, 100); },

    //  `self` is the boss's own body as a plain record — the boss module owns
    //  it, so reading it is not reaching into the engine.
    observe(self, allies) {
      selfWorld = self ? self.world | 0 : 0;
      obs.t = G.now();
      obs.self = self;
      obs.allies = allies | 0;
      let n = 0;
      // the local player, as the others see them: feet, facing, HP bar
      if (G.MP && G.p) {
        const b = body(n++);
        const yaw = G.yaw();
        b.id = G.MP.id; b.x = G.p.x; b.y = G.p.y - G.EYE; b.z = G.p.z;
        b.fx = -Math.sin(yaw); b.fz = -Math.cos(yaw);
        b.hp = G.hp(); b.hpMax = G.HP_MAX; b.dead = !!G.dead(); b.cloak = !!G.cloak(); b.world = G.world() | 0;
      }
      fillN = n;
      if (G.MP && G.MP.peers) G.MP.peers.forEach(fillPeer);
      n = fillN;
      bodies.length = n;
      for (let i = 0; i < n; i++) bodies[i] = pool[i];
      events.length = evN;
      for (let i = 0; i < evN; i++) events[i] = evPool[i];
      return obs;
    },
    //  The sensor has read this tick's events; start the next batch.
    drain() { evN = 0; events.length = 0; },
    stats() { return { pending: evN, dropped }; },
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { makeGameAdapter, EVENTS };
