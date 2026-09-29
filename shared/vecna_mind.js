'use strict';
//  ============================================================
//  CONTOUR — VECNA's mind  (shared)
//  ============================================================
//  The Fly-Brain design (the design text "VECNA FLY-BRAIN BOSS AI v1.0",
//  cited below as FB§n): not a chase-and-swing machine but a closed loop —
//
//    sense → perceive → believe → remember → predict → check how sure he is →
//    think about his own thinking → set goals → plan → order the court →
//    choose → check it is fair → act → watch what happened → learn → again
//
//  — built from the computation the fly's brain is known for (many senses at
//  once, parallel paths, a sense→decide→move hierarchy, closed-loop control,
//  learning and memory, action selection), not from its neurons. Every number
//  in it is bounded: he believes rather than knows (FB§3), he forgets (FB§33),
//  he guesses and is wrong (FB§34), he notices when he is wrong (FB§8), he
//  changes what he does when it stops working (FB§8.5), and he can be fooled
//  (FB§30). He never reads where a player is (FB§74): only what he sees, what
//  he hears, where a round came from (and not exactly), and what the things
//  that answer to him tell him — late, and not exactly (FB§23).
//
//  shared/vecna.js runs his body and asks this: where to go, how close, what
//  to do next and whether it is fair to; the court (shared/dogs.js,
//  gorgons.js, flayers.js) is given objectives through the hive, not
//  positions, and chooses for itself how (FB§14–§21). The room runs it with
//  him when two or more are here (server/dogs.js); a lone game runs it itself.
//  One mind, M, per VECNA (V.mind); all of it plain data, handed over whole.

const RULES = require('./rules.js');

// ---- one place for every knob (FB§81) ------------------------------------------------
const CONFIG = {
  difficulty: 'NIGHTMARE',
  perceptionRange: 124,          // m he can see (and close by, all the way round: 14 m)
  visionAngle: 1.5,              // rad either side of where he faces
  partialRange: 92,              // m past which a sighting is only partial
  hearingRange: 170,             // m a shot carries to him (a step, a sixth of it)
  memoryDuration: 30,            // s the short-term memory keeps
  memoryDecay: 0.985,            // a memory's strength, each second
  beliefTau: { vision: 9, minion: 6, damage: 5, sound: 4, predict: 3 },   // s: how fast a belief fades, by where it came from
  predictionHorizon: 1.5,        // s ahead he guesses
  predictionNoise: 3.2,          // m of error on a guess, before skill
  metacognitionRate: 1.0,        // Hz
  tacticalRate: 5,               // Hz
  strategicRate: 2,              // Hz
  minionCommandFrequency: 2.6,   // s between orders
  hiveDelay: { flayer: 0.35, gorgon: 0.6, dog: 0.9 },     // s before what one of them saw reaches him (and an order reaches it)
  hiveNoise: { flayer: 2.0, gorgon: 3.5, dog: 5.0 },      // m of error in it
  hiveConfidence: { flayer: 0.8, gorgon: 0.7, dog: 0.55 },
  hiveRange: 190,                // m: the court beyond this does not hear him, nor he it (V_LINK)
  actionRandomness: 0.16,        // the temperature of his choices among the reasonable ones (FB§29, §76)
  fairnessLimit: 55,             // damage he and his court may do one player in 10 s before the director steps in (FB§43, §73)
  reliefAfterDeath: 9,           // s of quiet after a player goes down
  emergencyThreshold: 0.30,      // FB§26: below this he is in an emergency
  adaptiveThreshold: 0.60,       // … below this, adapting
  psychicEnergy: { max: 100, regen: 7 },
  cost: { wave: 30, mind: 25, lift: 10, hurl: 4, blink: 30, summon: 45, order: 4 },   // FB§45
  autonomy: { dog: 0.75, gorgon: 0.85, flayer: 0.95 },    // FB§17
};
//  FB§9: the budget each ability of his mind is held to. Even the worst of
//  these never gives him the truth.
const DIFFICULTY = {
  HARD:      { prediction: 0.70, memory: 0.65, adaptation: 0.55, minionCoordination: 0.80, psychicControl: 0.75 },
  NIGHTMARE: { prediction: 0.85, memory: 0.80, adaptation: 0.75, minionCoordination: 0.95, psychicControl: 0.90 },
};
const VIS = ['LOST', 'OBSTRUCTED', 'PARTIAL', 'DIRECT'];                      // FB§2.1
const STATES = ['CONFIDENT', 'UNCERTAIN', 'SURPRISED', 'ADAPTING', 'PRESSURED', 'OVEREXTENDED', 'TESTING', 'RECOVERING', 'HUNTING', 'DEFENDING'];   // FB§8.6
const GOALS = ['HUNT_PLAYER', 'CONTROL_AREA', 'PROTECT_MINIONS', 'TEST_PLAYER', 'REPOSITION', 'RECOVER', 'CREATE_AMBUSH', 'CONTROL_ENVIRONMENT', 'ESCAPE_DANGER'];   // FB§10
const TACTICS = ['DIRECT_ATTACK', 'SHOCKWAVE', 'TENTACLE_ATTACK', 'PSYCHIC_BLAST', 'TELEKINESIS_THROW', 'AREA_DENIAL', 'FORCE_OUT_OF_COVER',
  'MINION_ATTACK', 'MINION_FLANK', 'MINION_SEARCH', 'SURROUND', 'CUT_OFF_ESCAPE', 'AMBUSH', 'REPOSITION', 'RETREAT', 'FAKE_RETREAT', 'TEST', 'SEARCH'];   // FB§12
const ORDERS = ['attack', 'search', 'contain', 'flank', 'guard', 'distract', 'retreat', 'regroup', 'hunt', 'protect', 'investigate', 'escort'];   // FB§16
const PHASE_NAMES = ['OBSERVATION', 'HUNT', 'CONTROL', 'ADAPTATION', 'PRESSURE', 'DESPERATION', 'FINAL CONFRONTATION'];   // FB§63
const WORLD = RULES.WORLD;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const keyOf = (t) => (t && t.id !== undefined ? t.id : 'p');

