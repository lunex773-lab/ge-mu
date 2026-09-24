//  ============================================================
//  CONTOUR — Beelzebub's memory, kept by the server  (B9b+)
//  ============================================================
//  One memory for every room (the BossMind Durable Object, mind.js, holds
//  it; this is its logic, with no Cloudflare in it, so node can test it):
//
//    what he knows of each player   the player model the game builds of
//                                   whoever he fights (lab/core/player_model.js),
//                                   filed under the name over their head, with
//                                   where the fairness had settled for them.
//                                   Whichever room or phone last fought them
//                                   has the newest, and the newest is kept.
//
//    how he reads his own mind      the readout (lab/core/neural.js): one
//                                   weight per motor neuron, a bias per action,
//                                   101 numbers — the part the lab trains
//                                   (lab/learn/train_readout.js). Here it goes
//                                   on learning in real fights, the way the lab
//                                   learned it: evolution strategies, one whole
//                                   fight a trial.
//
//  How the readout learns. Each fight is run with a candidate: the readout
//  nudged a little (SIGMA) along a random direction ε, plus for one fight
//  and minus for another (an antithetic pair). Each fight is scored where it
//  was run (boss_runner.js fightScore: his blade landing, not swinging at
//  air, not being cut down — per minute of fighting). Each pair whose two
//  fights are in says which way along its ε did better; every BATCH pairs,
//  the readout takes a small step the way they say, together. Real fights
//  are noisy — different players, different streets — so:
//
//    - a pair's difference is measured against how big differences usually
//      are (a running scale), and clipped: one lopsided pair moves him no
//      more than any other; and a short fight weighs less than a long one
//    - pairs are taken BATCH at a time: with 101 numbers, one pair's
//      direction is mostly noise, and several together are much less so
//    - no step is large (STEP_MAX a number), and he never strays far from
//      what the lab trained (RADIUS, all 101 numbers together): whatever
//      fights say, he stays the Beelzebub the lab tested
//    - how he did is judged WINDOW fights at a time; the best of those is
//      kept, and when a window is clearly worse than it, he goes back to it
//
//  It is slow on purpose: a step needs BATCH × 2 fights, and a real change
//  in how he fights needs dozens of steps.
//
//  A candidate not reported (the fight never happened, or the phone went
//  away) is handed out again after a while. The lab retraining him (a new
//  brain.js) starts the learning again from what the lab trained.
//
//  Storage: anything with the Durable Object storage's get / put / delete
//  (mind.js passes ctx.storage; the tests a Map). Keys: 'es' the readout's
//  learning, 'idx' who is remembered and when, 'p:<name>' each player.

import BRAIN from './brain.js';
import RNG from '../lab/core/rng.js';

const { makeRng, gauss } = RNG;

export const SIGMA = 0.05;             // a candidate's nudge, each number
export const BATCH = 4;                // pairs a step is taken from
export const LR = 0.03;                // a step: the pairs' mean of (how much better) × ε, times this
export const STEP_MAX = 0.05;          // no number moves more than this in one step
export const RADIUS = 1.5;             // how far from the lab's readout he may go (all numbers)
export const WINDOW = 12;              // fights a mean is taken over
export const EXPIRE_MS = 20 * 60e3;    // a candidate not reported is handed out again
export const MAX_PAIRS = 8;
export const MAX_PLAYERS = 400;        // names remembered (the longest unseen forgotten)
export const MAX_MODEL = 12000;        // bytes: one player model, as JSON (about 2.5 KB is usual)
export const MIN_FIGHT = 20;           // s (boss_runner.js MIN_FIGHT)
const FULL_FIGHT = 120;                // s: a fight this long weighs fully
const R5 = (x) => Math.round(x * 1e5) / 1e5;

//  the lab's readout, as the prepared core carries it
const C0 = BRAIN.core;
export const THETA0 = Array.from(C0.mSign).concat(Array.from(C0.mBias)).map(R5);
const NW = C0.mSign.length, DIM = THETA0.length;
const MARK = C0.graph + ':' + THETA0.reduce((a, x, i) => a + x * (i + 1), 0).toFixed(3);

//  the direction a pair explores, from its seed (so it need not be stored)
export function eps(seed) {
  const r = makeRng(seed), e = new Array(DIM);
  for (let d = 0; d < DIM; d++) e[d] = gauss(r.next);
  return e;
}
//  a readout the game and the room can set (NeuralCore.setReadout)
export function readoutOf(theta) {
  return { v: 1, graph: C0.graph, seed: C0.o.seed, w: theta.slice(0, NW).map(R5), b: theta.slice(NW).map(R5) };
}
export function distance(theta) { let s = 0; for (let d = 0; d < DIM; d++) s += (theta[d] - THETA0[d]) ** 2; return Math.sqrt(s); }

