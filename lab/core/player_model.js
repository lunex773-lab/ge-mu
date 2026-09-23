'use strict';
//  ============================================================
//  PLAYER MODEL  (spec §13, §14, §15; D4, D7)
//  ============================================================
//
//  §40 in one sentence: "このボス、俺の戦い方を覚えている". This is the file
//  that has to make that true.
//
//  Three parts, in the order the data flows:
//
//  1. BehaviorTracker (§13) turns the stream of WorldStates into a stream of
//     discrete behaviours — what a person watching would call what the
//     player just did. It reads only the WorldState, which is only what the
//     sensor could see or hear, so the model is exactly as blind as the boss.
//
//       attack        a shot, seen or heard
//       dodge_left    a sharp sideways break, to the boss's left
//       dodge_right   …to the boss's right
//       approach      closing in
//       retreat       opening the distance
//       strafe_left   moving across, steadily
//       strafe_right
//       hide          went out of sight
//       jump
//       wait          none of the above
//
//     §13 also lists skill and heal. The only skill is the cloak, which is
//     only observable as "went out of sight" (hide), and there is no heal.
//     "Left" and "right" are the boss's, because that is the frame it has to
//     swing in.
//
//  2. An n-gram model (§14) over that stream: what follows what, conditioned
//     on the last two behaviours, backing off to the last one, and then to
//     "what does this player do at this distance" — so a situation it has
//     not seen yet still gets a guess shaped by the player, not a uniform
//     shrug. §14 says to start light and leave room for sequence models
//     later; the model is one class behind one method, predict(history).
//
//  3. Prediction (§15) with a confidence that means something. Confidence
//     is the top probability discounted by how much evidence stands behind
//     it, so a player who behaves at random stays below every difficulty's
//     threshold and is simply never anticipated — the FairnessController
//     gate does the rest.
//
//  Forgetting is by half-life in behaviours (the difficulty's memory_length):
//  every new behaviour counts a little more than the last, which is the same
//  as every old one fading, without touching the old ones. A player who
//  changes how they fight is followed; how fast depends on the difficulty.

const { F } = require('./worldstate.js');
const { bandOf } = require('./memory.js');

const BEHAVIORS = ['attack', 'dodge_left', 'dodge_right', 'approach', 'retreat',
                   'strafe_left', 'strafe_right', 'hide', 'jump', 'wait'];
const B = {}; BEHAVIORS.forEach((b, i) => { B[b] = i; });
const V = BEHAVIORS.length;
const BANDS = ['close', 'mid', 'far'];
const UNAVAILABLE_BEHAVIORS = {
  skill: 'the cloak is only observable as going out of sight, which is `hide`',
  heal: 'the game has no healing',
  melee_attack: 'players only have guns; every attack is ranged',
};

//  What each behaviour usually means for where the player will be, in the
//  boss's frame (m/s). The tactics blend this with the measured velocity by
//  however much the fairness gate lets them trust the prediction.
const MOTION = {
  attack: [0, 0], dodge_left: [0, -6.5], dodge_right: [0, 6.5], approach: [-6, 0], retreat: [6, 0],
  strafe_left: [0, -4.5], strafe_right: [0, 4.5], hide: [2, 0], jump: [0, 0], wait: [0, 0],
};

// ======================================================================
//  1. behaviours out of WorldStates
// ======================================================================
const MOVE = 2.5;        // m/s — below this it is not really going anywhere

function classify(ws) {
  const v = ws.v;
  if (v[F.has_target] < 0.5) return -1;
  if (v[F.player_visible] <= 0) return v[F.player_confidence] > 0.05 ? B.hide : -1;
  if (v[F.player_dodging] > 0.6) return v[F.player_lateral_speed] >= 0 ? B.dodge_right : B.dodge_left;
  if (v[F.player_airborne] > 0.5) return B.jump;
  if (v[F.time_since_player_attack] < 0.35) return B.attack;
  const r = v[F.player_radial_speed], l = v[F.player_lateral_speed];
  if (Math.abs(r) >= Math.abs(l)) {
    if (r < -MOVE) return B.approach;
    if (r > MOVE) return B.retreat;
  }
  if (l > MOVE) return B.strafe_right;
  if (l < -MOVE) return B.strafe_left;
  if (r < -MOVE) return B.approach;
  if (r > MOVE) return B.retreat;
  return B.wait;
}