// ---- the mind ------------------------------------------------------------------------
function makeMind(difficulty) {
  const prof = DIFFICULTY[difficulty || CONFIG.difficulty] || DIFFICULTY.NIGHTMARE;
  return {
    prof, difficulty: difficulty || CONFIG.difficulty,
    acc: { tac: 0, strat: 0, meta: 0, hive: 0, order: 0 },
    hyp: [],                       // FB§3.1: what he believes, and how sure — [{ key|null, x, z, vx, vz, conf, src, t, lx, lz, lt, vis }]
    vis: {},                       // key → the last thing his eyes said (VIS index)
    focus: null, focusConf: 0,     // the one he is thinking about, and how sure he is where they are
    heard: 0,                      // the last noise he has taken in (its time)
    hive: [],                      // FB§23: what is on its way up to him, and orders on their way down — [{ due, up, … }]
    stm: [],                       // FB§5.1: the last half-minute — [{ t, k, s }]
    epi: {},                       // FB§5.2: what keeps happening — k → { n, s, t }
    tac: {},                       // FB§5.3: how each tactic has gone — name → { tries, wins, fails, val, block }
    players: {},                   // FB§6: key → his model of that player
    heat: {},                      // FB§4 RepeatedPlayerPositions: 24 m cells → strength
    danger: [],                    // FB§4 DangerousZones: where he was hurt from
    pred: { pending: [], err: 4, conf: 0.5, lastErr: 0, cands: null, px: 0, pz: 0 },   // FB§7
    meta: { state: 'UNCERTAIN', surprise: 0, successRate: 0.5, dmgIn: [], dmgOut: [], since: 0, adaptT: 0 },   // FB§8
    goal: 'HUNT_PLAYER', goalUtil: {},
    tactic: { name: 'SEARCH', x: 0, z: 0, standoff: 20, speed: 1.6, prefer: null, hold: false, t: 0, until: 0, dealt: 0, conf0: 0, lastName: '', reps: 0 },
    energy: CONFIG.psychicEnergy.max,
    dir: { hits: [], relief: 0, pressure: 1 },   // FB§72: the director's bookkeeping
    orders: 0, lastOrder: null,
    log: [], logN: 0,
  };
}
//  FB§51: every decision that matters, with when
function log(M, now, msg) {
  M.log.push({ t: +now.toFixed(2), m: msg });
  if (M.log.length > 60) M.log.shift();
  M.logN++;
}
function remember(M, now, k, s) {
  M.stm.push({ t: now, k, s: s || 1 });
  if (M.stm.length > 48) M.stm.shift();
}
//  FB§5.2 / §33: an episode grows with each repetition and fades with time;
//  one that has happened often enough is kept (long-term), weakly
function episode(M, now, k, w) {
  const e = M.epi[k] || (M.epi[k] = { n: 0, s: 0, t: now });
  e.n++; e.s = Math.min(6, e.s + (w || 1)); e.t = now;
  return e;
}
function epi(M, k) { const e = M.epi[k]; return e ? e.s : 0; }
function model(M, key) {
  let p = M.players[key];
  if (!p) {
    const ks = Object.keys(M.players);
    if (ks.length >= 6) delete M.players[ks[0]];
    p = M.players[key] = { range: 30, mobility: 0.4, elevation: 0, cover: 0.3, aggression: 0.4, n: 0, lastSeen: -99, seenAt: -99, shots: 0 };
  }
  return p;
}
//  FB§32: how much a trait may move his choices — nothing on one sighting,
//  some after two, more after four, most after seven; never all of it
function weight(M, p) {
  const n = p ? p.n : 0;
  return (n >= 7 ? 1 : n >= 4 ? 0.6 : n >= 2 ? 0.3 : 0) * M.prof.adaptation;
}

// ---- what he believes ----------------------------------------------------------------
//  Evidence is fused into the hypothesis it fits (the same player, or a
//  nameless one within 18 m), weighted by how sure it is; a new one is started
//  otherwise. At most eight: the weakest goes.
function believe(M, key, x, z, conf, src, now, vx, vz) {
  let h = null, bd = 18;
  if (key !== null) for (const q of M.hyp) if (q.key === key) { h = q; break; }
  if (!h) for (const q of M.hyp) {
    if (key !== null && q.key !== null) continue;
    const d = Math.hypot(q.x - x, q.z - z);
    if (d < bd) { bd = d; h = q; }
  }
  if (!h) {
    if (M.hyp.length >= 8) { let wi = 0; for (let i = 1; i < M.hyp.length; i++) if (M.hyp[i].conf < M.hyp[wi].conf) wi = i; M.hyp.splice(wi, 1); }
    h = { key, x, z, vx: 0, vz: 0, conf: 0, src, t: now, lx: x, lz: z, lt: now, vis: 0 };
    M.hyp.push(h);
  }
  //  (his own eyes, clearly: that is where they are; anything else is weighed)
  const w = src === 'vision' && conf >= 0.99 ? 1 : conf / Math.max(1e-3, conf + h.conf * 0.5);
  h.x += (x - h.x) * w; h.z += (z - h.z) * w;
  if (vx !== undefined) { h.vx += (vx - h.vx) * 0.5; h.vz += (vz - h.vz) * 0.5; }
  h.conf = Math.max(conf, Math.min(1, h.conf * 0.7 + conf * 0.45));
  h.src = src; h.t = now;
  if (key !== null && h.key === null) h.key = key;
  return h;
}
function bestOf(M, key) {
  let b = null;
  for (const h of M.hyp) if ((key === undefined || h.key === key) && (!b || h.conf > b.conf)) b = h;
  return b;
}

// ---- sensing (every step he thinks) ----------------------------------------------------
//  FB§2: vision (DIRECT / PARTIAL / OBSTRUCTED / LOST — no wall is seen
//  through), hearing (a shot, a sprint: where it came from, roughly), the
//  hive (late and rough), and then everything he believes fades by how old it
//  is and where it came from, and is carried on by the way it was moving.
function sense(V, dt) {
  const E = V.env, v = V.vec, M = V.mind, now = E.now(), rnd = E.random, who = E.targets(), C = CONFIG;
  let bt = null, bd = Infinity, nd = Infinity, nt = null;
  for (let i = 0; i < who.length; i++) {
    const t = who[i], key = keyOf(t);
    const d = Math.hypot(t.x - v.x, t.z - v.z);
    if (!t.dead && d < nd) { nd = d; nt = t; }
    let vis = 0;
    if (!t.dead && d < C.perceptionRange) {
      if (V.sees(V, t)) vis = (t.cloak || d > C.partialRange) ? 2 : 3;
      else {
        //  (in front of him and within sight, but something is in the way)
        let a = Math.atan2(t.x - v.x, t.z - v.z) - v.hd;
        while (a > Math.PI) a -= 6.2832; while (a < -Math.PI) a += 6.2832;
        vis = Math.abs(a) < C.visionAngle || d < 14 ? 1 : 0;
      }
    }
    const was = M.vis[key] || 0;
    M.vis[key] = vis;
    if (t.dead && M.alive && M.alive[key]) noteDeath(V, t);
    (M.alive || (M.alive = {}))[key] = !t.dead;
    if (vis >= 2) {
      //  seen: where, how fast it has been moving, how high (a roof, a floor up)
      const h = bestOf(M, key);
      let vx, vz;
      if (h && h.lt < now && now - h.lt < 1.5 && h.src === 'vision') { vx = (t.x - h.lx) / (now - h.lt); vz = (t.z - h.lz) / (now - h.lt); }
      const err = vis === 3 ? 0 : 2.5;
      const hh = believe(M, key, t.x + (rnd() - 0.5) * err, t.z + (rnd() - 0.5) * err, vis === 3 ? 1 : 0.6, 'vision', now, vx, vz);
      hh.lx = t.x; hh.lz = t.z; hh.lt = now; hh.vis = vis;
      const p = model(M, key);
      if (now - p.lastSeen > 1) {
        //  FB§6: once a second, what this sighting says about them
        p.lastSeen = now; p.n = Math.min(99, p.n + 1);
        p.range += (d - p.range) * 0.12;
        const sp = hh.vx !== undefined ? Math.hypot(hh.vx, hh.vz) : 0;
        p.mobility += (clamp01(sp / (RULES.RUN || 8)) - p.mobility) * 0.15;
        const up = t.y > 3.0 ? 1 : 0;                  // (a floor up, a roof)
        p.elevation += (up - p.elevation) * 0.15;
        if (up) episode(M, now, 'rooftop', 0.3);
        //  coming at him or keeping away
        const toward = hh.vx !== undefined ? -((t.x - v.x) * hh.vx + (t.z - v.z) * hh.vz) / Math.max(1, d) : 0;
        p.aggression += (clamp01(0.4 + toward * 0.12) - p.aggression) * 0.08;
        heatAt(M, t.x, t.z, 0.4);
      }
      if (was < 2) { remember(M, now, 'seen', 1); if (p.seenAt < now - 8) log(M, now, 'Vision: ' + VIS[vis] + ' on ' + key + ' at ' + d.toFixed(0) + ' m.'); p.seenAt = now; }
      if (vis === 3 && d < bd) { bd = d; bt = t; }
    } else if (was >= 2) {
      //  lost: behind something (they broke his sight), or gone out of range
      remember(M, now, 'lost', 1);
      log(M, now, 'Vision lost on ' + key + (vis === 1 ? ' (obstructed).' : '.'));
      const p = model(M, key);
      if (vis === 1) { p.cover += (1 - p.cover) * 0.12; episode(M, now, 'breaks_sight', 0.5); }
    }
  }
  //  (for the body: the nearest he sees, else the nearest; and how far)
  v.tgt = bt; v.near = nt;
  const on = bt || nt;
  if (on) v.tdist = Math.hypot(on.x - v.x, on.z - v.z);
  v.see = bt ? 1 : 0;

  //  FB§2.2: what he hears — a shot carries across the district, a step does
  //  not; where it came from he places roughly, worse the further off it was
  const N = E.noises ? E.noises() : null;
  if (N) for (let i = 0; i < N.length; i++) {
    const n = N[i];
    if (n.t <= M.heard) continue;
    M.heard = Math.max(M.heard, n.t);
    if (now - n.t > 2) continue;
    const d = Math.hypot(n.x - v.x, n.z - v.z), reach = C.hearingRange * (n.i || 0.3);
    if (d > reach) continue;
    const err = 3 + d * 0.09;
    const conf = clamp01((1 - d / reach) * 0.75 + 0.1) * (n.type === 'shot' ? 1 : 0.7);
    believe(M, null, n.x + (rnd() - 0.5) * err * 2, n.z + (rnd() - 0.5) * err * 2, conf, 'sound', now);
    remember(M, now, n.type === 'shot' ? 'shot_heard' : 'sound', conf);
    if (n.type === 'shot') log(M, now, 'Gunshot heard, ' + d.toFixed(0) + ' m off, confidence ' + conf.toFixed(2) + '.');
  }

  //  FB§23: the hive — what reaches him now, and orders reaching the court
  hiveStep(V, dt);

  //  FB§33: and it all fades; what was moving is carried on for a while
  const mem = 0.6 + 0.6 * M.prof.memory;
  for (let i = M.hyp.length - 1; i >= 0; i--) {
    const h = M.hyp[i];
    const tau = (C.beliefTau[h.src] || 4) * mem;
    h.conf *= Math.exp(-dt / tau);
    const age = now - h.t;
    if (age > 0.15 && age < 2.2 && (h.vx || h.vz)) { h.x += h.vx * dt * 0.8; h.z += h.vz * dt * 0.8; h.vx *= 1 - dt * 0.6; h.vz *= 1 - dt * 0.6; }
    if (h.conf < 0.04) M.hyp.splice(i, 1);
  }
  //  who he is thinking about: the surest (the one he sees first)
  const f = bt ? bestOf(M, keyOf(bt)) : bestOf(M);
  M.focus = f ? f.key : null;
  M.focusConf = f ? f.conf : 0;
  M.fx = f ? f.x : v.x; M.fz = f ? f.z : v.z;
  M.energy = Math.min(C.psychicEnergy.max, M.energy + C.psychicEnergy.regen * M.prof.psychicControl * dt * (M.dir.pressure < 1 ? 0.6 : 1));
}
function heatAt(M, x, z, w) {
  const k = Math.round(x / 24) + ',' + Math.round(z / 24);
  M.heat[k] = Math.min(8, (M.heat[k] || 0) + w);
}
//  where they keep coming back to (FB§4 RepeatedPlayerPositions), if anywhere
function hotSpot(M, v) {
  let best = null, bs = 1.5;
  for (const k in M.heat) {
    const s = M.heat[k];
    if (s <= bs) continue;
    const [i, j] = k.split(',').map(Number);
    if (Math.hypot(i * 24 - v.x, j * 24 - v.z) > 150) continue;
    bs = s; best = { x: i * 24, z: j * 24, s };
  }
  return best;
}

