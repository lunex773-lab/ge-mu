'use strict';
//  ============================================================
//  BOSS AI LAB — one fight  (spec §22, §24, §21, §31)
//  ============================================================
//
//  The whole stack, as it will run in the game, against one bot:
//
//    arena + bot ──obs──▶ SensorLayer ─▶ FairnessController ─┬▶ PlayerModel ─▶ gatePrediction ─┐
//                                                            └▶ NeuralCore ─▶ readout ────────┤
//                                          episodic memory ─────────────────────────────────▶ TacticalBrain
//                                                                                              │
//    arena + bot ◀── hits, misses ◀── BossBody ◀────────────────── decision ◀─ SafeBrain ◀─────┘
//
//  at the rates §28 asks for: physics and senses 20 Hz, core and tactics
//  10 Hz, ADAPTIVE's verdict 1 Hz.
//
//  Configurations for §25's ablation:
//    brain 'fsm'      + playerModel false  →  A  通常FSM
//    brain 'fsm'      + playerModel true   →  B  FSM + Player Model
//    brain 'tactical' + neural, no model   →  C  Neural Core
//    brain 'tactical' + neural + model     →  D  Neural Core + Player Model
//  and the two controls that say what the core itself adds:
//    brain 'tactical', no neural (± model) →  C0 / D0

const { makeRng } = require('../core/rng.js');
const { SensorLayer } = require('../core/sensors.js');
const { FairnessController } = require('../core/fairness.js');
const { PlayerModel } = require('../core/player_model.js');
const { NeuralCore } = require('../core/neural.js');
const { toChannels, F } = require('../core/worldstate.js');
const { TacticalBrain, SafeBrain } = require('../core/tactics.js');
const { FsmBrain } = require('../core/fsm_brain.js');
const { BossBody, BODY } = require('../core/boss_body.js');
const { WorkingMemory, EpisodicMemory, bandOf } = require('../core/memory.js');
const { Arena } = require('./arena.js');
const { PlayerBot } = require('./player_bot.js');

const DT = 0.05;

//  §21. Not "kill the player": several things that make it play well.
const REWARD = { landed: 10, dodged: 5, flank: 8, predicted: 15, whiff: -10, exposed: -8, strayed: -20 };

