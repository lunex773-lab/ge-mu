'use strict';
//  ============================================================
//  CONTOUR — the other side's demodogs  (shared)
//  ============================================================
//  What the dogs think and how they move: a player's game runs them while
//  alone (or hosting a room that does not), and with two or more in a room
//  the room server runs them (server/dogs.js) with this same code. Nothing
//  here draws or makes a sound — the game poses and draws a dog from the
//  fields this moves, and hears it through the hooks (env.on).
//
//  These have to read as animals that have noticed something dangerous and
//  would rather not die, so nothing here runs at you in a straight line. One
//  that sees you closes to a distance it likes, waits for a second, bites
//  once and leaves. Hurt it and it will usually break off and put a wreck
//  between the two of you. Corner it and it screams, and then there are more
//  of them. The district is stocked, not spawned-around-you: NDOG bodies live
//  across the whole map at once and simply exist where they are, whether or
//  not anyone is near.
//
//  The world a pack lives in comes through env:
//    now()                      the clock (s)
//    random()                   the dice (the game's Math.random, called at
//                               the time — so a seeded one is seen)
//    targets()                  who they hunt: [{ x, z, y (feet), ey (eyes),
//                               dead, cloak, fx, fz (the way they face) }] —
//                               the game's one player, or the room's players
//                               on this side of the tear
//    clearAt, supportHeight, collide, bldAt, navNext, rayCity(ro, rd, max),
//    wrecks()                   the city (shared/city.js ground, wrecks.js)
//    master(tag, slot)          the flayer ('mf', slot) or VECNA ('vec') a dog
//                               is sworn to, if it stands: { x, y, z, hd, sp }
//    gorgons(), vec()           the big ones, to keep out of the way of
//    bite(d)                    a bite has landed on whoever is in reach
//    on: { call, hurt, death, gone, share }   (sounds, the body, the flayer's link)

const CITY = require('./city.js');
const TR = require('./troop.js');
const WR = require('./wrecks.js');
const RULES = require('./rules.js');

const NDOG = 48;
const DOG_HP = 92;
const D_VIS = 30, D_VIS_COS = Math.cos(1.15), D_PERIPH = 7.5;   // sight: 30 m, ±66°, plus a close bubble
const D_HEAR = 46;                     // and ears that reach further than the eyes
const D_CALL_R = 50, D_CALL_MAX = 4, D_CALL_CD = 14;
const D_BITE_R = 2.25, D_BITE_DMG = 9;
const D_LIKED = 7.5;                   // the standoff distance one prefers to hold
const D_SEP = 3.6;                     // how much room each one insists on having
const D_KEEP = 34;                     // never spawned this close to anyone
const D_RISE_T = 1.7;                  // s climbing out of the ground
const WORLD = RULES.WORLD;
const D_ROAM = WORLD * 0.44;
//  what the dogs' masters are to them (index.html's flayers and VECNA)
const MF_TAKE = 58, V_TAKE = 96;       // near enough to be claimed
const LEASH = 1.55;                    // and how far it may then get before it is loose again
const V_CLEAR = 26;                    // nothing of VECNA's stands inside this
const MF_LINK = 74;                    // how far a flayer's command reaches (and a wound bleeds up to it)
const RETINUE = { mf: 3, vec: 6 };     // how many dogs a flayer, and VECNA, keep about them
//  a dog's state, as a snapshot numbers it (index 1…)
const D_ST = ['idle', 'wander', 'investigate', 'alert', 'chase', 'attack',
              'reposition', 'observe', 'retreat', 'hide', 'call', 'flee', 'escort'];

function makeDogs(env) {
  return { env, dogs: [], packs: [], noises: [], spawnCd: 0, repack: 0, roles: 0, holdSpawn: false };
}

// ---- hearing ------------------------------------------------------
//  A short ring of noise events. Gunfire carries the whole way, a sprint
//  carries about a third of it, and a scream is heard by other dogs only.
function noise(D, x, z, intensity, type) {
  D.noises.push({ x, z, i: intensity, type, t: D.env.now() });
  if (D.noises.length > 24) D.noises.shift();
}

// ---- the pack -----------------------------------------------------
function newPack(D) {
  const pk = { id: D.packs.length, members: [], leader: -1, alert: 0,
               tx: 0, tz: 0, tT: -99, threat: 0, roles: 0 };
  D.packs.push(pk); return pk;
}

// ---- spawning -----------------------------------------------------
//  Anywhere in the district. They are not spawned around the player and
//  deleted behind them — the whole map is stocked, and one two hundred metres
//  away is as real as the one in front of you: it walks its own streets, and
//  it will come if it hears something. The only rule about the players is
//  negative: never within D_KEEP of them, so nothing ever appears in a lap.
function spawnSpot(D) {
  const E = D.env, rnd = E.random, dogs = D.dogs, wrecks = E.wrecks(), who = E.targets();
  let best = null, bestS = -1;
  for (let i = 0; i < 60; i++) {
    const x = (rnd() * 2 - 1) * WORLD * 0.44, z = (rnd() * 2 - 1) * WORLD * 0.44;
    if (!E.clearAt(x, z, 1.1)) continue;
    let s = 6, keep = false;
    for (const t of who) {
      const dx = x - t.x, dz = z - t.z, d = Math.hypot(dx, dz) || 1;
      if (d < D_KEEP) { keep = true; break; }
      if (d < 120) {                       // close enough to see arrive: keep it out of shot
        const facing = (dx / d) * t.fx + (dz / d) * t.fz;
        if (facing > 0) s -= facing * 14;  // a penalty only — never a bonus for being near
      }
    }
    if (keep) continue;
    const bi = Math.round(x / CITY.PITCH), bj = Math.round(z / CITY.PITCH);
    const offRoad = Math.min(Math.abs(x - bi * CITY.PITCH), Math.abs(z - bj * CITY.PITCH));
    if (offRoad > CITY.RW + CITY.SWW) s += 7;                 // off the carriageway: an alley or a yard
    for (let w = 0; w < wrecks.length; w += 7) {              // near dead traffic
      const wr = wrecks[w]; if (!wr) continue;
      if (Math.abs(wr.x - x) < 9 && Math.abs(wr.z - z) < 9) { s += 5; break; }
    }
    //  Elbow room, and it is what actually spreads them. Every other term here
    //  is about the *kind* of place a demodog likes, and liking the same kinds
    //  of place is exactly how forty-eight of them end up in the same third of
    //  the map. This one asks a different question — is anything already out
    //  there? — and it is worth more than all the flavour combined, so an
    //  empty quarter of the district always outbids a good corner of a full one.
    let nearest = 1e9;
    for (const o of dogs) {
      if (!o.live || o.dead) continue;
      const q = Math.hypot(o.x - x, o.z - z);
      if (q < nearest) { nearest = q; if (nearest < 12) break; }
    }
    if (nearest < 1e8) s += Math.min(nearest, 150) * 0.18;    // up to +27, dwarfing the rest
    s += rnd() * 4;
    if (s > bestS) { bestS = s; best = { x, z }; }
  }
  return best;
}
function spawnDog(D) {
  const E = D.env, rnd = E.random, dogs = D.dogs;
  let d = dogs.find((o) => !o.live);
  if (!d && dogs.length >= NDOG) return null;
  const spot = spawnSpot(D); if (!spot) return null;
  if (!d) {
    d = { slot: dogs.length, live: false, S: {} };
    dogs.push(d);
  }
  let pk = D.packs.find((k) => k.members.length < 5 &&
    k.members.some((m) => dogs[m].live && Math.hypot(dogs[m].x - spot.x, dogs[m].z - spot.z) < 34));
  if (!pk) pk = newPack(D);
  if (!pk.members.includes(d.slot)) pk.members.push(d.slot);
  d.spawnD = nearestTo(E.targets(), spot.x, spot.z).d;
  Object.assign(d, {
    live: true, x: spot.x, z: spot.z, y: E.supportHeight(spot.x, spot.z, 1) , hd: rnd() * 6.2832,
    sp: 0, vx: 0, vz: 0, hp: DOG_HP, pack: pk.id, role: 'watch',
    st: 'wander', stT: 0, gaitPh: rnd(), gait: 'walk', lean: 0,
    maw: 0, headYaw: 0, headPitch: 0, tailUp: 0, crouch: 0, lunge: 0, stagger: 0,
    atkCd: 0, callCd: rnd() * 6, deadT: 0, dead: false,
    see: 0, seeT: -99, tx: 0, tz: 0, tdist: 999, hasT: false,
    wx: spot.x, wz: spot.z, wanderT: 0, strafe: rnd() < 0.5 ? 1 : -1,
    hideX: 0, hideZ: 0, hasHide: false, stepPh: rnd(), breath: rnd() * 6,
    netX: spot.x, netZ: spot.z, netH: 0, rx: spot.x, rz: spot.z, hpHold: 0, lod: 0,
    lord: null, lordSlot: -1, lordFar: 0, taint: 0, rise: 1, riseY: 0,
  });
  return d;
}
function despawnDog(D, d) {
  d.live = false; d.dead = false; d.hp = 0; d.lord = null;
  D.env.on.gone(d);
  const pk = D.packs[d.pack];
  if (pk) { const i = pk.members.indexOf(d.slot); if (i >= 0) pk.members.splice(i, 1); }
}
function clearDogs(D) { for (const d of D.dogs) if (d.live) despawnDog(D, d); D.noises.length = 0; }
//  the nearest of the targets to a point (t: null when there are none)
function nearestTo(who, x, z) {
  let t = null, d = Infinity;
  for (const q of who) { const e = Math.hypot(q.x - x, q.z - z); if (e < d) { d = e; t = q; } }
  return { t, d };
}