// ---- the hive (FB§22–§25) --------------------------------------------------------------
//  Up: what any of the court within reach sees is reported — late (a dog
//  slower than a flayer), a little wrong, and less sure than his own eyes.
//  Down: his orders reach them the same way. Nothing is instant and nothing
//  is exact, so the hive is a network and not a wallhack.
function hiveStep(V, dt) {
  const E = V.env, v = V.vec, M = V.mind, now = E.now(), rnd = E.random, C = CONFIG;
  M.acc.hive += dt;
  if (M.acc.hive >= 0.5) {
    M.acc.hive = 0;
    const scan = (arr, tier) => {
      for (const o of arr) {
        if (!o.live || o.dead || !o.see || !o.tgt || now - o.seeT > 0.6) continue;
        if (Math.hypot(o.x - v.x, o.z - v.z) > C.hiveRange) continue;
        const n = C.hiveNoise[tier];
        M.hive.push({ due: now + C.hiveDelay[tier] * (0.8 + rnd() * 0.4), up: true, key: keyOf(o.tgt),
          x: o.tgt.x + (rnd() - 0.5) * n * 2, z: o.tgt.z + (rnd() - 0.5) * n * 2, conf: C.hiveConfidence[tier], tier });
      }
    };
    scan(E.flayers(), 'flayer'); scan(E.gorgons(), 'gorgon'); scan(E.dogs(), 'dog');
    if (M.hive.length > 64) M.hive.splice(0, M.hive.length - 64);
  }
  for (let i = M.hive.length - 1; i >= 0; i--) {
    const q = M.hive[i];
    if (q.due > now) continue;
    M.hive.splice(i, 1);
    if (q.up) { believe(M, q.key, q.x, q.z, q.conf, 'minion', now); remember(M, now, 'report', q.conf); }
    else if (q.o && q.o.live && !q.o.dead) q.o.order = q.order;
  }
}
//  FB§15–§16, §39: an objective, handed down — what, where (as he believes
//  it: a point, not a player), how sure, how much it matters, until when — to
//  arrive late and a little wrong, like everything else in the hive
function order(V, o, tier, obj, x, z, pri, secs) {
  const E = V.env, M = V.mind, now = E.now(), rnd = E.random, C = CONFIG;
  const n = C.hiveNoise[tier] * (1.1 - M.prof.minionCoordination);
  M.hive.push({ due: now + C.hiveDelay[tier] * (0.8 + rnd() * 0.4), up: false, o,
    order: { obj, x: x + (rnd() - 0.5) * n * 2, z: z + (rnd() - 0.5) * n * 2, conf: M.focusConf, pri: pri || 1, t: now, until: now + (secs || 12), by: 'vec' } });
  M.orders++;
}

