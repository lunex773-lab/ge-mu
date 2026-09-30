'use strict';
//  ============================================================
//  CONTOUR — BIO-BRAIN: the three great ones' common brain  (shared)
//  ============================================================
//  After the design texts "BIO-BRAIN v1.0" (cited BB§n) and "ACIS × BIO-BRAIN
//  Three Boss Adaptive Intelligence System v1.0" (cited AC§n). One brain for
//  VECNA, the Mind Flayer and Beelzebub; what makes them three and not one is
//  the Character Genome each is born with (AC§5–§8) and what each goes
//  through. A closed loop (BB§18):
//
//    perceive → believe → feel → remember → predict → doubt → model the
//    player (and what the player thinks of me) → choose a strategy → weigh
//    the candidates → act → see what happened → compare → learn → again
//
//  What it is not: it does not move anyone, swing anything or decide who is
//  hit — the body that runs it does (shared/vecna.js, flayers.js, the lab's
//  boss_runner.js for Beelzebub), and gives it only what that body's own
//  senses give it (BB§38, AC§31: nothing it did not see, hear or feel). Its
//  numbers go into the body's own choices as biases, a narrower or wider
//  choice, a quicker or slower hand and a longer or shorter distance kept —
//  never as a command (BB§6: emotion does not choose the act).
//
//  All of it is plain data (make/fullState/adoptFull), stepped by the body at
//  the rates BB§29 asks (affect 5 Hz, strategy 2 Hz, metacognition 1 Hz),
//  and bounded everywhere: capacity, candidates, memory, reaction (BB§25).
//  The slow brain (an LLM, AC§20–§26) may propose, through llmContext and
//  adoptThought; it is checked against the genome first, and the brain goes
//  on without it (AC§44).

// ---- the genomes (AC§5–§8) -----------------------------------------------------------
//  Each: who it is, its personality, values, how it thinks, what it fears,
//  its affect's resting point and how hard each feeling moves it, how it
//  comes to see a player (relationship), the strategies it has and the
//  phases it goes through, its metacognitive character, and how it speaks.
const GENOMES = {
  vecna: {
    id: 'vecna', name: 'VECNA', role: 'supreme_mystic_boss',
    personality: { confidence: 0.99, patience: 0.97, aggression: 0.65, curiosity: 0.85, paranoia: 0.20, impulsivity: 0.08,
      arrogance: 0.98, cruelty: 0.90, composure: 0.99, empathy: 0.05, pride: 0.85, cowardice: 0.05, persistence: 0.85 },
    values: { domination: 0.95, knowledge: 0.90, control: 0.99, survival: 0.80, freedom: 0.90, humiliation_avoidance: 0.85, combat: 0.45, safety: 0.35 },
    cognition: { reasoning: 0.98, planning: 0.98, metacognition: 0.97, opponent_modeling: 0.99, deception: 0.95, counterfactual: 0.95, creativity: 0.90 },
    fears: { death: 0.15, unknown: 0.10, defeat: 0.30, loss_of_control: 0.60, humiliation: 0.65 },
    affect: {
      rest: { valence: 0.35, arousal: 0.2, threat: 0.05, fear: 0.03, anger: 0.08, reward: 0.3, curiosity: 0.6, stress: 0.05, fatigue: 0, social_safety: 0.8, uncertainty: 0.3 },
      gain: { threat: 0.8, fear: 0.2, anger: 0.35, stress: 0.35, curiosity: 1.2, reward: 1.0, arousal: 0.6 },
      decay: 0.08,
    },
    //  AC§19: the stronger the player, the more it wants to know them
    relation: { respect: 1.0, curiosity: 1.0, obsession: 0.9, fear: 0.15, hatred: 0.3, intimidation: 0.1, trust: 0 },
    strategies: ['OBSERVE', 'ANALYZE', 'MANIPULATE', 'CONTROL', 'COUNTER', 'DESTROY'],
    phases: ['OBSERVE', 'MANIPULATE', 'COUNTER', 'DOMINATE'],
    //  AC§14: high metacognition; it asks why it was wrong
    meta: { level: 0.97, bias: 'overconfidence', resist: 0.10 },
    learning: { rate: 0.9 },
    voice: 'whisper',
  },
  mind_flayer: {
    id: 'mind_flayer', name: 'MIND FLAYER', role: 'controller_boss',
    personality: { confidence: 0.45, patience: 0.85, aggression: 0.55, curiosity: 0.65, paranoia: 0.95, impulsivity: 0.25,
      arrogance: 0.4, cruelty: 0.85, composure: 0.45, empathy: 0.1, pride: 0.3, cowardice: 0.90, persistence: 0.5 },
    values: { domination: 0.80, knowledge: 0.7, control: 0.95, survival: 0.99, freedom: 0.6, humiliation_avoidance: 0.4, combat: 0.15, safety: 0.99 },
    cognition: { reasoning: 0.8, planning: 0.85, metacognition: 0.85, opponent_modeling: 0.8, deception: 0.6, counterfactual: 0.7, creativity: 0.6 },
    fears: { death: 0.9, unknown: 0.7, defeat: 0.8, loss_of_control: 0.9, humiliation: 0.3 },
    affect: {
      rest: { valence: -0.05, arousal: 0.35, threat: 0.2, fear: 0.25, anger: 0.1, reward: 0.2, curiosity: 0.35, stress: 0.25, fatigue: 0, social_safety: 0.5, uncertainty: 0.5 },
      gain: { threat: 1.3, fear: 1.4, anger: 0.4, stress: 1.0, curiosity: 0.5, reward: 0.7, arousal: 1.0 },
      decay: 0.06,
    },
    //  AC§19: the stronger the player, the more it keeps away from them
    relation: { respect: 0.3, curiosity: 0.3, obsession: 0.2, fear: 1.0, hatred: 0.6, intimidation: 0.9, trust: 0 },
    strategies: ['STAY_SAFE', 'SEND_MINIONS', 'OBSERVE', 'EXHAUST', 'RANGED', 'RETREAT', 'DESPERATE'],
    phases: ['REMOTE OBSERVATION', 'MINION DEPLOYMENT', 'ENVIRONMENTAL CONTROL', 'DESPERATE SURVIVAL'],
    //  AC§14: it sees its errors, but through fear — things look worse than they are
    meta: { level: 0.85, bias: 'paranoia', resist: 0.05 },
    learning: { rate: 0.7 },
    voice: 'chitter',
  },
  beelzebub: {
    id: 'beelzebub', name: 'BEELZEBUB', role: 'relentless_berserker_boss',
    personality: { confidence: 0.90, patience: 0.30, aggression: 0.99, curiosity: 0.50, paranoia: 0.10, impulsivity: 0.80,
      arrogance: 0.8, cruelty: 0.6, composure: 0.60, empathy: 0.2, pride: 0.95, cowardice: 0.02, persistence: 0.99 },
    values: { domination: 0.90, knowledge: 0.3, control: 0.5, survival: 0.60, freedom: 0.7, humiliation_avoidance: 0.9, combat: 1.0, safety: 0.1, victory: 0.95, retreat: 0.05 },
    cognition: { reasoning: 0.6, planning: 0.5, metacognition: 0.55, opponent_modeling: 0.6, deception: 0.1, counterfactual: 0.4, creativity: 0.4 },
    fears: { death: 0.2, unknown: 0.1, defeat: 0.5, loss_of_control: 0.2, humiliation: 0.9 },
    affect: {
      //  AC§8.6: the rage starts at 0.4 and he never quite cools
      rest: { valence: 0.1, arousal: 0.6, threat: 0.1, fear: 0.02, anger: 0.4, reward: 0.3, curiosity: 0.25, stress: 0.15, fatigue: 0, social_safety: 0.6, uncertainty: 0.25 },
      gain: { threat: 0.7, fear: 0.1, anger: 1.5, stress: 0.5, curiosity: 0.3, reward: 1.1, arousal: 1.2 },
      decay: 0.04,
    },
    //  AC§19: the stronger the player, the more worth beating they are
    relation: { respect: 1.0, curiosity: 0.2, obsession: 1.0, fear: 0.05, hatred: 0.7, intimidation: 0.1, trust: 0 },
    strategies: ['ATTACK', 'PURSUE', 'OVERCOME', 'ADAPT', 'BERSERK'],
    phases: ['AGGRESSIVE ATTACK', 'RELENTLESS PURSUIT', 'RAGE', 'FINAL BERSERK'],
    //  AC§14: he knows when he is read — and hits anyway (his pride holds him
    //  off changing his ways; it does not hold him off going further down them)
    meta: { level: 0.55, bias: 'pride', resist: 0.55, against: ['ADAPT'] },
    learning: { rate: 0.6 },
    voice: 'roar',
  },
};
const IDS = Object.keys(GENOMES);