function runFight(cfg) {
  const c = Object.assign({ brain: 'tactical', neural: true, playerModel: true, bot: 'AGGRESSIVE', seed: 1,
    difficulty: 'NORMAL', hpMax: 3000, maxT: 240, graph: null, replay: false, profile: null, readoutW: null }, cfg || {});
  const rng = makeRng(c.seed), brainRng = makeRng(c.seed ^ 0x9e37);
  const arena = new Arena({ seed: 1 });
  const fair = new FairnessController({ difficulty: c.difficulty, seed: c.seed ^ 0x51 });
  const body = new BossBody(arena, { x: arena.spawnBoss.x, z: arena.spawnBoss.z, hd: Math.PI, hpMax: c.hpMax, fairness: fair });
  const sensor = new SensorLayer({ seed: c.seed ^ 0x77 });
  const pm = c.playerModel ? new PlayerModel(fair.mind) : null;
  if (pm && c.profile) pm.restore(c.profile);
  const core = c.neural && c.graph ? new NeuralCore(c.graph, { seed: 0xbeef }) : null;
  if (core && c.readoutW) core.setReadout(c.readoutW);
  const memory = { episodic: new EpisodicMemory(), working: new WorkingMemory() };
  const inner = c.brain === 'fsm' ? new FsmBrain({ usePrediction: c.playerModel })
                                  : new TacticalBrain({ neuralWeight: core ? 0.35 : 0, usePrediction: c.playerModel });
  inner.gate = arena.gate;
  const fallback = new FsmBrain({}); fallback.gate = arena.gate;
  const brain = new SafeBrain(inner, fallback);

  const start = arena.openSpot(arena.gate.x, arena.gate.z - 30, 45, rng);
  const bot = new PlayerBot(c.bot, arena, rng, start);

  const events = [];
  const obs = { t: 0, self: {}, bodies: [{}], events, allies: 0,
    probe: (...a) => arena.probe(...a), solid: (x, y, z) => arena.solid(x, y, z) };
  const bodyInfo = {
    ready: (k) => body.ready(k), get alt() { return body.alt; },
    get canFly() { return body.flyCd <= 0 || body.alt > 0.5; }, get canGuard() { return !body.busy && body.alt < 1; },
  };

  const m = { winner: 'none', t: 0, reward: 0, rewardParts: {}, decisions: 0, actions: {}, faults: 0,
    brainUs: 0, bossDealt: 0, bossTaken: 0, lastMissT: -1e9, ambushes: 0 };
  const give = (k, n) => { const r = REWARD[k] * (n || 1); m.reward += r; m.rewardParts[k] = (m.rewardParts[k] || 0) + r; };
  const replay = c.replay ? [] : null;
  let view = null, readout = null, gated = null, dec = null, lastAction = 'wait', actionT = 0, takenAtAction = 0;
  const ch = {};
  let now = 0, tick = 0;
  const RESP_KINDS = ['reap', 'whirl', 'dash', 'dive'];
  const respCache = {};
  const respond = (k) => (pm ? respCache[k] || null : null);

  const hooks = {
    hit(id, dmg, kind) {
      bot.hurt(dmg); m.bossDealt += dmg;
      fair.noteLanded(id, now, dmg / 100);
      events.push({ type: 'hit', by: 'self', victim: id, dmg, hpMax: 100, t: now });
      const face = view ? view.v[F.player_facing_me] : 1;
      memory.episodic.record(now, 'boss_attack_landed', kind, bandOf(Math.hypot(bot.x - body.x, bot.z - body.z)));
      if (face < 0.3) { memory.episodic.record(now, 'ambush_success', kind, 'close'); m.ambushes++; give('flank'); }
      if (pm) pm.noteOutcome('player_hurt', now);
      give('landed');
      if (dec && dec.reason && dec.reason.prediction_weight > 0) give('predicted');
    },
    miss(kind) {
      memory.episodic.record(now, 'boss_attack_failed', kind, bandOf(Math.hypot(bot.x - body.x, bot.z - body.z)));
      if (bot.dodgeT > 0) memory.episodic.record(now, bot.ddx * (bot.z - body.z) - bot.ddz * (bot.x - body.x) < 0 ? 'player_dodged_right' : 'player_dodged_left', kind, 'close');
      if (pm) pm.noteOutcome('boss_missed', now);
      m.lastMissT = now;
      give('whiff');
    },
  };
  const botHooks = {
    shot(x, y, z) { events.push({ type: 'shot', by: 'p1', x, y, z, t: now }); },
    hitBoss(dmg) {
      const got = body.hurt(dmg, bot.x, bot.z);
      m.bossTaken += got;
      events.push({ type: 'hit', by: 'p1', victim: 'self', dmg: got, t: now });
      fair.noteBossHurt(got / body.hpMax, now);
      if (pm) pm.noteOutcome('boss_hurt', now);
      if (now - m.lastMissT < 1) memory.episodic.record(now, 'player_countered', 'reap', 'close');
      if (lastAction === 'chase' || lastAction === 'wait') { if (Math.hypot(bot.x - body.x, bot.z - body.z) > 30) give('exposed', got / 100); }
      return got;
    },
  };

  while (now < c.maxT && body.alive && bot.alive) {
    now = +(tick * DT).toFixed(4); tick++;
    bot.step(DT, now, body, botHooks);
    body.step(DT, now, [{ id: 'p1', x: bot.x, z: bot.z, y: 0, alive: bot.alive }], hooks);

    // ---- senses, 20 Hz --------------------------------------------------
    obs.t = now; body.selfRecord(obs.self); bot.bodyRecord(obs.bodies[0]);
    const ws = sensor.sense(obs);
    events.length = 0;
    const seen = fair.perceive(ws);
    if (seen) {
      view = seen;
      memory.working.observe(view);
      if (pm) pm.observe(view);
    }

    // ---- core and tactics, 10 Hz ------------------------------------------
    if (tick % 2 === 0 && view) {
      if (core) { core.step(toChannels(view, ch), 0.1); readout = core.readout(); }
      gated = pm ? fair.gatePrediction(pm.predict()) : null;
      if (pm) for (const k of RESP_KINDS) respCache[k] = fair.gatePrediction(pm.predictResponse(k));
      const t0 = process.hrtime.bigint();
      dec = brain.decide({ view, readout, gated, memory, body: bodyInfo, fair, rng: brainRng, now, targetId: 'p1', respond });
      m.brainUs += Number(process.hrtime.bigint() - t0) / 1e3;
      m.decisions++;
      m.actions[dec.action] = (m.actions[dec.action] || 0) + 1;
      if (dec.faulted) m.faults++;
      if (dec.action !== lastAction) {
        // a dodge or a guard that was followed by a quiet second and a half paid off
        if ((lastAction === 'dodge' || lastAction === 'defend') && m.bossTaken - takenAtAction < 1) give('dodged');
        lastAction = dec.action; actionT = now; takenAtAction = m.bossTaken;
      }
      apply(dec);
      if (replay) replay.push({ t: now, ws: view.toObject(), prediction: gated, neural: core ? core.activity() : null,
        decision: { action: dec.action, attack: dec.attack, reason: dec.reason }, reward: m.reward,
        boss: { x: +body.x.toFixed(2), z: +body.z.toFixed(2), hp: body.hp, mode: body.mode },
        player: { x: +bot.x.toFixed(2), z: +bot.z.toFixed(2), hp: bot.hp } });
    }
    if (tick % 20 === 0) {
      fair.adapt(now, 1);
      if (Math.hypot(body.x - arena.gate.x, body.z - arena.gate.z) > inner.o.leash) give('strayed');
    }
  }

  function apply(d) {
    if (d.attack) {
      if (body.attack(d.attack, d.aim.x, d.aim.z) && pm) pm.noteBossWindup(d.attack, view);
      return;
    }
    if (d.guard) { body.guard(); return; }
    if (d.move) {
      if (d.fly && body.alt < 0.5) body.takeOff();
      if (!d.fly && body.mode === 'fly') body.land();
      body.moveTo(d.move.x, d.move.z, d.move.speed, d.fly);
    } else body.hold();
    if (d.face) body.faceTo(d.face.x, d.face.z);
  }

  m.t = now;
  m.winner = !bot.alive ? 'boss' : !body.alive ? 'player' : 'timeout';
  m.playerSurvival = !bot.alive ? now : c.maxT;
  m.bossSurvival = !body.alive ? now : c.maxT;
  m.swings = body.stats.swings; m.landed = body.stats.landed; m.byKind = body.stats.byKind;
  m.hitRate = m.swings ? m.landed / m.swings : 0;
  m.playerShots = bot.shots; m.playerHits = bot.hits;
  m.prediction = pm ? pm.accuracy() : null;
  m.gate = { passed: fair.stats.passed, gated: fair.stats.gated };
  m.brainUsPerDecision = m.decisions ? m.brainUs / m.decisions : 0;
  m.dodges = bot.dodges;
  m.profile = pm ? pm.serialize() : null;
  m.level = fair.level;
  if (replay) m.replay = replay;
  return m;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { runFight, REWARD, DT };