// ---- damage, both ways ------------------------------------------------------------------
//  FB§2.4: a round tells him the way it came, not the place — the bearing is
//  off by a little, the distance by a lot
function onHurt(V, dmg, fromX, fromZ) {
  const E = V.env, v = V.vec, M = V.mind, now = E.now(), rnd = E.random;
  if (!M) return { x: fromX, z: fromZ };
  const d = Math.hypot(fromX - v.x, fromZ - v.z);
  const a = Math.atan2(fromX - v.x, fromZ - v.z) + (rnd() - 0.5) * (0.08 + d * 0.0012) * 2;
  const r = d * (0.8 + rnd() * 0.4);
  const x = v.x + Math.sin(a) * r, z = v.z + Math.cos(a) * r;
  const seen = M.focus !== null && M.vis[M.focus] >= 2 && Math.hypot(M.fx - fromX, M.fz - fromZ) < 12;
  believe(M, seen ? M.focus : null, x, z, seen ? 0.9 : 0.55, 'damage', now);
  M.meta.dmgIn.push({ t: now, d: dmg });
  remember(M, now, 'hit_taken', dmg / 20);
  M.danger.push({ x, z, s: dmg, t: now });
  if (M.danger.length > 12) M.danger.shift();
  //  FB§35: shot from where he did not think anyone was
  if (!seen) { M.meta.surprise = Math.min(1, M.meta.surprise + 0.25); if (d > 60) episode(M, now, 'long_range', 0.6); }
  else if (d < 14) episode(M, now, 'close_combat', 0.3);
  if (M.focus !== null) model(M, M.focus).shots++;
  return { x, z };
}
//  what he and his court did to a player: the tactic's score (FB§8.4), and the
//  director's reckoning (FB§72)
function noteHit(V, t, kind, dmg) {
  const M = V.mind; if (!M) return;
  const now = V.env.now();
  M.tactic.dealt += dmg;
  M.meta.dmgOut.push({ t: now, d: dmg });
  M.dir.hits.push({ t: now, k: keyOf(t), d: dmg });
  if (M.dir.hits.length > 40) M.dir.hits.shift();
  remember(M, now, 'hit_dealt', dmg / 20);
}
function noteDodge(V, t) {
  const M = V.mind; if (!M) return;
  const now = V.env.now();
  episode(M, now, 'jumps_wave', 1);
  M.meta.surprise = Math.min(1, M.meta.surprise + 0.2);
  log(M, now, keyOf(t) + ' went over the wave.');
}
function noteMiss(V) {
  const M = V.mind; if (!M) return;
  const now = V.env.now();
  episode(M, now, 'breaks_sight', 1);
  M.meta.surprise = Math.min(1, M.meta.surprise + 0.2);
  log(M, now, 'His mind found nothing: sight broken.');
}
function noteDeath(V, t) {
  const M = V.mind; if (!M) return;
  M.dir.relief = Math.max(M.dir.relief, CONFIG.reliefAfterDeath);
  log(M, V.env.now(), keyOf(t) + ' is down: a moment of quiet (the director).');
}

// ---- prediction (FB§7) -----------------------------------------------------------------
//  Where the one he is thinking about will be in a second and a half — several
//  candidates, each with a probability from how they move and what he thinks
//  of them; the most likely is not taken for the truth, and every guess is
//  checked later against what he then sees.
function predict(V) {
  const E = V.env, v = V.vec, M = V.mind, now = E.now(), rnd = E.random, C = CONFIG;
  const h = M.focus !== null ? bestOf(M, M.focus) : null;
  if (!h || h.conf < 0.25) { M.pred.cands = null; return; }
  const p = model(M, h.key), w = weight(M, p), H = C.predictionHorizon;
  const sp = Math.hypot(h.vx, h.vz), ux = sp > 0.1 ? h.vx / sp : 0, uz = sp > 0.1 ? h.vz / sp : 0;
  const d = Math.max(1, Math.hypot(h.x - v.x, h.z - v.z)), ax = (h.x - v.x) / d, az = (h.z - v.z) / d;
  const run = Math.max(3, sp);
  //  the nearest cover to them: eight directions, eight metres
  let cx = h.x, cz = h.z, hasCover = false;
  for (let i = 0; i < 8 && !hasCover; i++) {
    const a = i * 0.785, x = h.x + Math.sin(a) * 8, z = h.z + Math.cos(a) * 8;
    if (!E.clearAt(x, z, 0.6)) { cx = h.x + Math.sin(a) * 5; cz = h.z + Math.cos(a) * 5; hasCover = true; }
  }
  const side = (h.vx * az - h.vz * ax) >= 0 ? 1 : -1;
  const cands = [
    { k: 'continue', x: h.x + h.vx * H, z: h.z + h.vz * H, p: 0.25 + clamp01(sp / 4) * 0.35 },
    { k: 'stop', x: h.x, z: h.z, p: sp < 0.8 ? 0.45 : 0.12 },
    { k: 'retreat', x: h.x + ax * run * H, z: h.z + az * run * H, p: 0.12 + w * (1 - p.aggression) * 0.25 + (M.meta.dmgOut.length ? 0.05 : 0) },
    { k: 'flank', x: h.x + az * side * run * H, z: h.z - ax * side * run * H, p: 0.08 + w * p.mobility * 0.2 },
    { k: 'cover', x: cx, z: cz, p: hasCover ? 0.06 + w * p.cover * 0.35 : 0 },
    { k: 'unknown', x: h.x, z: h.z, p: 0.08 },
  ];
  let sum = 0; for (const c of cands) sum += c.p;
  let ex = 0, ez = 0;
  for (const c of cands) { c.p /= sum; ex += c.x * c.p; ez += c.z * c.p; }
  //  bounded: how much of the guess he acts on, and never without error
  const skill = M.prof.prediction, noise = C.predictionNoise * (1.2 - skill);
  M.pred.px = h.x + (ex - h.x) * skill + (rnd() - 0.5) * noise * 2;
  M.pred.pz = h.z + (ez - h.z) * skill + (rnd() - 0.5) * noise * 2;
  cands.sort((a, b) => b.p - a.p);
  M.pred.cands = cands;
  M.pred.pending.push({ key: h.key, due: now + H, x: M.pred.px, z: M.pred.pz, top: cands[0].k });
  if (M.pred.pending.length > 12) M.pred.pending.shift();
}
//  FB§8.3: each guess that has come due, against what he now sees of them
function checkPredictions(V) {
  const v = V.vec, M = V.mind, now = V.env.now();
  for (let i = M.pred.pending.length - 1; i >= 0; i--) {
    const q = M.pred.pending[i];
    if (q.due > now) continue;
    M.pred.pending.splice(i, 1);
    const h = bestOf(M, q.key);
    if (!h || M.vis[q.key] < 2 || now - h.t > 0.5) continue;       // (only what he can check)
    const err = Math.hypot(h.x - q.x, h.z - q.z);
    M.pred.err += (err - M.pred.err) * 0.25;
    M.pred.lastErr = err;
    M.pred.conf = clamp01(1 - M.pred.err / 14);
    if (err > 9) {
      M.meta.surprise = Math.min(1, M.meta.surprise + 0.15);
      remember(M, now, 'pred_fail', err / 10);
      log(M, now, 'Prediction failed (' + q.top + ', off by ' + err.toFixed(1) + ' m).');
      const p = model(M, q.key); p.mobility = Math.min(1, p.mobility + 0.03);
    }
  }
}

