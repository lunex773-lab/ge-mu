'use strict';
//  ============================================================
//  TACTICAL BRAIN + ACTION SELECTOR  (spec §16, §30, §32)
//  ============================================================
//
//  §16's formula, literally:
//
//     utility(a) = RuleScore + w_N·NeuralScore + PredictionScore
//                + PositionScore + ThreatScore − RiskScore − CooldownPenalty
//
//  RuleScore is what the situation plainly asks for — a small set of
//  continuous functions of the WorldState, one per action, not a branching
//  script (§36 forbids the "大量if文による偽AI", and the rules are kept to
//  what can be written as a single expression each). NeuralScore is the
//  Neural Core's readout, centred so it can only tilt the choice, never
//  make an impossible action possible. PredictionScore only exists when the
//  FairnessController let a prediction through (§15: low confidence means
//  plain reacting). Memory enters through the episodic success rates:
//  an attack that keeps whiffing at this range scores lower here.
//
//  The geometry is recomputed every decision from the *delayed* belief of
//  where the player is (target_x/z) and the boss's *current* pose — the
//  delay is on what it knows about you, never on where it is itself.
//
//  The selector picks by softmax at the FairnessController's temperature,
//  with a commitment bonus and a minimum hold so it does not dither, and
//  every decision carries its reasons (§30).

const { F } = require('./worldstate.js');
const { ACTIONS } = require('./neural.js');
const { ATTACKS } = require('./boss_body.js');
const { MOTION, REACT } = require('./player_model.js');
const { bandOf } = require('./memory.js');

const NA = ACTIONS.length;
const A = {}; ACTIONS.forEach((a, i) => { A[a] = i; });
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

const DEFAULTS = {
  neuralWeight: 0.35,      // how far the core can tilt a choice (0 = rules only; ablation)
  usePrediction: true,     // ablation: without the player model
  stick: 0.12,             // bonus for carrying on with the current action
  minHold: 0.5,            // s before it will change its mind…
  override: 0.30,          // …unless something else is this much better
  exploreEvery: 1.2,       // s — how often the selector may roll the dice at all
  territory: 60,           // m from the gate it guards (B5)
  leash: 90,               // m — past this it goes home
};

class TacticalBrain {
  constructor(opts) {
    this.o = Object.assign({}, DEFAULTS, opts || {});
    this.util = new Float64Array(NA);
    this.parts = ACTIONS.map(() => ({ rule: 0, neural: 0, pred: 0, pos: 0, threat: 0, risk: 0, cd: 0 }));
    this.current = A.wait; this.since = -Infinity;
    this.decision = { action: 'wait', attack: null, aim: { x: 0, z: 0 }, move: null, fly: false,
                      reason: null, t: 0, faulted: false };
    this.gate = null;                        // { x, z } the thing it guards
    this.dodgeT = -Infinity; this.repoT = -Infinity;
  }

