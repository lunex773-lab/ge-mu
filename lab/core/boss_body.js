'use strict';
//  ============================================================
//  BEELZEBUB'S BODY — the combat engine end of §38
//  ============================================================
//
//  Takes an intent from the Tactical Brain and makes it happen in a world:
//  walking, flying, winding up, swinging, and deciding — against where the
//  players *actually* are, not where the brain believed — whether a blade
//  connected. The brain decides; the body is the only thing that touches.
//
//  It is written against a small world interface so the same file drives
//  the headless arena (lab/sim) and, in Phase 7, the city:
//
//    world.blocked(x, z, r)   is a body of radius r standing here inside something?
//    world.ground(x, z)       the height of the floor
//    world.roof(x, z)         optional: the top of whatever stands here (0 in the
//                             street). Flight climbs over it rather than through it,
//                             and never comes down onto it.
//
//  Attack numbers come from BEELZEBUB.md B2. Every wind-up goes through the
//  FairnessController's telegraph() so no difficulty can make one unreadable.

//  kind: [reach m, half-arc rad, wind s, active s, recover s, damage, cooldown s]
const ATTACKS = {
  reap:   { reach: 8.5,  arc: 1.40, wind: 0.55, act: 0.20, rec: 0.60, dmg: 22, cd: 1.2, ground: true },   // 160° in front
  whirl:  { reach: 10.5, arc: Math.PI, wind: 0.90, act: 0.35, rec: 0.90, dmg: 26, cd: 5.0, ground: true },   // all round
  //  飛翔斬: the lunge ends in a narrower cut than the standing reap. With the
  //  full 160° a sideways dodge could not clear it at the end of a 30 m
  //  lunge — the arithmetic, not a playtest, said so — and an attack you
  //  cannot get out of is the one thing §17 rules out.
  dash:   { reach: 8.5,  arc: 0.80, wind: 0.70, act: 0.20, rec: 1.00, dmg: 28, cd: 7.0, ground: true, lunge: 30 },
  dive:   { reach: 7.0,  arc: Math.PI, wind: 1.00, act: 0.25, rec: 1.20, dmg: 32, cd: 9.0, air: true },   // 急降下
};
const ATTACK_NAMES = Object.keys(ATTACKS);

const BODY = {
  radius: 1.2,
  height: 4.6,
  walk: 7.5,           // m/s — slower than a running player: on foot it can be outrun…
  fly: 16.0,           // …in the air it cannot. Flight is the answer to being kited: at
                       // 16 m/s for 8 s it closes ~46 m on a running player (13 m/s
                       // for 6 s closed 17, and the lab's RANGED bot kited it forever)
  turn: 4.5,           // rad/s
  flyAlt: 8,           // m
  climb: 10,           // m/s up and down
  flyMax: 8,           // s in the air at a time
  flyCd: 5,            // s on the ground after
  dashSpeed: 30,       // m/s during the lunge
  guardT: 1.2,         // s a wing guard lasts
  guardCut: 0.5,       // damage taken from the front while guarding
  sideStep: 9,         // m/s
};

function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

class BossBody {
  constructor(world, opts) {
    const o = Object.assign({ x: 0, z: 0, hd: 0, hpMax: 3000, fairness: null }, opts || {});
    this.world = world;
    this.fair = o.fairness;
    this.x = o.x; this.z = o.z; this.hd = o.hd; this.alt = 0;
    this.vx = 0; this.vz = 0;
    this.hpMax = o.hpMax * (this.fair ? this.fair.body.health : 1);
    this.hp = this.hpMax;
    this.mode = 'ground';          // ground | fly | attack | guard | dead
    this.atk = null;               // { kind, phase, t, wind, ax, az, hit, lx, lz }
    this.cd = {}; for (const k of ATTACK_NAMES) this.cd[k] = 0;
    this.flyT = 0; this.flyCd = 0; this.guardT = 0;
    this.goal = null;              // { x, z, speed (0..1), fly }
    this.stuckT = 0; this.flyHold = 0;  // wings are the way out of a dead end
    this.face = null;              // { x, z } to turn toward
    this.stats = { swings: 0, landed: 0, byKind: {} };
  }