// ---- perception ---------------------------------------------------
//  Who it can see, and how well: the best seen of the targets. Whether it
//  sees anyone or not, d.tdist and d.ty are then the distance to, and the
//  floor of, the one it is looking at — or the nearest, if none.
const _eye = { x: 0, y: 0, z: 0 }, _dir = { x: 0, y: 0, z: 0 };
function see(D, d) {
  const E = D.env, who = E.targets();
  let best = 0, bt = null, nd = Infinity, nt = null;
  const fx = Math.sin(d.hd), fz = Math.cos(d.hd);
  for (let i = 0; i < who.length; i++) {
    const t = who[i];
    const dx = t.x - d.x, dz = t.z - d.z, dist = Math.hypot(dx, dz);
    if (dist < nd) { nd = dist; nt = t; }
    if (t.dead || dist > D_VIS) continue;
    const dotf = dist > 0.01 ? (dx / dist) * fx + (dz / dist) * fz : 1;
    if (dotf < D_VIS_COS && dist > D_PERIPH) continue;
    _eye.x = d.x; _eye.y = d.y + 0.95; _eye.z = d.z;
    _dir.x = t.x - _eye.x; _dir.y = (t.ey - 0.4) - _eye.y; _dir.z = t.z - _eye.z;
    const len = Math.sqrt(_dir.x * _dir.x + _dir.y * _dir.y + _dir.z * _dir.z), inv = 1 / len;   // (three.js's length() and multiplyScalar, to the last bit)
    _dir.x *= inv; _dir.y *= inv; _dir.z *= inv;
    if (Math.min(E.rayCity(_eye, _dir, len), WR.ray(E.wrecks(), _eye, _dir)) < len - 0.6) continue;
    // cloak: seen late and only close in — they hunt by more than sight
    const cl = t.cloak ? 0.35 : 1;
    const s = Math.max(0, 1 - dist / D_VIS) * cl + (dist < 4 ? 0.5 : 0);
    if (s > best) { best = s; bt = t; }
  }
  const on = bt || nt;
  if (on) { d.tdist = Math.hypot(on.x - d.x, on.z - d.z); d.ty = on.y; d.tgt = bt; }
  return best;
}
function hear(D, d) {
  const now = D.env.now();
  let best = null, bestI = 0;
  for (let i = D.noises.length - 1; i >= 0; i--) {
    const n = D.noises[i];
    if (now - n.t > 6) continue;
    const dist = Math.hypot(n.x - d.x, n.z - d.z);
    const reach = D_HEAR * n.i;
    if (dist > reach) continue;
    const s = n.i * (1 - dist / Math.max(1, reach));
    if (s > bestI) { bestI = s; best = n; }
  }
  return best ? { n: best, s: bestI } : null;
}

// ---- cover --------------------------------------------------------
//  A wreck you can get behind, chosen for being out of the player's sight
//  while still leaving a way back in. Cheap: a strided scan, not a search.
function cover(D, d, fx, fz) {
  const E = D.env, wrecks = E.wrecks();
  let best = null, bestS = -1;
  for (let i = 0; i < wrecks.length; i += 2) {
    const w = wrecks[i]; if (!w) continue;
    const dw = Math.hypot(w.x - d.x, w.z - d.z);
    if (dw > 30) continue;
    const bx = w.x - fx * 3.0, bz = w.z - fz * 3.0;          // the far side from the threat
    if (!E.clearAt(bx, bz, 0.9)) continue;
    const s = 22 - dw * 0.55 - Math.abs(Math.hypot(bx - fx * 0, bz - fz * 0) * 0) + E.random() * 4;
    if (s > bestS) { bestS = s; best = { x: bx, z: bz }; }
  }
  return best;
}

