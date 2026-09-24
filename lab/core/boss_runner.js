'use strict';
//  ============================================================
//  BOSS RUNNER — Beelzebub's mind and body, run together  (B9)
//  ============================================================
//
//  What whoever owns Beelzebub runs: his body moving and swinging, his
//  senses, the core, the tactics, and the bookkeeping that ties them —
//  what landed, what missed, who he has been fighting. Nothing here draws,
//  plays a sound, or knows there is a screen. The game runs it on the phone
//  that owns him (index.html: bzbThink and the functions around it); the
//  room server runs it when two or more are in the room (server/boss.js).
//  One copy, so he is the same Beelzebub wherever he is run.
//
//  `env` is what the place it runs in supplies:
//
//    world         { blocked(x, z, r), ground(x, z), roof(x, z) }   BossBody's world
//    G             the game adapter's handle (adapter/game_adapter.js)
//    core          a NeuralCore — built from the graph, or NeuralCore.fromPrepared
//    mind          { fair, bank } as last saved (serializeMind), or null
//    seed()        a fresh seed (Math.random on a phone)
//    nameOf(id)    the name over a player's head: what a player model is filed under
//    clock()       milliseconds, for what a decision costs (the F3 figure)
//    onHit(id, dmg, kind)   his blade has landed on id
//    onSwing(kind)          he has begun a swing
//    onDecision(ai, dec)    a decision was made (the game's replay recorder)
//    onSave(ai)             half a minute since the mind was last saved
//
//  The mind is a plain object, `ai`, with the fields the game's F3 panel and
//  replay read (fair, bank, pm, sensor, core, view, dec, …): that is what
//  makeMind returns, and every other function here takes it.

const { SensorLayer } = require('./sensors.js');
const { FairnessController } = require('./fairness.js');
const { PlayerModelBank } = require('./player_model.js');
const { TacticalBrain, SafeBrain } = require('./tactics.js');
const { FsmBrain } = require('./fsm_brain.js');
const { WorkingMemory, EpisodicMemory, bandOf } = require('./memory.js');
const { makeGameAdapter } = require('./game_adapter.js');
const { makeRng } = require('./rng.js');
const { BossBody } = require('./boss_body.js');
const { toChannels } = require('./worldstate.js');

const KINDS = ['reap', 'whirl', 'dash', 'dive'];      // his attacks, in the order the game's snapshot numbers them

//  The seeds are drawn in the order the game always drew them — the fairness
//  first, then the senses, then his dice — because on a phone they come from
//  the one Math.random stream everything else draws from too.
function makeMind(env) {
  const fair = new FairnessController({ difficulty: 'ADAPTIVE', seed: env.seed() });
  const bank = new PlayerModelBank({ cap: 8 });
  if (env.mind) {
    try { if (env.mind.fair) fair.restore(env.mind.fair); if (env.mind.bank) bank.restore(env.mind.bank, fair.mind); } catch (e) {}
  }
  const inner = new TacticalBrain({ neuralWeight: 0.35, usePrediction: true });
  const fallback = new FsmBrain({});
  const sensor = new SensorLayer({ seed: env.seed() });
  return {
    fair, bank, pm: null, pmName: '',
    sensor, core: env.core,
    inner, brain: new SafeBrain(inner, fallback), fallback,
    memory: { episodic: new EpisodicMemory(), working: new WorkingMemory() },
    adapter: makeGameAdapter(env.G), body: null, rng: makeRng(env.seed()),
    self: {}, ch: {}, view: null, readout: null, gated: null, resp: {}, dec: null,
    senseAcc: 0, thinkAcc: 0, adaptAcc: 0, saveAcc: 0, toChannels,
    bodyInfo: null, thinkUs: 0, thinks: 0, now: 0,
  };
}
function serializeMind(ai) { return { v: 1, fair: ai.fair.serialize(), bank: ai.bank.serialize() }; }