  //  in: view (FairnessController.perceive), readout (NeuralCore.readout or
  //      null), gated (FairnessController.gatePrediction or null), memory
  //      ({ episodic }), body ({ ready(kind), alt, canFly, canGuard }),
  //      fair (for mayAttack/aim/temperature), rng, now, targetId
  decide(ctx) {
    const { view, readout, gated, memory, body, fair, rng, now } = ctx;
    const o = this.o, v = view.v, u = this.util, P = this.parts;
    const sx = v[F.self_x], sz = v[F.self_z], hd = v[F.self_heading];
    const known = v[F.has_target] > 0.5 && v[F.player_confidence] > 0.05;
    const tx = v[F.target_x], tz = v[F.target_z];
    const dx = tx - sx, dz = tz - sz, d = known ? Math.hypot(dx, dz) : 999;
    const vis = v[F.player_visible], conf = v[F.player_confidence];
    const hp = v[F.self_health], th = v[F.threat], att = v[F.player_attacking], face = v[F.player_facing_me];
    const dmgT = v[F.damage_taken_recent], near = v[F.players_near], cov = v[F.player_cover];
    const alt = body.alt, flying = alt > 3;
    const band = bandOf(d);
    const ep = memory && memory.episodic;
    const sr = (kind) => (ep ? ep.successRate(kind, 60, now, band) : 0.5);

    // ---- where the player will be when a blade could reach them ----------
    //  (radial, lateral) in the frame of the line from boss to player
    const nx = d > 0.01 ? dx / d : Math.sin(hd), nz = d > 0.01 ? dz / d : Math.cos(hd);
    const lx = -nz, lz = nx;                                   // the boss's right, across that line
    const w = o.usePrediction && gated ? gated.weight : 0;
    const pm = gated && MOTION[gated.action] ? MOTION[gated.action] : [0, 0];
    const vr = (1 - w) * v[F.player_radial_speed] + w * pm[0];
    const vl = (1 - w) * v[F.player_lateral_speed] + w * pm[1];
    const lead = (h) => ({ x: tx + (vr * nx + vl * lx) * h, z: tz + (vr * nz + vl * lz) * h });
    //  How this player answers a given attack (the response model), if the
    //  fairness gate lets the boss believe it: where to aim so the answer
    //  walks into the blade, and how much the answer usually saves them.
    const respond = (kind, h) => {
      const r = o.usePrediction && ctx.respond ? ctx.respond(kind) : null;
      if (!r || !r.move) return { at: lead(h), ev: 1, w: 0 };
      //  as they are until they have seen it coming, then as this player
      //  usually answers this attack — by as much as it may trust that
      const vr0 = v[F.player_radial_speed], vl0 = v[F.player_lateral_speed];
      const after = Math.max(0, h - REACT);
      const rr = vr0 * Math.min(h, REACT) + ((1 - r.weight) * vr0 + r.weight * r.move[0]) * after;
      const rl = vl0 * Math.min(h, REACT) + ((1 - r.weight) * vl0 + r.weight * r.move[1]) * after;
      const at = { x: tx + rr * nx + rl * lx, z: tz + rr * nz + rl * lz };
      const wide = ATTACKS[kind].arc >= 1.3;            // reap, whirl, dive: only distance escapes them
      const escapes = r.action === 'away' || (wide && r.move[0] > 4);
      const ev = escapes && wide ? 1 - 0.6 * r.weight : r.action === 'stay' ? 1 + 0.3 * r.weight : 1 + 0.4 * r.weight;
      return { at, ev, w: r.weight, action: r.action };
    };
    const home = this.gate ? Math.hypot(sx - this.gate.x, sz - this.gate.z) : 0;
    const targetFromGate = this.gate && known ? Math.hypot(tx - this.gate.x, tz - this.gate.z) : 0;

    for (let i = 0; i < NA; i++) { u[i] = -Infinity; const p = P[i]; p.rule = p.neural = p.pred = p.pos = p.threat = p.risk = p.cd = 0; }
    const set = (a, rule, extra) => {
      const p = P[a]; p.rule = rule;
      if (extra) Object.assign(p, extra);
      u[a] = 0;                                                 // feasible; filled in below
    };

    // ---- rule scores: one expression per action ---------------------------
    let attackKind = null, attackAt = null;
    if (known && (vis > 0 || conf > 0.6) && fair.mayAttack(ctx.targetId, now)) {
      let bestEv = 0;
      for (const kind of ['reap', 'whirl']) {
        if (!body.ready(kind)) continue;
        const K = ATTACKS[kind];
        const rs = respond(kind, fair.telegraph(K.wind) + K.act * 0.5);
        const pd = Math.hypot(rs.at.x - sx, rs.at.z - sz);
        if (pd > K.reach + 0.5 && d > K.reach + 0.5) continue;
        const ev = sr(kind) * rs.ev * K.dmg / (fair.telegraph(K.wind) + K.act) * (kind === 'whirl' && near >= 2 ? 1.6 : 1);
        if (ev > bestEv) { bestEv = ev; attackKind = kind; attackAt = rs.at; this.attackW = rs.w; }
      }
      if (attackKind) {
        const pre = (d > ATTACKS[attackKind].reach && w > 0 ? 0.25 * w : 0) + 0.2 * (this.attackW || 0);
        set(A.attack, 0.55 + 0.45 * sr(attackKind), { pred: pre, pos: 0.1 * (1 - face), threat: 0.1 * th,
          risk: near >= 2 && attackKind === 'reap' ? 0.08 * (near - 1) : 0 });
      }
      let skill = null;
      if (body.ready('dive') && d < 22) skill = 'dive';
      else if (body.ready('dash') && d >= 12 && d <= 30 && vis > 0) skill = 'dash';
      if (skill) {
        const K = ATTACKS[skill];
        //  a lunge arrives about when the wind-up and the flight are over
        const rs = respond(skill, fair.telegraph(K.wind) + (skill === 'dash' ? Math.max(0, d - K.reach * 0.6) / 30 : 0.5));
        this.skill = skill; this.skillAt = rs.at;
        set(A.use_skill, (0.42 + 0.4 * sr(skill)) * Math.min(1.4, rs.ev), { pred: 0.2 * rs.w, pos: 0.1 * (1 - face) });
      }
    }
    if (known && d > 7) set(A.chase, vis > 0 ? 0.25 + 0.5 * clamp01((d - 7) / 40) : 0.3 * conf);
    if (known && w > 0 && d > 6 && d < 45 && (pm[0] !== 0 || pm[1] !== 0)) set(A.intercept, 0.35 + 0.5 * w);
    if (known && d > 14 && d < 70 && (face < 0.35 || (vis === 0 && cov > 0.5)))
      set(A.ambush, (0.2 + 0.45 * (1 - face) * (vis === 0 ? 0.8 : 1)) * (1 + (ep ? Math.min(2, ep.count_('ambush_success', 120, now)) * 0.15 : 0)));
    if (hp < 0.35 || dmgT > 0.05) set(A.retreat, clamp01((0.35 - hp) / 0.35) * 0.6 + Math.min(1, dmgT * 5) * 0.3 * (1 - hp),
      { threat: 0.15 * th });
    //  A dodge is a burst, not a stance: once one has started it cannot be
    //  chosen again for a moment, and inside scythe reach swinging back is
    //  worth more than stepping aside.
    const dodging = now - this.dodgeT < 0.6, repositioning = now - this.repoT < 1.8;
    if (known && att > 0.3 && face > 0.3 && d > 6 && (dodging || now - this.dodgeT > 2.5))
      set(A.dodge, 0.6 * att * face * Math.min(1, dmgT * 8 + 0.15) * (d > ATTACKS.whirl.reach ? 1 : 0.3), { threat: 0.15 * th });
    //  repositioning is also a manoeuvre, not a place to live: after one, it
    //  has to try something else for a few seconds
    if (known && (repositioning || (now - this.repoT > 5 && ((vis === 0 && conf > 0.2) || (ep && ep.count_('boss_attack_failed', 10, now) >= 2)))))
      set(A.reposition, 0.25 + (vis === 0 ? 0.2 : 0) + (ep ? Math.min(3, ep.count_('boss_attack_failed', 10, now)) / 3 * 0.25 : 0));
    set(A.wait, known ? 0.08 : 0.6);
    if (known && body.canGuard && att > 0.5 && face > 0.5 && d > 14) set(A.defend, 0.45 * att * face * (1 - 0.5 * hp), { threat: 0.15 * th });

    // ---- the core tilts; the selector chooses -----------------------------
    let mean = 0;
    if (readout && o.neuralWeight > 0) { for (const a of ACTIONS) mean += readout.scores[a]; mean /= NA; }
    for (let i = 0; i < NA; i++) {
      if (u[i] === -Infinity) continue;
      const p = P[i];
      if (readout && o.neuralWeight > 0) p.neural = o.neuralWeight * (readout.scores[ACTIONS[i]] - mean);
      if (i === A.attack || i === A.use_skill) p.cd = 0.5 * v[F.self_cooldown];
      u[i] = p.rule + p.neural + p.pred + p.pos + p.threat - p.risk - p.cd;
    }
    const pick = this.select(u, fair.temperature(), rng, now);

    // ---- the guardian's leash overrides everything (B5) -------------------
    const dec = this.decision;
    dec.t = now; dec.attack = null; dec.move = null; dec.fly = false;
    const leashed = this.gate && (home > o.leash || (targetFromGate > o.leash && home > o.territory * 0.5));
    let act = leashed ? A.retreat : pick;
    if (leashed) this.current = A.retreat;
    dec.action = ACTIONS[act];

    // ---- what it means for the body ---------------------------------------
    const aimOut = {};
    switch (act) {
      case A.attack: {
        const at = attackAt || { x: tx, z: tz };
        fair.aim(tx, tz, at.x, at.z, aimOut);
        dec.attack = attackKind; dec.aim.x = aimOut.x; dec.aim.z = aimOut.z;
        break;
      }
      case A.use_skill: {
        fair.aim(tx, tz, this.skillAt.x, this.skillAt.z, aimOut);
        dec.attack = this.skill; dec.aim.x = aimOut.x; dec.aim.z = aimOut.z;
        break;
      }
      case A.chase: dec.move = { x: tx, z: tz, speed: 1 }; dec.fly = d > 35 && body.canFly; break;
      case A.intercept: { const at = lead(Math.min(2.5, d / 9)); dec.move = { x: at.x, z: at.z, speed: 1 }; dec.fly = d > 25 && body.canFly; break; }
      case A.ambush: {
        // come round to the side it is not being watched from, over the top if it can
        const side = v[F.player_lateral_speed] >= 0 ? -1 : 1;
        dec.move = { x: tx - nx * 9 + lx * side * 14, z: tz - nz * 9 + lz * side * 14, speed: 1 };
        dec.fly = body.canFly;
        break;
      }
      case A.retreat: {
        const g = this.gate || { x: sx - nx * 20, z: sz - nz * 20 };
        dec.move = { x: g.x, z: g.z, speed: 1 }; dec.fly = leashed && home > 40 && body.canFly;
        break;
      }
      case A.dodge: {
        if (this.since === now || now - this.dodgeT > 0.6) { this.dodgeT = now; this.dodgeSide = rng.next() < 0.5 ? -1 : 1; }
        const side = this.dodgeSide;
        dec.move = { x: sx + lx * side * 8, z: sz + lz * side * 8, speed: 1 };
        break;
      }
      case A.reposition: {
        if (this.since === now || now - this.repoT > 1.8) { this.repoT = now; this.repoTurn = rng.next() < 0.5 ? 0.9 : -0.9; }
        const a = Math.atan2(sx - tx, sz - tz) + this.repoTurn;
        const r = Math.max(10, Math.min(22, d));
        dec.move = { x: tx + Math.sin(a) * r, z: tz + Math.cos(a) * r, speed: 0.9 };
        break;
      }
      case A.defend: dec.guard = true; break;
      default: {
        // wait: face what it knows, or drift back to its post
        if (this.gate && home > 6 && !known) dec.move = { x: this.gate.x, z: this.gate.z, speed: 0.5 };
      }
    }
    dec.guard = act === A.defend;
    dec.face = known ? { x: tx, z: tz } : null;
    dec.reason = this.explain(act, w, d, leashed);
    return dec;
  }