// ---- metacognition (FB§8) ---------------------------------------------------------------
//  Once a second he looks at himself: how hurt, how fast it is happening, how
//  many see him, what he has around him, how sure he is of where they are and
//  of his guesses, and whether what he is doing is working — and he names the
//  state that follows (it changes what he chooses; it is not a mood).
function metacog(V) {
  const E = V.env, v = V.vec, M = V.mind, now = E.now(), C = CONFIG, mt = M.meta;
  const cut = (arr, s) => { while (arr.length && now - arr[0].t > s) arr.shift(); return arr.reduce((a, q) => a + q.d, 0); };
  const dmgIn = cut(mt.dmgIn, 10), dmgOut = cut(mt.dmgOut, 20);
  const hpF = v.hp / (V.hpMax || 12600);
  let exposure = 0; for (const k in M.vis) if (M.vis[k] >= 2) exposure++;
  const court = V.hiveCount ? V.hiveCount(V) : 0;
  const dist = M.focus !== null ? Math.hypot(M.fx - v.x, M.fz - v.z) : 999;
  mt.surprise *= 0.8;
  checkPredictions(V);
  //  FB§33: memories fade; the ones that keep happening stay
  const kd = Math.pow(C.memoryDecay, 1 / Math.max(0.2, M.prof.memory));
  for (const k in M.epi) { const e = M.epi[k]; if (e.n < 4) e.s *= kd; else e.s = Math.max(1, e.s * kd); if (e.s < 0.05) delete M.epi[k]; }
  while (M.stm.length && now - M.stm[0].t > C.memoryDuration) M.stm.shift();
  for (const k in M.heat) { M.heat[k] *= 0.995; if (M.heat[k] < 0.05) delete M.heat[k]; }
  for (let i = M.danger.length - 1; i >= 0; i--) if (now - M.danger[i].t > 60) M.danger.splice(i, 1);
  //  FB§8.4/§8.5: is the tactic working — and if it keeps failing, stop using it for a while
  evalTactic(V, false);
  let st;
  if (mt.surprise > 0.55) st = 'SURPRISED';
  else if (hpF < C.emergencyThreshold && dmgIn > 200) st = 'RECOVERING';
  else if (dmgIn > 500 || exposure >= 2) st = 'PRESSURED';
  else if (dist < 10 && court < 2 && dmgIn > 150) st = 'OVEREXTENDED';
  else if (flayerHurt(V)) st = 'DEFENDING';                  // (his commander being hurt comes before his own doubts)
  else if (now < mt.adaptT) st = 'ADAPTING';
  else if (M.focusConf < 0.3) st = weight(M, M.focus !== null ? M.players[M.focus] : null) < 0.3 && M.focusConf > 0.1 ? 'TESTING' : 'UNCERTAIN';
  else if (M.pred.conf > 0.65 && mt.successRate > 0.55) st = 'CONFIDENT';
  else st = 'HUNTING';
  if (st !== mt.state) { log(M, now, 'Metacognitive state = ' + st + '.'); mt.state = st; }
  mt.dmgInRecent = dmgIn; mt.dmgOutRecent = dmgOut; mt.exposure = exposure; mt.court = court; mt.hpF = hpF;
}
function flayerHurt(V) {
  const v = V.vec, now = V.env.now();
  for (const m of V.env.flayers()) if (m.live && !m.dead && m.lord === 'vec' && m.senseT !== undefined && now - m.senseT < 3 && Math.hypot(m.x - v.x, m.z - v.z) < CONFIG.hiveRange && m.hp < (m.hpMax || 4200) * 0.7) return true;
  return false;
}
//  a tactic ends (or is looked at): did it do anything? dealt harm, or — for
//  the ones that look for people — made him surer of where they are
function evalTactic(V, ending) {
  const M = V.mind, T = M.tactic, now = V.env.now();
  const s = M.tac[T.name] || (M.tac[T.name] = { tries: 0, wins: 0, fails: 0, val: 0.5, block: 0 });
  //  (judged only on what it had the chance to do: seconds actually spent
  //  carrying it out — not watching, not turning a phase — and at least three)
  const age = T.active || 0;
  if (ending && age < 3) { T.t = now; T.active = 0; T.dealt = 0; T.conf0 = M.focusConf; return; }
  if (!ending && age < 5) return;
  const looking = T.name === 'SEARCH' || T.name === 'TEST' || T.name === 'MINION_SEARCH' || T.name === 'AMBUSH';
  const court = T.name === 'MINION_ATTACK' || T.name === 'MINION_FLANK' || T.name === 'SURROUND' || T.name === 'CUT_OFF_ESCAPE';
  const moving = T.name === 'REPOSITION' || T.name === 'RETREAT';
  //  it worked if it hurt them; or, for looking, if he knows where they are now;
  //  for the court's, if contact was kept; for getting out, if the hurt stopped
  const worked = T.dealt > 0 || (looking && M.focusConf > T.conf0 + 0.2) || (court && M.focusConf > 0.5) || (moving && (M.meta.dmgInRecent || 0) < 60);
  if (!ending && !worked && age < 9) return;
  s.tries++;
  if (worked) { s.wins++; s.fails = 0; } else s.fails++;
  s.val += ((worked ? 1 : 0) - s.val) * 0.3;
  M.meta.successRate += ((worked ? 1 : 0) - M.meta.successRate) * 0.2;
  if (!worked && s.fails >= 2) {
    //  FB§8.5: "this is not working now" — set aside, for a while
    s.block = now + 20 + V.env.random() * 20;
    M.meta.adaptT = now + 6;
    log(M, now, 'Tactic ' + T.name + ' is not working (' + s.fails + ' failures): trying something else.');
    s.fails = 0;
    T.until = now;                       // (and it is re-planned at once)
  }
  T.t = now; T.active = 0; T.dealt = 0; T.conf0 = M.focusConf;
}

// ---- goals (FB§10–§11) ------------------------------------------------------------------
function goals(V) {
  const E = V.env, v = V.vec, M = V.mind, now = E.now(), mt = M.meta, C = CONFIG;
  const hpF = mt.hpF === undefined ? 1 : mt.hpF, conf = M.focusConf;
  const p = M.focus !== null ? M.players[M.focus] : null, w = weight(M, p);
  const inDanger = M.danger.some((q) => Math.hypot(q.x - v.x, q.z - v.z) < 30 && now - q.t < 15);
  const U = {
    HUNT_PLAYER: conf * 0.9 + (v.phase || 0) * 0.05 + (mt.state === 'CONFIDENT' ? 0.15 : 0),
    CONTROL_AREA: (conf > 0.2 && conf < 0.65 ? 0.45 : 0.15) + (v.orbit.length < 2 ? 0.1 : 0),
    PROTECT_MINIONS: mt.state === 'DEFENDING' ? 0.75 : 0.05,
    TEST_PLAYER: (1 - w) * (conf > 0.1 && conf < 0.6 ? 0.5 : 0.1),
    REPOSITION: mt.state === 'PRESSURED' ? 0.8 : mt.state === 'OVEREXTENDED' ? 0.7 : (mt.exposure || 0) >= 2 ? 0.5 : 0.05,
    RECOVER: hpF < C.emergencyThreshold ? 0.55 + (mt.dmgInRecent > 150 ? 0.3 : 0) : 0.02,
    CREATE_AMBUSH: conf < 0.35 && hotSpot(M, v) ? 0.35 + w * 0.3 : 0.02,
    CONTROL_ENVIRONMENT: (M.focus !== null && M.vis[M.focus] === 1 ? 0.55 : 0.1) + w * (p ? p.cover : 0) * 0.3,
    ESCAPE_DANGER: inDanger && hpF < 0.5 ? 0.6 : 0.02,
  };
  M.goalUtil = U;
  //  (a goal is kept while it is still close to the best: goals do not flicker)
  let bestU = 0; for (const k in U) bestU = Math.max(bestU, U[k]);
  if (U[M.goal] !== undefined && U[M.goal] > bestU - 0.12) return;
  const g = softPick(E.random, Object.keys(U).map((k) => ({ k, s: U[k] })), C.actionRandomness * 0.8);
  if (g !== M.goal) { log(M, now, 'Goal = ' + g + ' (' + U[g].toFixed(2) + ').'); M.goal = g; }
}
//  FB§29/§76: not always the best — one of the reasonable ones, the better more often
function softPick(rnd, opts, temp) {
  opts = opts.filter((o) => o.s > -1e8);
  if (!opts.length) return null;
  opts.sort((a, b) => b.s - a.s);
  const top = opts.slice(0, 3), m = top[0].s;
  let sum = 0; for (const o of top) { o.w = Math.exp((o.s - m) / Math.max(0.02, temp)); sum += o.w; }
  let r = rnd() * sum;
  for (const o of top) { r -= o.w; if (r <= 0) return o.k; }
  return top[0].k;
}