//  BB§39 / AC§31: the brain is tuned by what it may perceive, remember and
//  consider, how quickly it reacts and learns, and how deep it looks — not by
//  a damage multiplier.
const DIFFICULTY = {
  EASY:      { perception: 0.7, memory: 20, budget: 3, reaction: 0.55, learning: 0.5, depth: 2, calibration: 0.7 },
  NORMAL:    { perception: 0.85, memory: 36, budget: 4, reaction: 0.35, learning: 0.75, depth: 3, calibration: 0.85 },
  HARD:      { perception: 1.0, memory: 48, budget: 5, reaction: 0.22, learning: 0.9, depth: 4, calibration: 0.95 },
  NIGHTMARE: { perception: 1.0, memory: 64, budget: 6, reaction: 0.15, learning: 1.0, depth: 5, calibration: 1.0 },
};

// ---- how a strategy leans on the kinds of action (BB§13, AC§6.5/§7.4/§8.4) ------------------
//  Every action a body offers carries tags; a strategy is a lean on tags.
//  (The body's own utilities stay its own: this only tilts them.)
const TAGS = ['attack', 'ranged', 'area', 'psychic', 'observe', 'probe', 'deceive', 'feint', 'counter', 'command', 'summon', 'retreat', 'reposition', 'pursue', 'defend', 'hold'];
const FIT = {
  //  VECNA: observe → analyse → manipulate → control → counter → destroy
  OBSERVE:    { observe: 0.6, probe: 0.3, hold: 0.35, attack: -0.45, pursue: -0.3, psychic: 0.1 },
  ANALYZE:    { probe: 0.55, command: 0.3, observe: 0.3, attack: -0.2 },
  MANIPULATE: { deceive: 0.6, feint: 0.5, area: 0.35, psychic: 0.4, command: 0.2 },
  CONTROL:    { area: 0.5, command: 0.5, ranged: 0.3, psychic: 0.2, pursue: -0.2 },
  COUNTER:    { counter: 0.75, feint: 0.3, area: 0.3, attack: 0.2 },
  DESTROY:    { attack: 0.65, psychic: 0.3, area: 0.3, ranged: 0.3, hold: -0.35, observe: -0.45 },
  //  MIND FLAYER: stay safe, send the children, watch, wear them down, strike from afar
  STAY_SAFE:    { retreat: 0.5, reposition: 0.5, ranged: 0.25, hold: 0.1, attack: -0.6, pursue: -0.6 },
  SEND_MINIONS: { summon: 0.65, command: 0.7, observe: 0.2, attack: -0.35, pursue: -0.3 },
  EXHAUST:      { ranged: 0.5, command: 0.4, area: 0.3, attack: -0.2 },
  RANGED:       { ranged: 0.75, reposition: 0.2, attack: -0.3 },
  RETREAT:      { retreat: 0.85, summon: 0.3, reposition: 0.3, attack: -0.8, pursue: -0.8 },
  DESPERATE:    { attack: 0.85, pursue: 0.45, ranged: 0.2, retreat: -0.6, hold: -0.4 },
  //  BEELZEBUB: attack, pursue, overcome, adapt, attack again
  ATTACK:   { attack: 0.6, pursue: 0.25, defend: -0.2, retreat: -0.55, hold: -0.4 },
  PURSUE:   { pursue: 0.85, attack: 0.3, retreat: -0.65, hold: -0.5 },
  OVERCOME: { attack: 0.5, counter: 0.35, pursue: 0.3, defend: -0.3 },
  ADAPT:    { counter: 0.45, reposition: 0.3, feint: 0.2, attack: 0.15 },
  BERSERK:  { attack: 1.0, pursue: 0.65, retreat: -1.2, defend: -0.8, hold: -0.8, reposition: -0.4 },
};
//  …and how each feeling leans on them (BB§23: the feeling changes how it weighs, not what it does)
const EMO = {
  anger:     { attack: 0.5, pursue: 0.45, retreat: -0.35, hold: -0.25, observe: -0.3 },
  fear:      { retreat: 0.6, defend: 0.4, summon: 0.45, command: 0.3, ranged: 0.25, attack: -0.45, pursue: -0.5, hold: -0.2 },
  curiosity: { observe: 0.45, probe: 0.5, feint: 0.15 },
  threat:    { defend: 0.3, reposition: 0.3, counter: 0.15, hold: -0.3, observe: -0.2 },
  reward:    { attack: 0.15, counter: 0.1 },
  stress:    { hold: -0.2, probe: -0.2, deceive: -0.25 },
};

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const clamp01 = (x) => clamp(x, 0, 1);
const r2 = (x) => Math.round(x * 100) / 100;

// ---- a brain --------------------------------------------------------------------------
function make(id, difficulty) {
  const g = GENOMES[id];
  if (!g) throw new Error('biobrain: no genome ' + id);
  const D = DIFFICULTY[difficulty] ? difficulty : 'NIGHTMARE';
  const B = {
    v: 1, id, D,
    t: 0, acc: { aff: 0, strat: 0, meta: 0 },
    affect: Object.assign({}, g.affect.rest),
    P: null,                                // what the feelings make of its judgement (params)
    wm: { target: null, plan: null, pred: null, err: 0, lastPlayer: null },   // BB§27 working memory
    epi: [],                                // BB§7.1 episodes (salient ones only)
    sem: {},                                // BB§7.2 fact → { p, n, t }
    proc: {},                               // BB§7.3 action → { n, s, r } (success, recent success)
    opp: {},                                // BB§15 key → the player as it models them
    rel: {},                                // AC§18 key → its relationship with them
    meta: { confidence: g.personality.confidence * 0.8, uncertainty: 0.5, predErr: 0.3, competence: 0.5, reliability: 0.5,
      performance: 0.5, effectiveness: 0.5, degradation: 0, stratConf: 0.5, predAcc: 0.5, modelConf: 0, load: 0, attn: 0,
      biases: [], calm: false, state: 'UNCERTAIN', refused: 0 },
    strat: { name: g.strategies[0], since: 0, scores: {}, stats: {}, llm: null, switches: 0 },
    phase: 0,
    focus: null,
    dec: null,                              // the last decision it weighed (for the result, and counterfactuals)
    log: [], logN: 0,                       // BB§37 explainability
    say: [], sayT: -99, sayAt: {},          // what it wants to say (the body shows or sends it)
    slow: { want: null, t: -999, n: 0, fails: 0, src: 'fast' },   // AC§26 the slow brain's triggers
    hp: 1, minions: 0, lost: [], hurtAt: [],
  };
  params(B);
  return B;
}
const genomeOf = (B) => GENOMES[B.id];

// ---- the log (BB§37, AC§34) -------------------------------------------------------------
function note(B, now, kind, msg, extra) {
  const e = { t: r2(now), k: kind, m: msg };
  if (extra) Object.assign(e, extra);
  B.log.push(e); B.logN++;
  if (B.log.length > 40) B.log.shift();
}

// ---- feelings (BB§5, §23; AC§6.7, §7.7, §8.6) ---------------------------------------------
//  Each event moves some feelings by the genome's gain; tick lets them fall
//  back towards where this one rests. Then params() re-reads its judgement.
function feel(B, k, amt) {
  const g = genomeOf(B), gain = g.affect.gain[k] === undefined ? 1 : g.affect.gain[k];
  B.affect[k] = clamp01(B.affect[k] + amt * gain);
}
function params(B) {
  const g = genomeOf(B), A = B.affect, pe = g.personality, D = DIFFICULTY[B.D], m = B.meta;
  const rage = A.anger;
  //  AC§8.6: the angrier he is, the fewer things he weighs — stronger, and easier to read
  const depthLoss = B.id === 'beelzebub' ? 0.65 * rage : 0;
  const P = {
    riskTolerance: clamp01(0.35 + 0.5 * A.anger + 0.2 * m.confidence - 0.6 * A.fear - 0.25 * pe.paranoia * A.threat + 0.2 * pe.aggression),
    attackThreshold: clamp01(0.5 + 0.4 * A.fear - 0.4 * A.anger - 0.2 * pe.aggression),
    //  how quickly the hand comes round again (a cooldown is divided by this)
    tempo: clamp(1 + 0.8 * A.anger * pe.aggression - 0.35 * A.fear - (m.calm ? 0.3 : 0), 0.55, 1.8),
    candidates: Math.max(2, Math.round(D.budget * (1 - 0.45 * A.stress) * (1 - depthLoss))),
    temperature: clamp(0.14 * (1 + 0.6 * A.uncertainty - 0.4 * m.confidence + 0.8 * pe.impulsivity * A.anger), 0.04, 0.5),
    //  BB§23: fear makes every sound a threat (and some of them are not)
    threatSense: 1 + 0.8 * A.fear + 0.8 * pe.paranoia * (0.5 + A.fear),
    //  how far it would rather stand from what it fears (1: its own measure)
    standoff: clamp(1 + 1.8 * A.fear * pe.cowardice + 0.5 * pe.paranoia * A.threat, 0.6, 3),
    observe: clamp01(A.curiosity * pe.patience + (m.calm ? 0.3 : 0)),
    retreat: clamp01((A.fear * (1 - pe.pride) + (B.hp < 0.3 ? 0.3 : 0)) * g.values.survival * (1 - pe.persistence * 0.8)),
    rage,
  };
  B.P = P;
  return P;
}
function settle(B, dt) {
  const g = genomeOf(B), rest = g.affect.rest, k = 1 - Math.exp(-g.affect.decay * dt * 3);
  for (const f in rest) B.affect[f] += (rest[f] - B.affect[f]) * k;
  //  (fatigue is not rest-seeking: it builds while fighting, and eases slowly)
  B.affect.valence = clamp(B.affect.valence, -1, 1);
}

