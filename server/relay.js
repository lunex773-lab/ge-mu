//  ============================================================
//  CONTOUR — what a room lets through, and what it decides  (brief §6, §20, §22)
//  ============================================================
//  The room is the only way players reach each other, so it decides what a
//  message may say — and, for what matters between players, what is true.
//  Plain JavaScript, no Cloudflare APIs: the GameRoom Durable Object feeds
//  it (server/test/room.test.js runs both on a local workerd;
//  lab/test/server.game.test.js runs the real game against them).
//
//  What it enforces:
//
//    - who you are: the room names every player (join order, so the one who
//      has been here longest has the lowest id and runs the creatures), and
//      stamps the sender on everything — nobody can speak as someone else,
//      or pick an id that makes them the host
//    - the pickups are the room's: whoever reaches one first gets it, and the
//      room says when it is back
//    - health, deaths and kills are the room's. A player's game says "I hit
//      so-and-so"; the room checks it could have happened (combat.js: the gun
//      ready, the target in reach, a clear line through the city) and only
//      then takes the gun's damage off the target, tells the target, and
//      decides the death and whose kill it is. What a player reports about
//      itself (a car, a monkey, a banana, coming back to life) it may only
//      report against itself.
//    - where players are: every step is checked against how far anyone
//      could have walked (move.js). One that could not is not passed on,
//      not used to judge shots or pickups, and the player is told where the
//      room last had them ('pos'), and put back there
//    - who runs the creatures: with two or more here the room runs Beelzebub
//      itself (creatures.js), and judges every shot at him; the rest are the
//      host's, and only the host's snapshots and kill reports are passed on
//    - how much: a size limit on every message and a rate limit per kind,
//      and anything the game never sends is dropped
//
//  Wire format, both ways: one JSON object per WebSocket message,
//    client → room   { s: kind, p: payload }
//    room → client   { s: kind, p: payload, f: sender id }   (f absent from the room itself)

import RULES from '../shared/rules.js';
import ITEMS from '../shared/items.js';
import { remember, whyNot } from './combat.js';
import { step, freeStep } from './move.js';
import { Creatures } from './creatures.js';

export const DMG = RULES.DMG;
export const MAX_BYTES = 16384;        // one message