class BehaviorTracker {
  constructor(opts) {
    const o = Object.assign({ dwell: 0.2 }, opts || {});
    this.dwell = o.dwell;            // s a behaviour has to hold before it counts — no flicker
    this.cand = -1; this.candT = 0;
    this.last = -1; this.lastT = -Infinity;
    this.band = 'mid';
  }
  //  Returns the index of a behaviour that has just started, or -1.
  observe(ws) {
    const c = classify(ws);
    if (c < 0) { this.cand = -1; return -1; }
    if (c !== this.cand) { this.cand = c; this.candT = ws.t; }
    // a dodge is over almost as soon as it starts; it counts on sight
    const need = c === B.dodge_left || c === B.dodge_right || c === B.attack ? 0 : this.dwell;
    if (c !== this.last && ws.t - this.candT >= need - 1e-9) {
      this.last = c; this.lastT = ws.t;
      this.band = bandOf(ws.v[F.player_distance]);
      return c;
    }
    return -1;
  }
}

// ======================================================================
//  2. the n-gram model
// ======================================================================
//  Contexts are small integers: order 1 is (a+1), order 2 is (a+1)*(V+1)+(b+1).
//  Each context holds a Float64Array of V weights and a total. With ten
//  behaviours that is at most 111 contexts, however long the fight.
const ctx1 = (a) => a + 1;
const ctx2 = (a, b) => (a + 1) * (V + 1) + (b + 1);

class NGram {
  constructor(opts) {
    const o = Object.assign({ halfLife: 150, beta: 4 }, opts || {});
    this.table = new Map();                       // ctx -> Float64Array(V + 1), last slot = total
    this.bandTable = BANDS.map(() => new Float64Array(V + 1));
    this.g = 1;                                   // the weight of the next event
    this.setHalfLife(o.halfLife);
    this.beta = o.beta;                           // how much evidence it takes to move off the lower order
    this.events = 0;
  }
  setHalfLife(h) { this.halfLife = Math.max(1, h); this.growth = Math.pow(2, 1 / this.halfLife); }
  row(key) {
    let r = this.table.get(key);
    if (!r) { r = new Float64Array(V + 1); this.table.set(key, r); }
    return r;
  }
  //  hist: the behaviours before `next`, most recent last.
  observe(hist, next, band) {
    const g = this.g;
    const n = hist.length;
    const add = (r) => { r[next] += g; r[V] += g; };
    add(this.bandTable[BANDS.indexOf(band) >= 0 ? BANDS.indexOf(band) : 1]);
    if (n >= 1) add(this.row(ctx1(hist[n - 1])));
    if (n >= 2) add(this.row(ctx2(hist[n - 2], hist[n - 1])));
    this.events++;
    this.g *= this.growth;
    if (this.g > 1e120) this.rescale(1 / this.g);
  }
  rescale(k) {
    for (const r of this.table.values()) for (let i = 0; i <= V; i++) r[i] *= k;
    for (const r of this.bandTable) for (let i = 0; i <= V; i++) r[i] *= k;
    this.g *= k;
  }
  //  In "recent behaviours" units: a weight of 1 is one behaviour seen just now.
  eff(w) { return w / (this.g / this.growth); }

  //  Interpolated back-off: each order leans on the one below by `beta`
  //  pseudo-observations. Returns probabilities into `out` and the evidence
  //  (effective count) at the most specific context that had any.
  predict(hist, band, out) {
    const p = out || new Float64Array(V);
    const b = this.bandTable[Math.max(0, BANDS.indexOf(band))];
    const bt = this.eff(b[V]);
    for (let i = 0; i < V; i++) p[i] = (this.eff(b[i]) + 1 / V) / (bt + 1);     // one pseudo-count of "anything"
    let evidence = bt;
    const n = hist.length;
    const layer = (r) => {
      if (!r || r[V] <= 0) return false;
      const tot = this.eff(r[V]);
      for (let i = 0; i < V; i++) p[i] = (this.eff(r[i]) + this.beta * p[i]) / (tot + this.beta);
      evidence = tot;
      return true;
    };
    if (n >= 1) layer(this.table.get(ctx1(hist[n - 1])));
    if (n >= 2) layer(this.table.get(ctx2(hist[n - 2], hist[n - 1])));
    return evidence;
  }
}

// ======================================================================
//  3. the model: tracker + n-gram + per-behaviour statistics + prediction
// ======================================================================
const OUTCOME_WINDOW = 1.5;      // s after a behaviour in which what happened is credited to it

