'use strict';
//  ============================================================
//  BOSS AI LAB — player bots  (spec §23)
//  ============================================================
//
//  Six kinds of player, so the boss is never tuned against one:
//
//    AGGRESSIVE  inside 6-12 m, circling, shooting; rarely dodges
//    DEFENSIVE   22-34 m, dodges often, ducks behind cover when hurt or reloading
//    RANGED      40-60 m, backs off whenever the boss comes on
//    DODGER      12-20 m, dodges nearly everything — and nearly always to the
//                same side. That habit is the thing a player model can learn.
//    RANDOM      no plan at all; new intention every second or so, and a dodge
//                in any direction whatever — even toward the blade. It is the
//                control for "does remembering help": a player with nothing
//                consistent about them gives memory nothing to find. (It used
//                to dodge away from the reap like everyone else, and memory
//                duly found that: +4.8 points of hit rate, [+1.6, +7.8].)
//    ADAPTIVE    tries the other styles and keeps whichever is working, the
//                way a person does
//
//  Bots see what a player sees: the boss's body and its wind-ups. They react
//  to a wind-up after a human reaction time (0.22-0.32 s), and whether a
//  dodge saves them is decided by the boss's body against where they ended
//  up — nothing here knows the boss's intent.

const RUN = 10.2, DODGE_SPEED = 11, DODGE_T = 0.45;
const FIRE = 0.22, MAG = 30, RELOAD = 1.6, DMG = 20;

const STYLES = {
  AGGRESSIVE: { band: [6, 12], strafe: 0.35, dodge: 0.30, habit: 0, aim: 1.00, cover: false, kite: false },
  DEFENSIVE:  { band: [22, 34], strafe: 0.50, dodge: 0.60, habit: 0, aim: 0.95, cover: true, kite: false },
  RANGED:     { band: [40, 60], strafe: 0.40, dodge: 0.50, habit: 0, aim: 0.85, cover: false, kite: true },
  DODGER:     { band: [12, 20], strafe: 0.70, dodge: 0.90, habit: 0.85, side: 1, aim: 0.90, cover: false, kite: false },
  DODGER_L:   { band: [12, 20], strafe: 0.70, dodge: 0.90, habit: 0.85, side: -1, aim: 0.90, cover: false, kite: false },
};
const BOT_TYPES = ['AGGRESSIVE', 'DEFENSIVE', 'RANGED', 'DODGER', 'RANDOM', 'ADAPTIVE'];

class PlayerBot {
  constructor(type, arena, rng, start) {
    this.type = type; this.arena = arena; this.rng = rng;
    this.id = 'p1';
    this.x = start.x; this.z = start.z; this.y = 0; this.vx = 0; this.vz = 0;
    this.hp = 100; this.fx = 0; this.fz = 1;
    this.fireCd = 0; this.ammo = MAG; this.reload = 0;
    this.dodgeT = 0; this.ddx = 0; this.ddz = 0; this.dodges = { left: 0, right: 0 };
    this.reactAt = -1; this.seenAtk = null;
    this.strafeDir = rng.next() < 0.5 ? -1 : 1; this.flipT = 2;
    this.style = STYLES[type] || STYLES.AGGRESSIVE;
    this.mode = 'hold'; this.modeT = 0;                      // RANDOM's current whim
    // ADAPTIVE: a bandit over the styles
    this.arms = ['AGGRESSIVE', 'DEFENSIVE', 'RANGED', 'DODGER', 'DODGER_L'].map((k) => ({ k, n: 0, v: 0 }));
    this.armT = 0; this.arm = 0; this.armDealt = 0; this.armTaken = 0;
    if (type === 'ADAPTIVE') this.style = STYLES.AGGRESSIVE;
    this.dealt = 0; this.shots = 0; this.hits = 0;
  }
  get alive() { return this.hp > 0; }