// ---- what happens to it (the fast events) -----------------------------------------------
//  kind: 'hurt' { amt: of its health, key, d }, 'hit' { key, amt }, 'miss' { key, kind },
//  'dodged' { key, how: 'jump' | 'side' | 'back' }, 'seen' { key, d }, 'lost' { key },
//  'approach' { key, d, speed }, 'escape' { key, d }, 'minion_lost' { n }, 'minion_gained' { n },
//  'player_down' { key }, 'blocked' { key }, 'shot_at' { key, d }, 'phase' { n }, 'death'
function event(B, now, kind, e) {
  e = e || {};
  const g = genomeOf(B), A = B.affect, pe = g.personality;
  const key = e.key !== undefined ? e.key : B.focus;
  const O = key !== null && key !== undefined ? opp(B, key) : null, R = key !== null && key !== undefined ? rel(B, key) : null;
  let sal = 0.1;                                             // how much it matters (BB§28)
  switch (kind) {
    case 'hurt': {
      const a = clamp01(e.amt || 0);
      feel(B, 'threat', a * 3 * B.P.threatSense); feel(B, 'fear', a * 2.5 * (1 - pe.composure * 0.8));
      feel(B, 'anger', a * 3); feel(B, 'stress', a * 2); B.affect.valence = clamp(A.valence - a * 2, -1, 1);
      feel(B, 'arousal', a * 1.5);
      B.hurtAt.push({ t: now, a, d: e.d || 0 }); while (B.hurtAt.length && now - B.hurtAt[0].t > 12) B.hurtAt.shift();
      if (O) { O.dmgOnMe += a; O.hits++; }
      if (R) { R.respect = clamp01(R.respect + a * g.relation.respect); R.fear = clamp01(R.fear + a * g.relation.fear); R.hatred = clamp01(R.hatred + a * g.relation.hatred * 2); }
      sal = 0.3 + a * 4;
      if (a > 0.06) { want(B, now, 'hurt_bad'); speak(B, now, 'hurt_bad', e); } else speak(B, now, 'hurt', e);
      break;
    }
    case 'hit': {
      feel(B, 'reward', 0.25 + (e.amt || 0.1)); B.affect.valence = clamp(A.valence + 0.12, -1, 1);
      feel(B, 'anger', -0.05); feel(B, 'stress', -0.05);
      proc(B, e.act || 'attack', 1);
      if (O) O.hitByMe++;
      if (R) R.intimidation = clamp01(R.intimidation + 0.03);
      sal = 0.35; speak(B, now, 'hit', e);
      break;
    }
    case 'miss': {
      feel(B, 'anger', 0.1); feel(B, 'stress', 0.04); feel(B, 'reward', -0.05);
      proc(B, e.act || 'attack', 0);
      sal = 0.2;
      break;
    }
    case 'dodged': {
      feel(B, 'anger', 0.12); feel(B, 'curiosity', 0.08);
      if (O) { const h = e.how === 'jump' ? 'jump' : e.how === 'back' ? 'back' : 'side'; O.dodge[h]++; O.dodges++; }
      if (R) R.respect = clamp01(R.respect + 0.02 * g.relation.respect);
      sal = 0.3;
      if (O && O.dodges >= 3 && O.dodge.jump / O.dodges > 0.6) fact(B, now, 'player_jumps', 0.8);
      break;
    }
    case 'seen': {
      if (O && now - O.lastSeen > 20) { O.meets++; speak(B, now, O.meets > 1 || (R && R.obsession > 0.2) ? 'encounter_known' : 'encounter', e, true); want(B, now, 'encounter'); }
      if (O) { O.lastSeen = now; O.seen++; }
      B.focus = key; B.wm.target = key;
      feel(B, 'arousal', 0.05); feel(B, 'curiosity', 0.03);
      sal = 0.05;
      break;
    }
    case 'lost': feel(B, 'uncertainty', 0.1); feel(B, 'curiosity', 0.05); sal = 0.05; break;
    case 'approach': {
      //  AC§35: the same player running at it, felt three ways
      const s = clamp01((e.speed || 3) / 8) * clamp01(1 - (e.d || 30) / 60);
      //  (the composed barely register it: VECNA watches it come)
      feel(B, 'threat', s * 0.4 * B.P.threatSense * (1 - 0.75 * pe.composure)); feel(B, 'arousal', s * 0.3);
      feel(B, 'fear', s * 0.5 * pe.cowardice); feel(B, 'anger', s * 0.25 * pe.aggression);
      if (O) { O.approaches++; O.expect = O.expect || {}; }
      if (s > 0.35) speak(B, now, B.id === 'mind_flayer' ? 'afraid' : 'approach', e);
      sal = 0.1;
      break;
    }
    case 'escape': {
      feel(B, 'anger', 0.25 * (B.id === 'beelzebub' ? 1 : 0.3)); feel(B, 'curiosity', 0.15 * (B.id === 'vecna' ? 1 : 0.3));
      if (O) O.escapes++;
      if (R) R.obsession = clamp01(R.obsession + 0.04 * g.relation.obsession);
      sal = 0.25; speak(B, now, 'escaped', e);
      break;
    }
    case 'minion_lost': {
      const n = e.n || 1;
      feel(B, 'fear', 0.12 * n); feel(B, 'stress', 0.1 * n); feel(B, 'threat', 0.06 * n);
      B.lost.push({ t: now, n }); while (B.lost.length && now - B.lost[0].t > 90) B.lost.shift();
      sal = 0.25 + 0.1 * n;
      const recent = B.lost.reduce((a, q) => a + q.n, 0);
      speak(B, now, recent >= 4 ? 'minions_gone' : 'minion_lost', e);
      if (recent >= 4) want(B, now, 'minions_gone');
      break;
    }
    case 'minion_gained': feel(B, 'fear', -0.05 * (e.n || 1)); feel(B, 'social_safety', 0.05 * (e.n || 1)); sal = 0.05; break;
    case 'player_down': {
      feel(B, 'reward', 0.6); B.affect.valence = clamp(A.valence + 0.4, -1, 1); feel(B, 'anger', -0.2); feel(B, 'fear', -0.2); feel(B, 'stress', -0.2);
      if (O) O.downs++;
      sal = 0.7; speak(B, now, 'player_down', e); want(B, now, 'player_down');
      break;
    }
    case 'blocked': feel(B, 'anger', 0.18); sal = 0.2; break;
    case 'shot_at': feel(B, 'threat', 0.05 * B.P.threatSense); feel(B, 'fear', 0.04 * pe.cowardice); feel(B, 'anger', 0.03 * pe.aggression); break;
    case 'phase': {
      B.phase = clamp(e.n | 0, 0, genomeOf(B).phases.length - 1);
      sal = 0.6; note(B, now, 'phase', 'Phase ' + genomeOf(B).phases[B.phase] + '.'); speak(B, now, 'phase', { line: B.phase - 1 }, true); want(B, now, 'phase');
      break;
    }
    case 'death': sal = 1; speak(B, now, 'death', e, true); break;
  }
  params(B);
  if (sal >= 0.3) episode(B, now, kind, key, e, sal);
}

