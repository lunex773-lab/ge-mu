'use strict';
//  ============================================================
//  THE GREAT ONES' BIO-BRAINS — the real game
//  ============================================================
//  shared/biobrain.js in the bosses, as players meet them (ACIS × BIO-BRAIN):
//
//    - alone, the game runs them: the Mind Flayer, walked at by the player,
//      backs away watching them, grows afraid, says so — and its bar says
//      what it is doing; VECNA, untroubled, falls into divine calm
//    - the slow brain: the game asks its room (a stand-in for Workers AI
//      here), and the answer comes back, is checked against the genome, and
//      is said — in that boss's own voice
//    - with two here the room runs them: what they say reaches the players
//      over there, their bar shows what their brain is doing, and the
//      room's slow brain speaks through them too
//    - what they remember of a player is kept by name (the room's memory),
//      for the next fight
//    - Beelzebub has his brain wherever he is run
//
//    node lab/test/brain.game.test.js     (about two minutes)

const { openRoom, sleep } = require('./harness/page.js');
const FL = require('../../shared/flayers.js');
const BB = require('../../shared/biobrain.js');

const results = [];
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  const line = (ok ? '  ok   ' : '  FAIL ') + name + (detail ? '\n         ' + detail : '');
  results.push(line); console.log(line);
}
const ev = (P, src) => P.eval((s) => window.__t.ev(s), src);
async function until(P, src, secs) {
  for (let i = 0; i < secs * 10; i++) { if (await ev(P, src)) return true; await sleep(100); }
  return false;
}
const STAND = (x, z) => `(() => { carHitCd = 1e9; for (let r = 0; r < 60; r += 2) for (let k = 0; k < 12; k++) { const sx = ${x} + Math.sin(k * 0.52) * r, sz = ${z} + Math.cos(k * 0.52) * r;
  if (clearAt(sx, sz, 3)) { p.set(sx, EYE, sz); vy = 0; publishState(true); return JSON.stringify([sx, sz]); } } return null; })()`;
//  a stand-in for Workers AI: answers as each boss would be allowed to
const LINES = { vecna: 'お前の考えは、読めている。', mind_flayer: '子らよ…囲め…', beelzebub: '逃がさんぞォ！' };
const STRATS = { vecna: 'COUNTER', mind_flayer: 'SEND_MINIONS', beelzebub: 'PURSUE' };
const ai = { asked: [], run: async (model, input) => {
  const ctx = JSON.parse(input.messages[1].content);
  ai.asked.push(ctx.boss);
  return { response: { internalAssessment: { situation: 'test', predictedPlayerAction: 'approach', uncertainty: 0.3 },
    intent: { primary: 'observe' }, strategyProposal: { strategy: STRATS[ctx.boss], reason: 'the stand-in says so', confidence: 0.9 }, dialogue: LINES[ctx.boss] } };
} };

