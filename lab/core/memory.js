'use strict';
//  ============================================================
//  MEMORY  (spec §19)
//  ============================================================
//
//  Two kinds, as §19 asks, and they answer different questions:
//
//    WorkingMemory   "what has the last half-minute looked like?" — a ring
//                    of a few WorldState fields sampled at 2 Hz. Cheap to
//                    keep, and what the tactics read trends from (is the
//                    player closing in over time, have they been hiding).
//
//    EpisodicMemory  "what happened that mattered?" — a short list of named
//                    events with the situation they happened in:
//
//                      player_dodged_left / _right   they slipped an attack
//                      boss_attack_failed            it swung and missed
//                      boss_attack_landed
//                      player_countered              it missed and was hit
//                                                    straight back
//                      ambush_success                it hit someone who was
//                                                    not looking at it
//                      player_vanished               a seen player went out
//                                                    of sight (the cloak, or
//                                                    a corner)
//
//                    The tactics use it to stop repeating what fails: three
//                    reaps whiffed at close range is a lesson, not noise.
//
//  Both are bounded and allocate only when they are built.

const { F } = require('./worldstate.js');

const WM_FIELDS = ['player_distance', 'player_radial_speed', 'player_lateral_speed', 'player_visible',
                   'player_attacking', 'damage_taken_recent', 'self_health'];

class WorkingMemory {
  constructor(opts) {
    const o = Object.assign({ seconds: 30, hz: 2 }, opts || {});
    this.every = 1 / o.hz;
    this.cap = Math.ceil(o.seconds * o.hz);
    this.idx = WM_FIELDS.map((n) => F[n]);
    this.buf = new Float32Array(this.cap * this.idx.length);
    this.tbuf = new Float64Array(this.cap);
    this.head = 0; this.count = 0; this.lastT = -Infinity;
  }
  observe(ws) {
    if (ws.t - this.lastT < this.every - 1e-9) return false;
    this.lastT = ws.t;
    const base = this.head * this.idx.length;
    for (let i = 0; i < this.idx.length; i++) this.buf[base + i] = ws.v[this.idx[i]];
    this.tbuf[this.head] = ws.t;
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
    return true;
  }
  //  Mean of one field over the last `seconds` (NaN if nothing that recent).
  mean(name, seconds, now) {
    const f = WM_FIELDS.indexOf(name); if (f < 0) throw new Error('not in working memory: ' + name);
    let sum = 0, n = 0;
    for (let k = 1; k <= this.count; k++) {
      const s = (this.head - k + this.cap) % this.cap;
      if (now - this.tbuf[s] > seconds) break;
      sum += this.buf[s * this.idx.length + f]; n++;
    }
    return n ? sum / n : NaN;
  }
  //  Least-squares slope of a field over the last `seconds`, per second.
  trend(name, seconds, now) {
    const f = WM_FIELDS.indexOf(name); if (f < 0) throw new Error('not in working memory: ' + name);
    let n = 0, st = 0, sy = 0, stt = 0, sty = 0;
    for (let k = 1; k <= this.count; k++) {
      const s = (this.head - k + this.cap) % this.cap;
      const dt = this.tbuf[s] - now;
      if (-dt > seconds) break;
      const y = this.buf[s * this.idx.length + f];
      n++; st += dt; sy += y; stt += dt * dt; sty += dt * y;
    }
    const den = n * stt - st * st;
    return n >= 3 && den > 1e-9 ? (n * sty - st * sy) / den : 0;
  }
}

const EPISODES = ['player_dodged_left', 'player_dodged_right', 'boss_attack_failed', 'boss_attack_landed',
                  'player_countered', 'ambush_success', 'player_vanished'];

class EpisodicMemory {
  constructor(opts) {
    const o = Object.assign({ cap: 64 }, opts || {});
    this.cap = o.cap;
    this.items = [];
    for (let i = 0; i < this.cap; i++) this.items.push({ t: 0, type: '', attack: '', band: '', who: null });
    this.head = 0; this.count = 0;
  }
  //  band: 'close' | 'mid' | 'far' — the distance it happened at.
  record(t, type, attack, band, who) {
    if (!EPISODES.includes(type)) throw new Error('unknown episode ' + type);
    const e = this.items[this.head];
    e.t = t; e.type = type; e.attack = attack || ''; e.band = band || ''; e.who = who === undefined ? null : who;
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
  }
  //  How many of `type` (optionally with this attack / band) in the last `seconds`.
  count_(type, seconds, now, attack, band) {
    let n = 0;
    for (let k = 1; k <= this.count; k++) {
      const e = this.items[(this.head - k + this.cap) % this.cap];
      if (now - e.t > seconds) break;
      if (e.type === type && (!attack || e.attack === attack) && (!band || e.band === band)) n++;
    }
    return n;
  }
  //  An attack's recent record: landed / (landed + failed), with a prior of
  //  one of each so a single miss is not a verdict. NaN-free by construction.
  successRate(attack, seconds, now, band) {
    const hit = this.count_('boss_attack_landed', seconds, now, attack, band);
    const miss = this.count_('boss_attack_failed', seconds, now, attack, band);
    return (hit + 1) / (hit + miss + 2);
  }
  recent(n) {
    const out = [];
    for (let k = 1; k <= Math.min(n, this.count); k++) {
      const e = this.items[(this.head - k + this.cap) % this.cap];
      out.push({ t: e.t, type: e.type, attack: e.attack, band: e.band, who: e.who });
    }
    return out;
  }
}

const bandOf = (d) => (d < 10 ? 'close' : d < 30 ? 'mid' : 'far');

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WorkingMemory, EpisodicMemory, EPISODES, WM_FIELDS, bandOf };
}