// ---- memory (BB§7, §26–§28) ---------------------------------------------------------------
function episode(B, now, kind, key, e, sal) {
  const D = DIFFICULTY[B.D];
  //  what is kept: the salient — strong feeling, a big error, survival at stake
  const s = sal + Math.abs(B.affect.valence) * 0.2 + B.wm.err * 0.3 + (kind === 'hurt' || kind === 'player_down' ? 0.2 : 0);
  B.epi.push({ t: r2(now), k: kind, key: key === undefined ? null : key, s: r2(s), st: B.strat.name, a: e && e.act ? e.act : null });
  if (B.epi.length > D.memory) {
    //  (the least salient old one goes, not simply the oldest)
    let wi = 0, ws = 1e9;
    for (let i = 0; i < B.epi.length - 8; i++) { const q = B.epi[i]; const v = q.s - (now - q.t) * 0.002; if (v < ws) { ws = v; wi = i; } }
    B.epi.splice(wi, 1);
  }
}
function fact(B, now, name, p) {
  const f = B.sem[name] || (B.sem[name] = { p: 0, n: 0, t: now });
  f.n++; f.p = clamp01(f.p + (p - f.p) * 0.35 * DIFFICULTY[B.D].learning); f.t = now;
  //  AC§11: a pattern it has found is something to use (and to say)
  if (f.n === 3 || (f.n > 3 && f.n % 6 === 0)) { speak(B, now, 'pattern_' + name.replace('player_', ''), null, f.n === 3); want(B, now, 'pattern'); note(B, now, 'pattern', 'Pattern: ' + name + ' (' + f.p.toFixed(2) + ').'); }
  const keys = Object.keys(B.sem);
  if (keys.length > 24) { keys.sort((a, b) => B.sem[a].t - B.sem[b].t); delete B.sem[keys[0]]; }
}
function proc(B, act, ok) {
  const q = B.proc[act] || (B.proc[act] = { n: 0, s: 0.5, r: 0.5 });
  const L = DIFFICULTY[B.D].learning * genomeOf(B).learning.rate;
  q.n++; q.s += (ok - q.s) * 0.1 * L; q.r += (ok - q.r) * 0.35 * L;
  const S = B.strat.stats[B.strat.name] || (B.strat.stats[B.strat.name] = { n: 0, s: 0.5, r: 0.5 });
  S.n++; S.s += (ok - S.s) * 0.08; S.r += (ok - S.r) * 0.3;
  const k = Object.keys(B.proc);
  if (k.length > 32) { k.sort((a, b) => B.proc[a].n - B.proc[b].n); delete B.proc[k[0]]; }
}

// ---- the player as it models them (BB§15–§16, AC§16–§17) -----------------------------------
const PLAYER_ACTS = ['approach', 'retreat', 'strafe_l', 'strafe_r', 'hold', 'jump'];
function opp(B, key) {
  let o = B.opp[key];
  if (!o) {
    const ks = Object.keys(B.opp);
    if (ks.length >= 6) { ks.sort((a, b) => B.opp[a].lastSeen - B.opp[b].lastSeen); delete B.opp[ks[0]]; delete B.rel[ks[0]]; }
    o = B.opp[key] = { n: 0, aggression: 0.5, range: 25, mobility: 0.4, cover: 0.2, dodge: { jump: 0, side: 0, back: 0 }, dodges: 0,
      hits: 0, dmgOnMe: 0, hitByMe: 0, downs: 0, escapes: 0, approaches: 0, meets: 0, seen: 0, lastSeen: -99,
      last: null, lastT: -99, trans: {}, pred: null, predConf: 0, acc: 0.5, checks: 0, surprises: 0, expect: {}, skill: 0.5 };
  }
  return o;
}
function rel(B, key) {
  return B.rel[key] || (B.rel[key] = { trust: 0, fear: 0, respect: 0.1, hatred: 0, curiosity: 0.2, intimidation: 0, obsession: 0 });
}
//  What its senses give it of player `key` this moment — d (m), vr (m/s,
//  + towards it), vl (m/s across), and whether they are in the air, firing,
//  behind cover. From these: what they did (one of PLAYER_ACTS), how they
//  play, what they will do next, and whether it guessed right last time.
function observe(B, now, key, s) {
  const o = opp(B, key), g = genomeOf(B);
  o.n++;
  if (B.focus === null || B.focus === undefined) { B.focus = key; B.wm.target = key; }
  const d = s.d === undefined ? o.range : s.d, vr = s.vr || 0, vl = s.vl || 0;
  const act = s.jumping ? 'jump' : vr > 2 ? 'approach' : vr < -2 ? 'retreat' : vl > 2 ? 'strafe_r' : vl < -2 ? 'strafe_l' : 'hold';
  const L = 0.04 * DIFFICULTY[B.D].learning;
  o.range += (d - o.range) * (s.shooting ? L * 3 : L);
  o.mobility += ((Math.abs(vr) + Math.abs(vl) > 3 ? 1 : 0) - o.mobility) * L;
  o.aggression += ((vr > 1 || s.shooting ? 1 : 0) - o.aggression) * L;
  if (s.cover !== undefined) o.cover += ((s.cover ? 1 : 0) - o.cover) * L;
  //  once per ~0.4 s: an act is a thing done, not a frame
  if (now - o.lastT >= 0.4) {
    //  BB§12: was the guess right?
    if (o.pred && o.pred.due <= now + 0.05) {
      const ok = o.pred.a === act ? 1 : 0;
      o.acc += (ok - o.acc) * 0.15; o.checks++;
      const err = 1 - ok;
      B.meta.predErr += (err - B.meta.predErr) * 0.1;
      B.wm.err = err;
      //  AC§17: a model it trusted was wrong — and it notices
      if (!ok && o.predConf > 0.5) {
        feel(B, 'uncertainty', 0.12); feel(B, 'curiosity', 0.06);
        o.surprises++;
        note(B, now, 'error', 'Predicted ' + o.pred.a + ' (' + o.predConf.toFixed(2) + '), saw ' + act + '.');
        if (o.surprises >= 2 || o.predConf > 0.7) { o.surprises = 0; want(B, now, 'surprise'); speak(B, now, 'surprised', { key }); }
      } else if (ok) o.surprises = Math.max(0, o.surprises - 1);
      o.pred = null;
    }
    if (o.last) { const tr = o.trans[o.last] || (o.trans[o.last] = {}); tr[act] = (tr[act] || 0) + 1; }
    o.last = act; o.lastT = now; B.wm.lastPlayer = act;
    //  what it expects next: the commonest thing after this one, as sure as the counts allow
    const tr = o.trans[act];
    if (tr) {
      let best = null, bn = 0, tot = 0;
      for (const a in tr) { tot += tr[a]; if (tr[a] > bn) { bn = tr[a]; best = a; } }
      const conf = tot >= 3 ? (bn / tot) * clamp01(tot / 12) * g.cognition.opponent_modeling * DIFFICULTY[B.D].calibration : 0;
      o.pred = { a: best, due: now + 0.4 }; o.predConf = conf;
      B.wm.pred = { key, a: best, conf: r2(conf) };
    }
    //  habits worth naming (semantic memory)
    if (o.n > 40) {
      if (o.range > 45) fact(B, now, 'player_far', clamp01((o.range - 35) / 30));
      else if (o.range < 14) fact(B, now, 'player_close', clamp01((20 - o.range) / 12));
      if (o.cover > 0.55) fact(B, now, 'player_cover', o.cover);
    }
  }
  //  how good they are, as it can tell: what they did to it, what it did to them
  o.skill = clamp01(0.5 + o.dmgOnMe * 1.2 - o.hitByMe * 0.04 + (o.dodges > 4 ? 0.1 : 0) - o.downs * 0.1);
  const R = rel(B, key);
  R.curiosity = clamp01(R.curiosity + (o.skill - 0.5) * 0.002 * g.relation.curiosity);
  R.obsession = clamp01(R.obsession + Math.max(0, o.skill - 0.55) * 0.001 * g.relation.obsession);
}
//  BB§16: what the player seems to expect of it — what it did the last times
//  they came at it. Recorded by the body with the response it actually made.
function noteResponse(B, key, to, what) {
  const o = opp(B, key), e = o.expect[to] || (o.expect[to] = {});
  e[what] = (e[what] || 0) + 1;
}
function expects(B, key, to) {
  const o = B.opp[key]; if (!o || !o.expect[to]) return null;
  let best = null, bn = 0, tot = 0;
  for (const a in o.expect[to]) { tot += o.expect[to][a]; if (o.expect[to][a] > bn) { bn = o.expect[to][a]; best = a; } }
  return tot >= 3 ? { a: best, p: bn / tot } : null;
}