// ---- movement -----------------------------------------------------
//  Steer toward a point, slide off walls and wrecks, and keep out of each
//  other's way with a soft separation push so a pack never stacks up.
const _pos = { x: 0, y: 0, z: 0 };
function step(D, d, tx, tz, speed, dt, sep, ty) {
  const E = D.env;
  //  Route round the architecture rather than into it. The waypoint replaces
  //  the destination only while one is needed; the moment the way is clear
  //  navNext returns null and it goes back to walking straight at you.
  //  ty is whose floor the destination is on, and it is not always the
  //  target's: an escort is walking to a spot beside its master, so routing
  //  it up the stairs because *you* are on the fifth is exactly wrong.
  const wpt = E.navNext(d.x, d.z, d.y, tx, tz, ty === undefined ? d.ty : ty);
  if (wpt) { tx = wpt.x; tz = wpt.z; }
  const dx = tx - d.x, dz = tz - d.z, dd = Math.hypot(dx, dz);
  let ux = dd > 0.01 ? dx / dd : Math.sin(d.hd), uz = dd > 0.01 ? dz / dd : Math.cos(d.hd);
  if (sep !== false && !d.inB) {
    //  Everything nearby pushes, not just packmates. Indoors it is switched
    //  off entirely: a stair run is two metres wide, and a crowd force that
    //  reads the room as open ground would walk them off the side of it.
    //  They queue on the steps instead, which is what a corridor is for.
    //  (Pushing only within a pack stacks twenty dogs arriving together into
    //  four perfectly spaced packs, each blind to the other three: a wall.)
    let sx = 0, sz = 0;
    for (const o of D.dogs) {
      if (o === d || !o.live || o.dead) continue;
      const ex = d.x - o.x, ez = d.z - o.z;
      if (ex > D_SEP || ex < -D_SEP || ez > D_SEP || ez < -D_SEP) continue;   // cheap reject first
      const e2 = ex * ex + ez * ez;
      if (e2 < D_SEP * D_SEP && e2 > 1e-4) {
        const e = Math.sqrt(e2), w = 1 - e / D_SEP;
        sx += ex / e * w * w; sz += ez / e * w * w;                            // firmer the closer it is
      }
    }
    for (const o of E.gorgons()) {                // and they do not stand in the big one's way either
      if (!o.live || o.dead) continue;
      const ex = d.x - o.x, ez = d.z - o.z, e2 = ex * ex + ez * ez;
      if (e2 < 30 && e2 > 1e-4) { const e = Math.sqrt(e2), w = 1 - e / 5.5; sx += ex / e * w * 2.2; sz += ez / e * w * 2.2; }
    }
    //  and they get well out of the king's way. He does not fight alongside
    //  vermin — he stands in a clear ring and lets the street come to him,
    //  which is also the only reason the fight against him is legible: a
    //  boss you cannot see past is not a boss, it is a crowd.
    const vec = E.vec();
    if (vec && vec.live && !vec.dead) {
      const ex = d.x - vec.x, ez = d.z - vec.z, e2 = ex * ex + ez * ez;
      if (e2 < V_CLEAR * V_CLEAR && e2 > 1e-4) {
        const e = Math.sqrt(e2), w = 1 - e / V_CLEAR;
        sx += ex / e * w * 3.4; sz += ez / e * w * 3.4;
      }
    }
    ux += sx * 2.6; uz += sz * 2.6;
    const un = Math.hypot(ux, uz) || 1; ux /= un; uz /= un;
  }
  //  Pressing into geometry that is not going to move. Rather than grind
  //  there forever, lean along the surface — each animal picks a consistent
  //  side, so a pair at the same corner peel off in opposite directions
  //  instead of both shuffling into the same brick.
  if (d.stuck > 0.5) {
    const sd2 = (d.slot & 1) ? 1 : -1, ca = Math.cos(1.15 * sd2), sa = Math.sin(1.15 * sd2);
    const rx2 = ux * ca - uz * sa, rz2 = ux * sa + uz * ca;
    ux = rx2; uz = rz2;
  }
  const want = Math.atan2(ux, uz);
  const turn = TR.easeHeading(d, want, dt, 5.5, d.st === 'chase' || d.st === 'attack' ? 4.2 : 2.6);
  d.lean += (-turn * 0.055 - d.lean) * Math.min(1, dt * 8);
  //  Substepped, because a charging demodog covers 0.31 m in a frame and the
  //  wall it is charging through is 0.32 m thick. The cap scales with the
  //  step, so a far one thinking a second at a time (the LOD) still moves in
  //  substeps near 0.3 m — about a third of the near band's cost per second.
  const bx0 = d.x, bz0 = d.z;
  const full = speed * dt;
  const steps = Math.min(4 + Math.floor(dt * 24), 1 + Math.floor(full / 0.22));
  const sx2 = Math.sin(d.hd) * (full / steps), sz2 = Math.cos(d.hd) * (full / steps);
  const wrecks = E.wrecks();
  for (let q = 0; q < steps; q++) {
    _pos.x = d.x + sx2; _pos.y = d.y; _pos.z = d.z + sz2;
    E.collide(_pos, d.y + 0.05, d.y + 0.95, 0.42);
    WR.collide(wrecks, _pos, 0.42);
    if (Math.abs(_pos.x) < WORLD * 0.48 && Math.abs(_pos.z) < WORLD * 0.48) { d.x = _pos.x; d.z = _pos.z; }
  }
  d.sp = dt > 1e-5 ? Math.hypot(d.x - bx0, d.z - bz0) / dt : 0;
  //  wanted to move, did not: something is in the way and pushing harder at
  //  it will not help
  d.stuck = (speed > 0.6 && d.sp < speed * 0.3) ? (d.stuck || 0) + dt : 0;
  d.y += (E.supportHeight(d.x, d.z, d.y + 0.5) - d.y) * Math.min(1, dt * 9);
  d.inB = !!E.bldAt(d.x, d.z);
  return dd;
}
function wanderPoint(D, d) {
  const E = D.env, rnd = E.random;
  //  Indoors there is nothing to wander to. Every candidate a metre away is
  //  through a wall, so it grinds along the plaster until something changes.
  //  With no reason to be in here, it leaves the way it came in.
  const inside = E.bldAt(d.x, d.z);
  if (inside) {
    const w = E.navNext(d.x, d.z, d.y, inside.door.x, inside.door.out, 0);
    return w || { x: inside.door.x, z: inside.door.out };
  }
  for (let i = 0; i < 12; i++) {
    const a = d.hd + (rnd() - 0.5) * 2.4, r = 10 + rnd() * 26;
    //  Reflected off the world edge, not rejected at it. Rejecting biases the
    //  walk inward: near the boundary every outward candidate is thrown away
    //  and only the inward ones survive. A reflecting walk has no such bias.
    let x = d.x + Math.sin(a) * r, z = d.z + Math.cos(a) * r;
    if (x > D_ROAM) x = 2 * D_ROAM - x; else if (x < -D_ROAM) x = -2 * D_ROAM - x;
    if (z > D_ROAM) z = 2 * D_ROAM - z; else if (z < -D_ROAM) z = -2 * D_ROAM - z;
    if (E.clearAt(x, z, 1.0)) return { x, z };
  }
  return { x: d.x, z: d.z };
}

