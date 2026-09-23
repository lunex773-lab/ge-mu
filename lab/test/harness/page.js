'use strict';
//  ============================================================
//  GAME TEST HARNESS
//  ============================================================
//
//  Runs the real game in headless Chromium, several players at once, with no
//  network. It builds lab/.cache/game.html from ../../index.html and changes
//  exactly three things on the way:
//
//    three.js     loaded from lab/.cache (fetched once with `npm pack`), since
//                 the CDN is not always reachable from where tests run
//    mqtt         a stand-in whose publish() goes through this process to
//                 every open page — separate browser contexts, so separate
//                 localStorage, exactly like separate phones
//    window.__t   a handle into the game's closure, added just before the
//                 main loop starts, so a test can read state and call the
//                 game's own functions
//
//  and it inlines the lab modules as window.__lab.require(name), so a test
//  can run the Neural Core's adapter against the live game objects.
//
//  Nothing here is shipped. Rendering is switched off after load (noRender):
//  software GL crawls at ~1 FPS, and none of these tests look at pixels.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

const FAKE_MQTT = `<script>
window.mqtt = { connect(url, opts) {
  const handlers = {}, subs = [];
  const match = (pat, t) => { const a = pat.split('/'), b = t.split('/');
    return a.length === b.length && a.every((x, i) => x === '+' || x === b[i]); };
  const client = {
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return client; },
    subscribe(t) { subs.push(t); },
    publish(t, p) { if (window.__relay) window.__relay({ t, p: String(p) }); },
    end() { client.dead = true; },
  };
  window.__recv = (m) => {
    if (client.dead) return;
    if (window.__drop && window.__drop(m.t, m.p)) return;
    if (!subs.some((x) => match(x, m.t))) return;
    const buf = { toString: () => m.p, length: m.p.length };
    for (const fn of handlers.message || []) fn(m.t, buf);
  };
  setTimeout(() => { for (const fn of handlers.connect || []) fn(); }, window.__connectDelay || 300);
  return client;
} };
</script>`;

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
  const mq = '<script src="https://cdn.jsdelivr.net/npm/mqtt@5/dist/mqtt.min.js"></script>';
  if (!s.includes(three) || !s.includes(mq)) throw new Error('harness: the library <script> tags have changed');
  if (!s.includes(TAIL)) throw new Error('harness: the end of the main script has changed');
  s = s.replace(three, '<script src="three.min.js"></script>');
  s = s.replace(mq, FAKE_MQTT + labBundle());
  s = s.replace(TAIL, HOOK);
  fs.writeFileSync(path.join(CACHE, 'game.html'), s);
}

//  A room of players. Each is a separate browser context — its own
//  localStorage, its own MP.id — and every publish reaches every page.
async function openRoom() {
  build();
  const { chromium } = playwright();
  const browser = await chromium.launch({ args: ['--disable-gpu', '--mute-audio'] });
  const pages = new Set();
  const relay = (m) => { for (const pg of pages) pg.evaluate((mm) => window.__recv && window.__recv(mm), m).catch(() => {}); };

  async function player({ room, id, nick, save, render, seed } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 480, height: 320 } });
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
    await page.exposeFunction('__relay', relay);
    await page.goto(ORIGIN + '/game.html', { timeout: 120000 });
    await page.waitForFunction(() => window.__t, null, { timeout: 60000 });
    if (!render) await page.evaluate(() => window.__t.noRender());
    pages.add(page);
    const P = {
      page, ctx, errors,
      eval: (fn, arg) => page.evaluate(fn, arg),
      join: () => page.evaluate(({ room, id, nick }) => {
        if (id) window.__t.MP.id = id;
        document.getElementById('nick').value = nick || 'bot';
        document.getElementById('room').value = room || 'lab';
        window.__t.start();
      }, { room, id, nick }),
      setDrop: (on) => page.evaluate((o) => { window.__drop = o ? ((t) => /\/(gate|gateask|mob)$/.test(t)) : null; }, on),
      close: async () => { pages.delete(page); await ctx.close(); },
    };
    return P;
  }
  return { player, close: () => browser.close() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { openRoom, build, sleep, ROOT, CACHE };