// ---- the tactical planner (FB§12, §13, §29) ---------------------------------------------
//  Each tactic is scored from what he believes, the goal, his state, what he
//  remembers of this player and of the tactic, what it costs him, and what
//  fairness costs it; then one of the best few is chosen.
function plan(V) {
  const E = V.env, v = V.vec, M = V.mind, now = E.now(), C = CONFIG, mt = M.meta;
  const conf = M.focusConf, known = conf > 0.18;
  const d = known ? Math.hypot(M.fx - v.x, M.fz - v.z) : 999;
  const vis = M.focus !== null ? (M.vis[M.focus] || 0) : 0;
  const p = M.focus !== null ? M.players[M.focus] : null, w = weight(M, p);
  const hpF = mt.hpF === undefined ? 1 : mt.hpF, phase = v.phase || 0, en = M.energy;
  const court = mt.court || 0, g = M.goal;
  const align = (goalsFor) => (goalsFor.indexOf(g) >= 0 ? 1 : 0.55);
  const T = M.tactic;
  const S = {};
  const blocked = (k) => { const s = M.tac[k]; return s && s.block > now; };
  const val = (k) => { const s = M.tac[k]; return s ? 0.6 + s.val * 0.8 : 1; };
  //  (EV × confidence × fit × goal alignment − risk − cost − fairness cost)
  const score = (k, ev, fit, goalsFor, risk, cost, fairCost) => {
    if (blocked(k)) return;
    S[k] = ev * Math.max(0.15, conf) * fit * align(goalsFor) * val(k) - risk - cost - fairCost;
  };
  const rep = (k) => (T.lastName === k ? T.reps * 0.12 : 0);        // FB§43: the same thing again and again becomes oppressive
  const jumpy = epi(M, 'jumps_wave'), sightBreaker = epi(M, 'breaks_sight'), longRange = epi(M, 'long_range'), roof = epi(M, 'rooftop');
  if (known) {
    score('DIRECT_ATTACK', 0.9, d < 40 ? 1 : 0.6, ['HUNT_PLAYER'], hpF < 0.3 ? 0.25 : 0.05, 0, rep('DIRECT_ATTACK'));
    if (d < 34 && phase >= 1 && en >= C.cost.wave) score('SHOCKWAVE', 1.1 - Math.min(0.5, jumpy * 0.1), d < 22 ? 1.1 : 0.5, ['HUNT_PLAYER', 'REPOSITION', 'ESCAPE_DANGER'], 0.05, 0.1, rep('SHOCKWAVE'));
    if (d < 22) score('TENTACLE_ATTACK', 1.0, d < 12 ? 1.2 : 0.6, ['HUNT_PLAYER'], hpF < 0.3 ? 0.2 : 0.05, 0, rep('TENTACLE_ATTACK'));
    if (vis >= 2 && phase >= 1 && en >= C.cost.mind && d > 8 && d < 62) score('PSYCHIC_BLAST', 0.8 - Math.min(0.4, sightBreaker * 0.08), 1, ['HUNT_PLAYER', 'CONTROL_AREA', 'TEST_PLAYER'], 0, 0.12, rep('PSYCHIC_BLAST'));
    if (d > 14 && (v.orbit.length || en >= C.cost.lift)) score('TELEKINESIS_THROW', 0.95, d > 24 ? 1.1 : 0.7, ['HUNT_PLAYER', 'CONTROL_ENVIRONMENT', 'CONTROL_AREA'], 0.02, 0.05, rep('TELEKINESIS_THROW'));
    if (d > 18 && en >= C.cost.lift && M.pred.cands) score('AREA_DENIAL', 0.7 + w * 0.3, 0.9, ['CONTROL_AREA', 'CONTROL_ENVIRONMENT'], 0.02, 0.08, rep('AREA_DENIAL'));
    if (vis === 1 || (w > 0 && p && p.cover > 0.5)) score('FORCE_OUT_OF_COVER', 1.0 + w * 0.3, vis === 1 ? 1.2 : 0.6, ['CONTROL_ENVIRONMENT', 'HUNT_PLAYER'], 0.05, 0.08, rep('FORCE_OUT_OF_COVER'));
    if (court >= 2) {
      score('MINION_ATTACK', 0.85, 1, ['HUNT_PLAYER', 'PROTECT_MINIONS'], 0, 0.02, rep('MINION_ATTACK'));
      score('MINION_FLANK', 0.9 + longRange * 0.08 + roof * 0.05, d > 30 ? 1.1 : 0.7, ['HUNT_PLAYER', 'CONTROL_AREA'], 0, 0.02, rep('MINION_FLANK'));
      if (court >= 4) score('SURROUND', 0.95 + w * 0.2, 1, ['CONTROL_AREA', 'HUNT_PLAYER'], 0, 0.03, rep('SURROUND'));
      if (M.pred.cands && M.pred.cands[0].k === 'retreat') score('CUT_OFF_ESCAPE', 1.0 + w * 0.3, 1, ['CONTROL_AREA', 'HUNT_PLAYER'], 0, 0.03, rep('CUT_OFF_ESCAPE'));
    }
    if (d < 30 && hpF < 0.6) score('FAKE_RETREAT', 0.7 + w * 0.25, 0.8, ['HUNT_PLAYER', 'REPOSITION'], 0.05, 0, rep('FAKE_RETREAT'));
    if (mt.state === 'PRESSURED' || mt.state === 'OVEREXTENDED' || g === 'REPOSITION' || g === 'ESCAPE_DANGER') score('REPOSITION', 1.0, 1, ['REPOSITION', 'ESCAPE_DANGER'], 0, 0, rep('REPOSITION'));
    if (hpF < C.emergencyThreshold && (g === 'RECOVER' || mt.state === 'RECOVERING')) score('RETREAT', 1.0, 1, ['RECOVER', 'ESCAPE_DANGER'], 0, 0, rep('RETREAT'));
  }
  //  not knowing where they are: find out
  if (!known || conf < 0.45) {
    S.SEARCH = 0.5 + (1 - conf) * 0.4;
    if (court >= 1) score('MINION_SEARCH', 0.8, 1, ['HUNT_PLAYER', 'TEST_PLAYER', 'CONTROL_AREA'], 0, 0.02, 0);
    if (court >= 1 && conf > 0.08 && w < 0.4) score('TEST', 0.9, 1, ['TEST_PLAYER'], 0, 0.02, 0);   // FB§37: a cheap probe
    if (hotSpot(M, v)) score('AMBUSH', 0.8 + w * 0.3, 1, ['CREATE_AMBUSH'], 0, 0, 0);
  }
  //  (and what he is doing he keeps doing until it runs its course, unless
  //  it no longer makes sense or something clearly better has come up)
  let best = -1e9; for (const k in S) best = Math.max(best, S[k]);
  //  (except in an emergency, or under fire he is not answering: then at once)
  const urgent = (S.RETREAT !== undefined && mt.state === 'RECOVERING' && T.name !== 'RETREAT') ||
    (S.REPOSITION !== undefined && (mt.state === 'PRESSURED' || mt.state === 'OVEREXTENDED') && T.name !== 'REPOSITION' && T.name !== 'RETREAT');
  if (!urgent && now < T.until && S[T.name] !== undefined && S[T.name] > best - 0.3) return;
  if (urgent) { const k = S.RETREAT !== undefined && mt.state === 'RECOVERING' ? 'RETREAT' : 'REPOSITION'; startTactic(V, k, S[k]); return; }
  const pick = softPick(E.random, Object.keys(S).map((k) => ({ k, s: S[k] })), C.actionRandomness);
  if (!pick) return;
  if (pick !== T.name || now >= T.until) startTactic(V, pick, S[pick]);
}
function startTactic(V, name, sc) {
  const E = V.env, v = V.vec, M = V.mind, now = E.now(), T = M.tactic, C = CONFIG;
  if (T.name !== name) {
    evalTactic(V, true);
    T.reps = T.lastName === name ? T.reps + 1 : 0;
    T.lastName = T.name;
    log(M, now, 'Selected: ' + name + ' (' + (sc || 0).toFixed(2) + ', ' + M.meta.state + ').');
  }
  T.name = name; T.t = now; T.until = now + 4 + E.random() * 3; T.dealt = 0; T.conf0 = M.focusConf;
  T.prefer = null; T.hold = false; T.speed = 1.55 + (v.phase || 0) * 0.22;
  if (!Number.isFinite(M.fx) || !Number.isFinite(M.fz)) { M.fx = v.x; M.fz = v.z; }       // (nothing believed yet: where he stands)
  const d = Math.max(1, Math.hypot(M.fx - v.x, M.fz - v.z)), ax = (M.fx - v.x) / d, az = (M.fz - v.z) / d;
  const tx = M.pred.cands ? M.pred.px : M.fx, tz = M.pred.cands ? M.pred.pz : M.fz;
  T.x = tx; T.z = tz; T.standoff = (v.phase || 0) >= 4 ? 10 : 20 - (v.phase || 0) * 2;
  const courtOrder = (obj, pri, how) => commandCourt(V, obj, pri, how);
  switch (name) {
    case 'DIRECT_ATTACK': T.prefer = d < 11 ? 'limb' : d < 24 ? 'wave' : v.orbit.length ? 'hurl' : null; break;
    case 'SHOCKWAVE': T.standoff = 9; T.prefer = 'wave'; break;
    case 'TENTACLE_ATTACK': T.standoff = 7; T.prefer = 'limb'; break;
    case 'PSYCHIC_BLAST': T.standoff = 24; T.prefer = 'mind'; break;
    case 'TELEKINESIS_THROW': T.standoff = 28; T.prefer = 'hurl'; break;
    case 'AREA_DENIAL': {
      //  the way they are likeliest to go, not where they are
      const c = M.pred.cands && M.pred.cands.find((q) => q.k === 'retreat' || q.k === 'cover' || q.k === 'flank') || null;
      if (c) { T.x = c.x; T.z = c.z; }
      T.standoff = 30; T.prefer = 'hurl'; T.aim = { x: T.x, z: T.z }; break;
    }
    case 'FORCE_OUT_OF_COVER': T.standoff = 26; T.prefer = 'hurl'; T.aim = { x: M.fx, z: M.fz }; courtOrder('flank', 2); break;
    case 'MINION_ATTACK': T.standoff = 34; courtOrder('attack', 2); break;
    case 'MINION_FLANK': T.standoff = 32; courtOrder('flank', 2); break;
    case 'SURROUND': T.standoff = 30; courtOrder('contain', 2); break;
    case 'CUT_OFF_ESCAPE': {
      const c = M.pred.cands && M.pred.cands.find((q) => q.k === 'retreat');
      T.standoff = 26; if (c) commandCourt(V, 'contain', 2, c); else courtOrder('contain', 2);
      break;
    }
    case 'MINION_SEARCH': T.standoff = 40; courtOrder('search', 1); break;
    case 'TEST': T.standoff = 45; T.hold = true; commandCourt(V, 'investigate', 1, null, 1); break;
    case 'SEARCH': T.standoff = 6; T.speed = 1.3; break;
    case 'AMBUSH': {
      const h = hotSpot(M, v);
      if (h) { T.x = h.x; T.z = h.z; }
      T.standoff = 14; T.hold = true; T.until = now + 12; break;
    }
    case 'REPOSITION': case 'RETREAT': {
      //  away from where he has been hurt and from who sees him, to somewhere
      //  he could stand — then he looks again (FB§27: with a reason, and after it: observe, counter)
      let best = null, bs = -1e9;
      for (let i = 0; i < 12; i++) {
        const a = i * 0.5236, r = name === 'RETREAT' ? 48 : 30;
        const x = v.x + Math.sin(a) * r, z = v.z + Math.cos(a) * r;
        if (Math.abs(x) > WORLD * 0.44 || Math.abs(z) > WORLD * 0.44 || !E.clearAt(x, z, 2.2)) continue;
        let s = Math.hypot(x - M.fx, z - M.fz) * 0.05;
        for (const q of M.danger) s -= Math.max(0, 40 - Math.hypot(x - q.x, z - q.z)) * 0.03;
        s += E.random() * 0.4;
        if (s > bs) { bs = s; best = { x, z }; }
      }
      if (best) { T.x = best.x; T.z = best.z; }
      T.standoff = 1; T.speed = 2.2; T.until = now + (name === 'RETREAT' ? 7 : 5);
      if (name === 'RETREAT') { courtOrder('protect', 3); }
      break;
    }
    case 'FAKE_RETREAT': {
      T.x = v.x - ax * 16; T.z = v.z - az * 16; T.standoff = 1; T.speed = 2.0; T.until = now + 3.2; T.prefer = null; T.then = 'wave';
      break;
    }
  }
}
//  FB§15/§21/§39: objectives to the court, not positions to walk to — the
//  flayer is told, then the gorgons and a few dogs; what each does with it is
//  its own business (and it arrives late, and a little wrong)
function commandCourt(V, obj, pri, at, only) {
  const E = V.env, v = V.vec, M = V.mind, C = CONFIG, now = E.now();
  if (M.energy < C.cost.order) return 0;
  const x = at ? at.x : M.fx, z = at ? at.z : M.fz, secs = obj === 'search' || obj === 'investigate' ? 15 : 10;
  let n = 0;
  const near = (arr) => arr.filter((o) => o.live && !o.dead && Math.hypot(o.x - v.x, o.z - v.z) <= C.hiveRange)
    .sort((a, b) => Math.hypot(a.x - v.x, a.z - v.z) - Math.hypot(b.x - v.x, b.z - v.z));
  if (!only) for (const m of near(E.flayers())) { order(V, m, 'flayer', obj, x, z, pri, secs); n++; }
  const gs = near(E.gorgons()).slice(0, only ? 0 : 2), ds = near(E.dogs()).slice(0, only || 5);
  for (const g of gs) { order(V, g, 'gorgon', obj, x, z, pri, secs); n++; }
  for (const d of ds) { order(V, d, 'dog', obj, x, z, pri, secs); n++; }
  if (n) { M.energy -= C.cost.order; M.lastOrder = { obj, t: now, n }; log(M, now, 'Command ' + obj.toUpperCase() + ' to ' + n + ' of the court.'); }
  return n;
}