// ---- its master -----------------------------------------------------
//  Who follows whom, written down: a minion knows its lord (lord: 'mf' with
//  the flayer's slot, or 'vec'). Resolves the bond and expires it in the same
//  breath, so nothing else has to remember to check whether the master is
//  still alive or still nearby. master(tag, slot): the master, if it stands.
//  (For the game's gorgons and flayers too: index.html lordOf.)
function lordOf(o, dt, master) {
  if (!o.lord) return null;
  const m = master(o.lord, o.lordSlot), take = o.lord === 'vec' ? V_TAKE : MF_TAKE;
  if (!m) { o.lord = null; o.lordFar = 0; return null; }
  //  Out of range is not the same as lost. A follower routed the long way
  //  round a building, or one the master has simply out-walked for a moment,
  //  is beyond the leash and closing — cutting it loose on the first frame
  //  that reads long means the bond breaks and re-forms every time either of
  //  them turns a corner. It has to *stay* out of reach to be free.
  if (Math.hypot(o.x - m.x, o.z - m.z) > take * LEASH) {
    o.lordFar = (o.lordFar || 0) + (dt || 0);
    if (o.lordFar > 5) { o.lord = null; o.lordFar = 0; return null; }
  } else o.lordFar = 0;
  return m;
}
//  Where a follower stands: its own bearing off its own slot and its own
//  radius, so a retinue rings the master instead of queueing up in the same
//  spot behind it. Outside V_CLEAR for VECNA, whose ring is kept clear by a
//  hard clamp — a station inside it would have them fighting the clamp.
//  The station must be somewhere you could stand: a target inside a
//  building is not walked to but *entered* (navNext sends it to the door),
//  so the follower would sprint between doors as the master walks and fall
//  steadily behind. So rotate round the master until the spot is out on the
//  street — and if nothing is, stand still (ok: false; the caller holds)
//  rather than head for the master's own spot, often itself over a
//  footprint and so another doorway.
function escortSpot(o, L, base, spread, ringMul, clearAt) {
  const ring = (o.lord === 'vec' ? V_CLEAR + base : base) + (o.slot % spread) * ringMul;
  const bear = L.hd + Math.PI + ((o.slot * 2.399) % 6.2832) * 0.55 - 0.9;
  for (let ri = 0; ri < 2; ri++) {
    const r = ri === 0 ? ring : ring * 1.45;      // pushed out a little if the near ring is all wall
    for (let i = 0; i < 6; i++) {
      const b = bear + (i === 0 ? 0 : (i & 1 ? 1 : -1) * Math.ceil(i / 2) * 0.8);
      const x = L.x + Math.sin(b) * r, z = L.z + Math.cos(b) * r;
      if (clearAt(x, z, 0.9)) return { x, z, ring, bear: b, ok: true };
    }
  }
  return { x: o.x, z: o.z, ring, bear, ok: false };
}

// ---- the decision -------------------------------------------------
//  Utility scoring rather than a ladder of ifs. Each candidate behaviour
//  gets a number from the things the animal can actually know — how far away
//  the threat is, how hurt it is, how many of its own are up, whether there
//  is anything to get behind — and the best one wins, with a bonus for
//  whatever it is already doing so it does not dither on the spot.
const D_DWELL = { attack: 0.55, call: 1.9, hide: 1.2, retreat: 1.0, reposition: 0.7, investigate: 1.4, alert: 0.8, escort: 1.6 };
function decide(D, d, dt) {
  const now = D.env.now(), dogs = D.dogs;
  const pk = D.packs[d.pack];
  const hpF = d.hp / DOG_HP;
  const fresh = now - d.seeT;                         // seconds since it last had eyes on
  const known = d.hasT && fresh < 9;
  const dist = d.tdist;
  const allies = pk ? pk.members.reduce((a, m) => a + (dogs[m].live && !dogs[m].dead ? 1 : 0), 0) : 1;
  const engaged = pk ? pk.members.reduce((a, m) => a + (dogs[m].live && !dogs[m].dead &&
    (dogs[m].st === 'attack' || dogs[m].st === 'chase') ? 1 : 0), 0) : 0;
  const S = d.S;
  for (const k in S) S[k] = 0;

  S.wander = 0.30;
  //  With nothing to hunt, a follower keeps station on its master instead of
  //  wandering off — the whole difference between an escort and a handful of
  //  animals summoned in the same place. It still loses to a loud noise, and
  //  it is gated on there being nothing to hunt: ungated it scores level with
  //  chase at any real distance and the retinue politely declines to fight.
  S.escort = (d.lord && !known) ? 0.90 : 0;
  S.investigate = (d.noise && now - d.noise.t < 6 && !known) ? 0.72 + d.noiseS * 0.5 : 0;
  S.alert = known && dist > 16 ? 0.62 : 0;
  // pressing in: wants a friend, wants to be healthy, wants to be close-ish
  S.chase = known ? 0.55 + (allies - 1) * 0.13 + hpF * 0.35 - Math.max(0, dist - D_LIKED) * 0.012
    - (engaged >= 2 && d.st !== 'chase' && d.st !== 'attack' ? 0.55 : 0) : 0;
  //  and it does not wind up to bite a ceiling
  S.attack = (known && d.see > 0 && dist < D_BITE_R + 1.4 && CITY.onSameLevel(d.y, d.ty) && d.atkCd <= 0) ? 1.35 + hpF * 0.3 : 0;
  // having bitten, get out of the way; also what the ones not chosen to press do
  S.reposition = known && dist < 13 ? 0.48 + (engaged >= 2 ? 0.5 : 0) + (d.atkCd > 0 ? 0.75 : 0) : 0;
  S.retreat = known ? (1 - hpF) * 1.5 + (d.hurtRecent > 0 ? 0.7 : 0) - (allies - 1) * 0.10 : 0;
  S.hide = known && hpF < 0.7 ? (1 - hpF) * 1.25 + (d.hasHide ? 0.35 : 0) : 0;
  S.observe = known && hpF < 0.85 && dist > 11 ? 0.55 : 0;
  S.call = (hpF < 0.55 || (known && allies < 2)) && d.callCd <= 0 && known ? 1.15 + (1 - hpF) * 0.8 : 0;
  S.flee = hpF < 0.22 ? 1.7 + (allies < 2 ? 0.5 : 0) : 0;
  //  Roles keep a pack from arriving as one lump (§33) — but a role is a
  //  statement about how to approach a target, so it means nothing without
  //  one: applied anyway, 'watch' (+0.60 observe, which walks a ring round
  //  d.tx, d.tz — still the (0, 0) it was born with) walked every idle dog in
  //  the district to the exact centre of the world.
  if (known) {
    if (d.role === 'flank') { S.reposition += 0.55; S.chase -= 0.35; }
    if (d.role === 'watch') { S.observe += 0.60; S.chase -= 0.55; S.attack -= 0.4; }
    if (d.role === 'engage') { S.chase += 0.40; }
  }
  //  §53: nothing of VECNA's runs away or goes to ground while he is watching.
  //  His command forces this too, but only every 2.6 s, and a dog that breaks
  //  off in between is a dog the player watches lose its nerve.
  if (d.lord === 'vec') { S.flee = 0; S.hide = 0; S.retreat *= 0.3; }

  let bestK = 'wander', bestV = -1;
  for (const k in S) if (S[k] > bestV) { bestV = S[k]; bestK = k; }
  const dwell = D_DWELL[d.st] || 0.4;
  if (d.stT < dwell && S[d.st] > 0.05) return;        // let the current one finish its beat
  if (bestK !== d.st) { d.st = bestK; d.stT = 0; d.hasHide = false; }
}

