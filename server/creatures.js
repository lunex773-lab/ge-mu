//  ============================================================
//  CONTOUR — which creatures the room runs  (B9)
//  ============================================================
//  Alone in a room, a player's game runs every creature itself, as it
//  always has: nothing is sent, nothing is waited for. With two or more,
//  the room runs them — so far Beelzebub (boss.js) — and everyone is told
//  the same, nobody's phone carrying them for the rest.
//
//  Handing him over, so that he is never run twice and never not at all:
//
//    two are here     → the room waits for the host's next snapshot (at most
//                       an eighth of a second), takes him from what it says
//                       (or finds he is not standing), and only then tells
//                       everyone it runs him ('own' { b: 1 }): the host's game
//                       stops, and everyone draws him from the room's 'sv'
//    one is left      → the room tells them it no longer does, with its last
//                       word on him ('own' { b: 0, s }), and their game carries
//                       on from there
//
//  The room steps him whenever a message arrives — with two players about,
//  some thirty a second — so it needs no timer (a Durable Object's alarm is
//  a billed request, and would keep it from sleeping).
//
//  What he learns, fight by fight, is kept for every room (mindstore.js,
//  the BossMind Durable Object). This is the room's side of it: what the
//  memory has of the players here (`known`), the candidate readout for the
//  next fight the room runs (`cand`), and what players' games may tell it.

import { RoomBoss } from './boss.js';
import { fileable, MIN_FIGHT } from './mindstore.js';
import PM from '../lab/core/player_model.js';

const SEND_MS = 100;                       // his account goes out ten times a second
export const ROOM = '__room';              // (who a candidate is for, when it is the room's own)
const KNOWN_MAX = 32;

export class Creatures {
  constructor(room, { enabled = true } = {}) {
    this.room = room;                      // the Relay
    this.enabled = enabled;
    this.boss = new RoomBoss(room);
    this.own = false;                      // the room runs Beelzebub
    this.taking = false;                   // two are here: waiting on the host's next word
    this.sentT = 0; this.sentSome = false;
    this.known = new Map();                // name → { t, m, f }: what the memory has of them (and what has been learned here since)
    this.asked = new Set();                // names already asked of the memory
    this.cand = null; this.candAsked = false;
    this.ro = null;                        // the readout, as the memory last had it
  }
  owns() { return { b: this.own ? 1 : 0 }; }

  //  the host's snapshot: the tear, whether he has fallen at it, and — while
  //  the room is taking him over — where he is and how he is
  hostSaid(p) {
    if (!this.enabled) return;
    this.boss.hearGate(Array.isArray(p.g) ? p.g : null);
    if (p.bs && Array.isArray(p.g)) this.boss.hearSlain(p.g[4]);
    if (this.taking) {
      this.taking = false; this.own = true;
      if (Array.isArray(p.b)) this.boss.adopt(p.b);
      this.room.send('all', 'own', { b: 1 });
    }
    if (this.own) delete p.b;              // (a game from before this still sends him)
  }
  //  someone came or went
  recount() {
    if (!this.enabled) return;
    const n = this.room.players.size;
    if (n >= 2) { if (!this.own) this.taking = true; this.wantMind(); return; }
    this.taking = false;
    if (!this.own) return;
    this.own = false;
    this.room.send('all', 'own', { b: 0, s: this.boss.snapshot() });
    this.boss.end();
    this.boss.st = null; this.sentSome = false;
    //  what the room learned of whoever is left goes with him
    for (const [id, p] of this.room.players) { const e = this.known.get(p.name); if (e) this.room.send(id, 'mind', { me: e }); }
  }
  //  a message has arrived (now: ms)
  tick(now) {
    if (!this.own) return;
    this.boss.step(now);
    if (now - this.sentT < SEND_MS) return;
    const b = this.boss.snapshot();
    if (!b && !this.sentSome) return;      // nothing to say, and nothing said that needs taking back
    this.sentT = now; this.sentSome = !!b;
    this.room.send('all', 'sv', { b });
  }
  //  a round at him, when the room runs him (returns false when it does not)
  shot(from, now) { if (!this.own) return false; this.boss.shot(from, now); return true; }
  heard(from) { if (this.own) this.boss.heard(from); }

  //  ---- his memory ------------------------------------------------------------
  //  what the room needs before it runs him: a candidate for the fight, and
  //  what is known of the players here (those who arrived since the room
  //  last woke were told with their hello)
  wantMind() {
    if (!this.enabled) return;
    if (!this.cand && !this.candAsked) { this.candAsked = true; this.room.ask({ k: 'cand', for: ROOM }); }
    const names = [];
    for (const p of this.room.players.values()) {
      if (p.helloed || !fileable(p.name) || this.known.has(p.name) || this.asked.has(p.name)) continue;
      this.asked.add(p.name); names.push(p.name);
    }
    if (names.length) this.room.ask({ k: 'models', names });
  }
  //  one of the memory's answers (mindstore.js ask)
  mindSaid(r) {
    if (!r || typeof r !== 'object') return;
    if (r.k === 'hello' || (r.k === 'cand' && r.for !== ROOM)) {
      const id = r.k === 'hello' ? r.id : r.for, pl = this.room.players.get(id);
      if (!pl) return;
      if (r.me) this.learnt(pl.name, r.me);
      pl.cand = r.c ? r.c.id : null;
      this.room.send(id, 'mind', r.k === 'hello' ? { ro: r.ro, c: r.c, me: r.me || null } : { ro: r.ro, c: r.c });
    } else if (r.k === 'cand') {
      this.cand = r.c || null; this.candAsked = false;
      if (r.ro) this.ro = r.ro;
    } else if (r.k === 'models') {
      for (const [n, e] of Object.entries(r.players || {})) this.learnt(n, e);
    }
  }
  learnt(name, e) {
    if (!e || !fileable(name)) return;
    const had = this.known.get(name);
    if (had && had.t >= e.t) return;
    this.known.delete(name); this.known.set(name, e);
    if (this.known.size > KNOWN_MAX) this.known.delete(this.known.keys().next().value);
  }
  //  What a player's game says (relay kind 'mind'):
  //    { r, s, n }   how the fight it ran with candidate r went (fightScore; s null: no fight)
  //    { m, f }      what it has learned of this player, and where its fairness had settled
  //  Only the candidate the memory handed this player, once; only this
  //  player's own model, under the name the room knows them by, and only one
  //  that is a model (PlayerModel.restore takes it).
  fromPlayer(from, p, now) {
    const me = this.room.players.get(from);
    if (p.r !== undefined) {
      if (!me.cand || p.r !== me.cand) { this.room.refused++; this.room.lastRefusal = 'mind: not your candidate'; }
      else {
        me.cand = null;
        const s = p.s === null ? null : Number.isFinite(p.s) ? p.s : undefined;
        //  (not a longer fight than they have been here)
        const n = Math.min(Number.isFinite(p.n) ? p.n : 0, (now - (me.t0 === undefined ? now : me.t0)) / 1000);
        if (s !== undefined) this.room.ask({ k: 'report', id: p.r, s: s !== null && n >= MIN_FIGHT ? s : null, n, for: from });
      }
    }
    if (p.m && typeof p.m === 'object' && fileable(me.name)) {
      if (!new PM.PlayerModel({}).restore(p.m)) { this.room.refused++; this.room.lastRefusal = 'mind: not a player model'; return; }
      const e = { t: now, m: p.m };
      if (Number.isFinite(p.f)) e.f = Math.max(0, Math.min(1, p.f));
      this.learnt(me.name, e);
      this.room.ask({ k: 'save', players: { [me.name]: e } });
    }
  }
}
