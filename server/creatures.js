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

import { RoomBoss } from './boss.js';

const SEND_MS = 100;                       // his account goes out ten times a second

export class Creatures {
  constructor(room, { enabled = true } = {}) {
    this.room = room;                      // the Relay
    this.enabled = enabled;
    this.boss = new RoomBoss(room);
    this.own = false;                      // the room runs Beelzebub
    this.taking = false;                   // two are here: waiting on the host's next word
    this.sentT = 0; this.sentSome = false;
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
    if (n >= 2) { if (!this.own) this.taking = true; return; }
    this.taking = false;
    if (!this.own) return;
    this.own = false;
    this.room.send('all', 'own', { b: 0, s: this.boss.snapshot() });
    this.boss.st = null; this.sentSome = false;
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
}
