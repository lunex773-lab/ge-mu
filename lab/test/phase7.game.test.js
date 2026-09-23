'use strict';
//  ============================================================
//  PHASE 7 — BEELZEBUB IN THE REAL GAME
//  ============================================================
//  Two players in one room, headless. The owner runs him; the other only
//  sees him. Checked: he stands in front of the tear when it opens (B1),
//  his brain runs without faulting, his blade hurts the owner AND the
//  follower (each judges it for itself), shots hurt him from either side,
//  and when he falls he stays down for that tear (B7).
//
//    node lab/test/phase7.game.test.js     (about three minutes)

const { openRoom, sleep } = require('./harness/page.js');

const results = [];
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  results.push((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '\n         ' + detail : ''));
}
const ev = (P, src) => P.eval((s) => window.__t.ev(s), src);
async function until(P, src, secs) {
  for (let i = 0; i < secs * 4; i++) { if (await ev(P, src)) return true; await sleep(250); }
  return false;
}

(async () => {
  const room = await openRoom();
  try {
    const A = await room.player({ room: 'p7', nick: 'Aki', id: 'paaaaaa' });   // the lower id owns the mobs
    const B = await room.player({ room: 'p7', nick: 'Ben', id: 'pbbbbbb' });
    await A.join(); await B.join();
    await sleep(3500);
    check('the rig is built with the city, before anything needs it', await ev(A, '!!(bzb.rig && bzb.rig.meshes.length >= 5)'));
    check('A owns the mobs', await ev(A, 'MP.host === MP.id') && !(await ev(B, 'MP.host === MP.id')));

    // ---- B1: the tear opens, he stands in front of it ---------------------
    await A.eval(() => { window.__t.myKills = 9; window.__t.creditMyKill(); });
    const up = await until(A, 'bzb.live', 20);
    const g = await ev(A, 'JSON.stringify({ gx: rift.x, gz: rift.z, x: bzb.x, z: bzb.z, clear: clearAt(bzb.x, bzb.z, 2), roof: bzbRoof(bzb.x, bzb.z) })');
    const gg = JSON.parse(g);
    check('B1: when the tear opens he stands in front of it, in the open street',
      up && Math.hypot(gg.x - gg.gx, gg.z - gg.gz) < 60 && gg.clear && gg.roof === 0, g);
    const seenB = await until(B, 'bzb.live', 10);
    const pos = JSON.parse(await ev(B, 'JSON.stringify({ x: bzb.x, z: bzb.z, own: !!(bzbAI && bzbAI.body) })'));
    check('the other player sees him too, in the same place, without running him',
      seenB && Math.hypot(pos.x - gg.x, pos.z - gg.z) < 3 && !pos.own, JSON.stringify(pos));

    // ---- his brain runs, and his blade lands on the owner -----------------
    //  stand A six metres in front of him and wait
    await ev(A, 'p.set(bzb.x + Math.sin(bzb.hd) * 6, p.y, bzb.z + Math.cos(bzb.hd) * 6); hp = HP_MAX; updateHpUI();');
    const hurtA = await until(A, 'hp < HP_MAX', 40);
    const dbg = JSON.parse(await ev(A, 'JSON.stringify(bzbDebug())'));
    check('his brain decides, with reasons, without faulting', dbg.decision && !dbg.faulted && dbg.owner,
      'last: ' + (dbg.decision ? dbg.decision.selected : '-') + ', ' + dbg.thinkUs + ' µs a decision, target ' + dbg.target);
    check('his blade hurts the player who owns him', hurtA, 'hp now ' + await ev(A, 'Math.round(hp)'));

    // ---- and on the follower, judged on the follower's own screen --------
    await ev(A, 'p.set(bzb.x + 70, p.y, bzb.z + 70);');     // A steps back out of reach
    await ev(B, 'p.set(bzb.x + Math.sin(bzb.hd) * 6, p.y, bzb.z + Math.cos(bzb.hd) * 6); hp = HP_MAX; updateHpUI(); publishState(true);');
    const hurtB = await until(B, 'hp < HP_MAX', 45);
    check('his blade hurts a player who does not own him (each judges it for itself)', hurtB, 'hp now ' + await ev(B, 'Math.round(hp)'));

    // ---- §30/§31: the overlay shows his mind; the replay can be saved ------
    await ev(A, 'dbgOn = true; dbgAcc = 1; updateHud(0.3);');
    const dbgText = await ev(A, "document.getElementById('dbg').textContent");
    check('§30: F3 shows what he sees, predicts and chose, and why',
      /BOSS NEURAL DEBUG/.test(dbgText) && /SEES/.test(dbgText) && /ACT/.test(dbgText) && /NEUR/.test(dbgText) && /rule/.test(dbgText),
      dbgText.split('\n').filter((l) => /BZB|SEES|MIND|PRED|ACT/.test(l)).join(' | '));
    const [dl] = await Promise.all([A.page.waitForEvent('download', { timeout: 10000 }).catch(() => null), ev(A, 'bzbExportReplay()')]);
    let rep = null;
    if (dl) { const fp = await dl.path(); rep = require('../tools/replay.js').load(fp); require('fs').copyFileSync(fp, require('path').join(require('../test/harness/page.js').CACHE, 'last-replay.json')); }
    //  two headless pages and the relay run the game at a few frames a second,
    //  which is the point: he must still decide at close to 10 Hz of game time
    const rate = rep && rep.records.length > 2 ? (rep.records.length - 1) / (rep.records[rep.records.length - 1].t - rep.records[0].t) : 0;
    check('§31: F4 saves the last minute of decisions, and the lab can read it back',
      rep && rep.records.length > 20 && rep.fields.length > 30 && rep.records.every((q) => q.action),
      rep ? rep.records.length + ' decisions; the last: ' + require('../tools/replay.js').line(rep, rep.records[rep.records.length - 1]).trim() : 'no download');
    check('a slow frame rate does not starve his thinking', rate > 6, rate.toFixed(1) + ' decisions a second at the harness frame rate');

    // ---- shots hurt him, from either side --------------------------------
    const h0 = await ev(A, 'bzb.hp');
    await ev(A, 'bzbHurt(DMG, p.x, p.z, MP.id);');
    await ev(B, 'bzbHurt(DMG, p.x, p.z, MP.id); sendBzbHit(DMG);');
    await sleep(1500);
    const h1 = await ev(A, 'bzb.hp');
    check("the owner's shot and the follower's shot both land", h0 - h1 >= 39, h0 + ' -> ' + h1);
    const bar = await ev(B, "document.getElementById('boss').classList.contains('on') && document.getElementById('boss-name').textContent");
    check('the follower, close and fighting him, sees his bar', bar === 'ヴェルゼブブ', String(bar));

    // ---- B7: he falls, and stays down for this tear ----------------------
    await ev(A, 'bzbAI.body.hp = 30; bzbHurt(DMG, p.x, p.z, MP.id); bzbHurt(DMG, p.x, p.z, MP.id);');
    const fell = await until(B, "bzb.mode === 'dead'", 8);
    check('when he falls, everyone sees it', fell && (await ev(A, "bzb.mode === 'dead'")));
    const gone = await until(A, '!bzb.live', 25);
    await sleep(6000);
    const back = await ev(A, 'bzb.live');
    check('B7: and he does not rise again at the same tear', gone && !back && (await ev(A, 'bzbSaved().slain === true')));

    // ---- when the world forgets the tear, a new one brings a new guardian --
    await ev(A, "rift.present = false; rift.group.visible = false; rift.seed = 0; gateUnlocked = false;");
    await sleep(1500);
    await A.eval(() => { window.__t.myKills = 9; window.__t.creditMyKill(); });
    const again = await until(A, 'bzb.live', 20);
    check('a new tear gets a new guardian', again);

    const errs = A.errors.concat(B.errors);
    check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await A.close(); await B.close();
  } finally {
    await room.close();
  }
  console.log('\nPHASE 7 — Beelzebub in the real game\n');
  console.log(results.join('\n'));
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