// ---- one dog, one tick --------------------------------------------
function tick(D, d, dt) {
  const E = D.env, rnd = E.random, now = E.now();
  d.stT += dt; d.atkCd = Math.max(0, d.atkCd - dt); d.callCd = Math.max(0, d.callCd - dt);
  d.stagger = Math.max(0, d.stagger - dt * 2.6);
  d.hurtRecent = Math.max(0, (d.hurtRecent || 0) - dt);
  if (d.dead) { d.deadT += dt; d.sp = 0; return; }
  //  Still coming up. It does not decide anything, does not walk, and does
  //  not bite — it claws its way out with its jaws working, and only then
  //  joins in. Without this it sets off for its station while still buried.
  if (d.rise < 1) {
    d.sp = 0; d.stuck = 0;
    d.maw += (0.85 - d.maw) * Math.min(1, dt * 5);
    d.crouch += (0.8 - d.crouch) * Math.min(1, dt * 4);
    d.headPitch += (-0.55 - d.headPitch) * Math.min(1, dt * 4);
    d.hd += dt * 0.9;
    return;
  }

  //  Wedged. Three seconds of wanting to move and not moving means the route
  //  is wrong, not that it needs to push harder — and it can happen in any
  //  state, so the recovery cannot live inside one branch of the machine. Drop
  //  whatever it was doing, forget the target that led it here, and wander:
  //  wander is the one state that always has somewhere reachable to go.
  if ((d.stuck || 0) > 3) {
    d.stuck = 0; d.hasT = false; d.st = 'wander'; d.stT = 0;
    const w = wanderPoint(D, d); d.wx = w.x; d.wz = w.z; d.wanderT = 5 + rnd() * 5;
  }

  // ---- senses
  const s = see(D, d);
  if (s > 0) {
    const t = d.tgt;
    d.see = s; d.seeT = now; d.hasT = true; d.tx = t.x; d.tz = t.z;
    const pk = D.packs[d.pack];
    if (pk) { pk.tx = t.x; pk.tz = t.z; pk.tT = now; pk.alert = Math.min(1, pk.alert + dt * 2.2); }
  } else {
    d.see = 0;
    const pk = D.packs[d.pack];
    if (pk && now - pk.tT < 7) { d.hasT = true; d.tx = pk.tx; d.tz = pk.tz; d.seeT = Math.max(d.seeT, pk.tT); }
  }
  const h = hear(D, d);
  if (h) { d.noise = h.n; d.noiseS = h.s; } else if (d.noise && now - d.noise.t > 6) d.noise = null;

  decide(D, d, dt);

  // ---- act
  const fx = d.tdist > 0.01 ? (d.tx - d.x) / d.tdist : 0, fz = d.tdist > 0.01 ? (d.tz - d.z) / d.tdist : 1;
  let lookX = d.tx, lookZ = d.tz, wantMaw = 0, wantTail = 0, wantCrouch = 0;
  switch (d.st) {
    case 'wander': {
      d.wanderT -= dt;
      //  A second of getting nowhere means the place it chose is not
      //  reachable from here, whatever the straight line says — except on a
      //  leg across town, which is a straight line through a city laid out on
      //  a 66 m grid and therefore meets a building almost at once: step()
      //  slides it along the wall on its own; it only has to be allowed to.
      if (d.wanderT <= 0 || Math.hypot(d.wx - d.x, d.wz - d.z) < 2.2 || d.stuck > 1.0) {
        const w = wanderPoint(D, d); d.wx = w.x; d.wz = w.z; d.wanderT = 4 + rnd() * 7;
        d.stuck = 0;
      }
      step(D, d, d.wx, d.wz, 1.45, dt);
      lookX = d.x + Math.sin(d.hd + Math.sin(now * 0.4 + d.slot) * 0.9) * 6;   // casting about as it goes
      lookZ = d.z + Math.cos(d.hd + Math.sin(now * 0.4 + d.slot) * 0.9) * 6;
      wantCrouch = 0.15;
      break;
    }
    case 'escort': {
      //  It travels with its master rather than being told once where the
      //  player was and then left to its own devices. Pace is taken from the
      //  master — its speed and a term for the gap to close — and none when
      //  it is already on its station: fixed bands leave it behind a
      //  strolling master or barging into one, or vibrating on the spot
      //  against the separation push. (Separation is off, as for a lunge: the
      //  stations are already spread, and the push only shoves the formation
      //  apart faster than it can re-form.)
      const L = lordOf(d, dt, E.master);
      if (!L) { d.st = 'wander'; d.stT = 0; break; }
      const s2 = escortSpot(d, L, d.lord === 'vec' ? 5 : 9, 4, 2.6, E.clearAt);
      const behind = Math.hypot(L.x - d.x, L.z - d.z);
      const pace = (!s2.ok || behind < s2.ring - 1.5) ? 0
        : Math.min(8.4, (L.sp || 0) * 1.2 + Math.max(0, behind - s2.ring) * 0.9);
      step(D, d, s2.x, s2.z, pace, dt, false, L.y);
      //  facing out, not in: a ring of animals all staring at their own master
      //  looks like a pen, not a guard
      lookX = d.x + Math.sin(s2.bear + Math.sin(now * 0.5 + d.slot) * 0.7) * 9;
      lookZ = d.z + Math.cos(s2.bear + Math.sin(now * 0.5 + d.slot) * 0.7) * 9;
      wantTail = 0.4; wantCrouch = 0.1; wantMaw = 0.1;
      break;
    }
    case 'investigate': {
      const n = d.noise;
      if (n) {
        const dd = step(D, d, n.x, n.z, 2.6, dt);
        lookX = n.x; lookZ = n.z;
        if (dd < 3.5) { d.noise = null; d.st = 'alert'; d.stT = 0; }
      } else { d.st = 'wander'; d.stT = 0; }
      wantCrouch = 0.3; wantTail = 0.2;
      break;
    }
    case 'alert': {                       // stop, raise the head, work out what it is
      d.sp *= 0.5;
      if (d.stT > 0.9) step(D, d, d.tx - fx * 12, d.tz - fz * 12, 1.9, dt);
      else step(D, d, d.x, d.z, 0, dt);
      wantMaw = 0.22; wantTail = 0.55; wantCrouch = 0.05;
      break;
    }
    case 'chase': {
      //  come in on your own line, not down the same corridor as everyone else
      const want = Math.max(D_LIKED * 0.45, D_BITE_R * 0.8);
      const off = ((d.slot * 2.399) % 6.2832) - Math.PI;
      const apx = d.tx - fx * want - fz * Math.sin(off) * 3.2;
      const apz = d.tz - fz * want + fx * Math.sin(off) * 3.2;
      step(D, d, apx, apz, d.tdist > 16 ? 8.4 : 6.2, dt);
      wantMaw = 0.45; wantTail = 0.7; wantCrouch = 0.1;
      break;
    }
    case 'attack': {
      //  a committed lunge: forward fast, jaws open, one bite, then it is over
      d.lunge = Math.min(1, d.lunge + dt * 7);
      step(D, d, d.tx, d.tz, 9.4, dt, false);
      wantMaw = 1; wantTail = 0.9;
      //  (a lunge of its own: one broken off after its bite — shot mid-lunge —
      //  left this set, and that dog never bit anyone again)
      if (d.stT <= 0.18) d.bit = false;
      if (d.stT > 0.18 && !d.bit) {
        d.bit = true;
        E.bite(d);                        // whoever is in reach, on its floor, takes it (and it is heard)
      }
      if (d.stT > 0.42) { d.atkCd = 1.5 + rnd() * 1.4; d.bit = false; d.st = 'reposition'; d.stT = 0; }
      break;
    }
    case 'reposition': {
      //  off the centre line — sideways and a little back, still watching, and
      //  each one swings out to its own radius so two never pick the same spot
      const sx = -fz * d.strafe, sz = fx * d.strafe;
      const want = D_LIKED + 1.5 + (d.slot % 4) * 1.4;
      const gx = d.tx - fx * want + sx * (4.5 + (d.slot % 3) * 1.8), gz = d.tz - fz * want + sz * (4.5 + (d.slot % 3) * 1.8);
      if (!E.clearAt(gx, gz, 0.8)) d.strafe = -d.strafe;
      step(D, d, gx, gz, 5.4, dt);
      wantMaw = 0.35; wantTail = 0.5;
      break;
    }
    case 'observe': {
      //  and if there is nothing to watch, this is not the state to be in
      if (!d.hasT) { d.st = 'wander'; d.stT = 0; break; }
      //  Watchers ring the target rather than queueing up behind it: each one
      //  keeps its own bearing, derived from its slot so it is stable, and its
      //  own distance. Sending them all to the same point behind the player is
      //  what turns a pack into a crowd.
      const ring = D_LIKED + 5 + (d.slot % 5) * 1.9;
      const bear = Math.atan2(fx, fz) + Math.PI + ((d.slot * 2.399) % 6.2832) * 0.34 - 0.55;
      const gx = d.tx + Math.sin(bear) * ring, gz = d.tz + Math.cos(bear) * ring;
      step(D, d, gx, gz, 2.4, dt);
      wantMaw = 0.16; wantTail = 0.35; wantCrouch = 0.35;
      break;
    }
    case 'retreat': case 'hide': {
      if (!d.hasHide) {
        const c = cover(D, d, fx, fz);
        if (c) { d.hideX = c.x; d.hideZ = c.z; d.hasHide = true; }
        else { d.hideX = d.x - fx * 16; d.hideZ = d.z - fz * 16; d.hasHide = true; }
      }
      const dd = step(D, d, d.hideX, d.hideZ, 6.6, dt);
      wantCrouch = dd < 2.5 ? 0.75 : 0.25; wantTail = 0;
      if (dd < 2.0 && d.stT > 2.6) {      // looked long enough — try again
        d.hp = Math.min(DOG_HP, d.hp + 4);
        d.st = 'observe'; d.stT = 0; d.hasHide = false;
      }
      break;
    }
    case 'call': {
      d.sp *= 0.3;
      step(D, d, d.x, d.z, 0, dt);
      wantMaw = 1; wantTail = 0.95;
      if (!d.called && d.stT > 0.25) {
        d.called = true; d.callCd = D_CALL_CD;
        call(D, d);
      }
      if (d.stT > 1.7) { d.called = false; d.st = 'reposition'; d.stT = 0; }
      break;
    }
    case 'flee': {
      const gx = d.x - fx * 30, gz = d.z - fz * 30;
      const jitter = Math.sin(now * 1.7 + d.slot) * 9;    // never a straight line
      step(D, d, gx - fz * jitter, gz + fx * jitter, 7.6, dt);
      wantTail = 0; wantCrouch = 0.1;
      if (d.tdist > 55) { d.hasT = false; d.st = 'wander'; d.stT = 0; d.hp = Math.min(DOG_HP, d.hp + 8); }
      break;
    }
    default: step(D, d, d.x, d.z, 0, dt);
  }
  if (d.st !== 'attack') d.lunge = Math.max(0, d.lunge - dt * 4);

  // ---- head tracking, jaw, tail: all eased, never snapped
  let hy = 0, hp2 = 0;
  { const rel = Math.atan2(lookX - d.x, lookZ - d.z) - d.hd;
    let a = rel; while (a > Math.PI) a -= 6.2832; while (a < -Math.PI) a += 6.2832;
    hy = Math.max(-1.25, Math.min(1.25, a));
    const dz2 = Math.hypot(lookX - d.x, lookZ - d.z);
    hp2 = Math.max(-0.7, Math.min(0.8, Math.atan2((d.st === 'wander' ? 0.2 : 1.5) - 0.95, Math.max(1, dz2))));
  }
  const ez = Math.min(1, dt * 5.5);
  d.headYaw += (hy - d.headYaw) * ez;
  d.headPitch += (hp2 - d.headPitch) * ez;
  d.maw += (wantMaw - d.maw) * Math.min(1, dt * (wantMaw > d.maw ? 11 : 4));
  d.tailUp += (wantTail - d.tailUp) * Math.min(1, dt * 4);
  d.crouch += (wantCrouch - d.crouch) * Math.min(1, dt * 4.5);
}

