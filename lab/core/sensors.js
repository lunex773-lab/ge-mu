'use strict';
//  ============================================================
//  SENSOR LAYER  (spec §11, and §17's first rule)
//  ============================================================
//
//  Observations in, a WorldState out. An observation is what a creature
//  standing where the boss stands could actually know:
//
//    self     its own body — position, heading, health, cooldown
//    bodies   the players, as their avatars show them: where they stand, which
//             way they face, the HP bar over their heads, whether they shimmer
//    events   things that could be seen or heard — a shot, a hit landing
//    probe()  a ray into the world, which is how anything is ever *seen*
//    solid()  whether a point is inside a building — how "a wall close by"
//             is answered without a ray (see coverRays below)
//
//  and nothing else. §17: "AIはプレイヤーの入力情報を直接取得してはいけない".
//  The sensor never reads a key, a joystick or a fire button; it reads
//  whitelisted fields by name, so anything else passed in is simply not
//  looked at — and in strict mode (tests, the debug overlay) passing it at
//  all is an error, so a later change that tries cannot do it quietly.
//
//  What it keeps is a *belief* per player, not a copy of the truth:
//
//    seen      position and velocity are measured from what it saw
//    lost      it keeps walking the belief along the last velocity for a
//              moment (MEMORY s), then it stops — it does not know where you
//              went, and it is not told
//    heard     a shot puts the belief back near where it came from, with an
//              error that grows with distance
//
//  That is §17's "imperfect information" done where it belongs, at the
//  senses, instead of as noise sprinkled on a decision made with perfect
//  information.

const { WorldState, F, NEVER } = require('./worldstate.js');
const { makeRng, gauss } = require('./rng.js');

const SENSE = {
  sight: 110,          // m — as far as it can make out a player at all
  fov: 1.55,           // rad either side of its facing
  near: 14,            // m — inside this it notices you whichever way it faces
  eye: 3.9,            // m — eye height above its feet (about 4.6 m tall)
  chest: 1.15,         // m — where on a player it looks
  cloakSight: 10,      // m — a cloaked player is only made out this close…
  cloakVis: 0.35,      //   …and only this well
  hear: 140,           // m — a shot carries this far (the game's own shot audio)
  hearErr: 0.06,       // heard position error, as a fraction of the distance
  memory: 1.2,         // s — how long a lost target's belief keeps moving
  forget: 6,           // s — confidence time constant after losing sight
  heardHold: 4,        // s — confidence time constant of a heard position
  velTau: 0.22,        // s — velocity smoothing
  dodgeAcc: 26,        // m/s² sideways that reads as a dodge, not a turn
  attackTau: 0.8,      // s
  dodgeTau: 0.6,       // s
  noiseTau: 1.5,       // s
  recent: 3,           // s — the damage window
  nearR: 30,           // m — "near"
  run: 10.2,           // m/s — the game's run speed
  coverR: 3,           // m — a wall this close to the player is cover
  selfCoverR: 5,       // m
  //  Rays are the whole cost of this layer, so they are budgeted per tick
  //  rather than cast whenever a question comes up — D8 cares about the
  //  worst frame, not the average one. The game's rayCity walks every
  //  building in the city whatever the ray's length, so "is there a wall
  //  within 3 m" is never asked with a ray when the host can answer solid():
  //  two footprint lookups per direction instead.
  coverRays: 4,        // of the 16 cover directions (8 around it, 8 around the player), checked per tick
  losQuota: 2,         // sight rays per tick for players other than the one it is attending to
  losEvery: 0.3,       // s — how stale another player's sighting may get
  switchRatio: 1.3,    // a new target must look this much better to win
  airborne: 1.6,       // m/s vertical
};

//  Names that mean "the player's controls". Nothing here reads them; strict
//  mode makes sure nothing upstream even offers them.
const FORBIDDEN = /^(keys?|inputs?|joy(stick)?|touch(es)?|pointer|mouse|buttons?|pressed|controls?|want[A-Z]\w*|aim(Yaw|Pitch)?|fireHeld)$/;
function assertObservable(obs) {
  const check = (o, where) => {
    if (!o || typeof o !== 'object') return;
    for (const k of Object.keys(o)) {
      if (FORBIDDEN.test(k)) throw new Error('§17: "' + where + '.' + k + '" is a player input, not an observation');
    }
  };
  check(obs, 'obs'); check(obs.self, 'self');
  if (obs.bodies) for (let i = 0; i < obs.bodies.length; i++) check(obs.bodies[i], 'bodies[' + i + ']');
  if (obs.events) for (let i = 0; i < obs.events.length; i++) check(obs.events[i], 'events[' + i + ']');
}