//  A body for the mind: a new one where he stands up (hpMax as the game
//  counts it, for however many are fighting), or one that carries on from
//  what the last owner said of him (st: x, z, hd, hp, hpMax, mode).
function giveBody(ai, env, x, z, hd, hpMax, gate) {
  const b = new BossBody(env.world, { x, z, hd, hpMax: hpMax / ai.fair.body.health, fairness: ai.fair });
  fit(ai, b, gate);
  return b;
}
function adoptBody(ai, env, st, gate) {
  const b = new BossBody(env.world, { x: st.x, z: st.z, hd: st.hd, hpMax: st.hpMax / ai.fair.body.health, fairness: ai.fair });
  b.hp = st.hp;
  if (st.mode === 'dead') { b.hp = 0; b.mode = 'dead'; }
  fit(ai, b, gate);
  return b;
}
function fit(ai, b, gate) {
  ai.body = b;
  ai.inner.gate = { x: gate.x, z: gate.z }; ai.fallback.gate = ai.inner.gate;
  ai.bodyInfo = {
    ready: (k) => b.ready(k), get alt() { return b.alt; },
    get canFly() { return b.flyCd <= 0 || b.alt > 0.5; }, get canGuard() { return !b.busy && b.alt < 1; },
  };
}

//  A round has struck him (whoever fired it). The display is the caller's;
//  this is what it does to him and what he makes of it. Returns what it took.
function hurt(ai, dmg, fx, fz, by, now) {
  const b = ai.body;
  const got = b.hurt(dmg, fx, fz);
  ai.adapter.noteHit('self', by, got, 100);
  ai.fair.noteBossHurt(got / b.hpMax, now);
  if (ai.pm) ai.pm.noteOutcome('boss_hurt', now);
  if (now - (ai.missT || -99) < 1) ai.memory.episodic.record(now, 'player_countered', ai.missKind || 'reap', 'close', by);
  return got;
}
//  a gunshot is something he hears, whoever's it is
function heard(ai, id, x, y, z) { if (ai.body) ai.adapter.noteShot(id, x, y, z); }