// ---- pack bookkeeping ---------------------------------------------
//  Roles are dealt once a second, not per dog per frame: the closest two
//  press, the next two swing wide, the rest hold and watch.
function packTick(D, dt) {
  const now = D.env.now(), dogs = D.dogs;
  //  Packs are re-formed from where the animals actually are, not from where
  //  they happened to spawn. Without this they drift together into one crowd
  //  while still believing they are five packs of one, and every "pack" duly
  //  sends its own two in — which is a lump wearing the word pack.
  D.repack -= dt;
  if (D.repack <= 0) {
    D.repack = 2.5;
    const live = dogs.filter((d) => d.live && !d.dead);
    //  Every animal inherits what *its own* pack knew — not a pool of what
    //  every pack knew. Pooled, one sighting became a district-wide alarm
    //  within one repack and forty-eight animals walked to the same corner.
    //  Per member, a scream still travels (the animals it reached carry it
    //  into whatever pack they land in) and it still stops at the edge of
    //  the group that actually heard it.
    const inherit = new Map();
    for (const k of D.packs) for (const m of k.members) inherit.set(m, k);
    for (const d of live) d.pack = -1;
    D.packs.length = 0;
    for (const d of live) {
      if (d.pack >= 0) continue;
      const pk = newPack(D);
      const q = [d];
      d.pack = pk.id; pk.members.push(d.slot);
      while (q.length && pk.members.length < 6) {          // flood fill at 26 m
        const a = q.shift();
        for (const o of live) {
          if (o.pack >= 0 || pk.members.length >= 6) continue;
          if (Math.hypot(o.x - a.x, o.z - a.z) > 26) continue;
          o.pack = pk.id; pk.members.push(o.slot); q.push(o);
        }
      }
      //  seeded from its own members only — the freshest thing any of them
      //  personally knows, and the alarm level they personally carried over
      for (const sl of pk.members) {
        const o = dogs[sl]; if (!o) continue;
        if (o.hasT && o.seeT > pk.tT) { pk.tx = o.tx; pk.tz = o.tz; pk.tT = o.seeT; }
        const k = inherit.get(sl); if (!k) continue;
        if (k.tT > pk.tT) { pk.tx = k.tx; pk.tz = k.tz; pk.tT = k.tT; }
        pk.alert = Math.max(pk.alert, k.alert);
      }
    }
    if (!D.packs.length) newPack(D);
  }
  for (const pk of D.packs) {
    if (!pk.members.length) continue;
    pk.alert = Math.max(0, pk.alert - dt * 0.25);
    const alive = pk.members.filter((m) => dogs[m] && dogs[m].live && !dogs[m].dead);
    if (!alive.length) continue;
    if (pk.leader < 0 || !alive.includes(pk.leader)) pk.leader = alive[0];   // §11: promote on death
  }
  //  Roles are dealt across everything that currently knows where you are,
  //  not pack by pack: per pack they stop meaning anything the moment a
  //  chase spreads the animals out, and four packs of two each send their
  //  own two in. What the player should see is two pressing, two swinging
  //  wide, the rest watching — a statement about the whole field.
  D.roles -= dt;
  if (D.roles > 0) return;
  D.roles = 0.8;
  const aware = dogs.filter((d) => d.live && !d.dead && d.hasT && now - d.seeT < 9);
  aware.sort((a, b) => a.tdist - b.tdist);
  for (let i = 0; i < aware.length; i++) {
    const d = aware[i];
    d.role = i < 2 ? 'engage' : i < 4 ? 'flank' : 'watch';
    if (d.hp < DOG_HP * 0.45) d.role = 'watch';        // the hurt ones hang back regardless
  }
  for (const d of dogs) if (d.live && !aware.includes(d)) d.role = 'watch';
}
//  A scream reaches 50 m, brings two to four, and the caller cannot do it
//  again for a quarter of a minute. It is deliberately not a world event.
function call(D, d) {
  const now = D.env.now(), dogs = D.dogs;
  D.env.on.call(d);
  noise(D, d.x, d.z, 0.95, 'call');
  let brought = 0;
  for (const o of dogs) {
    if (!o.live || o.dead || o === d || brought >= D_CALL_MAX) continue;
    if (Math.hypot(o.x - d.x, o.z - d.z) > D_CALL_R) continue;
    if (o.st === 'attack' || o.st === 'flee') continue;
    o.hasT = true; o.tx = d.tx; o.tz = d.tz; o.seeT = now - 1;
    o.st = 'chase'; o.stT = 0; brought++;
    const pk = D.packs[o.pack]; if (pk) { pk.tx = d.tx; pk.tz = d.tz; pk.tT = now; pk.alert = 1; }
  }
  // and reinforcements from off-screen, capped, so a call is not a faucet
  for (let i = brought; i < D_CALL_MAX && dogs.filter((o) => o.live).length < NDOG; i++) {
    const n = spawnDog(D); if (!n) break;
    n.hasT = true; n.tx = d.tx; n.tz = d.tz; n.seeT = now - 2; n.st = 'chase';
  }
}