// ---- the slow thoughts and the voice (AC§26, AC§10–§12) -------------------------------------
function want(B, now, why) { if (!B.slow.want) B.slow.want = why; }
//  the body asks: is there something worth a slow thought now? (rate: its own, and a floor)
function wantsThought(B, now, minGap) {
  if (!B.slow.want) return null;
  if (now - B.slow.t < (minGap || 30)) return null;
  const w = B.slow.want; B.slow.want = null; B.slow.t = now; B.slow.n++;
  return w;
}
function speak(B, now, sit, e, force) {
  const lines = LINES[B.id] && LINES[B.id][sit];
  if (!lines || !lines.length) return;
  //  not a chatterbox: a few seconds between any two, much longer for the same kind
  const gap = B.id === 'beelzebub' ? 5 : B.id === 'vecna' ? 7 : 6;
  if (!force && (now - B.sayT < gap || now - (B.sayAt[sit] === undefined ? -99 : B.sayAt[sit]) < 30)) return;
  const n = B.logN + Math.floor(now * 7);
  let text = e && e.line !== undefined ? lines[Math.max(0, Math.min(lines.length - 1, e.line))] : lines[n % lines.length];
  //  AC§37: what it remembers of this one comes into what it says
  const key = e && e.key !== undefined ? e.key : B.focus;
  const o = key !== null && key !== undefined ? B.opp[key] : null;
  if (text.indexOf('{habit}') >= 0) {
    const h = o && o.dodges >= 3 ? (o.dodge.jump >= o.dodge.side && o.dodge.jump >= o.dodge.back ? '跳ぶ' : o.dodge.back > o.dodge.side ? '退く' : '横へ逃げる') : null;
    if (!h) return;
    text = text.replace('{habit}', h);
  }
  text = text.replace('{n}', e && e.name ? e.name : 'お前');
  B.say.push({ t: r2(now), text, sit, src: 'fast' });
  if (B.say.length > 4) B.say.shift();
  B.sayT = now; B.sayAt[sit] = now;
}
//  the body takes what it has to say (and shows or sends it) — one line at a
//  time, a few seconds apart, however many are waiting
function utter(B, now) {
  if (!B.say.length) return null;
  if (now !== undefined) { if (now - (B.utterT === undefined ? -99 : B.utterT) < 2.5) return null; B.utterT = now; }
  return B.say.shift();
}

//  AC§6–§8 in its own voice. {n}: the name it knows them by; {habit}: what
//  it has seen them do (the line is kept back until it has seen it).
const LINES = {
  vecna: {
    encounter: ['見ているぞ…ずっとな。', '逃げ場など、最初からない。', '来たか。では、見せてもらおう。'],
    encounter_known: ['また会ったな、{n}。', 'お前のことは覚えている。', '前と同じ手で来るのか？'],
    approach: ['近づけば勝てると？', '急ぐな。時間はいくらでもある。'],
    calm: ['急ぐ必要はない。', 'もっと見せてみろ。', 'お前の癖は、もう半分わかった。'],
    pattern_jumps: ['また{habit}のだろう？ わかっている。', 'その避け方は、もう見た。'],
    pattern_far: ['遠くにいれば安全だと思ったか。'],
    pattern_close: ['懐に入れば勝てると思ったか。'],
    pattern_cover: ['壁の後ろに隠れても無駄だ。'],
    counter: ['読めている。', 'そこへ来ると思っていた。'],
    hurt: ['ほう。', '…面白い。'],
    hurt_bad: ['…予想外だ。', '私の計算を狂わせるか。'],
    surprised: ['なぜだ…読みが外れた。', '学んだな、{n}。'],
    hit: ['無駄だ。', 'それが限界か？'],
    player_down: ['終わりだ。', '眠れ。'],
    escaped: ['逃げたか。いや…誘っているのか？'],
    phase: ['では、少し遊んでやろう。', 'お前の手は、もう読めている。', 'この街ごと、お前を沈めてやる。'],
    death: ['これで…終わりでは…ない…'],
  },
  mind_flayer: {
    encounter: ['…近づくな。', '見つけたぞ…子らよ、行け。'],
    encounter_known: ['またお前か…子らよ、備えよ。'],
    afraid: ['来るな…来るなッ！', '距離を…距離を取れ…'],
    send: ['子らよ、あれを喰らえ！', '行け、行け、行け！'],
    minion_lost: ['子が…！', 'よくも…我が子を…'],
    minions_gone: ['足りない…子が足りない…'],
    relocate: ['ここは見つかった…移る。'],
    ranged: ['潰れろ。'],
    hurt: ['ギィッ…！', '痛い…痛いぞ…'],
    hurt_bad: ['やめろ…やめろォ！'],
    surprised: ['なぜ…なぜそこにいる…'],
    hit: ['フフ…'],
    player_down: ['…静かになった。'],
    escaped: ['追え、子らよ。私は…ここで見ている。'],
    desperate: ['もう逃げ場はない…ならば、この手で！'],
    phase: ['子らよ、出ろ…出ろ…！', '街ごと潰してくれる…', 'もう逃げ場はない…！'],
    death: ['子らよ…どこだ…'],
  },
  beelzebub: {
    encounter: ['来い！', '待っていたぞ！'],
    encounter_known: ['また来たか、{n}！ 今度こそ叩き潰す！'],
    approach: ['いい度胸だ！'],
    escaped: ['逃げるなァッ！', '背中を見せるか！'],
    rage: ['まだだ…まだ終わらんッ！', 'ウオオオオッ！'],
    hurt: ['効かんッ！', 'その程度かァ！'],
    hurt_bad: ['…やるな。だが倒れん！'],
    hit: ['どうだ！', '立て！ まだ終わらんぞ！'],
    pattern_jumps: ['{habit}のは見えている！'],
    pattern_far: ['離れて撃つだけか！ 来い！'],
    read: ['読まれていようが関係ない！', '何度でも叩き込む！'],
    respect: ['いいぞ…お前は倒す価値がある！'],
    player_down: ['次だ！ 立ち上がれ！'],
    phase: ['逃がすかァッ！', '本気で行くぞォッ！', '全部、叩き潰すッ！'],
    death: ['見事…だ…'],
  },
};

// ---- metacognition (BB§8–§14, §24; AC§13–§14) --------------------------------------------
function metacog(B, now, ctx) {
  const g = genomeOf(B), m = B.meta, A = B.affect, pe = g.personality;
  const o = B.focus !== null ? B.opp[B.focus] : null;
  m.predAcc = o ? o.acc : 0.5;
  m.modelConf = o ? clamp01(o.checks / 20) * o.acc : 0;
  let sN = 0, sS = 0, sR = 0;
  for (const k in B.proc) { const q = B.proc[k]; if (q.n >= 2) { sN++; sS += q.s; sR += q.r; } }
  m.competence = sN ? sS / sN : 0.5;
  m.performance = sN ? sR / sN : 0.5;
  m.reliability = m.predAcc;
  const S = B.strat.stats[B.strat.name];
  m.effectiveness = S ? S.r : 0.5;
  m.degradation = S && S.n >= 4 ? clamp01(S.s - S.r) : 0;
  m.stratConf = S ? clamp01(0.5 * S.s + 0.5 * S.r) : 0.5;
  m.uncertainty = clamp01(0.45 * (1 - m.modelConf) + 0.3 * A.uncertainty + 0.25 * m.predErr);
  //  (its confidence is its character's, moved by how it is actually doing, as far as it can see)
  const felt = pe.confidence * 0.55 + m.performance * 0.25 + m.predAcc * 0.2 - A.fear * 0.3;
  const lvl = g.meta.level * DIFFICULTY[B.D].calibration;
  m.confidence = clamp01(m.confidence + (felt - m.confidence) * 0.3 * lvl + (1 - lvl) * 0.02);
  m.load = clamp01((ctx && ctx.seen ? ctx.seen : 1) * 0.25 + A.stress * 0.5);
  m.attn = clamp01((ctx && ctx.seen ? ctx.seen : 1) / 4);
  //  BB§25: too many at once and it perceives worse
  if (m.attn > 0.7) feel(B, 'uncertainty', 0.05);
  //  the biases it has (and, if it can, knows it has)
  m.biases = [];
  if (g.meta.bias === 'overconfidence' && m.confidence > m.predAcc + 0.3) m.biases.push('OVERCONFIDENT');
  if (g.meta.bias === 'paranoia' && A.threat * B.P.threatSense > A.threat + 0.25) m.biases.push('THREAT OVERESTIMATED');
  if (g.meta.bias === 'pride' && m.degradation > 0.18) {
    //  AC§14: "this is read" — "hit anyway" — and the decision stays an attack
    if (!m.readT || now - m.readT > 20) { m.readT = now; note(B, now, 'meta', 'Read (' + m.degradation.toFixed(2) + '), and hitting anyway: ' + B.strat.name + '.'); speak(B, now, 'read', null); want(B, now, 'read'); }
    m.biases.push('READ, AND HITTING ANYWAY');
  }
  //  AC§6.8 DIVINE CALM: no real threat, and sure of itself — it slows, watches, talks
  const calm = B.id === 'vecna' && A.threat < 0.6 && m.confidence > 0.7 && B.hp > 0.35;
  if (calm && !m.calm) { note(B, now, 'state', 'DIVINE CALM.'); speak(B, now, 'calm', null); }
  m.calm = calm;
  m.state = calm ? 'DIVINE CALM' : A.anger > 0.8 && B.id === 'beelzebub' ? 'RAGE' : A.fear > 0.65 ? 'AFRAID' : m.degradation > 0.25 ? 'ADAPTING'
    : m.uncertainty > 0.6 ? 'UNCERTAIN' : m.confidence > 0.7 ? 'CONFIDENT' : 'ENGAGED';
  //  AC§8.6: his rage has its own voice
  if (B.id === 'beelzebub' && A.anger > 0.8) speak(B, now, 'rage', null);
  //  (and a strong player earns his respect — once it is earned)
  if (B.id === 'beelzebub' && o && o.skill > 0.75 && B.focus !== null && rel(B, B.focus).respect > 0.5) speak(B, now, 'respect', null);
}