  //  boss: a BossBody. hooks: { shot(x, y, z), hitBoss(dmg) }
  step(dt, now, boss, hooks) {
    if (!this.alive) { this.vx = this.vz = 0; return; }
    const rng = this.rng, st = this.style;
    const dx = boss.x - this.x, dz = boss.z - this.z, d = Math.hypot(dx, dz) || 1e-3;
    //  n points from the player to the boss. The boss, facing the player,
    //  looks along -n, so its right is (n.z, -n.x) — the axis `lateral`
    //  and a dodge's `side` are measured on, + being the boss's right.
    const nx = dx / d, nz = dz / d;

    if (this.type === 'ADAPTIVE') this.adapt(dt);
    if (this.type === 'RANDOM') this.whim(dt);

    // ---- a wind-up seen: react after a human delay ----------------------
    if (boss.mode === 'attack' && boss.atk && boss.atk.phase === 'wind' && boss.atk !== this.seenAtk) {
      this.seenAtk = boss.atk;
      this.reactAt = now + 0.22 + rng.next() * 0.10;
    }
    if (this.reactAt > 0 && now >= this.reactAt) {
      this.reactAt = -1;
      const k = boss.atk && boss.atk.kind;
      const threatened = k && (k === 'dash' || k === 'dive' || d < 13);
      const p = this.type === 'RANDOM' ? 0.5 : st.dodge;
      if (threatened && rng.next() < p) this.dodge(k, nx, nz);
    }

    // ---- where it wants to go -------------------------------------------
    let vx = 0, vz = 0;
    if (this.dodgeT > 0) {
      this.dodgeT -= dt; vx = this.ddx * DODGE_SPEED; vz = this.ddz * DODGE_SPEED;
    } else {
      this.flipT -= dt;
      if (this.flipT <= 0) { this.flipT = 2 + rng.next() * 2; if (rng.next() < 0.5) this.strafeDir *= -1; }
      let radial = 0, lateral = st.strafe * this.strafeDir;
      if (this.type === 'RANDOM') {
        radial = this.mode === 'approach' ? -1 : this.mode === 'retreat' ? 1 : 0;
        lateral = this.mode === 'left' ? -0.7 : this.mode === 'right' ? 0.7 : 0;
      } else {
        if (d < st.band[0]) radial = st.kite ? 1 : 0.8;
        else if (d > st.band[1]) radial = -0.8;
      }
      // hiding when it hurts or the magazine is empty
      if (st.cover && (this.hp < 50 || this.reload > 0)) {
        const spot = this.coverSpot(boss);
        if (spot) { const cx = spot.x - this.x, cz = spot.z - this.z, cd = Math.hypot(cx, cz);
          if (cd > 0.8) { vx = cx / cd * RUN; vz = cz / cd * RUN; } radial = lateral = 0; }
      }
      // radial + is away from the boss; lateral + is toward the boss's right
      vx += (-nx * radial + nz * lateral) * RUN;
      vz += (-nz * radial - nx * lateral) * RUN;
      const s = Math.hypot(vx, vz); if (s > RUN) { vx *= RUN / s; vz *= RUN / s; }
    }
    this.move(vx * dt, vz * dt);
    this.vx = vx; this.vz = vz;

    // ---- shooting: facing the boss, if it can be seen -------------------
    this.fireCd -= dt;
    if (this.reload > 0) { this.reload -= dt; if (this.reload <= 0) this.ammo = MAG; }
    const bossY = boss.alt + 2.5;
    const see = boss.alive && this.arena.los(this.x, 1.6, this.z, boss.x, bossY, boss.z);
    const wantShoot = see && d < 110 && (this.type !== 'RANDOM' || this.mode !== 'hold');
    if (see) { this.fx = nx; this.fz = nz; } else if (Math.hypot(vx, vz) > 0.5) { const s = Math.hypot(vx, vz); this.fx = vx / s; this.fz = vz / s; }
    if (wantShoot && this.reload <= 0 && this.fireCd <= 0) {
      this.fireCd = FIRE; this.ammo--; this.shots++;
      if (hooks && hooks.shot) hooks.shot(this.x, 1.6, this.z);
      const bossSpeed = Math.hypot(boss.vx, boss.vz);
      let p = 0.85 * st.aim - d / 150 - 0.02 * bossSpeed - (boss.alt > 3 ? 0.1 : 0);
      if (this.dodgeT > 0) p *= 0.5;
      p = Math.max(0.08, Math.min(0.9, p));
      if (rng.next() < p) { this.hits++; if (hooks && hooks.hitBoss) { const got = hooks.hitBoss(DMG); this.dealt += got; this.armDealt += got; } }
      if (this.ammo <= 0) this.reload = RELOAD;
    }
  }