class PlayerModel {
  constructor(opts) {
    const o = Object.assign({ memory_length: 150, learning_rate: 0.1, dwell: 0.2 }, opts || {});
    this.tracker = new BehaviorTracker({ dwell: o.dwell });
    this.ngram = new NGram({ halfLife: o.memory_length, beta: 0.4 / Math.max(0.02, o.learning_rate) });
    this.hist = [];                                 // last few behaviours (indices)
    this.stats = BEHAVIORS.map(() => ({ count: 0, lastT: -Infinity, success: 0, fail: 0, bands: [0, 0, 0] }));
    this.open = -1; this.openT = -Infinity;         // the behaviour outcomes are being credited to
    this.probs = new Float64Array(V);
    // prediction bookkeeping, for §24's "prediction accuracy"
    this.pending = -1; this.hits = 0; this.tries = 0; this.confidentHits = 0; this.confidentTries = 0;
    this.lastPred = null;
  }
  tune(mind) {
    this.ngram.setHalfLife(mind.memory_length);
    this.ngram.beta = 0.4 / Math.max(0.02, mind.learning_rate);
  }

  //  Every sensor tick (or every Fairness view). Returns the behaviour that
  //  just started, or null.
  observe(ws) {
    const b = this.tracker.observe(ws);
    if (b < 0) return null;
    // score the prediction that was standing when this behaviour started
    if (this.pending >= 0) {
      this.tries++; if (this.pending === b) this.hits++;
      if (this.lastPred && this.lastPred.confidence >= 0.5) { this.confidentTries++; if (this.pending === b) this.confidentHits++; }
    }
    const band = this.tracker.band;
    this.ngram.observe(this.hist, b, band);
    const s = this.stats[b];
    s.count++; s.lastT = ws.t; s.bands[BANDS.indexOf(band)]++;
    this.hist.push(b); if (this.hist.length > 4) this.hist.shift();
    this.open = b; this.openT = ws.t;
    const pr = this.predict();
    this.pending = pr.bestIndex;
    return BEHAVIORS[b];
  }

  //  What happened after the behaviour — did it work for the player?
  //    'boss_hurt'        they landed damage          -> success
  //    'boss_missed'      it swung at them and missed -> success
  //    'player_hurt'      it landed on them           -> failure
  noteOutcome(kind, t) {
    if (this.open < 0 || t - this.openT > OUTCOME_WINDOW) return;
    const s = this.stats[this.open];
    if (kind === 'boss_hurt' || kind === 'boss_missed') s.success++;
    else if (kind === 'player_hurt') s.fail++;
  }

  //  §15. { probs: {behaviour: p}, best, bestIndex, confidence, evidence }
  predict() {
    const ev = this.ngram.predict(this.hist, this.tracker.band, this.probs);
    let bi = 0;
    for (let i = 1; i < V; i++) if (this.probs[i] > this.probs[bi]) bi = i;
    const probs = {};
    for (let i = 0; i < V; i++) probs[BEHAVIORS[i]] = this.probs[i];
    //  The top probability, discounted until there is evidence behind it:
    //  four recent behaviours in this exact context make it count for ~63%.
    const confidence = this.probs[bi] * (1 - Math.exp(-ev / 4));
    this.lastPred = { probs, best: BEHAVIORS[bi], bestIndex: bi, confidence, evidence: ev };
    return this.lastPred;
  }

  //  §13 transition_probability: P(next | this one).
  transitions(behavior) {
    const r = this.ngram.table.get(ctx1(B[behavior]));
    const out = {};
    for (let i = 0; i < V; i++) out[BEHAVIORS[i]] = r && r[V] > 0 ? r[i] / r[V] : 0;
    return out;
  }

  //  §13 per-behaviour statistics.
  profile(now) {
    const out = {};
    let total = 0; for (const s of this.stats) total += s.count;
    BEHAVIORS.forEach((name, i) => {
      const s = this.stats[i];
      out[name] = {
        frequency: total ? s.count / total : 0,
        recency: s.lastT > -Infinity ? now - s.lastT : Infinity,
        success_rate: (s.success + 1) / (s.success + s.fail + 2),
        context: { close: s.bands[0], mid: s.bands[1], far: s.bands[2] },
      };
    });
    return out;
  }

  //  §14. Sequences it has learned to expect: a -> b -> c (-> d), with the
  //  chance of the last step given the ones before and the recent evidence.
  patterns(minSupport, minP) {
    const ms = minSupport === undefined ? 3 : minSupport, mp = minP === undefined ? 0.6 : minP;
    const out = [];
    for (const [key, r] of this.ngram.table) {
      if (key <= V) continue;                                   // order-2 contexts only
      const a = Math.floor(key / (V + 1)) - 1, b = (key % (V + 1)) - 1;
      const tot = this.ngram.eff(r[V]);
      for (let c = 0; c < V; c++) {
        const sup = this.ngram.eff(r[c]);
        const p = r[V] > 0 ? r[c] / r[V] : 0;
        if (sup < ms || p < mp) continue;
        const seq = [BEHAVIORS[a], BEHAVIORS[b], BEHAVIORS[c]];
        let prob = p;
        // one step further if the next is just as sure
        const nx = this.ngram.table.get(ctx2(b, c));
        if (nx && nx[V] > 0) {
          let d = 0; for (let i = 1; i < V; i++) if (nx[i] > nx[d]) d = i;
          const pd = nx[d] / nx[V];
          if (this.ngram.eff(nx[d]) >= ms && pd >= mp) { seq.push(BEHAVIORS[d]); prob *= pd; }
        }
        out.push({ seq, p: +prob.toFixed(3), support: +sup.toFixed(1), of: +tot.toFixed(1) });
      }
    }
    out.sort((x, y) => y.p * y.support - x.p * x.support);
    return out;
  }

