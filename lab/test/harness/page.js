'use strict';
//  ============================================================
//  GAME TEST HARNESS
//  ============================================================
//
//  Runs the real game in headless Chromium, several players at once, with no
//  network. It builds lab/.cache/game.html from ../../index.html and changes
//  exactly two things on the way:
//
//    three.js     loaded from lab/.cache (fetched once with `npm pack`), since
//                 the CDN is not always reachable from where tests run
//    window.__t   a handle into the game's closure, added just before the
//                 main loop starts, so a test can read state and call the
//                 game's own functions
//
//  The room server is played here, in this process, by the real room rules
//  (server/relay.js): each page's WebSocket to /ws is routed to it
//  (Playwright's routeWebSocket), and it does what GameRoom does on
//  Cloudflare — names players in join order, welcomes them, passes every
//  message through Relay.handle, and says when someone leaves. Separate
//  browser contexts, so separate localStorage, exactly like separate phones.
//  (The real GameRoom, on workerd, is server/test/room.test.js and
//  lab/test/server.game.test.js.)
//
//  and it inlines the lab modules as window.__lab.require(name), so a test
//  can run the Neural Core's adapter against the live game objects.
//
//  Nothing here is shipped. Rendering is switched off after load (noRender):
//  software GL crawls at ~1 FPS, and none of these tests look at pixels.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const CACHE = path.join(ROOT, 'lab', '.cache');
const ORIGIN = 'http://lab.test';

function playwright() {
  try { return require('playwright'); } catch (e) {}
  const g = execSync('npm root -g').toString().trim();
  return require(path.join(g, 'playwright'));
}

function ensureThree() {
  const out = path.join(CACHE, 'three.min.js');
  if (fs.existsSync(out)) return;
  fs.mkdirSync(CACHE, { recursive: true });
  execSync('npm pack three@0.128.0 --silent', { cwd: CACHE, stdio: 'pipe' });
  execSync('tar xzf three-0.128.0.tgz package/build/three.min.js', { cwd: CACHE });
  fs.renameSync(path.join(CACHE, 'package', 'build', 'three.min.js'), out);
  fs.rmSync(path.join(CACHE, 'package'), { recursive: true, force: true });
  fs.rmSync(path.join(CACHE, 'three-0.128.0.tgz'), { force: true });
}


const HOOK = `
  window.__t = {
    get p() { return p; }, get yaw() { return yaw; }, set yaw(v) { yaw = v; },
    get hp() { return hp; }, get dead() { return dead; }, get cloak() { return cloak; },
    get wState() { return wState; }, WS, MP, EYE, HP_MAX,
    get cityT() { return cityT; },
    rayCity, rayWrecks, clearAt,
    get rift() { return rift; },
    get gateSettle() { return gateSettle; },
    get myKills() { return myKills; }, set myKills(v) { myKills = v; },
    get gateUnlocked() { return gateUnlocked; },
    get rageT() { return rageT; }, RAGE_TIME,
    monkeyPeds, dogs,
    creditMyKill, openGate, saveGate, publishGate, start,
    noRender() { renderer.realRender = renderer.render; renderer.render = () => {}; },
    //  a direct eval inside the game's closure: tests can read and set any of
    //  its variables without the game shipping a single debug hook
    ev(src) { return eval(src); },
  };
  document.getElementById('loading').remove();
  requestAnimationFrame(frame);
})();`;
const TAIL = `
  document.getElementById('loading').remove();
  requestAnimationFrame(frame);
})();`;

const LAB_MODULES = {
  'rng.js': 'lab/core/rng.js',
  'connectome.js': 'lab/core/connectome.js',
  'compress.js': 'lab/core/compress.js',
  'neural.js': 'lab/core/neural.js',
  'worldstate.js': 'lab/core/worldstate.js',
  'sensors.js': 'lab/core/sensors.js',
  'game_adapter.js': 'lab/adapter/game_adapter.js',
};
function labBundle() {
  const defs = Object.entries(LAB_MODULES).map(([name, rel]) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    return JSON.stringify(name) + ': function (module, exports, require) {\n' + src + '\n}';
  });
  return `<script>
(function () {
  const defs = {${defs.join(',\n')}};
  const cache = {};
  function req(name) {
    name = name.replace(/^.*\\//, '');
    if (cache[name]) return cache[name].exports;
    const m = { exports: {} }; cache[name] = m;
    defs[name](m, m.exports, req);
    return m.exports;
  }
  window.__lab = { require: req };
})();
</script>`;
}

function build() {
  ensureThree();
  //  LAB_GAME=<file> runs another copy of the game (an A/B comparison against
  //  the version before a change); the default is the repository's index.html
  let s = fs.readFileSync(process.env.LAB_GAME || path.join(ROOT, 'index.html'), 'utf8');
  const three = '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>';
  const mq = '<script src="https://cdn.jsdelivr.net/npm/mqtt@5/dist/mqtt.min.js"></script>';   // in copies from before it went
  if (!s.includes(three)) throw new Error('harness: the three.js <script> tag has changed');
  if (!s.includes(TAIL)) throw new Error('harness: the end of the main script has changed');
  s = s.replace(three, '<script src="three.min.js"></script>' + labBundle());
  s = s.replace(mq, '');
  s = s.replace(TAIL, HOOK);
  fs.writeFileSync(path.join(CACHE, 'game.html'), s);
}