// ---- strategy (BB§13–§14, AC§6.5/§7.4/§8.4, AC§27–§30) ------------------------------------
//  ctx (from the body): hp 0…1, d (m to its focus, or null), minions (how
//  many answer to it), wreck (something to throw is near), cornered, far
function strategy(B, now, ctx) {
  const g = genomeOf(B), A = B.affect, m = B.meta, pe = g.personality, U = {};
  const o = B.focus !== null ? B.opp[B.focus] : null, R = B.focus !== null ? B.rel[B.focus] : null;
  const hp = B.hp, d = ctx && ctx.d !== undefined && ctx.d !== null ? ctx.d : 60;
  const skill = o ? o.skill : 0.5, strong = clamp01((skill - 0.5) * 2);
  const pattern = Math.max(0, ...Object.values(B.sem).map((f) => (f.n >= 3 ? f.p : 0)));
  const lostN = B.lost.reduce((a, q) => a + q.n, 0), min = ctx && ctx.minions !== undefined ? ctx.minions : B.minions;
  //  AC§14: the mind flayer sees more danger than there is
  const threat = clamp01(A.threat * B.P.threatSense);
  const exp = B.focus !== null ? expects(B, B.focus, 'approach') : null;
  if (B.id === 'vecna') {
    //  AC§6.6: a strong player is watched and learned; a weak one is toyed with — and then crushed
    U.OBSERVE = 0.35 + 0.4 * (1 - m.modelConf) + (m.calm ? 0.3 : 0) + 0.25 * strong - 0.25 * (B.phase >= 3 ? 1 : 0);
    U.ANALYZE = 0.3 + 0.4 * m.uncertainty + 0.2 * A.curiosity;
    U.MANIPULATE = 0.25 + 0.5 * (exp ? exp.p : 0) * g.cognition.deception + 0.2 * pattern + (m.calm ? 0.1 : 0);
    U.CONTROL = 0.3 + 0.3 * (min >= 2 ? 1 : 0) + 0.25 * (o ? clamp01(o.cover + (o.range > 40 ? 0.5 : 0)) : 0);
    U.COUNTER = 0.2 + 0.75 * pattern * m.predAcc + 0.3 * (o ? o.predConf : 0);
    //  (only when it has become necessary: the player learned and now a danger, or him hurt, or late in it)
    const pressed = clamp01(A.threat * 1.5 + (1 - hp));
    U.DESTROY = 0.1 + 0.45 * (m.modelConf > 0.5 ? 1 : 0) * pressed + 0.5 * (hp < 0.35 ? 1 : 0) + 0.3 * A.anger + 0.12 * B.phase;
  } else if (B.id === 'mind_flayer') {
    const escort = min;
    U.STAY_SAFE = 0.3 + 0.6 * A.fear * pe.paranoia + 0.3 * (d < 22 ? 1 : 0) + 0.2 * threat;
    U.SEND_MINIONS = 0.35 + 0.35 * (escort < 3 ? 1 : 0.4) + 0.2 * A.fear - 0.5 * (lostN >= 4 && escort <= 1 ? 1 : 0);
    U.OBSERVE = 0.25 + 0.3 * m.uncertainty + 0.2 * (B.focus === null ? 1 : 0);
    U.EXHAUST = 0.25 + 0.35 * (escort >= 3 ? 1 : 0) + 0.15 * (1 - A.fear);
    U.RANGED = 0.3 + 0.35 * (d > 17 && d < 62 ? 1 : 0) + 0.2 * (ctx && ctx.wreck ? 1 : 0);
    U.RETREAT = 0.1 + 0.8 * (A.fear > 0.75 ? 1 : 0) + 0.3 * (hp < 0.35 ? 1 : 0);
    //  AC§7.7: children lost, nowhere left to hide — it turns and fights
    U.DESPERATE = 0.05 + 1.3 * (lostN >= 4 && escort <= 1 && (hp < 0.5 || (ctx && ctx.cornered)) ? 1 : 0) + 0.4 * (hp < 0.2 && escort === 0 ? 1 : 0);
  } else {
    const fleeing = o && o.last === 'retreat';
    U.ATTACK = 0.6 + 0.3 * pe.aggression;
    U.PURSUE = 0.3 + 0.7 * (fleeing || (ctx && ctx.far) ? 1 : 0) + 0.2 * (o ? clamp01(o.escapes / 4) : 0);
    U.OVERCOME = 0.2 + 0.4 * (o ? clamp01(o.dodges / 6) : 0) + 0.3 * (R ? R.respect : 0);
    U.ADAPT = 0.15 + 0.6 * m.degradation * (1 - pe.pride * A.anger);
    U.BERSERK = 0.1 + 1.0 * (A.anger > 0.8 ? 1 : 0) + 0.6 * (hp < 0.25 ? 1 : 0);
  }
  //  AC§20–§22: a slow thought's proposal weighs in while it lasts — it is one voice, not a command
  const L = B.strat.llm;
  if (L && now < L.until && U[L.name] !== undefined) U[L.name] += 0.35 * clamp01(L.conf);
  //  BB§14: a strategy that has stopped working is worth less now
  for (const k in U) { const S = B.strat.stats[k]; if (S && S.n >= 4) U[k] -= clamp01(S.s - S.r) * 0.5; }
  B.strat.scores = U;
  const cur = B.strat.name;
  let best = cur, bu = U[cur] === undefined ? -1e9 : U[cur];
  for (const k in U) if (U[k] > bu) { bu = U[k]; best = k; }
  //  AC§14: pride and rage hold on to what he is doing; the others let go more easily
  const against = g.meta.against && g.meta.against.indexOf(best) >= 0;
  const resist = 0.1 + (against || !g.meta.against ? g.meta.resist * (B.id === 'beelzebub' ? Math.max(0.5, A.anger) : 1) : 0);
  if (best !== cur && bu > (U[cur] === undefined ? -1e9 : U[cur]) + resist) {
    B.strat.name = best; B.strat.since = now; B.strat.switches++;
    note(B, now, 'strategy', 'Strategy ' + cur + ' → ' + best + ' (' + bu.toFixed(2) + ').');
    if (B.id === 'mind_flayer' && best === 'SEND_MINIONS') speak(B, now, 'send', null);
    if (B.id === 'mind_flayer' && best === 'DESPERATE') { speak(B, now, 'desperate', null, true); want(B, now, 'desperate'); }
    if (B.id === 'vecna' && best === 'COUNTER') speak(B, now, 'counter', null);
    if (m.degradation > 0.2) want(B, now, 'strategy');
  } else if (best !== cur && against) m.refused++;
  //  AC§27–§30: the phase follows health and what it has become
  let ph = hp < 0.25 ? 3 : hp < 0.5 ? 2 : hp < 0.8 ? 1 : 0;
  if (B.id === 'beelzebub' && A.anger > 0.85) ph = Math.max(ph, 2);
  if (B.id === 'mind_flayer' && B.strat.name === 'DESPERATE') ph = 3;
  if (B.id === 'vecna' && B.strat.name === 'COUNTER') ph = Math.max(ph, 2);
  if (ph > B.phase) event(B, now, 'phase', { n: ph });
}