  //  Greedy with a commitment bonus, and exploration (§17's tactical
  //  randomness) drawn once per plan rather than every tick: a boss that
  //  re-rolls ten times a second does not look unpredictable, it looks broken.
  select(u, temp, rng, now) {
    const cur = this.current;
    this.stuck = u[cur] > -Infinity ? cur : -1;
    if (u[cur] > -Infinity) u[cur] += this.o.stick;
    let best = 0;
    for (let i = 1; i < NA; i++) if (u[i] > u[best]) best = i;
    // hold the current plan for a moment unless something is clearly better
    if (u[cur] > -Infinity && now - this.since < this.o.minHold && u[best] < u[cur] + this.o.override) return cur;
    let pick = best;
    const explore = now - (this.exploreT === undefined ? -Infinity : this.exploreT) >= this.o.exploreEvery;
    if (temp > 1e-6 && explore) {
      this.exploreT = now;
      let sum = 0;
      const e = this._e || (this._e = new Float64Array(NA));
      for (let i = 0; i < NA; i++) { e[i] = u[i] > -Infinity ? Math.exp((u[i] - u[best]) / temp) : 0; sum += e[i]; }
      let r = rng.next() * sum;
      for (let i = 0; i < NA; i++) { r -= e[i]; if (r <= 0 && e[i] > 0) { pick = i; break; } }
    }
    if (pick !== cur) { this.current = pick; this.since = now; }
    return pick;
  }