  //  Which way: a habit if it has one, a coin if not. Away from the reap,
  //  across the line of a lunge, straight out from under a dive. `side` is
  //  in the boss's frame: +1 is the boss's right.
  dodge(kind, nx, nz) {
    const st = this.style;
    if (this.type === 'RANDOM') {
      const a = this.rng.next() * Math.PI * 2;
      this.ddx = Math.sin(a); this.ddz = Math.cos(a); this.dodgeT = DODGE_T;
      if (this.ddx * nz - this.ddz * nx > 0) this.dodges.right++; else this.dodges.left++;
      return;
    }
    let side = this.rng.next() < 0.5 ? -1 : 1;
    if (st.habit && this.rng.next() < st.habit) side = st.side;
    const rx = nz, rz = -nx;                                  // the boss's right (see step)
    const away = kind === 'dash' ? 0.25 : kind === 'dive' ? 1.0 : 0.8;
    const across = kind === 'dash' ? 1.0 : kind === 'dive' ? 0.2 : 0.6;
    let x = -nx * away + rx * side * across, z = -nz * away + rz * side * across;
    const l = Math.hypot(x, z) || 1; this.ddx = x / l; this.ddz = z / l;
    this.dodgeT = DODGE_T;
    if (side > 0) this.dodges.right++; else this.dodges.left++;
  }

  move(sx, sz) {
    const a = this.arena;
    if (!a.blocked(this.x + sx, this.z + sz, 0.5)) { this.x += sx; this.z += sz; return; }
    if (!a.blocked(this.x + sx, this.z, 0.5)) { this.x += sx; return; }
    if (!a.blocked(this.x, this.z + sz, 0.5)) { this.z += sz; }
  }

  coverSpot(boss) {
    let best = null, bd = Infinity;
    for (const b of this.arena.boxes) {
      if (b[3] < 2) continue;
      const cx = (b[0] + b[1]) / 2, cz = (b[4] + b[5]) / 2;
      const ax = cx - boss.x, az = cz - boss.z, al = Math.hypot(ax, az) || 1;
      const r = Math.max(b[1] - b[0], b[5] - b[4]) / 2 + 2.5;
      const sx = cx + ax / al * r, sz = cz + az / al * r;
      const d = Math.hypot(sx - this.x, sz - this.z);
      if (d < bd && !this.arena.blocked(sx, sz, 0.6)) { bd = d; best = { x: sx, z: sz }; }
    }
    return bd < 45 ? best : null;
  }

  whim(dt) {
    this.modeT -= dt;
    if (this.modeT > 0) return;
    this.modeT = 0.5 + this.rng.next();
    const m = ['approach', 'retreat', 'left', 'right', 'hold', 'shoot'];
    this.mode = m[Math.floor(this.rng.next() * m.length)];
  }

  //  Every 15 s, score the style it was using (damage dealt against damage
  //  taken) and pick the next: usually the best so far, sometimes a new one.
  adapt(dt) {
    this.armT += dt;
    if (this.armT < 15) return;
    const a = this.arms[this.arm];
    const score = this.armDealt / 20 - this.armTaken / 5;
    a.n++; a.v += (score - a.v) / a.n;
    this.armT = 0; this.armDealt = 0; this.armTaken = 0;
    const untried = this.arms.findIndex((q) => q.n === 0);
    if (untried >= 0) this.arm = untried;
    else if (this.rng.next() < 0.2) this.arm = Math.floor(this.rng.next() * this.arms.length);
    else { let b = 0; for (let i = 1; i < this.arms.length; i++) if (this.arms[i].v > this.arms[b].v) b = i; this.arm = b; }
    this.style = STYLES[this.arms[this.arm].k];
  }
  hurt(dmg) { this.hp = Math.max(0, this.hp - dmg); this.armTaken += dmg; }
  //  As the Sensor Layer's observation of this player.
  bodyRecord(out) {
    const o = out || {};
    o.id = this.id; o.x = this.x; o.y = this.y; o.z = this.z; o.fx = this.fx; o.fz = this.fz;
    o.hp = this.hp; o.hpMax = 100; o.dead = !this.alive; o.cloak = false; o.world = 0;
    return o;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { PlayerBot, STYLES, BOT_TYPES, RUN, DMG };