  get alive() { return this.hp > 0; }
  get busy() { return this.mode === 'attack' || this.mode === 'guard' || this.mode === 'dead'; }
  get cooldown() {
    // the soonest any ground attack is ready, as a fraction of its own cooldown
    let best = 1;
    for (const k of ATTACK_NAMES) best = Math.min(best, this.cd[k] / ATTACKS[k].cd);
    return this.busy ? 1 : best;
  }
  ready(kind) {
    const A = ATTACKS[kind];
    if (!A || this.busy || this.cd[kind] > 0) return false;
    if (A.air && this.alt < BODY.flyAlt * 0.6) return false;
    if (A.ground && this.alt > 1.0) return false;
    return true;
  }

  // ---------------------------------------------------------- orders
  moveTo(x, z, speed, fly) { if (!this.busy) this.goal = { x, z, speed: Math.max(0, Math.min(1, speed)), fly: !!fly }; }
  faceTo(x, z) { this.face = { x, z }; }
  hold() { this.goal = null; }
  //  Start an attack aimed at (ax, az). Returns false if it cannot.
  attack(kind, ax, az) {
    if (!this.ready(kind)) return false;
    const A = ATTACKS[kind];
    const wind = this.fair ? this.fair.telegraph(A.wind) : A.wind;
    this.mode = 'attack';
    this.atk = { kind, phase: 'wind', t: 0, wind, ax, az, hit: new Set(), lx: 0, lz: 0 };
    this.goal = null;
    if (A.lunge) {
      const d = Math.hypot(ax - this.x, az - this.z) || 1;
      const go = Math.min(A.lunge, Math.max(0, d - A.reach * 0.6));
      this.atk.lx = this.x + (ax - this.x) / d * go; this.atk.lz = this.z + (az - this.z) / d * go;
    }
    this.cd[kind] = A.cd;
    this.stats.swings++;
    if (this.fair) this.fair.noteAttack(this.now || 0);
    return true;
  }
  guard() {
    if (this.busy || this.alt > 1) return false;
    this.mode = 'guard'; this.guardT = BODY.guardT; this.goal = null;
    return true;
  }
  takeOff() { if (!this.busy && this.flyCd <= 0 && this.alt < 0.5) { this.mode = 'fly'; this.flyT = 0; return true; } return false; }
  land() { if (this.mode === 'fly' && this.flyHold <= 0 && this.roofAt(this.x, this.z) <= 0) this.mode = 'ground'; }
  roofAt(x, z) { return this.world.roof ? this.world.roof(x, z) : 0; }

  //  A hit on the body. From the front while guarding, it is blunted.
  hurt(dmg, fromX, fromZ) {
    if (!this.alive) return 0;
    let d = dmg;
    if (this.mode === 'guard') {
      const a = wrap(Math.atan2(fromX - this.x, fromZ - this.z) - this.hd);
      if (Math.abs(a) < 1.2) d *= BODY.guardCut;
    }
    this.hp = Math.max(0, this.hp - d);
    if (this.hp <= 0) { this.mode = 'dead'; this.atk = null; this.goal = null; }
    return d;
  }

