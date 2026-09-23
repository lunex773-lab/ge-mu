'use strict';
//  ============================================================
//  FAIRNESS CONTROLLER  (spec §17, §18, §40)
//  ============================================================
//
//  §40's goal has two halves and this file is the second one: "強いが、学習
//  すれば攻略できる". Everything above it — the core, the player model, the
//  tactics — is trying to win. This is what keeps winning from being the
//  same thing as being unbeatable, and it sits in the path rather than
//  beside it so nothing upstream can route around it.
//
//  §18 asks for "AIの知能" and "ゲーム上の強さ" to be separate, and that
//  separation is the spine here. A difficulty is two independent profiles:
//
//    mind   how well it reads you: reaction time, how far it trusts its
//           predictions, how much it remembers, how often it guesses wrong
//    body   how hard it is to survive: damage, health, speed, how long it
//           telegraphs, how much breathing room it leaves after a hit
//
//  ADAPTIVE (the default, B10) moves only the mind. A good player gets read
//  more closely; they never get a boss with more health for being good.
//
//  The constraints, each from §17:
//
//    reaction delay     the brain sees the world as it was `reaction` s ago —
//                       a ring of past WorldStates, no allocation (D8). Its
//                       own body is proprioception and is never delayed.
//    confidence gate    a prediction below the threshold is not acted on at
//                       all; the tactics fall back to reacting (§15)
//    occasional error   even a confident prediction is sometimes swapped for
//                       a wrong one, at a rate the difficulty sets
//    attack pacing      a budget of attacks per window, and a relief window
//                       after it lands a hit on someone, so a hit cannot
//                       become a stun-lock
//    telegraph floor    every attack winds up for at least TELEGRAPH_MIN s,
//                       whatever the difficulty — being avoidable is not a
//                       setting
//    aim                it leads a moving target only as far as its accuracy
//                       and prediction strength allow, with a scatter
//    randomness         a softmax temperature for the action selector

const { WorldState, FIELDS, N_FIELDS } = require('./worldstate.js');
const { makeRng, gauss } = require('./rng.js');

const TELEGRAPH_MIN = 0.40;      // s — no attack winds up faster than this, at any difficulty

//  Numbers are starting points for Phase 9 to measure, not conclusions.
const MIND = {
  //            reaction  predStrength  predThreshold  memory  learnRate  explore  accuracy  adaptSpeed  errorRate
  EASY:      { reaction: 0.45, prediction_strength: 0.30, prediction_threshold: 0.75, memory_length: 60,
               learning_rate: 0.05, exploration_rate: 0.30, attack_accuracy: 0.55, adaptation_speed: 0.30, error_rate: 0.20 },
  NORMAL:    { reaction: 0.32, prediction_strength: 0.60, prediction_threshold: 0.62, memory_length: 150,
               learning_rate: 0.10, exploration_rate: 0.18, attack_accuracy: 0.75, adaptation_speed: 0.50, error_rate: 0.12 },
  HARD:      { reaction: 0.22, prediction_strength: 0.85, prediction_threshold: 0.50, memory_length: 400,
               learning_rate: 0.18, exploration_rate: 0.09, attack_accuracy: 0.90, adaptation_speed: 0.75, error_rate: 0.06 },
  NIGHTMARE: { reaction: 0.15, prediction_strength: 1.00, prediction_threshold: 0.42, memory_length: 1000,
               learning_rate: 0.25, exploration_rate: 0.04, attack_accuracy: 0.97, adaptation_speed: 1.00, error_rate: 0.03 },
};
const BODY = {
  EASY:      { damage: 0.70, health: 0.75, speed: 0.90, telegraph: 1.30, relief: 1.40, pressure: 3 },
  NORMAL:    { damage: 1.00, health: 1.00, speed: 1.00, telegraph: 1.00, relief: 1.00, pressure: 4 },
  HARD:      { damage: 1.20, health: 1.25, speed: 1.08, telegraph: 0.90, relief: 0.75, pressure: 5 },
  NIGHTMARE: { damage: 1.45, health: 1.60, speed: 1.15, telegraph: 0.80, relief: 0.55, pressure: 6 },
};
const LEVELS = ['EASY', 'NORMAL', 'HARD', 'NIGHTMARE'];
const DIFFICULTIES = LEVELS.concat(['ADAPTIVE']);
const PRESSURE_WINDOW = 6;       // s