const RING = 32;             // damage events remembered, either way

function newTrack(id) {
  return {
    id, alive: false, visible: 0, blocked: false,
    // belief
    bx: 0, by: 0, bz: 0, vx: 0, vy: 0, vz: 0, have: false,
    // the last sighting
    sx: 0, sy: 0, sz: 0, seenT: -Infinity, obsT: -Infinity, rvx: 0, rvz: 0,
    heardT: -Infinity, attackT: -Infinity, noiseT: -Infinity, noiseI: 0, dodgeT: -Infinity,
    hx: 0, hy: 0, hz: 0, pendingHeard: false,
    hp: 1, fx: 0, fz: 1, facingSeen: false, probeT: -Infinity,
    hurtT: new Float32Array(RING), hurtD: new Float32Array(RING), hurtK: 0,   // their damage to the boss
    lastT: -Infinity,
  };
}

class SensorLayer {
  constructor(opts) {
    this.o = Object.assign({}, SENSE, opts || {});
    this.rng = makeRng(this.o.seed === undefined ? 0x5e45e : this.o.seed);
    this.strict = !!this.o.strict;
    this.ws = new WorldState();
    this.tracks = new Map();
    this.target = null;
    this.t = 0;
    this.coverI = 0;
    this.coverHit = new Uint8Array(16);  // 0-7 around the boss, 8-15 around the player
    this.selfCover = 0; this.playerWalls = 0;
    this.takenT = new Float32Array(RING); this.takenD = new Float32Array(RING); this.takenK = 0;
    this.dealtT = new Float32Array(RING); this.dealtD = new Float32Array(RING); this.dealtK = 0;
    this.lastDamagedT = -Infinity; this.lastSwingT = -Infinity;
    this.probes = 0;                     // rays cast, for the budget
    this.takenT.fill(-1e9); this.dealtT.fill(-1e9);
  }

  track(id) {
    let tr = this.tracks.get(id);
    if (!tr) { tr = newTrack(id); tr.hurtT.fill(-1e9); this.tracks.set(id, tr); }
    return tr;
  }