//  One step of him: the body, then — at the rates §28 asks — the senses
//  (20 Hz), the core and the tactics (10 Hz), and the verdict on the fight
//  (1 Hz). `targets` are the players he can reach ({ id, x, z, y, alive }),
//  `gate` the tear he guards, and `out` what everyone else is told of him
//  (the game's `bzb`, the room's own record): x, z, alt, hd, vx, vz, hp,
//  mode, atkKind, atkPhase, and atkSeq, which counts his swings.
function think(ai, env, dt, now, targets, gate, out) {
  const b = ai.body;
  ai.now = now;
  const hooks = ai.hooks || (ai.hooks = {
    hit(id, dmg, kind) {
      env.onHit(id, dmg, kind);
      const tgt = ai.lastTargets && ai.lastTargets.find((q) => q.id === id), me = ai.body;
      const band = bandOf(tgt ? Math.hypot(tgt.x - me.x, tgt.z - me.z) : 10);
      ai.fair.noteLanded(id, ai.now, dmg / 100);
      ai.adapter.noteHit(id, 'self', dmg, 100);
      ai.memory.episodic.record(ai.now, 'boss_attack_landed', kind, band, id);
      if (ai.view && ai.view.get('player_facing_me') < 0.3) ai.memory.episodic.record(ai.now, 'ambush_success', kind, band, id);
      if (ai.pm) ai.pm.noteOutcome('player_hurt', ai.now);
    },
    miss(kind) {
      ai.memory.episodic.record(ai.now, 'boss_attack_failed', kind, 'close');
      if (ai.pm) ai.pm.noteOutcome('boss_missed', ai.now);
      ai.missT = ai.now; ai.missKind = kind;
    },
    swing(kind) { env.onSwing(kind); ai.adapter.noteSwing(); },
  });
  ai.lastTargets = targets;
  b.step(dt, now, targets, hooks);

  // …and never both in one frame: D8 is about the worst frame, not the average
  ai.senseAcc += dt; ai.thinkAcc += dt; ai.adaptAcc += dt; ai.saveAcc += dt;
  let sensed = false;
  if (ai.senseAcc >= 0.05) {
    sensed = true;
    ai.senseAcc = 0;
    const ws = ai.sensor.sense(ai.adapter.observe(b.selfRecord(ai.self), 0));
    ai.adapter.drain();
    const v = ai.fair.perceive(ws);
    if (v) {
      ai.view = v;
      ai.memory.working.observe(v);
      const tid = ai.sensor.target ? ai.sensor.target.id : null;
      if (tid) {
        const name = env.nameOf(tid);
        if (name !== ai.pmName) { ai.pm = ai.bank.get(name, now, ai.fair.mind); ai.pmName = name; }
        ai.pm.observe(v);
      }
    }
  }
  //  …unless the frame rate is so low that sensing is due every frame, when
  //  a decision that is overdue goes ahead anyway: a slow phone must not
  //  get a boss that has stopped thinking
  if (ai.thinkAcc >= 0.1 && ai.view && (!sensed || ai.thinkAcc >= 0.2)) {
    ai.thinkAcc = 0;
    const t0 = env.clock();
    ai.core.step(ai.toChannels(ai.view, ai.ch), 0.1);
    ai.readout = ai.core.healthy() ? ai.core.readout() : null;
    ai.gated = ai.pm ? ai.fair.gatePrediction(ai.pm.predict()) : null;
    for (const k of KINDS) ai.resp[k] = ai.pm ? ai.fair.gatePrediction(ai.pm.predictResponse(k)) : null;
    ai.inner.gate.x = gate.x; ai.inner.gate.z = gate.z;
    const dec = ai.brain.decide({ view: ai.view, readout: ai.readout, gated: ai.gated, memory: ai.memory, body: ai.bodyInfo,
      fair: ai.fair, rng: ai.rng, now, targetId: ai.sensor.target ? ai.sensor.target.id : null,
      respond: (k) => ai.resp[k] || null });
    ai.dec = dec;
    apply(ai, b, dec);
    env.onDecision(ai, dec);
    ai.thinkUs += (env.clock() - t0) * 1000; ai.thinks++;
  }
  if (ai.adaptAcc >= 1) { ai.fair.adapt(now, ai.adaptAcc); ai.adaptAcc = 0; }
  //  B11: left alone, the guardian mends. Nobody to fight for 20 s and he
  //  recovers 4% a second — otherwise dying and walking back would win
  //  any fight by attrition, which is not a way of learning him.
  if (ai.view && ai.view.get('has_target') > 0.5 && ai.view.get('player_confidence') > 0.1) ai.aloneT = 0;
  else ai.aloneT = (ai.aloneT || 0) + dt;
  if (ai.aloneT > 20 && b.hp < b.hpMax && b.alive) b.hp = Math.min(b.hpMax, b.hp + b.hpMax * 0.04 * dt);
  if (ai.saveAcc >= 30) { ai.saveAcc = 0; env.onSave(ai); }
  // what everyone else is told, and what the body looks like
  out.x = b.x; out.z = b.z; out.alt = b.alt; out.hd = b.hd; out.vx = b.vx; out.vz = b.vz;
  out.hp = b.hp; out.mode = b.mode;
  if (b.atk) { if (b.atk !== ai.lastAtk) { ai.lastAtk = b.atk; out.atkSeq = (out.atkSeq + 1) & 255; } out.atkKind = b.atk.kind; out.atkPhase = b.atk.phase; }
  else { out.atkKind = null; out.atkPhase = null; }
}
function apply(ai, b, d) {
  if (d.attack) {
    if (b.attack(d.attack, d.aim.x, d.aim.z) && ai.pm) ai.pm.noteBossWindup(d.attack, ai.view);
    return;
  }
  if (d.guard) { b.guard(); return; }
  if (d.move) {
    if (d.fly && b.alt < 0.5) b.takeOff();
    if (!d.fly && b.mode === 'fly') b.land();
    b.moveTo(d.move.x, d.move.z, d.move.speed, d.fly);
  } else b.hold();
  if (d.face) b.faceTo(d.face.x, d.face.z);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { KINDS, makeMind, serializeMind, giveBody, adoptBody, hurt, heard, think, apply };
}