//  per kind: tokens a second, burst, and what to do with it — return the
//  payload to pass on to the others, or null to pass nothing on (the kind
//  may have answered through room.send). `from` is the sender's id.
const KINDS = {
  state: [30, 40, (p, from, room, now) => {
    if (!num(p.x) || !num(p.y) || !num(p.z) || Math.abs(p.x) > 2000 || Math.abs(p.z) > 2000) return null;
    const me = room.players.get(from), w = p.w === undefined ? 0 : int(p.w) ? 1 : 0;
    if (room.moves) {
      const why = step(me, p.x, p.y, p.z, w, now);
      if (why) { room.moveRefused++; room.lastMoveRefusal = why; room.putBack(from, me, now); return null; }
    }
    remember(me, now, p.x, p.y, p.z);
    me.w = w; me.yaw = num(p.r) ? p.r : 0; me.inv = !!p.iv;          // (what the room's creatures see of them)
    p.id = from;
    if (p.n !== undefined) p.n = text(p.n, 20);
    //  what the others are told about my health and my score is the room's
    p.hp = Math.round(me.hp); p.k = me.kills;
    if (me.dead) { p.d = 1; p.ds = me.ds; if (me.killer) p.kb = me.killer; else delete p.kb; }
    else { delete p.d; delete p.ds; delete p.kb; }
    return p;
  }],
  shot: [12, 16, (p, from, room) => { room.creatures.heard(from); return { id: from }; }],
  //  "I hit t": checked, and if it stands the room does the damage (below)
  hit: [6, 8, (p, from, room, now) => {
    const me = room.players.get(from), v = room.players.get(p.t);
    if (!v || p.t === from) return null;
    const why = whyNot(me, v, now);
    if (why) { room.refused++; room.lastRefusal = why; return null; }
    me.lastHitT = now;
    room.damage(p.t, DMG, from, now);
    return null;
  }],
  //  what a player reports against itself: hurt by the city (a car, a
  //  creature), back on its feet
  hurt: [20, 40, (p, from, room, now) => {
    const d = Math.max(0, Math.min(RULES.HP_MAX, +p.d || 0));
    if (d > 0) room.damage(from, d, null, now);
    return null;
  }],
  //  "let me have pickup i": the first one there, alive, on its side of the
  //  tear, gets it; the room heals them (a banana) and tells everyone it is gone
  take: [4, 8, (p, from, room, now) => {
    const items = room.items(), i = int(p.i), it = items[i], me = room.players.get(from);
    if (!it || !it.active || me.dead || me.w !== it.w || !room.near(me, it, now)) return null;
    it.active = false; it.until = now + ITEMS.RESPAWN[it.k] * 1000;
    if (it.k === 'compass') room.send(from, 'took', { i });
    else { me.hp = Math.min(RULES.HP_MAX, me.hp + RULES.BANANA_HEAL); room.dirty.add(from); room.send(from, 'took', { i, hp: me.hp }); }
    room.send('all', 'item', { i, a: 0 });
    return null;
  }],
  spawn: [1, 3, (p, from, room) => {
    const me = room.players.get(from);
    if (me.dead) { me.dead = false; me.hp = RULES.HP_MAX; me.killer = null; me.lastBy = null; room.dirty.add(from); freeStep(me); }   // up again, wherever
    room.send(from, 'hp', { hp: me.hp });
    return null;
  }],
  //  deaths and kills are decided here now; a player's own claim is ignored
  kill: [3, 6, () => null],
  chat: [1, 4, (p, from) => { const m = text(p.m, 120); return m ? { id: from, n: text(p.n, 20), m } : null; }],
  mob: [10, 12, (p, from, room) => {
    if (room.host() !== from) return null;
    room.creatures.hostSaid(p);                                    // the tear, and Beelzebub while the room takes him over
    return Object.assign(p, { id: from });
  }],
  mdeath: [8, 16, (p, from, room) => (room.host() === from ? { i: int(p.i), by: typeof p.by === 'string' ? p.by : null, s: int(p.s) } : null)],
  mobhit: [8, 12, (p, from) => ({ i: int(p.i), d: DMG, by: from })],
  dhit: [8, 12, (p) => ({ i: int(p.i), d: DMG, x: int(p.x), z: int(p.z) })],
  ghit: [8, 12, (p) => ({ i: int(p.i), d: DMG, x: int(p.x), z: int(p.z) })],
  mfhit: [8, 12, (p) => ({ i: int(p.i), d: DMG, x: int(p.x), z: int(p.z) })],
  vhit: [8, 12, (p) => ({ d: DMG, x: int(p.x), z: int(p.z) })],
  //  at Beelzebub: the room's to judge when it runs him, else the host's
  bhit: [8, 12, (p, from, room, now) => (room.creatures.shot(from, now) ? null : { d: DMG, x: int(p.x), z: int(p.z), by: from })],
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
  //  moves: check where players say they are (move.js). On in every room on
  //  Cloudflare; the lab's game tests move players about to set scenes up,
  //  and turn it on only where they test it.
  //  creatures: run Beelzebub when two or more are here (creatures.js). On
  //  in every room on Cloudflare; the lab's game tests of the creatures as a
  //  host runs them leave it off.
  constructor({ moves = true, creatures = true } = {}) {
    this.moves = moves;
    this.players = new Map();          // id → the room's view of that player
    this.out = [];
    this.refused = 0; this.lastRefusal = '';
    this.moveRefused = 0; this.lastMoveRefusal = '';
    this.dirty = new Set();            // players whose health or score changed (the room saves them)
    this.pickups = null;               // shared/items.js, and which are lying there (items())
    this.creatures = new Creatures(this, { enabled: creatures });
  }
  items() {
    if (!this.pickups) this.pickups = ITEMS.layout().map((it) => ({ k: it.k, w: it.w, x: it.x, z: it.z, active: true, until: 0 }));
    return this.pickups;
  }
  itemState() { return this.items().map((it) => (it.active ? 1 : 0)); }
  //  pickups whose time has come back, announced — checked on every message,
  //  which arrive many times a second while anyone is playing
  tickItems(now) {
    if (!this.pickups) return;
    this.pickups.forEach((it, i) => { if (!it.active && now >= it.until) { it.active = true; this.send('all', 'item', { i, a: 1 }); } });
  }
  //  was this player within reach of it lately (their last half second)?
  near(me, it, now) {
    const h = me.hist, r = ITEMS.REACH + 1.0;
    for (let i = h.length - 4; i >= 0 && h[i] >= now - 600; i -= 4) if (Math.hypot(h[i + 1] - it.x, h[i + 3] - it.z) <= r) return true;
    return false;
  }
  has(id) { return this.players.has(id); }
  host() { let h = null; for (const id of this.players.keys()) if (h === null || id < h) h = id; return h; }
  //  saved: what was kept of this player while the room slept (saved()).
  //  Returns what to send because of it, as handle() does (the room's
  //  creatures may change hands when someone comes or goes).
  join(id, name, saved) {
    this.out = [];
    const k = saved || {};
    this.players.set(id, { name: text(name, 20), buckets: {}, hp: num(k.hp) ? k.hp : RULES.HP_MAX, dead: !!k.dead, ds: int(k.ds), kills: int(k.kills), deaths: int(k.deaths),
      killer: k.killer || null, lastBy: null, lastByT: 0, lastHitT: -1e9, w: 0, hist: [] });
    this.creatures.recount();
    return this.out;
  }
  saved(id) { const v = this.players.get(id); return v && { hp: v.hp, dead: v.dead, ds: v.ds, kills: v.kills, deaths: v.deaths, killer: v.killer }; }
  //  a step the room did not believe: tell the player where it has them
  //  (not more than twice a second; the steps still on their way in will
  //  be refused too, and one answer is enough)
  putBack(id, v, now) {
    if (!v.mv || now - (v.putT || 0) < 500) return;       // (no step believed yet: nowhere to go back to)
    v.putT = now;
    this.send(id, 'pos', { x: v.mv.x, y: v.mv.y, z: v.mv.z });
  }
  leave(id) { this.out = []; this.players.delete(id); this.creatures.recount(); return this.out; }

  //  queue a message from the room: to 'others' (than the sender), 'self',
  //  'all', or one player's id
  send(to, s, p, f) { this.out.push([to, JSON.stringify(f ? { s, p, f } : { s, p })]); }

  //  d damage to player id, by another player (by) or by the city (null)
  damage(id, d, by, now) {
    const v = this.players.get(id);
    if (!v || v.dead) return;
    v.hp = Math.max(0, v.hp - d); this.dirty.add(id);
    if (by) { v.lastBy = by; v.lastByT = now; this.send(id, 'hurt', { d, by, hp: v.hp }); }
    else this.send(id, 'hp', { hp: v.hp });
    if (v.hp <= 0) this.die(id, now);
  }
  //  a death, and whose kill it is: whoever shot them in the last 12 s
  die(id, now) {
    const v = this.players.get(id);
    v.dead = true; v.hp = 0; v.ds++; v.deaths++;
    const k = v.lastBy && v.lastBy !== id && now - v.lastByT < RULES.KILL_CREDIT_MS && this.players.has(v.lastBy) ? v.lastBy : null;
    v.killer = k;
    if (k) { this.players.get(k).kills++; this.dirty.add(k); this.send('all', 'kill', { by: k, v: id, ds: v.ds }); }
  }

  //  One message from `from`. Returns what to send, as [to, text] pairs
  //  (to: 'others', 'self', 'all' or an id), and why nothing, if nothing.
  handle(from, raw, now) {
    this.out = [];
    const me = this.players.get(from);
    if (!me) return { out: [], drop: 'unknown sender' };
    this.tickItems(now);
    const r = this.judge(me, from, raw, now);
    this.creatures.tick(now);              // whatever the message, time has moved on for the creatures
    return r;
  }
  judge(me, from, raw, now) {
    const no = (why) => ({ out: this.out, drop: why });
    if (typeof raw !== 'string') return no('binary');
    if (raw.length > MAX_BYTES) return no('too large');
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return no('not JSON'); }
    if (!msg || typeof msg !== 'object' || typeof msg.s !== 'string' || !msg.p || typeof msg.p !== 'object') return no('malformed');
    const rule = KINDS[msg.s];
    if (!rule) return no('unknown kind ' + msg.s);
    if (!this.take(me, msg.s, rule[0], rule[1], now)) return no('rate ' + msg.s);
    const p = rule[2](msg.p, from, this, now);
    if (p) {
      //  a ping is for the sender; a chat line goes to everyone *including* the
      //  sender, who shows it when it comes back (as it did from the broker)
      this.send(msg.s === 'ping' ? 'self' : msg.s === 'chat' ? 'all' : 'others', msg.s, p, from);
    }
    return { out: this.out, drop: p || this.out.length ? null : 'refused ' + msg.s };
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