// ---- the director (FB§72–§73) -----------------------------------------------------------
//  Not him: the pacing around him. When a player has taken too much too fast
//  from him and his court, or has just gone down, the pressure comes off —
//  his swings come slower, the court is told less — and it goes back on.
function director(V, dt) {
  const M = V.mind, now = V.env.now(), C = CONFIG, D = M.dir;
  D.relief = Math.max(0, D.relief - dt);
  while (D.hits.length && now - D.hits[0].t > 10) D.hits.shift();
  const per = {};
  for (const q of D.hits) per[q.k] = (per[q.k] || 0) + q.d;
  let worst = 0; for (const k in per) worst = Math.max(worst, per[k]);
  const was = D.pressure;
  D.pressure = D.relief > 0 ? 0.5 : worst > C.fairnessLimit ? 0.65 : 1;
  if (D.pressure < 1 && was === 1) log(M, now, 'Director: pressure eased (' + Math.round(worst) + ' in 10 s' + (D.relief > 0 ? ', a player down' : '') + ').');
}
//  FB§43: the last word before he swings — is it fair to do this, now?
function fair(V, kind, dist) {
  const M = V.mind, v = V.vec;
  if (!M) return true;
  if (M.dir.pressure < 1 && V.env.random() > M.dir.pressure) { v.atkCd = Math.max(v.atkCd, 1.2); return false; }
  const cost = CONFIG.cost[kind] || 0;
  if (M.energy < cost) return false;
  M.energy -= cost;
  return true;
}

