//  ============================================================
//  CONTOUR — which creatures the room runs  (B9)
//  ============================================================
//  Alone in a room, a player's game runs every creature itself, as it
//  always has: nothing is sent, nothing is waited for. With two or more,
//  the room runs them — so far Beelzebub (boss.js), the monkey troop
//  (troop.js) and the day side's traffic (traffic.js) — and everyone is told
//  the same, nobody's phone carrying them for the rest.
//
//  Handing one over, so that it is never run twice and never not at all:
//
//    two are here     → the room waits for the host's next snapshot (at most
//                       an eighth of a second), takes it from what that says,
//                       and only then tells everyone it runs it ('own' { b: 1 },
//                       { m: 1 }): the host's game stops, and everyone draws it
//                       from the room's 'sv'. (The troop rides in a host's
//                       snapshot only when someone else is on this side of the
//                       tear, or in every eighth; after nine without it, the
//                       host is not running one, and the room starts its own.)
//                       The traffic is every game's own until then (each
//                       phone runs its own), so the room asks the host's game
//                       for its traffic ('tq' → 'tfull'), carries on from that
//                       — the host sees no change — and tells everyone ('own'
//                       { t: 1 }); if no answer comes, it starts the city's own.
//    one is left      → the room tells them it no longer does, with its last
//                       word ('own' { b: 0, s } / { m: 0, mt } / { t: 0, tf }),
//                       and their game carries on from there
//
//  The room steps them whenever a message arrives — with two players about,
//  some thirty a second — so it needs no timer (a Durable Object's alarm is
//  a billed request, and would keep it from sleeping).
//
//  What he learns, fight by fight, is kept for every room (mindstore.js,
//  the BossMind Durable Object). This is the room's side of it: what the
//  memory has of the players here (`known`), the candidate readout for the
//  next fight the room runs (`cand`), and what players' games may tell it.

import { RoomBoss } from './boss.js';
import { RoomTroop } from './troop.js';
import { RoomTraffic } from './traffic.js';
import { fileable, MIN_FIGHT } from './mindstore.js';
import PM from '../lab/core/player_model.js';

const SEND_MS = 100;                       // what the room runs goes out ten times a second
export const ROOM = '__room';              // (who a candidate is for, when it is the room's own)
const KNOWN_MAX = 32;
const TROOP_WAIT = 9;                      // host snapshots without the troop before the room starts its own
const TRAFFIC_WAIT = 12;                   // host snapshots without its traffic, asked for, before the room starts the city's own

export class Creatures {
  constructor(room, { enabled = true } = {}) {
    this.room = room;                      // the Relay
    this.enabled = enabled;
    this.boss = new RoomBoss(room);
    this.traffic = new RoomTraffic(room, (c) => this.roomCorpse(c));
    this.troop = new RoomTroop(room, () => this.traffic.t);        // (the signals: one clock for the city)
    this.own = { b: false, m: false, t: false };   // what the room runs: Beelzebub, the troop, the traffic
    this.taking = { b: false, m: 0, t: 0 };        // two are here: waiting on the host's word (m, t: how many so far)
    this.sentT = 0; this.sentSome = false; this.svSeq = 0;
    this.known = new Map();                // name → { t, m, f }: what the memory has of them (and what has been learned here since)
    this.asked = new Set();                // names already asked of the memory
    this.cand = null; this.candAsked = false;
    this.ro = null;                        // the readout, as the memory last had it
  }
  owns() { return { b: this.own.b ? 1 : 0, m: this.own.m ? 1 : 0, t: this.own.t ? 1 : 0 }; }