//  ADAPTIVE moves the mind along EASY (0) -> NORMAL (0.4) -> HARD (1).
//  NIGHTMARE is something you ask for, never something you are handed.
const ADAPT_START = 0.4;
function mindAt(level) {
  const l = Math.max(0, Math.min(1, level));
  const [a, b, f] = l <= 0.4 ? [MIND.EASY, MIND.NORMAL, l / 0.4] : [MIND.NORMAL, MIND.HARD, (l - 0.4) / 0.6];
  const out = {};
  for (const k of Object.keys(a)) out[k] = a[k] + (b[k] - a[k]) * f;
  out.memory_length = Math.round(out.memory_length);
  return out;
}

//  Which WorldState fields are the boss's own body — never delayed.
const SELF_IDX = [];
FIELDS.forEach((f, i) => { if (f[4] === 'self') SELF_IDX.push(i); });

//  A ring of past WorldStates. push() copies in, read() returns the newest
//  one at least `delay` old. Slots are allocated once.
class DelayLine {
  constructor(capacity) {
    this.cap = capacity || 32;
    this.slots = [];
    for (let i = 0; i < this.cap; i++) this.slots.push(new WorldState());
    this.head = 0; this.count = 0;
  }
  push(ws) {
    this.slots[this.head].copyFrom(ws);
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
  }
  //  null until something old enough exists: a brain that has only just
  //  started seeing has not seen anything yet.
  read(now, delay) {
    for (let k = 1; k <= this.count; k++) {
      const s = this.slots[(this.head - k + this.cap) % this.cap];
      if (s.t <= now - delay + 1e-9) return s;
    }
    return null;
  }
  clear() { this.count = 0; this.head = 0; }
}

class FairnessController {
  constructor(opts) {
    const o = Object.assign({ difficulty: 'ADAPTIVE', seed: 0xfa1e, capacity: 32 }, opts || {});
    if (!DIFFICULTIES.includes(o.difficulty)) throw new Error('unknown difficulty ' + o.difficulty);
    this.difficulty = o.difficulty;
    this.rng = makeRng(o.seed);
    this.line = new DelayLine(o.capacity);
    this.view = new WorldState();
    this.level = o.level === undefined ? ADAPT_START : o.level;
    this.mind = o.difficulty === 'ADAPTIVE' ? mindAt(this.level) : Object.assign({}, MIND[o.difficulty]);
    this.body = Object.assign({}, BODY[o.difficulty === 'ADAPTIVE' ? 'NORMAL' : o.difficulty]);
    // pacing
    this.attackT = new Float64Array(8).fill(-1e9); this.attackK = 0;
    this.relief = new Map();                 // target id -> time its relief window ends
    // ADAPTIVE's read of how the fight is going
    this.bossLoss = 0; this.playerLoss = 0; this.lastEventT = -1e9;
    this.bossRate = 0; this.playerRate = 0;
    this.stats = { gated: 0, passed: 0, corrupted: 0, refused: 0 };
  }

  // ---------------------------------------------------------- perception
  //  Feed the sensor's state in every tick; get back what the brain may know.
  perceive(ws) {
    this.line.push(ws);
    const old = this.line.read(ws.t, this.mind.reaction);
    if (!old) return null;
    this.view.copyFrom(old);
    for (let i = 0; i < SELF_IDX.length; i++) this.view.v[SELF_IDX[i]] = ws.v[SELF_IDX[i]];
    this.view.t = ws.t;
    return this.view;
  }

  // ---------------------------------------------------------- prediction
  //  `pred` is { probs: {action: p}, confidence }. Returns the action the
  //  tactics may lean on, or null to mean "react, do not anticipate".
  gatePrediction(pred) {
    if (!pred || !(pred.confidence >= this.mind.prediction_threshold)) { this.stats.gated++; return null; }
    let best = null, bestP = -1;
    const keys = Object.keys(pred.probs);
    for (const k of keys) if (pred.probs[k] > bestP) { bestP = pred.probs[k]; best = k; }
    if (keys.length > 1 && this.rng.next() < this.mind.error_rate) {
      // a wrong read: one of the other outcomes, weighted by how likely it looked
      let sum = 0;
      for (const k of keys) if (k !== best) sum += pred.probs[k];
      let r = this.rng.next() * sum;
      for (const k of keys) {
        if (k === best) continue;
        r -= pred.probs[k];
        if (r <= 0) { best = k; break; }
      }
      this.stats.corrupted++;
    }
    this.stats.passed++;
    //  a wrong read keeps the displacement of what it wrongly believes, or
    //  none at all — never the right answer smuggled through
    const move = pred.move && best === pred.best ? pred.move : null;
    return { action: best, weight: this.mind.prediction_strength * pred.confidence, move };
  }