  //  §30: the three best candidates with what made up their scores.
  explain(act, w, d, leashed) {
    const order = [];
    for (let i = 0; i < NA; i++) if (this.util[i] > -Infinity) order.push(i);
    order.sort((a, b) => this.util[b] - this.util[a]);
    return {
      selected: ACTIONS[act], leashed: !!leashed, prediction_weight: +w.toFixed(3), distance: +d.toFixed(1),
      candidates: order.slice(0, 3).map((i) => {
        const p = this.parts[i];
        return { action: ACTIONS[i], utility: +this.util[i].toFixed(3), commit: i === this.stuck ? this.o.stick : 0,
                 rule: +p.rule.toFixed(3), neural: +p.neural.toFixed(3),
                 prediction: +p.pred.toFixed(3), position: +p.pos.toFixed(3), threat: +p.threat.toFixed(3),
                 risk: +p.risk.toFixed(3), cooldown: +p.cd.toFixed(3) };
      }),
    };
  }
}

//  ---- §32 Fallback -----------------------------------------------------
//  Wraps the brain. A thrown error, a NaN anywhere in the utilities, or a
//  decision that ran over its time budget three times in a row switches to
//  the plain FSM for ten seconds, then tries the brain again. The game never
//  stops because the AI did.
class SafeBrain {
  constructor(brain, fallback, opts) {
    this.brain = brain; this.fallback = fallback;
    this.o = Object.assign({ budgetMs: 4, strikes: 3, coolOff: 10 }, opts || {});
    this.slow = 0; this.until = -Infinity; this.faults = 0; this.lastError = null;
    this.clock = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
  }
  decide(ctx) {
    if (ctx.now < this.until) return this.fb(ctx);
    const t0 = this.clock();
    let d;
    try { d = this.brain.decide(ctx); }
    catch (e) { this.lastError = String(e && e.message || e); return this.trip(ctx); }
    const ms = this.clock() - t0;
    let bad = !d || !d.action;
    const u = this.brain.util;
    if (u) for (let i = 0; i < u.length && !bad; i++) if (Number.isNaN(u[i])) bad = true;
    if (d && d.aim && !(Number.isFinite(d.aim.x) && Number.isFinite(d.aim.z))) bad = true;
    if (bad) { this.lastError = 'invalid decision'; return this.trip(ctx); }
    this.slow = ms > this.o.budgetMs ? this.slow + 1 : 0;
    if (this.slow >= this.o.strikes) { this.lastError = 'over budget ' + ms.toFixed(2) + ' ms'; return this.trip(ctx); }
    d.faulted = false;
    return d;
  }
  trip(ctx) { this.faults++; this.slow = 0; this.until = ctx.now + this.o.coolOff; return this.fb(ctx); }
  fb(ctx) { const d = this.fallback.decide(ctx); d.faulted = true; return d; }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { TacticalBrain, SafeBrain, DEFAULTS, A };
