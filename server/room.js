//  ============================================================
//  CONTOUR — GameRoom, one Durable Object per room
//  ============================================================
//  Holds the room's WebSockets and passes messages between them through
//  the Relay (relay.js), which decides what may be said and keeps the
//  room's account of each player's health, deaths and kills. It uses the
//  WebSocket Hibernation API: while nobody is sending anything, the object
//  can leave memory without dropping anyone, and costs nothing; the first
//  message wakes it and the constructor puts the room back together from
//  the sockets' attachments.
//
//  Ids are handed out in join order (p000000, p000001, …) from a counter
//  kept in the object's storage, so the player who has been here longest
//  has the lowest id — and runs the creatures, as the game decides — and
//  nobody can pick an id to take that job.
//
//  What Beelzebub learns is kept for every room by one other object,
//  BossMind (mind.js): after each message, whatever the room has for it
//  (relay.takeAsks) goes to it in one call, and its answers come back
//  through the relay (mindSaid). The live check's rooms (_check-…) use a
//  memory of their own, so testing teaches him nothing.

import { DurableObject } from 'cloudflare:workers';
import { Relay, idFor } from './relay.js';
import BUILD from '../dist/build.js';                // (written by server/build.js: which code this is)

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    //  MOVE_CHECK=off (wrangler dev --var) only for tests that move players
    //  about to set a scene up; every real room checks
    this.relay = new Relay({ moves: env.MOVE_CHECK !== 'off' });
    this.sockets = new Map();                       // id → WebSocket
    this.who = new Map();                           // WebSocket → { id, name, mind }
    this.mindName = 'beelzebub';
    for (const ws of this.ctx.getWebSockets()) {    // woken up: whoever is still connected
      const a = ws.deserializeAttachment();
      if (a && a.id) { this.adopt(ws, a); if (a.mind) this.mindName = a.mind; this.relay.woke = true; }
    }
    //  a plain "ping" keeps a phone's connection alive without waking the room
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  adopt(ws, a) {
    this.who.set(ws, a); this.sockets.set(a.id, ws);
    return this.relay.join(a.id, a.name, a.keep);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const n = (await this.ctx.storage.get('next')) || 0;
    await this.ctx.storage.put('next', n + 1);
    if (String(url.searchParams.get('room') || '').startsWith('_check')) this.mindName = 'beelzebub-check';
    const a = { id: idFor(n), name: String(url.searchParams.get('name') || '').slice(0, 20), mind: this.mindName };
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(a);
    const out = this.adopt(server, a);
    server.send(JSON.stringify({ s: '_welcome', p: { id: a.id, host: this.relay.host(), players: [...this.sockets.keys()], t: Date.now(), hp: this.relay.players.get(a.id).hp, items: this.relay.itemState(), own: this.relay.creatures.owns(), bd: BUILD, ver: (this.env && this.env.CF_VERSION_METADATA && this.env.CF_VERSION_METADATA.id) || null } }));
    this.route(out, a.id, server);
    this.relay.hello(a.id);
    const asked = this.askMind();                   // (answered once the player is in)
    if (asked) try { this.ctx.waitUntil(asked); } catch (e) {}
    return new Response(null, { status: 101, webSocket: client });
  }
  //  whatever the room has for Beelzebub's memory, in one call; its answers
  //  go out as the room's own messages. Without it (no MIND binding, or it
  //  cannot be reached) the room runs on: he fights with the readout he has.
  askMind() {
    const asks = this.relay.takeAsks();
    if (!asks.length || !this.env.MIND) return null;
    return this.env.MIND.getByName(this.mindName).ask(asks)
      .then((replies) => this.route(this.relay.mindSaid(replies), null, null))
      .catch((e) => { this.relay.mindErrors = (this.relay.mindErrors || 0) + 1; this.relay.lastMindError = String(e && e.message || e); });
  }

  async webSocketMessage(ws, raw) {
    const a = this.who.get(ws);
    if (!a) return;
    const r = this.relay.handle(a.id, raw, Date.now());
    //  health and score ride on the sockets' attachments, so a room that
    //  sleeps while everyone is idle wakes up remembering them
    for (const id of this.relay.dirty) {
      const s = this.sockets.get(id), w = s && this.who.get(s);
      if (w) { w.keep = this.relay.saved(id); try { s.serializeAttachment(w); } catch (e) {} }
    }
    this.relay.dirty.clear();
    this.route(r.out, a.id, ws);
    const asked = this.askMind();
    if (asked) await asked;
  }
  //  what the room says: [to, text] pairs, to 'others' (than `from`), 'all', 'self' or an id
  route(out, from, ws) {
    for (const [to, text] of out) {
      if (to === 'others') this.broadcast(text, from);
      else if (to === 'all') this.broadcast(text, null);
      else if (to === 'self') { try { ws.send(text); } catch (e) {} }
      else { const s = this.sockets.get(to); if (s) try { s.send(text); } catch (e) {} }
    }
  }

  //  answer the close (newer runtimes do it themselves; doing it too is safe)
  //  or the player's side waits on it and never learns the socket is gone
  async webSocketClose(ws, code, reason) {
    this.gone(ws);
    try { ws.close(code === 1005 ? 1000 : code, reason); } catch (e) {}
  }
  async webSocketError(ws) { this.gone(ws); }

  gone(ws) {
    const a = this.who.get(ws);
    if (!a) return;
    this.who.delete(ws); this.sockets.delete(a.id);
    const out = this.relay.leave(a.id);
    this.broadcast(JSON.stringify({ s: 'leave', p: { id: a.id } }), null);
    this.route(out, a.id, null);
    const asked = this.askMind();
    if (asked) try { this.ctx.waitUntil(asked); } catch (e) {}
  }

  broadcast(text, except) {
    for (const [id, s] of this.sockets) {
      if (id === except) continue;
      try { s.send(text); } catch (e) { /* closing; webSocketClose will tidy up */ }
    }
  }
}
