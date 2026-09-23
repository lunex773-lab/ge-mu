//  ============================================================
//  CONTOUR — GameRoom, one Durable Object per room
//  ============================================================
//  Holds the room's WebSockets and passes messages between them through
//  the Relay (relay.js), which decides what may be said. It uses the
//  WebSocket Hibernation API: while nobody is sending anything, the object
//  can leave memory without dropping anyone, and costs nothing; the first
//  message wakes it and the constructor puts the room back together from
//  the sockets' attachments.
//
//  Ids are handed out in join order (p000000, p000001, …) from a counter
//  kept in the object's storage, so the player who has been here longest
//  has the lowest id — and runs the creatures, as the game decides — and
//  nobody can pick an id to take that job.

import { DurableObject } from 'cloudflare:workers';
import { Relay, idFor } from './relay.js';

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.relay = new Relay();
    this.sockets = new Map();                       // id → WebSocket
    this.who = new Map();                           // WebSocket → { id, name }
    for (const ws of this.ctx.getWebSockets()) {    // woken up: whoever is still connected
      const a = ws.deserializeAttachment();
      if (a && a.id) this.adopt(ws, a);
    }
    //  a plain "ping" keeps a phone's connection alive without waking the room
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  adopt(ws, a) {
    this.who.set(ws, a); this.sockets.set(a.id, ws); this.relay.join(a.id, a.name);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const n = (await this.ctx.storage.get('next')) || 0;
    await this.ctx.storage.put('next', n + 1);
    const a = { id: idFor(n), name: String(url.searchParams.get('name') || '').slice(0, 20) };
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(a);
    this.adopt(server, a);
    server.send(JSON.stringify({ s: '_welcome', p: { id: a.id, host: this.relay.host(), players: [...this.sockets.keys()], t: Date.now() } }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    const a = this.who.get(ws);
    if (!a) return;
    const r = this.relay.handle(a.id, raw, Date.now());
    if (r.back) ws.send(r.back);
    if (r.all) this.broadcast(r.all, a.id);
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
    this.who.delete(ws); this.sockets.delete(a.id); this.relay.leave(a.id);
    this.broadcast(JSON.stringify({ s: 'leave', p: { id: a.id } }), null);
  }

  broadcast(text, except) {
    for (const [id, s] of this.sockets) {
      if (id === except) continue;
      try { s.send(text); } catch (e) { /* closing; webSocketClose will tidy up */ }
    }
  }
}