(async () => {
  const room = await openRoom({ creatures: true, ai });
  try {
    const A = await room.player({ room: 'brain', nick: 'Aki' });
    await A.join(); await sleep(2000);
    await ev(A, 'window.__t.noRender(); VS.holdSpawn = true; VS.spawnCd = 1e9; DOGS.holdSpawn = true; GORS.holdSpawn = true; MFS.holdSpawn = true; MFS.spawnCd = 1e9; 1');
    await ev(A, 'setWorld(WS.BACK); 1');
    const at = JSON.parse(await ev(A, STAND(11, 10)));

    // ---- alone: the Mind Flayer, walked at ---------------------------------------------
    {
      await ev(A, `(() => { let s = null;
        for (let r = 0; r < 40 && !s; r += 2) for (let k = 0; k < 12 && !s; k++) { const sx = p.x + 32 + Math.sin(k * 0.52) * r, sz = p.z + Math.cos(k * 0.52) * r; if (clearAt(sx, sz, 3)) s = { x: sx, z: sz }; }
        const m = spawnFlayer(s); m.escorted = true; m.summonT = 999; m.hd = Math.atan2(p.x - m.x, p.z - m.z); return 1; })()`);
      await sleep(3000);
      const f0 = await ev(A, 'flayers.find((m) => m.live).bio.affect.fear');
      //  the player walks straight at it, 5 m/s, for six seconds (of the game's time: a page just opened runs slow)
      await ev(A, `(() => { const f = updatePeers, m0 = flayers.find((q) => q.live && !q.dead); window.__from = { x: m0.x, z: m0.z, px: p.x, pz: p.z };
        window.__walkOff = false; window.__gt = 0; window.__near = 999; window.__fmax = 0; window.__strats = []; updatePeers = function (dt, now) {
        const m = flayers.find((q) => q.live && !q.dead);
        if (m && !window.__walkOff && window.__gt < 6) { window.__gt += dt; const d = Math.hypot(m.x - p.x, m.z - p.z); window.__near = Math.min(window.__near, d);
          window.__fmax = Math.max(window.__fmax, m.bio.affect.fear); if (window.__strats[window.__strats.length - 1] !== m.bio.strat.name) window.__strats.push(m.bio.strat.name);
          if (d > 3) { const nx = p.x + (m.x - p.x) / d * 5 * dt, nz = p.z + (m.z - p.z) / d * 5 * dt; if (clearAt(nx, nz, 0.6)) p.set(nx, EYE, nz); } }
        return f(dt, now); }; return 1; })()`);
      await until(A, 'window.__gt >= 6', 30);
      //  how far it went back, along the line the player came in on
      const [near, back, fmax, strats, mood, said] = JSON.parse(await ev(A, `(() => { const m = flayers.find((q) => q.live), F0 = window.__from, d0 = Math.hypot(F0.x - F0.px, F0.z - F0.pz);
        return JSON.stringify([window.__near, ((m.x - F0.x) * (F0.x - F0.px) + (m.z - F0.z) * (F0.z - F0.pz)) / d0, window.__fmax, window.__strats, $('boss-mood').textContent, bioHeard.filter((q) => q.w === 'mf').map((q) => q.t)]); })()`));
      //  (a player at 5 m/s from 32 m would have been on it in six seconds: it kept its distance, going back)
      check('alone: walked at, the Mind Flayer backs away watching them, grows afraid — its bar says what it is doing, and it speaks',
        near > 8 && back > 4 && fmax > f0 + 0.1 && mood.length > 0 && said.length >= 1,
        'nearest the player got ' + near.toFixed(1) + ' m, it went back ' + back.toFixed(1) + ' m; fear ' + f0.toFixed(2) + ' → at most ' + fmax.toFixed(2) + ' ' + JSON.stringify(strats) + '; bar "' + mood + '"; said ' + JSON.stringify(said));
      await ev(A, 'window.__walkOff = true; 1');
    }

    // ---- alone: the slow brain, through the room -----------------------------------------------
    {
      //  (meeting the player is itself a reason to think: it may already have asked)
      await ev(A, `(() => { const m = flayers.find((q) => q.live); m.bio.slow.want = 'phase'; m.bio.slow.t = -999; return 1; })()`);
      const came = await until(A, `bioHeard.some((q) => q.src === 'llm' && q.w === 'mf')`, 8);
      const [llm, line] = JSON.parse(await ev(A, `JSON.stringify([flayers.find((q) => q.live).bio.strat.llm, (bioHeard.find((q) => q.src === 'llm') || {}).t])`));
      check('alone, the slow brain: the game asks its room, the room asks the model, and the answer — checked against the genome — leans its strategy and is said in its voice',
        came && ai.asked.includes('mind_flayer') && llm && llm.name === 'SEND_MINIONS' && line === LINES.mind_flayer,
        'asked for ' + JSON.stringify(ai.asked) + '; took ' + JSON.stringify(llm) + '; said "' + line + '"');
      await ev(A, 'for (const m of flayers) if (m.live) FL.despawnFlayer(MFS, m); 1');
    }

    // ---- alone: VECNA, untroubled ---------------------------------------------------------------
    {
      await ev(A, 'bioHeard.length = 0; 1');
      await ev(A, `(() => { let s = null;
        for (let r = 0; r < 40 && !s; r += 2) for (let k = 0; k < 12 && !s; k++) { const sx = p.x + 40 + Math.sin(k * 0.52) * r, sz = p.z + Math.cos(k * 0.52) * r; if (clearAt(sx, sz, 3)) s = { x: sx, z: sz }; }
        spawnVecna(s); vec.hd = Math.atan2(p.x - vec.x, p.z - vec.z); vec.awake = true; vec.st = 'hunt'; vec.stT = 0; return 1; })()`);
      const calm = await until(A, 'VS.mind && VS.mind.bio && VS.mind.bio.meta.calm', 12);
      const [st, tempo, lines, f3] = JSON.parse(await ev(A, 'JSON.stringify([VS.mind.bio.meta.state, VS.mind.bio.P.tempo, bioHeard.filter((q) => q.w === \'vec\').map((q) => q.t), bioDebugText()])'));
      check('alone: VECNA, untroubled and sure of himself, falls into divine calm — slower to strike, and F3 shows his brain',
        calm && tempo < 1 && /BRAIN VECNA/.test(f3) && /DIVINE CALM/.test(f3), st + ', tempo ' + tempo.toFixed(2) + '; said ' + JSON.stringify(lines));
      await ev(A, 'clearVecna(); 1');
    }

    // ---- Beelzebub has his too ----------------------------------------------------------------------
    {
      const ok = await ev(A, 'bzbMakeAI().bio.id === "beelzebub"');
      check('Beelzebub is given his BIO-BRAIN wherever he is run (here: this game\'s)', ok);
    }

    // ---- with two here, the room runs them ----------------------------------------------------------
    const B = await room.player({ room: 'brain', nick: 'Ben' });
    await ev(B, 'window.__t.noRender(); 1');
    await B.join();
    await until(A, 'MP.srvOwns.d', 15); await until(B, 'MP.srvOwns.d', 15);
    await ev(B, 'setWorld(WS.BACK); 1');
    await ev(B, STAND(at[0] + 5, at[1]));
    const R = room.rooms.get('brain').relay, C = R.creatures, RD = C.dogs;
    RD.D.holdSpawn = true; RD.G.holdSpawn = true; RD.V.holdSpawn = true; RD.M.holdSpawn = true; RD.M.spawnCd = 1e9;
    await sleep(1500);
    const bx = JSON.parse(await ev(B, 'JSON.stringify([p.x, p.z])'));
    let s = null;
    for (let r = 0; r < 40 && !s; r += 2) for (let k = 0; k < 12 && !s; k++) { const sx = bx[0] + 30 + Math.sin(k * 0.52) * r, sz = bx[1] + Math.cos(k * 0.52) * r; if (RD.M.env.clearAt(sx, sz, 3)) s = { x: sx, z: sz }; }
    const m = FL.spawnFlayer(RD.M, s); m.escorted = true; m.summonT = 999; m.hd = Math.atan2(bx[0] - m.x, bx[1] - m.z);
    {
      const heard = await until(B, `bioHeard.some((q) => q.w === 'mf')`, 10);
      const barOk = await until(B, `$('boss').classList.contains('on') && $('boss-mood').textContent.length > 0`, 8);
      const [lines, mood] = JSON.parse(await ev(B, `JSON.stringify([bioHeard.filter((q) => q.w === 'mf').map((q) => q.t), $('boss-mood').textContent])`));
      check('with two here the room runs it: what the Mind Flayer says reaches the players over there, and its bar shows what its brain is doing',
        heard && barOk, 'said ' + JSON.stringify(lines) + '; bar "' + mood + '"');
    }
    {
      const n0 = ai.asked.length;
      m.bio.slow.want = 'pattern'; m.bio.slow.t = -999;
      const came = await until(B, `bioHeard.some((q) => q.src === 'llm' && q.w === 'mf')`, 10);
      check('the room\'s slow brain thinks for the bosses it runs, and they say it — to everyone over there',
        came && ai.asked.slice(n0).includes('mind_flayer') && m.bio.strat.llm && m.bio.strat.llm.name === 'SEND_MINIONS',
        'asked for ' + JSON.stringify(ai.asked.slice(n0)) + '; ' + JSON.stringify(m.bio.strat.llm));
    }
    {
      //  what it has learned of Ben goes to the room's memory, by name, for the next fight
      for (let i = 0; i < 100 && m.bioKey === null; i++) await sleep(100);
      m.bioSaveT = -99; C.bioOutT = 0;
      await sleep(1500);
      //  (whichever of the two it has been watching — by their name, not the room's id for them)
      const who = (R.players.get(m.bioKey) || {}).name;
      const [rep] = await room.mind.ask([{ k: 'bioget', names: ['Aki', 'Ben'] }]);
      const rec = who && rep && rep.players && rep.players[who] && rep.players[who].mind_flayer;
      check('what it learned of a player is kept by name in the room\'s memory, for the next fight', !!(rec && rec.v === 1 && rec.o),
        who + ': ' + JSON.stringify(rec || rep).slice(0, 160));
    }

    const errs = A.errors.concat(B.errors);
    check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  } finally {
    await room.close();
  }
  console.log('\nTHE GREAT ONES\' BIO-BRAINS: ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