  // ---------------------------------------------------------- the step
  //  targets: [{ id, x, z, y, alive }] — the truth, for hit resolution only.
  //  hooks: { hit(id, dmg, kind), swing(kind), miss(kind) }
  step(dt, now, targets, hooks) {
    this.now = now;
    if (!this.alive) { this.vx = this.vz = 0; return; }
    for (const k of ATTACK_NAMES) if (this.cd[k] > 0) this.cd[k] = Math.max(0, this.cd[k] - dt);
    if (this.flyCd > 0) this.flyCd -= dt;
    const sp = this.fair ? this.fair.body.speed : 1;
    let tvx = 0, tvz = 0;

    if (this.mode === 'attack') {
      const a = this.atk, A = ATTACKS[a.kind];
      a.t += dt;
      if (a.phase === 'wind') {
        this.turnToward(a.ax, a.az, dt * 1.6);               // it can still track a little while winding up…
        if (a.kind === 'dive') { this.alt = Math.max(this.alt, BODY.flyAlt); }
        if (a.t >= a.wind) {
          a.t = 0;
          if (A.lunge || a.kind === 'dive') {
            // …but not once it is committed. The lunge and the dive carry it
            // to where it aimed, and only then does the blade move.
            a.phase = 'travel';
            if (a.kind === 'dive') { a.lx = a.ax; a.lz = a.az; }
            a.from = Math.hypot(a.lx - this.x, a.lz - this.z);
          } else { a.phase = 'act'; if (hooks && hooks.swing) hooks.swing(a.kind); }
        }
      } else if (a.phase === 'travel') {
        const dx = a.lx - this.x, dz = a.lz - this.z, d = Math.hypot(dx, dz);
        const step = Math.min(d, BODY.dashSpeed * sp * dt);
        let moved = true;
        if (d > 1e-3) {
          if (a.kind === 'dive') { this.x += dx / d * step; this.z += dz / d * step; }
          else moved = this.tryMove(this.x + dx / d * step, this.z + dz / d * step);
        }
        if (a.kind === 'dive') this.alt = BODY.flyAlt * Math.max(0, Math.min(1, (d - step) / Math.max(1, a.from)));
        if (d - step < 0.3 || !moved || a.t > 1.2) {
          a.phase = 'act'; a.t = 0;
          if (a.kind === 'dive') this.alt = 0;
          if (hooks && hooks.swing) hooks.swing(a.kind);
        }
      } else if (a.phase === 'act') {
        for (const tg of targets) {
          if (!tg.alive || a.hit.has(tg.id)) continue;
          if (this.inArc(A, tg.x, tg.z, tg.y || 0)) {
            a.hit.add(tg.id);
            const dmg = this.fair ? this.fair.damage(A.dmg) : A.dmg;
            this.stats.landed++;
            this.stats.byKind[a.kind] = (this.stats.byKind[a.kind] || 0) + 1;
            if (hooks && hooks.hit) hooks.hit(tg.id, dmg, a.kind);
          }
        }
        if (a.t >= A.act) {
          a.phase = 'rec'; a.t = 0;
          if (a.hit.size === 0 && hooks && hooks.miss) hooks.miss(a.kind);
        }
      } else if (a.t >= A.rec) {
        this.mode = this.alt > 0.5 ? 'fly' : 'ground'; this.atk = null;
        if (a.kind === 'dive') { this.flyCd = BODY.flyCd; this.mode = 'ground'; }
      }
    } else if (this.mode === 'guard') {
      this.guardT -= dt;
      if (this.face) this.turnToward(this.face.x, this.face.z, dt);
      if (this.guardT <= 0) this.mode = 'ground';
    } else {
      // walking or flying toward the goal
      const flying = this.mode === 'fly';
      if (this.flyHold > 0) this.flyHold -= dt;
      if (flying) {
        this.flyT += dt;
        //  high enough for whatever is under it and just ahead, and no higher
        let roof = this.roofAt(this.x, this.z);
        if (this.goal) {
          const gx = this.goal.x - this.x, gz = this.goal.z - this.z, gd = Math.hypot(gx, gz) || 1;
          roof = Math.max(roof, this.roofAt(this.x + gx / gd * 6, this.z + gz / gd * 6));
        }
        const want = Math.max(BODY.flyAlt, roof + 3);
        this.alt += Math.max(-BODY.climb * dt, Math.min(BODY.climb * dt, want - this.alt));
        const over = this.roofAt(this.x, this.z) > 0;
        const done = this.flyT > BODY.flyMax || (this.goal && !this.goal.fly && this.flyHold <= 0);
        if (done && !over) { this.mode = 'ground'; this.flyCd = BODY.flyCd; }
      } else if (this.alt > 0) this.alt = Math.max(0, this.alt - BODY.climb * dt);
      if (this.goal) {
        const dx = this.goal.x - this.x, dz = this.goal.z - this.z, d = Math.hypot(dx, dz);
        const v = (this.mode === 'fly' ? BODY.fly : BODY.walk) * sp * this.goal.speed;
        if (d > 0.3) {
          tvx = dx / d * v; tvz = dz / d * v;
          this.turnToward(this.goal.x, this.goal.z, dt);
        }
      } else if (this.face) this.turnToward(this.face.x, this.face.z, dt);
      const nx = this.x + tvx * dt, nz = this.z + tvz * dt;
      if (this.mode === 'fly') {
        // over the top, but only once it is actually above it
        if (this.alt > this.roofAt(nx, nz) + 1 && this.alt > 3) { this.x = nx; this.z = nz; }
      } else {
        const bx = this.x, bz = this.z;
        this.steer(nx, nz, tvx * dt, tvz * dt);
        //  walking into a wall it cannot slide round: take to the air
        const want = Math.hypot(tvx, tvz) * dt, got = Math.hypot(this.x - bx, this.z - bz);
        this.stuckT = want > 0.05 && got < want * 0.3 ? this.stuckT + dt : Math.max(0, this.stuckT - dt);
        if (this.stuckT > 0.8 && this.flyCd <= 0 && this.alt < 0.5) { this.stuckT = 0; this.mode = 'fly'; this.flyT = 0; this.flyHold = 2.5; }
      }
    }
    this.vx = (this.x - (this.px === undefined ? this.x : this.px)) / Math.max(dt, 1e-3);
    this.vz = (this.z - (this.pz === undefined ? this.z : this.pz)) / Math.max(dt, 1e-3);
    this.px = this.x; this.pz = this.z;
  }