  //  One tick. `obs` is described at the top of the file.
  sense(obs) {
    if (this.strict) assertObservable(obs);
    const o = this.o, ws = this.ws, v = ws.v;
    const t = +obs.t || 0;
    const dt = Math.max(1e-3, Math.min(1, t - this.t || 0.1));
    this.t = t; ws.t = t;
    const self = obs.self || {};
    const sx = +self.x || 0, sy = +self.y || 0, sz = +self.z || 0, shd = +self.hd || 0;
    const sWorld = self.world | 0;
    const probe = typeof obs.probe === 'function' ? obs.probe : null;
    const solid = typeof obs.solid === 'function' ? obs.solid : null;

    // ---- events first: what was heard and felt since the last tick ----
    const ev = obs.events || [];
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i]; if (!e) continue;
      const et = e.t === undefined ? t : +e.t;
      if (e.type === 'shot') {
        if (e.by === 'self' || e.by == null) continue;
        const tr = this.track(e.by);
        const ex = +e.x || 0, ez = +e.z || 0, d = Math.hypot(ex - sx, ez - sz);
        if (d > o.hear) continue;
        tr.attackT = Math.max(tr.attackT, et);
        tr.noiseT = et; tr.noiseI = 1 - d / o.hear;
        tr.heardT = et; tr.hx = ex + gauss(this.rng.next) * o.hearErr * d; tr.hz = ez + gauss(this.rng.next) * o.hearErr * d;
        tr.hy = +e.y || 0; tr.pendingHeard = true;
      } else if (e.type === 'hit') {
        const dmg = Math.max(0, +e.dmg || 0);
        if (e.victim === 'self') {
          this.takenT[this.takenK] = et; this.takenD[this.takenK] = dmg; this.takenK = (this.takenK + 1) % RING;
          this.lastDamagedT = et;
          if (e.by != null && e.by !== 'self') {
            const tr = this.track(e.by);
            tr.hurtT[tr.hurtK] = et; tr.hurtD[tr.hurtK] = dmg; tr.hurtK = (tr.hurtK + 1) % RING;
            tr.attackT = Math.max(tr.attackT, et);
          }
        } else if (e.by === 'self') {
          this.dealtT[this.dealtK] = et; this.dealtD[this.dealtK] = dmg / Math.max(1, +e.hpMax || 100);
          this.dealtK = (this.dealtK + 1) % RING;
        }
      } else if (e.type === 'swing' && e.by === 'self') {
        this.lastSwingT = et;
      }
    }

    // ---- sight: every player the boss could be looking at ----
    for (const tr of this.tracks.values()) tr.alive = false;
    const bodies = obs.bodies || [];
    const ex0 = sx, ey0 = sy + o.eye, ez0 = sz;
    const fcx = Math.sin(shd), fcz = Math.cos(shd);
    let quota = o.losQuota;
    let free = this.target ? 0 : 1;      // no one attended to: the main look goes to discovery
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b || b.id == null) continue;
      if (b.dead || (b.world | 0) !== sWorld) { const tr = this.tracks.get(b.id); if (tr) { tr.alive = false; tr.visible = 0; } continue; }
      const tr = this.track(b.id);
      tr.alive = true;
      const bx = +b.x || 0, by = +b.y || 0, bz = +b.z || 0;
      const dx = bx - sx, dz = bz - sz, dist = Math.hypot(dx, dz);
      const cloak = !!b.cloak;
      const range = cloak ? o.cloakSight : o.sight;
      let seen = 0; tr.blocked = false;
      if (dist <= range) {
        let a = Math.atan2(dx, dz) - shd;
        while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI;
        if (Math.abs(a) <= o.fov || dist < o.near) {
          // Whoever it is attending to gets a look every tick; everyone else
          // shares a small quota. A player not looked at this tick keeps the
          // belief from the last look — never an update it did not see.
          let main = tr === this.target;
          if (!main && free > 0 && t - tr.probeT >= o.losEvery) { main = true; free--; }
          if (probe && !main && (t - tr.probeT < o.losEvery || quota <= 0)) {
            if (tr.visible > 0) { tr.pendingHeard = false; continue; }
            seen = -1;                     // not looked at: stays unseen, below
          } else if (probe && !main) quota--;
        }
        if (seen === 0 && (Math.abs(a) <= o.fov || dist < o.near)) {
          let clear = true;
          tr.probeT = t;
          if (probe) {
            const ty = by + o.chest;
            const rx = bx - ex0, ry = ty - ey0, rz = bz - ez0;
            const len = Math.hypot(rx, ry, rz) || 1e-3;
            this.probes++;
            const hit = probe(ex0, ey0, ez0, rx / len, ry / len, rz / len, len);
            clear = !(hit < len - 0.6);
          }
          if (clear) seen = cloak ? o.cloakVis : 1;
          else tr.blocked = true;
        }
      }
      if (seen < 0) seen = 0;
      tr.visible = seen;
      if (seen > 0) {
        // measure, don't trust: velocity comes from successive sightings
        const gap = t - tr.obsT;
        if (gap > 0 && gap < 0.6) {
          const rvx = (bx - tr.sx) / gap, rvy = (by - tr.sy) / gap, rvz = (bz - tr.sz) / gap;
          // a dodge is a sharp change of velocity *across* the line to the boss
          const nx = dist > 0.01 ? dx / dist : 0, nz = dist > 0.01 ? dz / dist : 1;
          const latNow = rvx * nz - rvz * nx, latWas = tr.rvx * nz - tr.rvz * nx;
          if (Math.abs(latNow - latWas) / gap > o.dodgeAcc && Math.abs(latNow) > 3) tr.dodgeT = t;
          tr.rvx = rvx; tr.rvz = rvz;
          const k = Math.min(1, gap / o.velTau);
          tr.vx += (rvx - tr.vx) * k; tr.vy += (rvy - tr.vy) * k; tr.vz += (rvz - tr.vz) * k;
        } else if (gap >= 0.6) { tr.vx = tr.vy = tr.vz = 0; tr.rvx = tr.rvz = 0; }
        tr.sx = bx; tr.sy = by; tr.sz = bz; tr.obsT = t; tr.seenT = t;
        tr.bx = bx; tr.by = by; tr.bz = bz; tr.have = true;
        tr.hp = Math.max(0, Math.min(1, (+b.hp || 0) / Math.max(1, +b.hpMax || 100)));
        if (b.fx !== undefined) {
          const fl = Math.hypot(+b.fx || 0, +b.fz || 0);
          if (fl > 1e-3) { tr.fx = b.fx / fl; tr.fz = b.fz / fl; tr.facingSeen = true; }
        }
        tr.pendingHeard = false;
      } else if (tr.have) {
        // lost: walk the belief on for a moment, then stop — it is not told
        const since = t - tr.seenT, prev = Math.max(0, since - dt);
        const step = Math.min(since, o.memory) - prev;
        if (step > 0) { tr.bx += tr.vx * step; tr.bz += tr.vz * step; }
        tr.facingSeen = false;
      }
      if (seen === 0 && tr.pendingHeard) {
        // heard but not seen: it knows roughly where, and nothing about how fast
        tr.bx = tr.hx; tr.bz = tr.hz; tr.by = tr.hy; tr.have = true;
        tr.vx = tr.vz = tr.vy = 0;
        tr.pendingHeard = false;
      }
    }

    // ---- who to attend to ----
    let best = null, bestS = 0, curS = -1;
    for (const tr of this.tracks.values()) {
      if (!tr.alive || !tr.have) continue;
      const conf = this.confidence(tr, t);
      if (conf < 0.02) continue;
      const d = Math.hypot(tr.bx - sx, tr.bz - sz);
      let hurt = 0;
      for (let k = 0; k < RING; k++) if (t - tr.hurtT[k] < 5) hurt += tr.hurtD[k];
      const s = conf * (1.25 - Math.min(1, d / 120))
              + Math.min(1, hurt / Math.max(1, +self.hpMax || 1) * 10) * 0.6
              + Math.exp(-(t - tr.attackT) / o.attackTau) * 0.3;
      if (tr === this.target) curS = s;
      if (s > bestS) { bestS = s; best = tr; }
    }
    if (this.target && curS > 0 && best !== this.target && bestS < curS * o.switchRatio) best = this.target;
    this.target = best;

    // ---- cover: a few of its sixteen rays each tick, round and round ----
    if (probe || solid) {
      for (let k = 0; k < o.coverRays; k++) {
        const i = this.coverI; this.coverI = (i + 1) & 15;
        const a = (i & 7) * Math.PI / 4, dx = Math.sin(a), dz = Math.cos(a);
        if (i < 8) this.coverHit[i] = this.wallNear(probe, solid, sx, sy + 1.2, sz, dx, dz, o.selfCoverR);
        else if (best) this.coverHit[i] = this.wallNear(probe, solid, best.bx, best.by + o.chest, best.bz, dx, dz, o.coverR);
        else this.coverHit[i] = 0;
      }
      let a = 0, b = 0;
      for (let i = 0; i < 8; i++) { a += this.coverHit[i]; b += this.coverHit[i + 8]; }
      this.selfCover = a / 8; this.playerWalls = b / 8;
    }

    // ---- write the state ----
    ws.reset();
    const tr = best;
    if (tr) {
      const conf = this.confidence(tr, t);
      const dx = tr.bx - sx, dz = tr.bz - sz, dist = Math.hypot(dx, dz);
      const nx = dist > 0.01 ? dx / dist : fcx, nz = dist > 0.01 ? dz / dist : fcz;
      let a = Math.atan2(dx, dz) - shd;
      while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI;
      const fresh = t - tr.seenT < o.memory;                 // velocity is only worth anything while fresh
      const vx = fresh ? tr.vx : 0, vz = fresh ? tr.vz : 0, vy = fresh ? tr.vy : 0;
      const radial = vx * nx + vz * nz;
      const lateral = Math.abs(vx * nz - vz * nx);
      v[F.has_target] = 1;
      v[F.player_distance] = dist;
      v[F.player_bearing] = -a;              // atan2(dx,dz) grows to the left; + is to its right
      v[F.player_height_diff] = tr.by - sy;
      v[F.player_speed] = Math.hypot(vx, vz);
      v[F.player_radial_speed] = radial;
      v[F.player_lateral_speed] = lateral;
      v[F.player_vertical_speed] = vy;
      v[F.player_health] = tr.hp;
      v[F.player_visible] = tr.visible;
      v[F.player_confidence] = conf;
      v[F.time_since_seen] = tr.seenT > -Infinity ? t - tr.seenT : NEVER;
      v[F.player_attacking] = tr.attackT > -Infinity ? Math.exp(-(t - tr.attackT) / o.attackTau) : 0;
      v[F.time_since_player_attack] = tr.attackT > -Infinity ? t - tr.attackT : NEVER;
      if (tr.visible > 0 && tr.facingSeen) {
        const c = -(tr.fx * nx + tr.fz * nz);  // facing back along the line to the boss
        v[F.player_facing_me] = Math.max(0, Math.min(1, (c - 0.7) / 0.3));
      }
      v[F.player_dodging] = tr.dodgeT > -Infinity ? Math.exp(-(t - tr.dodgeT) / o.dodgeTau) : 0;
      v[F.player_airborne] = fresh && Math.abs(vy) > o.airborne ? 1 : 0;
      v[F.player_approaching] = Math.max(0, Math.min(1, -radial / o.run));
      v[F.player_retreating] = Math.max(0, Math.min(1, radial / o.run));
      v[F.player_noise] = tr.noiseT > -Infinity ? tr.noiseI * Math.exp(-(t - tr.noiseT) / o.noiseTau) : 0;
      v[F.los_blocked] = tr.blocked ? 1 : 0;
      v[F.player_cover] = Math.min(1, (tr.blocked || (tr.visible === 0 && conf > 0.1) ? 0.6 : 0) + 0.4 * this.playerWalls);
    }
    v[F.self_health] = Math.max(0, Math.min(1, (+self.hp || 0) / Math.max(1, +self.hpMax || 1)));
    v[F.self_speed] = Math.hypot(+self.vx || 0, +self.vz || 0);
    v[F.self_altitude] = +self.alt || 0;
    v[F.self_cooldown] = +self.cd || 0;
    v[F.self_state] = self.state | 0;
    v[F.time_since_self_attack] = this.lastSwingT > -Infinity ? t - this.lastSwingT : NEVER;
    v[F.self_cover] = this.selfCover;
    let near = 0, known = 0;
    for (const k of this.tracks.values()) {
      if (!k.alive || !k.have) continue;
      const c = this.confidence(k, t);
      if (c < 0.02) continue;
      known++;
      if (c > 0.3 && Math.hypot(k.bx - sx, k.bz - sz) < o.nearR) near++;
    }
    v[F.players_near] = near;
    v[F.players_known] = known;
    v[F.allies_near] = +obs.allies || 0;
    let taken = 0, dealt = 0;
    for (let k = 0; k < RING; k++) {
      if (t - this.takenT[k] < o.recent) taken += this.takenD[k];
      if (t - this.dealtT[k] < o.recent) dealt += this.dealtD[k];
    }
    v[F.damage_taken_recent] = taken / Math.max(1, +self.hpMax || 1);
    v[F.time_since_damaged] = this.lastDamagedT > -Infinity ? t - this.lastDamagedT : NEVER;
    v[F.damage_dealt_recent] = dealt;
    if (tr) {
      const conf = v[F.player_confidence];
      v[F.threat] = conf * (0.35 * Math.max(0, 1 - v[F.player_distance] / 60)
                          + 0.25 * v[F.player_attacking]
                          + 0.15 * v[F.player_facing_me])
                  + 0.25 * Math.min(1, v[F.damage_taken_recent] * 6);
    }
    ws.sanitize();
    return ws;
  }

  confidence(tr, t) {
    if (tr.visible > 0) return tr.visible;
    const o = this.o;
    const bySight = tr.seenT > -Infinity ? Math.exp(-(t - tr.seenT) / o.forget) : 0;
    const byEar = tr.heardT > -Infinity ? 0.6 * Math.exp(-(t - tr.heardT) / o.heardHold) : 0;
    return Math.max(bySight, byEar);
  }

  //  Is there a wall within r in this direction? Two footprint lookups when
  //  the host can answer them, a ray only when it cannot.
  wallNear(probe, solid, x, y, z, dx, dz, r) {
    if (solid) return solid(x + dx * r * 0.5, y, z + dz * r * 0.5) || solid(x + dx * r, y, z + dz * r) ? 1 : 0;
    this.probes++;
    return probe(x, y, z, dx, 0, dz, r) < r ? 1 : 0;
  }

  //  For the debug overlay (§30): what it believes, not what is true.
  beliefs() {
    const out = [];
    for (const tr of this.tracks.values()) {
      if (!tr.have) continue;
      out.push({ id: tr.id, x: +tr.bx.toFixed(2), z: +tr.bz.toFixed(2), visible: tr.visible,
                 confidence: +this.confidence(tr, this.t).toFixed(3), target: tr === this.target });
    }
    return out;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SensorLayer, SENSE, assertObservable, FORBIDDEN };
}