// ---- damage -------------------------------------------------------
function hurt(D, d, dmg, fromX, fromZ) {
  if (!d.live || d.dead) return;
  const E = D.env, now = E.now();
  E.on.share(d.x, d.z, dmg);          // a linked minion bleeds upward (the flayer's link)
  d.hp -= dmg; d.stagger = 1; d.hurtRecent = 2.5;
  d.hasT = true; d.tx = fromX; d.tz = fromZ; d.seeT = now;
  const pk = D.packs[d.pack];
  if (pk) { pk.tx = fromX; pk.tz = fromZ; pk.tT = now; pk.alert = 1; }
  if (d.hp <= 0) { kill(D, d); return; }
  E.on.hurt(d);
  // being shot does not automatically mean charging the thing that shot you
  const roll = E.random();
  if (roll < 0.55 || d.hp < DOG_HP * 0.4) { d.st = 'retreat'; d.stT = 0; d.hasHide = false; }
  else { d.st = 'reposition'; d.stT = 0; }
}
function kill(D, d) {
  d.dead = true; d.deadT = 0; d.hp = 0; d.sp = 0; d.maw = 0.7; d.tailUp = 0;
  D.env.on.death(d);
  const pk = D.packs[d.pack];
  if (pk) { pk.alert = 1; if (pk.leader === d.slot) pk.leader = -1; }
  for (const o of D.dogs) {                       // the others saw that happen
    if (!o.live || o.dead || o === d) continue;
    if (Math.hypot(o.x - d.x, o.z - d.z) > 22) continue;
    o.hurtRecent = Math.max(o.hurtRecent || 0, 1.6);
  }
}

// ---- keeping the district stocked -----------------------------------
//  On arrival the map is filled in a few seconds — several at a time, since
//  they are going in all over a 600 m square and nobody will see them
//  arrive — and after that it only tops up what has been killed. Nothing is
//  ever deleted for being far away; the dead are cleared after 9 s.
function stock(D, dt) {
  const dogs = D.dogs;
  const live = dogs.reduce((a, o) => a + (o.live && !o.dead ? 1 : 0), 0);
  const want = NDOG - 2;
  D.spawnCd -= dt;
  if (D.spawnCd <= 0 && live < want && !D.holdSpawn) {
    const deficit = want - live;
    const burst = deficit > 8 ? 4 : 1;                     // filling an empty map vs replacing a loss
    for (let i = 0; i < burst; i++) spawnDog(D);
    D.spawnCd = deficit > 8 ? 0.10 : 3.5 + D.env.random() * 4;
  }
  for (const d of dogs) if (d.live && d.dead && d.deadT > 9) despawnDog(D, d);
  packTick(D, dt);
}

// ---- the others: what the big ones do to them -------------------------
//  §33: the dogs know what a gorgon is. They do not take orders from it —
//  they just want to be somewhere else, which is a far better way to tell the
//  player which of the two is the dangerous one. g: { x, z, lord, lordSlot }.
function shove(D, g, dt) {
  for (const d of D.dogs) {
    if (!d.live || d.dead) continue;
    const ddx = d.x - g.x, ddz = d.z - g.z, dd2 = ddx * ddx + ddz * ddz;
    if (dd2 > 289 || dd2 < 1e-4) continue;                      // within 17 m
    //  but not at one of its own. Two members of the same retinue hold
    //  stations a few metres apart on purpose; shoving them apart at
    //  2.2 m/s undoes the formation faster than either can walk back into
    //  it, and the escort spends the whole time drifting off its master.
    if (d.lord && d.lord === g.lord && d.lordSlot === g.lordSlot) continue;
    const dd = Math.sqrt(dd2), push = (1 - dd / 17) * 2.2 * dt;
    d.x += ddx / dd * push; d.z += ddz / dd * push;
    //  and they mean it: the dog's own wander target is thrown out to the
    //  far side, so it walks away instead of being shoved and coming back
    d.wx = g.x + ddx / dd * 34; d.wz = g.z + ddz / dd * 34; d.wanderT = 5;
    if (d.st === 'wander' || d.st === 'idle' || d.st === 'observe') { d.st = 'alert'; d.stT = 0; }
  }
}