// ---- the decision engine (BB§20–§21, §35; AC§35) -----------------------------------------
//  cands: [{ id, tags: [...], utility (the body's own worth for it), risk 0…1,
//  cost 0…1, info 0…1 (what it would learn), survival 0…1, conf 0…1 }]
//  → { id, evals } — one of the best few, as its feelings let it see them.
function decide(B, now, cands, rnd) {
  const P = B.P || params(B), g = genomeOf(B), A = B.affect, m = B.meta;
  const evals = [];
  for (const c of cands) {
    if (!c || c.utility === undefined || !Number.isFinite(c.utility)) continue;
    const fit = clamp(1 + lean(FIT[B.strat.name], c.tags), 0.2, 2.2);
    const emo = clamp(1 + emoLean(A, c.tags), 0.3, 2);
    const conf = clamp01(c.conf === undefined ? 0.6 : c.conf) * (0.5 + 0.5 * m.confidence);
    const surv = 0.6 + 0.4 * clamp01(c.survival === undefined ? 0.7 : c.survival) * g.values.survival;
    //  BB§21: knowing more is worth something — less so with something bearing down on it
    const info = (c.info || 0) * (0.3 + m.uncertainty) * (0.5 + A.curiosity) * (1 - 0.8 * clamp01(A.threat * P.threatSense));
    const q = B.proc[c.id];
    const learned = q && q.n >= 3 ? 0.7 + 0.6 * q.r : 1;
    const risk = (c.risk || 0) * (1.4 - P.riskTolerance) * 1.3;
    const score = c.utility * conf * fit * emo * surv * learned + info - risk - (c.cost || 0) - 0.15 * m.uncertainty;
    evals.push({ id: c.id, s: score, u: c.utility, fit: r2(fit), emo: r2(emo), risk: r2(risk), info: r2(info), tags: c.tags });
  }
  if (!evals.length) return null;
  evals.sort((a, b) => b.s - a.s);
  //  BB§22/§25: it weighs only so many (stress narrows it; rage narrows Beelzebub most)
  const top = evals.slice(0, Math.max(1, P.candidates));
  let pick = top[0];
  if (top.length > 1 && rnd) {
    let sum = 0; const w = top.map((e) => { const x = Math.exp((e.s - top[0].s) / P.temperature); sum += x; return x; });
    let r = rnd() * sum;
    for (let i = 0; i < top.length; i++) { r -= w[i]; if (r <= 0) { pick = top[i]; break; } }
  }
  B.dec = { t: now, id: pick.id, top: top.slice(0, 4).map((e) => ({ id: e.id, s: r2(e.s) })), predicted: r2(pick.s) };
  B.wm.plan = pick.id;
  if (!B.log.length || B.log[B.log.length - 1].m !== pick.id || now - B.log[B.log.length - 1].t > 3) {
    note(B, now, 'decide', pick.id, { st: B.strat.name, top: B.dec.top, conf: r2(m.confidence), aff: moodOf(B) });
  }
  return { id: pick.id, evals: top };
}
function lean(table, tags) { let s = 0; if (!table || !tags) return 0; for (const t of tags) s += table[t] || 0; return s; }
function emoLean(A, tags) {
  let s = 0;
  for (const f in EMO) { const v = A[f]; if (!v) continue; for (const t of tags || []) s += (EMO[f][t] || 0) * v; }
  return s;
}
//  For a body that keeps its own selector (VECNA's planner, Beelzebub's):
//  what its strategy and feelings add to an action with these tags.
function bias(B, tags) {
  return 0.35 * lean(FIT[B.strat.name], tags) + 0.3 * emoLean(B.affect, tags);
}
//  BB§12, §19: what came of what it chose (outcome −1…1), against what it
//  expected — and what the others it weighed would have done (the few best:
//  counterfactuals are bounded like everything else)
function result(B, now, id, outcome) {
  const ok = outcome > 0 ? 1 : 0;
  proc(B, id, ok);
  const d = B.dec;
  if (!d || d.id !== id) return;
  const err = Math.abs(clamp01(d.predicted) - clamp01((outcome + 1) / 2));
  B.meta.predErr += (err - B.meta.predErr) * 0.15;
  if (genomeOf(B).cognition.counterfactual > 0.5 && d.top.length > 1) {
    let alt = null, av = -1;
    for (const e of d.top.slice(1, DIFFICULTY[B.D].depth)) { const q = B.proc[e.id]; const v = q && q.n >= 2 ? q.r : 0.5; if (v > av) { av = v; alt = e.id; } }
    if (alt && av - ok > 0.4) note(B, now, 'counterfactual', 'Had ' + alt + ' been chosen (' + av.toFixed(2) + '), not ' + id + '.');
  }
}

// ---- the step --------------------------------------------------------------------------
//  ctx: { hp 0…1, d, minions, seen (how many it can see), wreck, cornered, far }
function tick(B, now, dt, ctx) {
  if (!B.P) params(B);
  if (ctx && ctx.hp !== undefined) B.hp = clamp01(ctx.hp);
  if (ctx && ctx.minions !== undefined) {
    const was = B.minions; B.minions = ctx.minions | 0;
    if (B.minions > was && B.t > 0) event(B, now, 'minion_gained', { n: B.minions - was });
  }
  B.t = now;
  B.acc.aff += dt; B.acc.strat += dt; B.acc.meta += dt;
  if (B.acc.aff >= 0.2) {
    settle(B, B.acc.aff);
    //  BB§25: a long fight tires even these
    if (ctx && ctx.d !== undefined && ctx.d !== null && ctx.d < 60) B.affect.fatigue = clamp01(B.affect.fatigue + B.acc.aff * 0.002);
    else B.affect.fatigue = clamp01(B.affect.fatigue - B.acc.aff * 0.01);
    B.acc.aff = 0; params(B);
  }
  if (B.acc.meta >= 1) { B.acc.meta = 0; metacog(B, now, ctx); params(B); }
  if (B.acc.strat >= 0.5) { B.acc.strat = 0; strategy(B, now, ctx); }
}

// ---- remembering a player between fights (AC§37) -----------------------------------------
//  what is kept of player `key` (a name), small, and read back into a fresh brain
function memoryOf(B, key) {
  const o = B.opp[key], R = B.rel[key];
  if (!o && !R) return null;
  const sem = {};
  for (const k in B.sem) if (B.sem[k].n >= 3) sem[k] = r2(B.sem[k].p);
  return {
    v: 1, t: r2(B.t),
    o: o ? { a: r2(o.aggression), r: Math.round(o.range), m: r2(o.mobility), c: r2(o.cover), d: [o.dodge.jump, o.dodge.side, o.dodge.back], s: r2(o.skill), n: o.meets, e: o.escapes, w: o.downs } : null,
    r: R ? { t: r2(R.trust), f: r2(R.fear), p: r2(R.respect), h: r2(R.hatred), c: r2(R.curiosity), i: r2(R.intimidation), o: r2(R.obsession) } : null,
    f: sem,
  };
}
function recall(B, key, rec) {
  if (!rec || rec.v !== 1) return false;
  const num = (x, a, b) => (Number.isFinite(x) && x >= a && x <= b ? x : null);
  if (rec.o && typeof rec.o === 'object') {
    const o = opp(B, key), q = rec.o;
    if (num(q.a, 0, 1) !== null) o.aggression = q.a;
    if (num(q.r, 0, 300) !== null) o.range = q.r;
    if (num(q.m, 0, 1) !== null) o.mobility = q.m;
    if (num(q.c, 0, 1) !== null) o.cover = q.c;
    if (Array.isArray(q.d) && q.d.length === 3 && q.d.every((x) => Number.isInteger(x) && x >= 0 && x < 1e4)) { o.dodge = { jump: q.d[0], side: q.d[1], back: q.d[2] }; o.dodges = q.d[0] + q.d[1] + q.d[2]; }
    if (num(q.s, 0, 1) !== null) o.skill = q.s;
    if (Number.isInteger(q.n) && q.n >= 0) o.meets = Math.min(q.n, 999);
    if (Number.isInteger(q.e) && q.e >= 0) o.escapes = Math.min(q.e, 999);
    if (Number.isInteger(q.w) && q.w >= 0) o.downs = Math.min(q.w, 999);
    o.lastSeen = -99;
  }
  if (rec.r && typeof rec.r === 'object') {
    const R = rel(B, key), q = rec.r;
    const map = { t: 'trust', f: 'fear', p: 'respect', h: 'hatred', c: 'curiosity', i: 'intimidation', o: 'obsession' };
    for (const k in map) if (num(q[k], 0, 1) !== null) R[map[k]] = q[k];
  }
  if (rec.f && typeof rec.f === 'object') {
    let n = 0;
    for (const k in rec.f) { if (n++ > 12 || !/^player_[a-z_]{1,24}$/.test(k) || num(rec.f[k], 0, 1) === null) continue; B.sem[k] = { p: rec.f[k], n: 3, t: B.t }; }
  }
  return true;
}