  accuracy() {
    return {
      overall: this.tries ? this.hits / this.tries : NaN, tries: this.tries,
      confident: this.confidentTries ? this.confidentHits / this.confidentTries : NaN, confidentTries: this.confidentTries,
    };
  }

  // ---------------------------------------------------------- D4 persistence
  //  Effective counts, rounded; contexts that have faded to nothing are
  //  dropped. The saved form is small and does not grow with play time.
  serialize() {
    const k = 1 / (this.ngram.g / this.ngram.growth);
    const r2 = (x) => Math.round(x * k * 100) / 100;
    const ctx = {};
    for (const [key, r] of this.ngram.table) {
      if (r[V] * k < 0.05) continue;
      ctx[key] = Array.from(r, r2);
    }
    return {
      v: 1, vocab: BEHAVIORS.join(','), halfLife: this.ngram.halfLife,
      ctx, band: this.ngram.bandTable.map((r) => Array.from(r, r2)),
      stats: this.stats.map((s) => [s.count, s.success, s.fail, s.bands[0], s.bands[1], s.bands[2]]),
    };
  }
  restore(o) {
    if (!o || o.v !== 1 || o.vocab !== BEHAVIORS.join(',') || !o.ctx || !Array.isArray(o.band) || o.band.length !== 3) return false;
    const okRow = (a) => Array.isArray(a) && a.length === V + 1 && a.every((x) => Number.isFinite(x) && x >= 0);
    if (!o.band.every(okRow) || !Object.values(o.ctx).every(okRow)) return false;
    const ng = this.ngram;
    ng.table.clear();
    ng.g = 1;                                        // saved counts are already in "recent" units
    for (const [key, a] of Object.entries(o.ctx)) {
      const n = +key;
      if (!Number.isInteger(n) || n < 1 || n > (V + 1) * (V + 1)) continue;
      ng.table.set(n, Float64Array.from(a));
    }
    o.band.forEach((a, i) => ng.bandTable[i].set(a));
    ng.g = ng.growth;                                // the next event weighs one "recent behaviour"
    if (Array.isArray(o.stats) && o.stats.length === V) {
      o.stats.forEach((a, i) => {
        if (!Array.isArray(a) || a.length !== 6 || !a.every(Number.isFinite)) return;
        const s = this.stats[i]; s.count = a[0]; s.success = a[1]; s.fail = a[2]; s.bands = [a[3], a[4], a[5]];
      });
    }
    return true;
  }
}

//  One model per player, keyed by the name over their head — the only thing
//  about a player that survives a reload and that anyone can see (D7: each
//  device keeps its own memories; nothing is sent).
class PlayerModelBank {
  constructor(opts) {
    this.o = Object.assign({ cap: 8 }, opts || {});
    this.models = new Map();                         // name -> { model, lastT }
  }
  get(name, now, mind) {
    let e = this.models.get(name);
    if (!e) {
      e = { model: new PlayerModel(mind || {}), lastT: now };
      this.models.set(name, e);
      if (this.models.size > this.o.cap) {           // forget whoever it has not seen longest
        let old = null, oldT = Infinity;
        for (const [k, v] of this.models) if (v.lastT < oldT) { oldT = v.lastT; old = k; }
        this.models.delete(old);
      }
    }
    e.lastT = now;
    return e.model;
  }
  serialize() {
    const out = { v: 1, players: {} };
    for (const [k, e] of this.models) out.players[k] = { t: e.lastT, m: e.model.serialize() };
    return out;
  }
  restore(o, mind) {
    if (!o || o.v !== 1 || !o.players) return false;
    for (const [k, e] of Object.entries(o.players)) {
      const m = new PlayerModel(mind || {});
      if (e && m.restore(e.m)) this.models.set(k, { model: m, lastT: +e.t || 0 });
    }
    return true;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PlayerModel, PlayerModelBank, BehaviorTracker, NGram, classify,
                     BEHAVIORS, B, MOTION, UNAVAILABLE_BEHAVIORS, OUTCOME_WINDOW };
}