// ---- over the wire ----------------------------------------------------
const HDQ = TR.HDQ;
//  a dog's marks, as a snapshot carries them: 1 dead, 2 sworn to someone
//  (4: to VECNA, else a flayer — 8: the second flayer), 16 still climbing out
function marks(d) {
  return (d.dead ? 1 : 0) | (d.lord ? 2 : 0) | (d.lord === 'vec' ? 4 : 0) | (d.lord === 'mf' && d.lordSlot === 1 ? 8 : 0) | (d.rise < 1 ? 16 : 0);
}
//  what a snapshot says of the dogs: per dog [slot, x·10, z·10, heading byte,
//  hp, state (D_ST index + 1), marks]. Whole (full) or only those near(d)
//  someone who might see them, and any whose health, state or marks changed
//  since the last snapshot said them (d.netSig) — so a bite or a death is
//  heard at once. null when there are no dogs up.
function snapRows(D, full, near) {
  const k = []; let up = 0;
  for (const dg of D.dogs) {
    if (!dg.live) continue;
    up++;
    const hv = Math.max(0, dg.hp), st = D_ST.indexOf(dg.st) + 1, fl = marks(dg);
    const sig = hv * 2048 + st * 32 + fl;
    if (!full && sig === dg.netSig && !near(dg)) continue;
    dg.netSig = sig;
    const h = (((dg.hd || 0) % 6.2832) + 6.2832) % 6.2832;
    k.push(dg.slot, Math.round(dg.x * 10), Math.round(dg.z * 10), Math.round(h * HDQ), hv, st, fl);
  }
  return up ? k : null;
}
//  The whole of it, to carry on from (a room taking the dogs from its host's
//  game, or giving them back): per live dog [slot, x·100, z·100, y·100,
//  heading·1000, hp·10, state, time in it·10, dead time·10 (−1: alive),
//  target (1/0), tx·10, tz·10, seen ago·10, lord (0, 1 flayer, 2 VECNA),
//  its slot, bite ready in·10, call ready in·10, climbing·100, wander x·10,
//  z·10, wander time·10, strafe (±1)]
const FULL_N = 22;
function fullState(D) {
  const now = D.env.now(), rows = [];
  for (const d of D.dogs) {
    if (!d.live) continue;
    rows.push(d.slot, Math.round(d.x * 100), Math.round(d.z * 100), Math.round(d.y * 100), Math.round((d.hd || 0) * 1000), Math.round(Math.max(0, d.hp) * 10),
      D_ST.indexOf(d.st), Math.round(Math.min(600, d.stT) * 10), d.dead ? Math.round(d.deadT * 10) : -1,
      d.hasT ? 1 : 0, Math.round(d.tx * 10), Math.round(d.tz * 10), Math.round(Math.min(600, Math.max(0, now - d.seeT)) * 10),
      d.lord === 'mf' ? 1 : d.lord === 'vec' ? 2 : 0, d.lord === 'mf' ? d.lordSlot : -1,
      Math.round(d.atkCd * 10), Math.round(d.callCd * 10), Math.round(Math.min(1, d.rise === undefined ? 1 : d.rise) * 100),
      Math.round(d.wx * 10), Math.round(d.wz * 10), Math.round(Math.min(600, d.wanderT) * 10), d.strafe < 0 ? -1 : 1);
  }
  return { k: rows };
}
function fullOk(f) {
  if (!f || !Array.isArray(f.k) || f.k.length % FULL_N || f.k.length > NDOG * FULL_N || !f.k.every(Number.isFinite)) return false;
  for (let i = 0; i < f.k.length; i += FULL_N) {
    const r = f.k;
    if (r[i] < 0 || r[i] >= NDOG || Math.abs(r[i + 1]) > 50000 || Math.abs(r[i + 2]) > 50000 || r[i + 6] < 0 || r[i + 6] >= D_ST.length) return false;
  }
  return true;
}
//  (the dogs there now are cleared first: this is all of them)
function adoptFull(D, f) {
  clearDogs(D);
  const now = D.env.now(), r = f.k;
  for (let i = 0; i < r.length; i += FULL_N) {
    const slot = r[i];
    while (D.dogs.length <= slot) D.dogs.push({ slot: D.dogs.length, live: false, S: {} });
    const d = D.dogs[slot], x = r[i + 1] / 100, z = r[i + 2] / 100, lord = r[i + 13];
    Object.assign(d, {
      live: true, x, z, y: r[i + 3] / 100, hd: r[i + 4] / 1000, sp: 0, vx: 0, vz: 0, hp: Math.min(DOG_HP, r[i + 5] / 10), pack: -1, role: 'watch',
      st: D_ST[r[i + 6]], stT: r[i + 7] / 10, gaitPh: 0, gait: 'walk', lean: 0,
      maw: 0, headYaw: 0, headPitch: 0, tailUp: 0, crouch: 0, lunge: 0, stagger: 0,
      atkCd: r[i + 15] / 10, callCd: r[i + 16] / 10, deadT: r[i + 8] >= 0 ? r[i + 8] / 10 : 0, dead: r[i + 8] >= 0,
      see: 0, seeT: now - r[i + 12] / 10, tx: r[i + 10] / 10, tz: r[i + 11] / 10, tdist: 999, hasT: !!r[i + 9],
      wx: r[i + 18] / 10, wz: r[i + 19] / 10, wanderT: r[i + 20] / 10, strafe: r[i + 21] < 0 ? -1 : 1,
      hideX: 0, hideZ: 0, hasHide: false, stepPh: 0, breath: 0,
      netX: x, netZ: z, netH: r[i + 4] / 1000, rx: x, rz: z, hpHold: 0, lod: 0,
      lord: lord === 1 ? 'mf' : lord === 2 ? 'vec' : null, lordSlot: lord === 1 ? r[i + 14] : -1, lordFar: 0, taint: lord ? 1 : 0,
      rise: r[i + 17] / 100, riseY: 0, noise: null, bit: false, called: false, stuck: 0, hurtRecent: 0, netSig: undefined,
    });
    if (d.dead) d.hp = 0;
  }
  D.packs.length = 0; D.repack = 0; D.roles = 0;         // re-formed from where they stand, on the next tick
  for (const d of D.dogs) if (d.live && !d.dead) d.pack = 0;
  newPack(D);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    NDOG, DOG_HP, D_VIS, D_HEAR, D_CALL_R, D_CALL_MAX, D_BITE_R, D_BITE_DMG, D_LIKED, D_SEP, D_KEEP, D_RISE_T, D_ST,
    MF_TAKE, V_TAKE, LEASH, V_CLEAR, MF_LINK, RETINUE, FULL_N,
    makeDogs, noise, newPack, spawnSpot, spawnDog, despawnDog, clearDogs, nearestTo, see, hear, cover, step, wanderPoint,
    lordOf, escortSpot, decide, tick, packTick, call, hurt, kill, stock, shove, marks, snapRows, fullState, fullOk, adoptFull,
  };
}