//  a name the memory files a player under: the name over their head — not
//  a room's id for someone who gave none, which means nothing in another room
export function fileable(name) { return typeof name === 'string' && name.length > 0 && name.length <= 20 && !/^p[0-9a-z]{6}$/.test(name); }
//  an entry as stored: { t: wall ms, m: the model (serialize()), f: fairness level }
export function entryOk(e) {
  if (!e || typeof e !== 'object' || !Number.isFinite(e.t) || !e.m || typeof e.m !== 'object') return false;
  if (e.f !== undefined && !(Number.isFinite(e.f) && e.f >= 0 && e.f <= 1)) return false;
  try { return JSON.stringify(e.m).length <= MAX_MODEL; } catch (x) { return false; }
}

export class MindStore {
  constructor(storage, { now = () => Date.now(), random = Math.random } = {}) {
    this.st = storage; this.now = now; this.random = random;
    this.es = null; this.idx = null;
  }

  async ready() {
    if (!this.es) {
      const es = await this.st.get('es');
      this.es = es && es.v === 1 && es.mark === MARK && Array.isArray(es.theta) && es.theta.length === DIM && Array.isArray(es.acc) ? es : this.fresh();
    }
    if (!this.idx) this.idx = (await this.st.get('idx')) || {};
  }
  fresh() {
    return { v: 1, mark: MARK, theta: THETA0.slice(), gen: 0, fights: 0, scale: 0, pairs: [], acc: new Array(DIM).fill(0), accN: 0,
      recent: [], best: null, reverts: 0, log: [] };
  }

  //  Everything a room asks at once (a list), answered in one list.
  //    { k: 'hello', id, name }      → { k: 'hello', id, ro, c, me }   a player has arrived: the readout,
  //                                    a candidate for the fights their game runs, and what is known of them
  //    { k: 'models', names }        → { k: 'models', players }         what is known of these players
  //    { k: 'cand', for }            → { k: 'cand', for, c, ro }       a candidate for the next fight
  //    { k: 'report', id, s, n, for? } → (a new candidate for `for`, when given)   how a fight went
  //    { k: 'save', players }        → nothing                          what was learned of players
  //    { k: 'stats' }                → { k: 'stats', … }
  async ask(asks) {
    await this.ready();
    const out = [];
    let esDirty = false, touched = null;
    for (const a of Array.isArray(asks) ? asks : []) {
      if (!a || typeof a !== 'object') continue;
      if (a.k === 'hello') {
        out.push({ k: 'hello', id: a.id, ro: this.readout(), c: this.candidate(), me: fileable(a.name) ? await this.player(a.name) : null });
        esDirty = true;
      } else if (a.k === 'models') {
        const players = {};
        for (const n of Array.isArray(a.names) ? a.names.slice(0, 16) : []) if (fileable(n)) { const e = await this.player(n); if (e) players[n] = e; }
        out.push({ k: 'models', players });
      } else if (a.k === 'cand') {
        out.push({ k: 'cand', for: a.for, c: this.candidate(), ro: this.readout() }); esDirty = true;
      } else if (a.k === 'report') {
        this.report(a.id, a.s, a.n); esDirty = true;
        if (a.for !== undefined) out.push({ k: 'cand', for: a.for, c: this.candidate(), ro: this.readout() });
      } else if (a.k === 'save') {
        touched = touched || {};
        for (const [name, e] of Object.entries(a.players || {})) {
          if (!fileable(name) || !entryOk(e)) continue;
          const had = this.idx[name];
          if (had !== undefined && had >= e.t) continue;            // what is kept is newer
          touched[name] = { t: Math.min(e.t, this.now()), m: e.m, f: e.f };
          this.idx[name] = touched[name].t;
        }
      } else if (a.k === 'stats') out.push(Object.assign({ k: 'stats' }, this.stats()));
    }
    if (touched && Object.keys(touched).length) {
      const puts = { idx: this.idx };
      for (const [name, e] of Object.entries(touched)) puts['p:' + name] = e;
      const names = Object.keys(this.idx);
      if (names.length > MAX_PLAYERS) {
        names.sort((x, y) => this.idx[x] - this.idx[y]);
        const gone = names.slice(0, names.length - MAX_PLAYERS);
        for (const n of gone) { delete this.idx[n]; delete puts['p:' + n]; }
        await this.st.delete(gone.map((n) => 'p:' + n));
      }
      await this.st.put(puts);
    }
    if (esDirty) await this.st.put('es', this.es);
    return out;
  }

  async player(name) {
    if (this.idx[name] === undefined) return null;
    const e = await this.st.get('p:' + name);
    return entryOk(e) ? e : null;
  }
  readout() { return Object.assign(readoutOf(this.es.theta), { gen: this.es.gen }); }