//  The room server, as GameRoom (server/room.js) runs it, minus what only
//  Cloudflare has (hibernation, storage): one Relay per room name. Its check
//  on where players are (server/move.js) is off unless asked for — the game
//  tests move players about to set scenes up — and move.game.test.js asks;
//  so is its running of the creatures (server/creatures.js), which the tests
//  of creatures as a host runs them do without, and boss.game.test.js asks for.
async function roomServer({ moves = false, creatures = false } = {}) {
  const { Relay, idFor } = await import(pathToFileURL(path.join(ROOT, 'server', 'relay.js')).href);
  const rooms = new Map();                       // name → { relay, next, sockets: Map(id → { ws, who }) }
  connect.rooms = rooms;                         // (a test may look inside: openRoom().rooms)
  const kindOf = (text) => { try { return JSON.parse(text).s; } catch (e) { return ''; } };
  function connect(ws, who) {
    const u = new URL(ws.url());
    const raw = String(u.searchParams.get('room') || '').trim();
    const name = /^[\p{L}\p{N}_\-. ]{1,32}$/u.test(raw) ? raw : 'lobby';   // as server/worker.js
    let R = rooms.get(name);
    if (!R) rooms.set(name, R = { relay: new Relay({ moves, creatures }), next: 0, sockets: new Map() });
    const id = idFor(R.next++);
    R.sockets.set(id, { ws, who });
    const joined = R.relay.join(id, String(u.searchParams.get('name') || '').slice(0, 20));
    //  who.drop: kinds this player does not hear (setDrop — packets lost)
    const deliver = (to, text) => { const t = R.sockets.get(to); if (t && !(t.who.drop && t.who.drop.test(kindOf(text)))) t.ws.send(text); };
    ws.send(JSON.stringify({ s: '_welcome', p: { id, host: R.relay.host(), players: [...R.sockets.keys()], t: Date.now(), hp: R.relay.players.get(id).hp, items: R.relay.itemState(), own: R.relay.creatures.owns() } }));
    const route = (out, from) => {
      for (const [to, text] of out) {
        if (to === 'others' || to === 'all') { for (const other of [...R.sockets.keys()]) if (to === 'all' || other !== from) deliver(other, text); }
        else deliver(to === 'self' ? from : to, text);
      }
    };
    route(joined, id);
    ws.onMessage((m) => {
      if (!R.sockets.has(id)) return;
      const r = R.relay.handle(id, String(m), Date.now());
      R.relay.dirty.clear();
      route(r.out, id);
    });
    const gone = () => {
      if (!R.sockets.delete(id)) return;
      const out = R.relay.leave(id);
      for (const other of R.sockets.keys()) deliver(other, JSON.stringify({ s: 'leave', p: { id } }));
      route(out, id);
    };
    ws.onClose(() => { try { ws.close(); } catch (e) {} gone(); });   // answer it, as GameRoom does
    who.closes.add(gone);                          // (a page shut outright never says goodbye: P.close says it for it)
  }
  return connect;
}

//  A room of players. Each is a separate browser context — its own
//  localStorage — and all of them meet in the room server above.
async function openRoom({ moves = false, creatures = false } = {}) {
  build();
  const { chromium } = playwright();
  const browser = await chromium.launch({ args: ['--disable-gpu', '--mute-audio'] });
  const connect = await roomServer({ moves, creatures });

  async function player({ room, nick, save, render, seed, url, viewport } = {}) {
    const ctx = await browser.newContext({ viewport: viewport || { width: 480, height: 320 } });
    await ctx.route(ORIGIN + '/**', (route) => {
      const f = path.join(CACHE, new URL(route.request().url()).pathname.slice(1));
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
      route.fulfill({ status: 200, contentType: f.endsWith('.js') ? 'text/javascript' : 'text/html', body: fs.readFileSync(f) });
    });
    //  seed: Math.random becomes a fixed sequence, so two copies of the game
    //  put the same traffic and the same crowd in the same places (A/B runs)
    if (seed) await ctx.addInitScript((sd) => { let a = sd | 0;
      Math.random = () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }, seed);
    if (save) await ctx.addInitScript((s) => { try { localStorage.setItem('contour.rift', s); } catch (e) {} }, JSON.stringify(save));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const who = { drop: null, down: false, closes: new Set() };
    //  who.down: the room server is not answering (refused at once), as when
    //  a day's free requests are used up
    await page.routeWebSocket(/^ws:\/\/lab\.test\/ws\?/, (ws) => { if (who.down) ws.close({ code: 1011 }); else connect(ws, who); });
    //  url: the same page served from somewhere else — the room server under
    //  wrangler dev, say — instead of the harness's own origin
    await page.goto(url || ORIGIN + '/game.html', { timeout: 120000 });
    await page.waitForFunction(() => window.__t, null, { timeout: 60000 });
    if (!render) await page.evaluate(() => window.__t.noRender());
    const P = {
      page, ctx, errors,
      eval: (fn, arg) => page.evaluate(fn, arg),
      //  the room names players in the order they join: the first in has the
      //  lowest id, and runs the creatures
      join: () => page.evaluate(({ room, nick }) => {
        document.getElementById('nick').value = nick || 'bot';
        document.getElementById('room').value = room || 'lab';
        window.__t.start();
      }, { room, nick }),
      setDrop: (on) => { who.drop = on ? /^(gate|gateask|mob)$/ : null; },
      serverDown: (on) => { who.down = !!on; },
      close: async () => { for (const f of who.closes) f(); who.closes.clear(); await ctx.close(); },
    };
    return P;
  }
  return { player, close: () => browser.close(), rooms: connect.rooms };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { openRoom, build, sleep, ROOT, CACHE };
