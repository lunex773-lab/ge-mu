//  ============================================================
//  CONTOUR — what a room lets through  (brief §6, §20, §22)
//  ============================================================
//  The room is the only way players reach each other, so it decides what a
//  message may say. Plain JavaScript, no Cloudflare APIs: the GameRoom
//  Durable Object feeds it (server/test/room.test.js runs both on a local
//  workerd; lab/test/server.game.test.js runs the real game against them).
//
//  What it enforces today (the game's messages, from the MQTT days, carried
//  over the room's WebSocket):
//
//    - who you are: the room names every player (join order, so the one who
//      has been here longest has the lowest id and runs the creatures), and
//      stamps the sender on everything — nobody can speak as someone else,
//      or pick an id that makes them the host
//    - what a shot does: damage is the gun's, never what the message claims
//      (a hit used to carry its own damage, so {"d": 99999} killed anyone)
//    - who runs the creatures: only the host's snapshots and kill reports
//      are passed on
//    - how much: a size limit on every message and a rate limit per kind,
//      and anything the game never sends is dropped
//
//  Wire format, both ways: one JSON object per WebSocket message,
//    client → room   { s: kind, p: payload }
//    room → client   { s: kind, p: payload, f: sender id }   (f absent from the room itself)

export const DMG = 20;                 // the gun's damage per shot (index.html DMG)
export const MAX_BYTES = 16384;        // one message
const ID_RE = /^p[0-9a-z]{6}$/;

//  per kind: tokens a second, burst, and how to clean the payload
//  (return null to drop it). `from` is the sender's id; `room` the Relay.
const KINDS = {
  state: [30, 40, (p, from) => {
    if (!num(p.x) || !num(p.y) || !num(p.z) || Math.abs(p.x) > 2000 || Math.abs(p.z) > 2000) return null;
    p.id = from;
    if (p.n !== undefined) p.n = text(p.n, 20);
    return p;
  }],
  shot: [12, 16, (p, from) => ({ id: from })],
  hit: [6, 8, (p, from, room) => (room.has(p.t) && p.t !== from ? { by: from, t: p.t, d: DMG } : null)],
  kill: [3, 6, (p, from) => (typeof p.by === 'string' && ID_RE.test(p.by) && p.by !== from ? { by: p.by, v: from, ds: int(p.ds) } : null)],
  chat: [1, 4, (p, from) => { const m = text(p.m, 120); return m ? { id: from, n: text(p.n, 20), m } : null; }],
  mob: [10, 12, (p, from, room) => (room.host() === from ? Object.assign(p, { id: from }) : null)],
  mdeath: [8, 16, (p, from, room) => (room.host() === from ? { i: int(p.i), by: typeof p.by === 'string' ? p.by : null, s: int(p.s) } : null)],
  mobhit: [8, 12, (p, from) => ({ i: int(p.i), d: DMG, by: from })],
  dhit: [8, 12, (p) => ({ i: int(p.i), d: DMG, x: int(p.x), z: int(p.z) })],
  ghit: [8, 12, (p) => ({ i: int(p.i), d: DMG, x: int(p.x), z: int(p.z) })],
  mfhit: [8, 12, (p) => ({ i: int(p.i), d: DMG, x: int(p.x), z: int(p.z) })],
  vhit: [8, 12, (p) => ({ d: DMG, x: int(p.x), z: int(p.z) })],
  bhit: [8, 12, (p, from) => ({ d: DMG, x: int(p.x), z: int(p.z), by: from })],
  corpse: [4, 8, (p, from) => Object.assign(p, { id: from })],
  //  a tear is announced by whoever heard of it, on behalf of its owner: the
  //  id in it is the owner's, and is left alone
  gate: [4, 8, (p) => p],
  gateask: [2, 4, (p, from) => ({ id: from })],
  gatereq: [2, 4, () => ({})],
  bolt: [2, 4, (p, from) => ({ id: from, s: int(p.s) })],
  ping: [2, 4, (p, from) => ({ id: from, t: +p.t || 0 })],    // answered to the sender only
};

function num(v) { return typeof v === 'number' && Number.isFinite(v); }
function int(v) { return Number.isFinite(+v) ? Math.round(+v) : 0; }
function text(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }

export class Relay {
  constructor() {
    this.players = new Map();          // id → { name, buckets }
  }
  has(id) { return this.players.has(id); }
  host() { let h = null; for (const id of this.players.keys()) if (h === null || id < h) h = id; return h; }
  join(id, name) { this.players.set(id, { name: text(name, 20), buckets: {} }); }
  leave(id) { this.players.delete(id); }

  //  One message from `from`. Returns what to do with it:
  //    { all: text }       send to everyone else in the room
  //    { back: text }      send to the sender (both, for a chat line)
  //    { drop: reason }
  handle(from, raw, now) {
    const me = this.players.get(from);
    if (!me) return { drop: 'unknown sender' };
    if (typeof raw !== 'string') return { drop: 'binary' };
    if (raw.length > MAX_BYTES) return { drop: 'too large' };
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return { drop: 'not JSON' }; }
    if (!msg || typeof msg !== 'object' || typeof msg.s !== 'string' || !msg.p || typeof msg.p !== 'object') return { drop: 'malformed' };
    const rule = KINDS[msg.s];
    if (!rule) return { drop: 'unknown kind ' + msg.s };
    if (!this.take(me, msg.s, rule[0], rule[1], now)) return { drop: 'rate ' + msg.s };
    const p = rule[2](msg.p, from, this);
    if (!p) return { drop: 'refused ' + msg.s };
    const out = JSON.stringify({ s: msg.s, p, f: from });
    //  a ping is for the sender; a chat line goes to everyone *including* the
    //  sender, who shows it when it comes back (as it did from the broker)
    return msg.s === 'ping' ? { back: out } : msg.s === 'chat' ? { all: out, back: out } : { all: out };
  }

  //  a token bucket per player per kind
  take(me, kind, rate, burst, now) {
    const b = me.buckets[kind] || (me.buckets[kind] = { n: burst, t: now });
    b.n = Math.min(burst, b.n + (now - b.t) / 1000 * rate); b.t = now;
    if (b.n < 1) return false;
    b.n -= 1;
    return true;
  }
}

//  ids in join order: p000000, p000001, … — the lowest present is the host
export function idFor(n) { return 'p' + n.toString(36).padStart(6, '0'); }