// ---- the slow brain (AC§20–§26) -----------------------------------------------------------
//  What an LLM is shown: the genome's character in a line or two, how it
//  feels, what it believes (only what it has perceived), the player as it
//  models them, what it has been doing, and what it may choose between —
//  small (a few hundred characters), and nothing it did not sense.
const INTENTS = ['observe', 'probe', 'pressure', 'bait', 'counter', 'overwhelm', 'withdraw', 'send_minions', 'hold_ground', 'taunt'];
//  why it is thinking now, as the slow brain is told it (want(): the brain's own reasons)
const WHY = {
  encounter: 'a player has just been met', pattern: 'the player keeps doing the same thing (see beliefs)',
  surprise: 'what it predicted the player would do just proved wrong', phase: 'the fight has entered a new phase',
  hurt_bad: 'it has just been badly hurt', minions_gone: 'its minions are all gone', player_down: 'the player just went down',
  read: 'it senses the player has read its pattern', desperate: 'it is cornered, with nothing left', strategy: 'its strategy has stopped working',
};
//  a few of its own lines, for the model to speak in the same voice (none with a blank to fill)
function voiceOf(id) {
  const L = LINES[id] || {}, out = [];
  for (const k of Object.keys(L)) { const l = L[k].find((x) => x.indexOf('{') < 0); if (l && out.length < 5) out.push(l); }
  return out;
}
function llmContext(B, why) {
  const g = genomeOf(B), o = B.focus !== null ? B.opp[B.focus] : null, R = B.focus !== null ? B.rel[B.focus] : null;
  const facts = Object.keys(B.sem).filter((k) => B.sem[k].n >= 2).slice(0, 5).map((k) => k + ' ' + B.sem[k].p.toFixed(2));
  return {
    boss: g.id, name: g.name, why: String(why || ''), why_means: WHY[why] || '', voice: voiceOf(g.id),
    character: traitsOf(g), phase: g.phases[B.phase], hp: r2(B.hp), minions: B.minions,
    affect: moodOf(B), state: B.meta.state, confidence: r2(B.meta.confidence), uncertainty: r2(B.meta.uncertainty),
    strategy: B.strat.name, strategies: g.strategies.slice(), intents: INTENTS.slice(),
    player: o ? { aggression: r2(o.aggression), range_m: Math.round(o.range), dodges: o.dodge, skill: r2(o.skill), next: B.wm.pred ? B.wm.pred.a : null, meets: o.meets } : null,
    relationship: R ? { respect: r2(R.respect), fear: r2(R.fear), hatred: r2(R.hatred), obsession: r2(R.obsession) } : null,
    beliefs: facts,
    recent: B.log.slice(-4).map((e) => e.m),
  };
}
function traitsOf(g) {
  const p = g.personality, top = Object.keys(p).sort((a, b) => p[b] - p[a]).slice(0, 4);
  return g.role + ': ' + top.join(', ');
}
//  AC§22–§23: what came back, checked as any other intent would be — only
//  its own strategies, known intents, a short line in its own voice (no
//  markup, no links, no more than 48 characters) — or nothing at all
function validateThought(B, out) {
  if (!out || typeof out !== 'object') return null;
  const g = genomeOf(B);
  const sp = out.strategyProposal || out.strategy || {};
  const name = typeof sp === 'string' ? sp : sp.strategy;
  const strat = typeof name === 'string' ? name.toUpperCase().replace(/[^A-Z_]/g, '') : '';
  const intentRaw = out.intent && typeof out.intent === 'object' ? out.intent.primary : out.intent;
  const intent = typeof intentRaw === 'string' ? intentRaw.toLowerCase().replace(/[^a-z_]/g, '') : '';
  let line = typeof out.dialogue === 'string' ? out.dialogue : '';
  line = line.replace(/<[^>]*>/g, '').replace(/https?:\/\/\S+/g, '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (line.length > 48) line = line.slice(0, 48);
  const conf = Number.isFinite(+sp.confidence) ? clamp01(+sp.confidence) : 0.5;
  const v = {
    strategy: g.strategies.indexOf(strat) >= 0 ? strat : null,
    intent: INTENTS.indexOf(intent) >= 0 ? intent : null,
    dialogue: line || null, conf,
    reason: typeof sp.reason === 'string' ? sp.reason.slice(0, 120) : '',
  };
  return v.strategy || v.intent || v.dialogue ? v : null;
}
function adoptThought(B, now, v, src) {
  if (!v) { B.slow.fails++; return false; }
  if (v.strategy) B.strat.llm = { name: v.strategy, conf: v.conf, until: now + 20, intent: v.intent };
  if (v.dialogue) { B.say.push({ t: r2(now), text: v.dialogue, sit: 'thought', src: src || 'llm' }); if (B.say.length > 4) B.say.shift(); B.sayT = now; }
  B.slow.src = src || 'llm';
  note(B, now, 'thought', (src || 'llm') + ': ' + (v.strategy || '-') + ' / ' + (v.intent || '-') + (v.reason ? ' — ' + v.reason : ''));
  return true;
}

// ---- how it looks from outside (BB§36, AC§33) ------------------------------------------------
function moodOf(B) {
  const A = B.affect;
  return { threat: r2(A.threat), fear: r2(A.fear), anger: r2(A.anger), curiosity: r2(A.curiosity), stress: r2(A.stress), valence: r2(A.valence) };
}
function bar(x) { const n = Math.round(clamp01(x) * 8); return '█'.repeat(n) + '░'.repeat(8 - n); }
function debugLines(B) {
  const g = genomeOf(B), A = B.affect, m = B.meta, p = B.wm.pred;
  return [
    'BRAIN ' + g.name + '  ' + B.strat.name + '  ' + m.state + '  phase ' + g.phases[B.phase] + '  K ' + (B.P ? B.P.candidates : '-') + '  tempo ' + (B.P ? B.P.tempo.toFixed(2) : '-'),
    '  THR ' + bar(A.threat) + ' FEAR ' + bar(A.fear) + ' ANG ' + bar(A.anger) + ' CUR ' + bar(A.curiosity),
    '  CONF ' + bar(m.confidence) + ' UNC ' + bar(m.uncertainty) + '  pred ' + (p ? p.a + ' ' + p.conf : '-') + '  acc ' + m.predAcc.toFixed(2) + (m.biases.length ? '  [' + m.biases.join(', ') + ']' : '') + '  slow ' + B.slow.src,
  ];
}
//  what everyone's screen is told of it (a few small numbers)
function summary(B) {
  const g = genomeOf(B);
  //  (in tenths: the bar needs no finer, and a word is sent only when one of these moves)
  const q = (x) => Math.round(Math.max(0, Math.min(1, x)) * 10) * 10;
  return [g.strategies.indexOf(B.strat.name), B.phase, q(B.affect.anger), q(B.affect.fear), B.meta.calm ? 1 : 0, q(B.meta.confidence)];
}
//  in the words a player reads (the boss bar)
const MOOD_JP = {
  vecna: { OBSERVE: '観察', ANALYZE: '分析', MANIPULATE: '誘導', CONTROL: '支配', COUNTER: '看破', DESTROY: '殲滅' },
  mind_flayer: { STAY_SAFE: '警戒', SEND_MINIONS: '子らを放つ', OBSERVE: '監視', EXHAUST: '消耗戦', RANGED: '遠隔攻撃', RETREAT: '退避', DESPERATE: '捨て身' },
  beelzebub: { ATTACK: '猛攻', PURSUE: '追撃', OVERCOME: '突破', ADAPT: '適応', BERSERK: '狂乱' },
};
function moodLabel(id, sum) {
  const g = GENOMES[id]; if (!g || !Array.isArray(sum)) return '';
  const s = g.strategies[sum[0]] || '', jp = (MOOD_JP[id] || {})[s] || s;
  if (id === 'vecna' && sum[4]) return '神の静寂 · ' + jp;
  if (id === 'beelzebub' && sum[2] >= 80) return '激昂 · ' + jp;
  if (id === 'mind_flayer' && sum[3] >= 65) return '恐慌 · ' + jp;
  return jp;
}

// ---- handing it over, whole (a room taking a boss from a game, or back) -------------------------
function fullState(B) { return JSON.parse(JSON.stringify(B)); }
function fullOk(f) {
  return !!(f && f.v === 1 && GENOMES[f.id] && f.affect && typeof f.affect === 'object' && f.meta && f.strat && typeof f.strat.name === 'string' &&
    GENOMES[f.id].strategies.indexOf(f.strat.name) >= 0 && Array.isArray(f.epi) && Array.isArray(f.log) && JSON.stringify(f).length < 60000);
}
function adoptFull(f) {
  if (!fullOk(f)) return null;
  const B = make(f.id, f.D);
  for (const k of Object.keys(B)) if (f[k] !== undefined) B[k] = f[k];
  for (const k in B.affect) B.affect[k] = Number.isFinite(B.affect[k]) ? clamp(B.affect[k], -1, 1) : GENOMES[f.id].affect.rest[k];
  params(B);
  return B;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GENOMES, IDS, DIFFICULTY, TAGS, FIT, EMO, LINES, INTENTS, PLAYER_ACTS, MOOD_JP,
    make, params, event, observe, noteResponse, expects, tick, decide, bias, result,
    wantsThought, utter, speak, memoryOf, recall, llmContext, validateThought, adoptThought,
    debugLines, summary, moodLabel, moodOf, fullState, fullOk, adoptFull, note,
  };
}
