//  ============================================================
//  CONTOUR — BossMind, the one Durable Object that remembers for every room
//  ============================================================
//  What Beelzebub has learned — of the players he has fought, and how he
//  reads his own mind — kept for every room (mindstore.js, its logic). The
//  rooms call it (GameRoom → env.MIND, one object by name: 'beelzebub') with
//  whatever they have for it after a message, in one call; nothing else can
//  reach it but the Worker's read-only /mind page.

import { DurableObject } from 'cloudflare:workers';
import { MindStore } from './mindstore.js';

export class BossMind extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.store = new MindStore(ctx.storage);
  }
  async ask(asks) { return this.store.ask(asks); }
}