  //  a half of a pair not yet handed out (or handed out long ago and never
  //  reported), or a new pair
  candidate() {
    const es = this.es, now = this.now();
    let pick = null;
    for (const p of es.pairs) {
      for (let h = 0; h < 2 && !pick; h++) if (!p.got[h] && now - p.out[h] > EXPIRE_MS) pick = [p, h];
      if (pick) break;
    }
    if (!pick) {
      const p = { seed: 1 + Math.floor(this.random() * 0x3fffffff), got: [null, null], out: [0, 0] };
      es.pairs.push(p);
      if (es.pairs.length > MAX_PAIRS) es.pairs.shift();
      pick = [p, 0];
    }
    const [p, h] = pick, e = eps(p.seed), sgn = h === 0 ? 1 : -1;
    p.out[h] = now;
    return Object.assign(readoutOf(es.theta.map((x, d) => x + sgn * SIGMA * e[d])), { id: p.seed * 2 + h });
  }

  //  how the fight run with candidate `id` went (s: fightScore's, per minute;
  //  n: seconds of fighting). s null: there was no fight — hand it out again.
  report(id, s, n) {
    const es = this.es;
    if (!Number.isInteger(id) || id < 2) return 'bad id';
    const seed = Math.floor(id / 2), h = id % 2, p = es.pairs.find((q) => q.seed === seed);
    if (!p) return 'not a candidate now';
    if (p.got[h]) return 'already reported';
    if (s === null || s === undefined) { p.out[h] = 0; return 'no fight'; }
    if (!Number.isFinite(s) || !Number.isFinite(n) || n < MIN_FIGHT) { p.out[h] = 0; return 'not a fight'; }
    s = Math.max(-5, Math.min(5, s));
    p.got[h] = { s, n: Math.min(n, 3600) };
    es.fights++;
    es.recent.push(s);
    if (p.got[0] && p.got[1]) { this.gather(p); es.pairs.splice(es.pairs.indexOf(p), 1); }
    if (es.accN >= BATCH) this.step();
    if (es.recent.length >= WINDOW) this.judge();
    return null;
  }
  //  a pair's two fights: which way along its ε did better, and by how much
  gather(p) {
    const es = this.es, [a, b] = p.got;
    const diff = (a.s - b.s) / 2;                               // + : nudging along +ε did better
    es.scale = es.scale ? 0.9 * es.scale + 0.1 * Math.abs(diff) : Math.abs(diff);
    const k = Math.max(-2, Math.min(2, diff / Math.max(es.scale, 1e-3))) * Math.min(1, Math.min(a.n, b.n) / FULL_FIGHT);
    const e = eps(p.seed);
    for (let d = 0; d < DIM; d++) es.acc[d] += k * e[d];
    es.accN++;
  }
  step() {
    const es = this.es, th = es.theta, n = es.accN;
    let moved = 0;
    for (let d = 0; d < DIM; d++) {
      const dx = Math.max(-STEP_MAX, Math.min(STEP_MAX, LR * es.acc[d] / n));
      th[d] += dx; moved += dx * dx; es.acc[d] = 0;
    }
    es.accN = 0;
    const dist = distance(th);
    if (dist > RADIUS) for (let d = 0; d < DIM; d++) th[d] = THETA0[d] + (th[d] - THETA0[d]) * RADIUS / dist;
    for (let d = 0; d < DIM; d++) th[d] = R5(th[d]);
    es.gen++;
    this.note('step ' + es.gen + ' from ' + n + ' pairs: moved ' + Math.sqrt(moved).toFixed(3) + ', now ' + distance(th).toFixed(3) + ' from the lab');
  }
  //  every WINDOW fights: the best he has done, and going back to it
  judge() {
    const es = this.es, r = es.recent;
    es.recent = [];
    const mean = r.reduce((x, y) => x + y, 0) / r.length;
    const sd = Math.sqrt(r.reduce((x, y) => x + (y - mean) ** 2, 0) / (r.length - 1));
    if (!es.best || mean > es.best.mean) { es.best = { theta: es.theta.slice(), mean: +mean.toFixed(4), gen: es.gen }; return; }
    //  clearly worse: more than three standard errors of the difference below the best
    if (es.best.mean - mean > Math.max(0.02, 3 * sd * Math.sqrt(2 / r.length))) {
      es.theta = es.best.theta.slice(); es.reverts++;
      es.acc.fill(0); es.accN = 0;
      this.note('back to the best (gen ' + es.best.gen + ', mean ' + es.best.mean + '): the last ' + r.length + ' fights averaged ' + mean.toFixed(3));
      es.best.mean = +((es.best.mean + mean) / 2).toFixed(4);   // (and the bar lowers, or a lucky run would be chased forever)
    }
  }
  note(line) { const l = this.es.log; l.push(new Date(this.now()).toISOString().slice(0, 19) + ' ' + line); if (l.length > 20) l.shift(); }

  stats() {
    const es = this.es;
    return { gen: es.gen, fights: es.fights, reverts: es.reverts, pending: es.pairs.length, fromLab: +distance(es.theta).toFixed(4),
      best: es.best && { mean: es.best.mean, gen: es.best.gen }, players: Object.keys(this.idx).length, log: es.log.slice(-8) };
  }
}
