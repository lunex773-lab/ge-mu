//  ============================================================
//  CONTOUR — the Worker
//  ============================================================
//  Everything that is a file (index.html) is served by Cloudflare's static
//  assets before this runs, free and without counting as a request. What
//  reaches here is /ws — a player joining a room — and anything else, which
//  is not found.
//
//    /ws?room=<name>&name=<nick>   WebSocket, handed to that room's GameRoom
//    /mind                         how Beelzebub's learning is going (JSON:
//                                  steps taken, fights, how far from the lab's
//                                  readout, how many players remembered — no names)

import { GameRoom } from './room.js';
import { BossMind } from './mind.js';
export { GameRoom, BossMind };

const ROOM_RE = /^[\p{L}\p{N}_\-. ]{1,32}$/u;

export function roomName(raw) {
  const r = String(raw || '').trim();
  return r && ROOM_RE.test(r) ? r : 'lobby';
}

function originAllowed(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;                                   // not a browser page
  const here = new URL(request.url);
  let o;
  try { o = new URL(origin); } catch (e) { return false; }
  if (o.host === here.host) return true;                      // the game served from here
  if (o.hostname === 'localhost' || o.hostname === '127.0.0.1') return true;   // development
  return String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean).includes(origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/mind' && request.method === 'GET' && env.MIND) {
      const [st] = await env.MIND.getByName('beelzebub').ask([{ k: 'stats' }]);
      return new Response(JSON.stringify(st, null, 1), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }
    if (url.pathname !== '/ws') return new Response('not found', { status: 404 });
    if (request.method !== 'GET' || request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected a WebSocket', { status: 426 });
    }
    if (!originAllowed(request, env)) return new Response('forbidden', { status: 403 });
    const room = roomName(url.searchParams.get('room'));
    const stub = env.ROOMS.getByName(room, { locationHint: env.LOCATION_HINT || undefined });
    return stub.fetch(request);
  },
};