  inArc(A, x, z, y) {
    const dx = x - this.x, dz = z - this.z, d = Math.hypot(dx, dz);
    if (d > A.reach + 0.5) return false;                  // + a player's own half-width
    if (y - this.alt > 3.5) return false;                 // they are on a roof above the swing
    if (A.arc >= Math.PI) return true;
    return Math.abs(wrap(Math.atan2(dx, dz) - this.hd)) <= A.arc;
  }
  turnToward(x, z, dt) {
    const want = Math.atan2(x - this.x, z - this.z);
    const d = wrap(want - this.hd), m = BODY.turn * dt;
    this.hd = wrap(this.hd + Math.max(-m, Math.min(m, d)));
  }
  tryMove(nx, nz) {
    if (!this.world.blocked(nx, nz, BODY.radius)) { this.x = nx; this.z = nz; return true; }
    return false;
  }
  //  Walk, sliding around what is in the way rather than stopping at it.
  steer(nx, nz, sx, sz) {
    if (this.tryMove(nx, nz)) return;
    const len = Math.hypot(sx, sz); if (len < 1e-6) return;
    const base = Math.atan2(sx, sz);
    for (const off of [0.5, -0.5, 1.0, -1.0, 1.5, -1.5]) {
      const a = base + off;
      if (this.tryMove(this.x + Math.sin(a) * len, this.z + Math.cos(a) * len)) return;
    }
  }
  //  What the Sensor Layer is told about the boss's own body.
  selfRecord(out) {
    const o = out || {};
    o.x = this.x; o.y = this.world.ground(this.x, this.z) + this.alt; o.z = this.z; o.hd = this.hd;
    o.vx = this.vx; o.vz = this.vz; o.hp = this.hp; o.hpMax = this.hpMax;
    o.cd = this.cooldown; o.state = ['ground', 'fly', 'attack', 'guard', 'dead'].indexOf(this.mode);
    o.alt = this.alt; o.world = 0;
    return o;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { BossBody, ATTACKS, ATTACK_NAMES, BODY, wrap };