  //  Where to swing at: from where the target is toward where it is expected
  //  to be, only as far as it is allowed to trust that, plus a scatter.
  aim(nowX, nowZ, predX, predZ, out) {
    const o = out || {};
    const lead = this.mind.attack_accuracy * this.mind.prediction_strength;
    const miss = (1 - this.mind.attack_accuracy) * 1.6;
    o.x = nowX + (predX - nowX) * lead + gauss(this.rng.next) * miss;
    o.z = nowZ + (predZ - nowZ) * lead + gauss(this.rng.next) * miss;
    return o;
  }

  // ---------------------------------------------------------- attacks
  mayAttack(targetId, now) {
    const until = this.relief.get(targetId);
    if (until !== undefined && now < until) { this.stats.refused++; return false; }
    let recent = 0;
    for (let i = 0; i < this.attackT.length; i++) if (now - this.attackT[i] < PRESSURE_WINDOW) recent++;
    if (recent >= this.body.pressure) { this.stats.refused++; return false; }
    return true;
  }
  noteAttack(now) { this.attackT[this.attackK] = now; this.attackK = (this.attackK + 1) % this.attackT.length; }
  //  It hit someone: give that someone room to get their feet back.
  noteLanded(targetId, now, dmgFrac) {
    this.relief.set(targetId, now + this.body.relief);
    this.playerLoss += Math.max(0, dmgFrac || 0);
    this.lastEventT = now;
  }
  telegraph(base) { return Math.max(TELEGRAPH_MIN, base * this.body.telegraph); }
  damage(base) { return base * this.body.damage; }
  temperature() { return this.mind.exploration_rate; }

  // ---------------------------------------------------------- ADAPTIVE
  noteBossHurt(frac, now) { this.bossLoss += Math.max(0, frac || 0); this.lastEventT = now; }
  notePlayerDied(now) {
    if (this.difficulty !== 'ADAPTIVE') return;
    // a death is the clearest signal there is; ease off at once
    this.setLevel(this.level - 0.10 * (0.5 + this.mind.adaptation_speed));
    this.lastEventT = now;
  }
  //  Once a second or so. Compares how fast each side is losing against how
  //  fast a good fight loses it: the boss over ~5 minutes, a player over ~1.
  adapt(now, dt) {
    const tau = 20;                                   // s — the window the fight is judged over
    const k = Math.min(1, dt / tau);
    this.bossRate += (this.bossLoss / Math.max(dt, 1e-3) - this.bossRate) * k;
    this.playerRate += (this.playerLoss / Math.max(dt, 1e-3) - this.playerRate) * k;
    this.bossLoss = 0; this.playerLoss = 0;
    if (this.difficulty !== 'ADAPTIVE' || now - this.lastEventT > 15) return 0;   // no fight, no verdict
    const edge = Math.tanh((this.bossRate * 300) - (this.playerRate * 60));        // + : the player is winning easily
    if (Math.abs(edge) < 0.2) return 0;                                              // a fair fight: leave it alone
    const step = edge * 0.012 * this.mind.adaptation_speed * dt;
    this.setLevel(this.level + step);
    return step;
  }
  setLevel(l) {
    this.level = Math.max(0, Math.min(1, l));
    if (this.difficulty === 'ADAPTIVE') this.mind = mindAt(this.level);
  }

  // ---------------------------------------------------------- persistence
  //  D4: what it has learned about you survives a reload. For fairness that
  //  is only where ADAPTIVE had settled.
  serialize() { return { v: 1, difficulty: this.difficulty, level: +this.level.toFixed(4) }; }
  restore(o) {
    if (!o || o.v !== 1 || typeof o.level !== 'number' || !Number.isFinite(o.level)) return false;
    this.setLevel(o.level);
    return true;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FairnessController, DelayLine, MIND, BODY, LEVELS, DIFFICULTIES, TELEGRAPH_MIN, mindAt, ADAPT_START };
}
