'use strict';
//  ============================================================
//  FSM BRAIN — ablation baseline A/B (§25) and the fallback (§32)
//  ============================================================
//
//  The boss as it would be written without any of this project: chase, swing
//  when in reach, lunge from mid range, dive from the air, go home when
//  dragged too far. It is the yardstick the Neural Core has to beat (§25 A),
//  and with `usePrediction` it leads its aim with the player model (§25 B).
//
//  It is also what SafeBrain drops to when the real brain faults, so it
//  must never throw and never need anything the real brain might have
//  broken: it reads the view, the body and the fairness controller only.

const { F } = require('./worldstate.js');
const { ATTACKS } = require('./boss_body.js');
const { MOTION, REACT } = require('./player_model.js');

class FsmBrain {
  constructor(opts) {
    this.o = Object.assign({ usePrediction: false, territory: 60, leash: 90 }, opts || {});
    this.decision = { action: 'wait', attack: null, aim: { x: 0, z: 0 }, move: null, fly: false, guard: false,
                      face: null, reason: null, t: 0, faulted: false };
    this.gate = null;
  }
  decide(ctx) {
    const { view, gated, body, fair, now } = ctx;
    const v = view.v, dec = this.decision;
    dec.t = now; dec.attack = null; dec.move = null; dec.fly = false; dec.guard = false; dec.face = null;
    const sx = v[F.self_x], sz = v[F.self_z];
    const known = v[F.has_target] > 0.5 && v[F.player_confidence] > 0.05;
    const tx = v[F.target_x], tz = v[F.target_z];
    const d = known ? Math.hypot(tx - sx, tz - sz) : 999;
    const home = this.gate ? Math.hypot(sx - this.gate.x, sz - this.gate.z) : 0;
    const far = this.gate && known && Math.hypot(tx - this.gate.x, tz - this.gate.z) > this.o.leash;
    if (!known || (this.gate && (home > this.o.leash || (far && home > this.o.territory * 0.5)))) {
      dec.action = known ? 'retreat' : 'wait';
      if (this.gate && home > 4) dec.move = { x: this.gate.x, z: this.gate.z, speed: known ? 1 : 0.5 };
      dec.fly = !!(this.gate && home > 40 && body.canFly);
      dec.reason = { selected: dec.action, fsm: true };
      return dec;
    }
    dec.face = { x: tx, z: tz };
    // where to aim: where they are — or, with the player model, where it thinks they are going
    let ax = tx, az = tz;
    if (this.o.usePrediction && gated && MOTION[gated.action]) {
      const nx = (tx - sx) / (d || 1), nz = (tz - sz) / (d || 1), m = MOTION[gated.action], h = 0.6;
      ax += (m[0] * nx - m[1] * nz) * h * gated.weight;
      az += (m[0] * nz + m[1] * nx) * h * gated.weight;
    }
    const may = fair.mayAttack(ctx.targetId, now);
    let kind = null;
    if (may && d <= ATTACKS.reap.reach && body.ready('reap')) kind = 'reap';
    else if (may && d <= ATTACKS.whirl.reach && body.ready('whirl')) kind = 'whirl';
    else if (may && body.ready('dive') && d < 22) kind = 'dive';
    else if (may && body.ready('dash') && d >= 12 && d <= 30 && v[F.player_visible] > 0) kind = 'dash';
    //  with the player model, lead the swing by how this player answers it
    const r = kind && this.o.usePrediction && ctx.respond ? ctx.respond(kind) : null;
    if (r && r.move) {
      const nx = (tx - sx) / (d || 1), nz = (tz - sz) / (d || 1), m = r.move;
      const h = Math.max(0, fair.telegraph(ATTACKS[kind].wind) + (kind === 'dash' ? Math.max(0, d - 5) / 30 : 0.1) - REACT);
      ax = tx + (m[0] * nx - m[1] * nz) * r.weight * h;
      az = tz + (m[0] * nz + m[1] * nx) * r.weight * h;
    }
    const aim = fair.aim(tx, tz, ax, az, {});
    if (kind) {
      dec.action = kind === 'dash' || kind === 'dive' ? 'use_skill' : 'attack';
      dec.attack = kind; dec.aim.x = aim.x; dec.aim.z = aim.z;
    } else {
      dec.action = 'chase';
      dec.move = { x: ax, z: az, speed: 1 };
      dec.fly = d > 35 && body.canFly;
    }
    dec.reason = { selected: dec.action, fsm: true, distance: +d.toFixed(1) };
    return dec;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { FsmBrain };