  //  the host's snapshot: the tear, whether he has fallen at it, and — while
  //  the room is taking them over — where he is and how he is, and the troop
  hostSaid(p) {
    if (!this.enabled) return;
    this.boss.hearGate(Array.isArray(p.g) ? p.g : null);
    if (p.bs && Array.isArray(p.g)) this.boss.hearSlain(p.g[4]);
    const took = {};
    if (this.taking.b) {
      this.taking.b = false; this.own.b = true; took.b = 1;
      if (Array.isArray(p.b)) this.boss.adopt(p.b);
    }
    if (this.taking.m) {
      const ok = RoomTroop.valid(p.m, p.c);
      if (ok || ++this.taking.m > TROOP_WAIT) {
        this.taking.m = 0; this.own.m = true; took.m = 1;
        this.troop.adopt(ok ? p.m : null, p.c, p.r);
      }
    }
    if (this.taking.t && ++this.taking.t > TRAFFIC_WAIT) {           // the host's game never answered: the city's own
      this.taking.t = 0; this.own.t = true; took.t = 1;
      this.traffic.adopt(null);
    }
    if (took.b || took.m || took.t) this.room.send('all', 'own', took);
    if (this.own.b) delete p.b;            // (a game from before this still sends them)
    if (this.own.m) { delete p.m; delete p.c; delete p.r; }
  }
  //  someone came or went
  recount() {
    if (!this.enabled) return;
    const n = this.room.players.size;
    if (n >= 2) {
      if (!this.own.b) this.taking.b = true;
      if (!this.own.m && !this.taking.m) this.taking.m = 1;
      if (!this.own.t && !this.taking.t) { this.taking.t = 1; this.room.send(this.room.host(), 'tq', {}); }
      this.wantMind();
      return;
    }
    this.taking.b = false; this.taking.m = 0; this.taking.t = 0;
    if (!this.own.b && !this.own.m && !this.own.t) return;
    const back = {};
    if (this.own.t) { this.own.t = false; back.t = 0; back.tf = this.traffic.full(); }
    if (this.own.m) { this.own.m = false; back.m = 0; back.mt = this.troop.snapshot(); }
    if (this.own.b) {
      this.own.b = false; back.b = 0; back.s = this.boss.snapshot();
      this.boss.end();
      this.boss.st = null; this.sentSome = false;
    }
    this.room.send('all', 'own', back);
    //  what the room learned of whoever is left goes with him
    if ('b' in back) for (const [id, p] of this.room.players) { const e = this.known.get(p.name); if (e) this.room.send(id, 'mind', { me: e }); }
  }
  //  a message has arrived (now: ms)
  tick(now) {
    if (!this.own.b && !this.own.m && !this.own.t) return;
    if (this.own.t) { this.traffic.step(now); this.traffic.tell(now); }
    if (this.own.b) this.boss.step(now);
    if (this.own.m) this.troop.step(now);
    if (now - this.sentT < SEND_MS) return;
    const sv = {};
    if (this.own.b) {
      const b = this.boss.snapshot();
      if (b || this.sentSome) sv.b = b;    // (nothing to say, and nothing said that needs taking back: nothing)
      this.sentSome = !!b;
    }
    if (this.own.m) {
      const T = this.troop.snapshot();
      sv.r = T.r;
      //  the troop and its bodies belong to this side of the tear: while
      //  everyone is over on the other they ride only in every eighth
      let dayside = this.svSeq++ % 8 === 0;
      for (const p of this.room.players.values()) if (!p.w) dayside = true;
      if (dayside) { sv.m = T.m; sv.c = T.c; }
    }
    if (!('b' in sv) && !('r' in sv)) return;
    this.sentT = now;
    this.room.send('all', 'sv', sv);
  }
  //  a round at him, when the room runs him (returns false when it does not)
  shot(from, now) { if (!this.own.b) return false; this.boss.shot(from, now); return true; }
  heard(from) { if (this.own.b) this.boss.heard(from); }
  //  a round at monkey i, when the room runs the troop (false when it does not)
  monkeyShot(from, i, now) { if (!this.own.m) return false; this.troop.shot(from, i, now); return true; }
  //  a body a player's game threw: the room's troop comes to eat it too
  corpse(p) { if (this.own.m) this.troop.corpse(p); }
  //  a body the room's traffic left (a Ferrari through the crowd): on every
  //  screen, and for whoever runs the troop
  roomCorpse(c) {
    this.room.send('all', 'corpse', Object.assign({ id: '__room' }, c));
    this.corpse(c);
  }
  //  the host's game's traffic, asked for when two came ('tq'): the room
  //  carries on from it, and says so
  trafficFrom(from, p) {
    if (!this.enabled || !this.taking.t || from !== this.room.host()) return;
    this.taking.t = 0; this.own.t = true;
    this.traffic.adopt(p);
    this.room.send('all', 'own', { t: 1 });
  }
  //  a round into walker k, when the room runs the traffic
  pedShot(from, k, now) { if (!this.own.t) return false; this.traffic.shot(from, k, now); return true; }

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
    if (this.own.b && this.boss.ai && this.boss.ai.tally) this.boss.recall(name);   // (mid-fight: he knows it from now)
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