// ---- the step (FB§28, §46) ------------------------------------------------------------
//  sense every step; predict and plan at 5 Hz; goals at 2 Hz; look at
//  himself once a second
function tick(V, dt) {
  const M = V.mind, C = CONFIG, st = V.vec.st;
  sense(V, dt);
  if (st === 'hunt' || st === 'combat') M.tactic.active = (M.tactic.active || 0) + dt;
  director(V, dt);
  M.acc.meta += dt; M.acc.strat += dt; M.acc.tac += dt;
  if (M.acc.meta >= 1 / C.metacognitionRate) { M.acc.meta = 0; metacog(V); }
  if (M.acc.strat >= 1 / C.strategicRate) { M.acc.strat = 0; goals(V); }
  if (M.acc.tac >= 1 / C.tacticalRate) { M.acc.tac = 0; predict(V); plan(V); }
}

// ---- what his body asks ---------------------------------------------------------------
//  which swing, now: the tactic's, if it fits the distance; else what the
//  distance offers (as before) — each through fairness and his budget
function pickAttack(V, dist, ready) {
  const M = V.mind, T = M.tactic, E = V.env;
  const fits = (k) => (k === 'limb' ? dist < 11.5 : k === 'wave' ? dist < 26 && (V.vec.phase || 0) >= 1 : k === 'hurl' ? V.vec.orbit.length > 0 : k === 'mind' ? ready.mind : false);
  let k = T.prefer && fits(T.prefer) ? T.prefer : null;
  if (T.then && E.now() >= T.until && dist < 16) k = T.then;
  if (!k) {
    const opts = [];
    if (dist < 11.5) opts.push('limb', 'limb');
    if (fits('wave')) opts.push('wave');
    if (V.vec.orbit.length) opts.push('hurl', 'hurl');
    if (ready.mind) opts.push('mind');
    //  (what they have learned to beat, a little less often)
    if (epi(M, 'jumps_wave') > 2 && opts.length > 1) { const i = opts.indexOf('wave'); if (i >= 0 && E.random() < 0.5) opts.splice(i, 1); }
    if (!opts.length) return null;
    k = opts[(E.random() * opts.length) | 0];
  }
  if (!fair(V, k, dist)) return null;
  if (T.then && k === T.then) T.then = null;
  return k;
}
//  where he is going and how he stands, for this step
function goal(V) {
  const M = V.mind, T = M.tactic, v = V.vec;
  const ok = Number.isFinite(T.x) && Number.isFinite(T.z);
  return { x: ok ? T.x : v.x, z: ok ? T.z : v.z, standoff: T.standoff, speed: T.speed, hold: T.hold, name: T.name };
}

// ---- for F3 and the log (FB§49–§51) ---------------------------------------------------
function debugInfo(V) {
  const M = V.mind; if (!M) return null;
  const T = M.tactic, v = V.vec;
  let mem = 0; for (const k in M.epi) mem += M.epi[k].s;
  return {
    goal: M.goal, state: M.meta.state, tactic: T.name, conf: +M.focusConf.toFixed(2), focus: M.focus,
    pred: M.pred.cands ? M.pred.cands[0].k + ' ' + M.pred.cands[0].p.toFixed(2) : '-', err: +M.pred.err.toFixed(1), predConf: +M.pred.conf.toFixed(2),
    energy: Math.round(M.energy), adapt: +weight(M, M.focus !== null ? M.players[M.focus] : null).toFixed(2), mem: +mem.toFixed(1),
    hyp: M.hyp.length, pressure: M.dir.pressure, orders: M.orders, phase: PHASE_NAMES[phaseName(V)],
    episodes: Object.keys(M.epi).map((k) => k + ':' + M.epi[k].s.toFixed(1)).join(' '),
    last: M.log.length ? M.log[M.log.length - 1].m : '',
  };
}
//  FB§63: the fight's phase, from state, health and what is going on — not a script
function phaseName(V) {
  const M = V.mind, v = V.vec, hpF = M.meta.hpF === undefined ? 1 : M.meta.hpF, st = M.meta.state;
  if (!v.awake || v.st === 'observe' || v.st === 'dormant') return 0;
  if (hpF < 0.18) return 6;
  if (hpF < CONFIG.emergencyThreshold) return 5;
  if (st === 'PRESSURED' || st === 'OVEREXTENDED') return 4;
  if (st === 'ADAPTING' || st === 'SURPRISED') return 3;
  if (M.goal === 'CONTROL_AREA' || M.goal === 'CONTROL_ENVIRONMENT') return 2;
  return 1;
}
//  five small numbers for those who only draw him (a snapshot's tail): goal,
//  state, tactic, how sure·100, energy
function summary(V) {
  const M = V.mind;
  if (!M) return [0, 0, 0, 0, 0];
  return [GOALS.indexOf(M.goal), STATES.indexOf(M.meta.state), TACTICS.indexOf(M.tactic.name), Math.round(M.focusConf * 100), Math.round(M.energy)];
}

// ---- carried over (FB§54: the session's memory, not the moment's) ----------------------
//  what he has learned of each player, how each tactic has gone, what keeps
//  happening, and his budget — not what he believes this second
function fullState(V) {
  const M = V.mind; if (!M) return null;
  const pl = [];
  for (const k in M.players) { const p = M.players[k]; pl.push([String(k).slice(0, 16), Math.round(p.range * 10), Math.round(p.mobility * 100), Math.round(p.elevation * 100), Math.round(p.cover * 100), Math.round(p.aggression * 100), p.n]); }
  const tc = [];
  for (const k in M.tac) { const s = M.tac[k]; tc.push([TACTICS.indexOf(k), s.tries, s.wins, Math.round(s.val * 100)]); }
  const ep = [];
  for (const k in M.epi) ep.push([k.slice(0, 20), M.epi[k].n, Math.round(M.epi[k].s * 100)]);
  return { e: Math.round(M.energy), pl: pl.slice(0, 6), tc: tc.slice(0, TACTICS.length), ep: ep.slice(0, 12), sr: Math.round(M.meta.successRate * 100) };
}
function fullOk(f) {
  if (!f || typeof f !== 'object' || !Number.isFinite(f.e)) return false;
  const rows = (a, n) => Array.isArray(a) && a.length <= 32 && a.every((r) => Array.isArray(r) && r.length === n);
  return rows(f.pl, 7) && rows(f.tc, 4) && rows(f.ep, 3) && Number.isFinite(f.sr);
}
function adoptFull(V, f, difficulty) {
  const M = V.mind = makeMind(difficulty);
  if (!fullOk(f)) return M;
  M.energy = Math.max(0, Math.min(CONFIG.psychicEnergy.max, f.e));
  for (const r of f.pl) M.players[r[0]] = { range: r[1] / 10, mobility: r[2] / 100, elevation: r[3] / 100, cover: r[4] / 100, aggression: r[5] / 100, n: Math.min(99, r[6] | 0), lastSeen: -99, seenAt: -99, shots: 0 };
  for (const r of f.tc) { const k = TACTICS[r[0]]; if (k) M.tac[k] = { tries: r[1] | 0, wins: r[2] | 0, fails: 0, val: r[3] / 100, block: 0 }; }
  for (const r of f.ep) if (typeof r[0] === 'string') M.epi[r[0]] = { n: r[1] | 0, s: r[2] / 100, t: 0 };
  M.meta.successRate = f.sr / 100;
  return M;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONFIG, DIFFICULTY, VIS, STATES, GOALS, TACTICS, ORDERS, PHASE_NAMES,
    makeMind, keyOf, believe, bestOf, sense, hiveStep, order, commandCourt, onHurt, noteHit, noteDodge, noteMiss, noteDeath,
    predict, checkPredictions, metacog, evalTactic, goals, softPick, plan, startTactic, director, fair, tick,
    pickAttack, goal, debugInfo, phaseName, summary, fullState, fullOk, adoptFull, model, weight, episode, hotSpot, log,
  };
}
