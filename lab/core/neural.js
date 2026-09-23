'use strict';
//  ============================================================
//  NEURAL CORE  (spec §9, §10)
//  ============================================================
//
//  WorldState channels in, action scores out, and a persistent internal state
//  in between. The state is the entire point: a function of the current frame
//  is a lookup table with extra steps, and the boss this is for is supposed to
//  behave differently at the end of a fight than at the start of one.
//
//  §10 asks for activation, inhibition, excitation, decay, recurrence and
//  temporal state, and explicitly says *not* to start with a biologically
//  complete neuron. So this is a leaky rate-coded integrator: each neuron
//  holds a scalar that relaxes toward what its inputs are driving it to. It is
//  the cheapest model that still has all six properties, and every one of them
//  falls out of the graph rather than being bolted on:
//
//    excitation / inhibition   from Dale's principle — the sign is on the
//                              source neuron, folded into the CSR once
//    recurrence                from the feedback and lateral edges the
//                              generator already lays down
//    decay                     the leak term
//    temporal state            the activation vector, carried between ticks
//    modulation                a second, separate pathway: modulatory neurons
//                              do not drive their targets, they change the
//                              gain of whatever else is driving them
//
//  The dynamics live in one small function so that §10's "compare LIF or
//  Izhikevich later" stays a possibility rather than a rewrite.

const { CLASS } = require('./connectome.js');
const { makeRng } = require('./rng.js');

//  ---- the action vocabulary (spec §9) ---------------------------------
const ACTIONS = ['attack', 'dodge', 'chase', 'retreat', 'ambush',
                 'intercept', 'wait', 'reposition', 'use_skill', 'defend'];

//  ---- the sensory vocabulary ------------------------------------------
//  These are *channel names only*. The core does not know what a metre is or
//  where the player is; Phase 3 fills these in from the game and nothing in
//  this file ever reaches into the engine. That is §12's boundary, and it is
//  also what lets the whole core be tested without a game attached.
//
//  Everything is expected in 0..1. Anything outside is clamped rather than
//  trusted — a sensor bug should make the boss confused, not make it NaN.
const CHANNELS = [
  'player_distance',     // 0 = on top of us, 1 = at the edge of perception
  'player_bearing',      // 0 = behind, 0.5 = flank, 1 = dead ahead
  'player_speed',
  'player_approaching',
  'player_attacking',
  'player_visible',
  'player_noise',
  'self_health',
  'self_cooldown',
  'threat',
  'cover',               // how much cover the player currently has
  'allies_near',
  'damage_recent',
  'time_since_seen',
];

//  ======================================================================
//  NeuralCore
//  ======================================================================
class NeuralCore {
  constructor(graph, opts) {
    const o = Object.assign({
      seed: 0xbeef,
      decay: 0.72,         // how much of last tick survives into this one
      gain: 1.35,          // input drive
      modStrength: 0.85,   // how hard modulatory neurons can bend the gain
      noise: 0.0,          // exploration; Fairness (Phase 4) owns this dial
      recGain: 0.88,       // total recurrent drive per neuron; must stay under 1
      tuneWidth: 0.26,     // sensory tuning-curve width
      clamp: 6.0,
    }, opts || {});
    this.o = o;
    this.g = graph;
    this.n = graph.n;

    const rng = makeRng(o.seed);

    //  ---- state ------------------------------------------------------
    //  Allocated once. A step that allocates is a step that makes the
    //  collector run during a boss fight.
    this.act = new Float32Array(this.n);
    this.net = new Float32Array(this.n);
    this.mod = new Float32Array(this.n);
    this.bias = new Float32Array(this.n);
    //  Small, because the recurrence amplifies it. At a spectral radius of
    //  0.88 a constant offset is multiplied by roughly 1/(1-0.88), so a +/-0.06
    //  bias becomes a resting state around 0.23 and eats most of the dynamic
    //  range the senses are supposed to use. It is here to break symmetry
    //  between otherwise identical neurons, not to set the operating point.
    for (let i = 0; i < this.n; i++) this.bias[i] = (rng.next() - 0.5) * 0.04;

    //  ---- sensory binding --------------------------------------------
    //  Each sensory neuron listens to one channel with its own preferred
    //  value and gain — a population code rather than one neuron per channel.
    //
    //  This is not decoration. One neuron per channel makes "distance" a
    //  single scalar the network can only threshold; a population with
    //  tuning curves lets it represent *near*, *mid* and *far* as genuinely
    //  different patterns of activity, which is what makes distinct tactics
    //  at distinct ranges learnable at all.
    const sensory = graph.byClass(CLASS.SENSORY);
    rng.shuffle(sensory);
    this.sIdx = new Int32Array(sensory.length);
    this.sChan = new Int32Array(sensory.length);
    this.sMu = new Float32Array(sensory.length);
    this.sGain = new Float32Array(sensory.length);
    for (let i = 0; i < sensory.length; i++) {
      this.sIdx[i] = sensory[i];
      this.sChan[i] = i % CHANNELS.length;
      //  preferred values spread across the range, not clustered at random
      this.sMu[i] = ((Math.floor(i / CHANNELS.length) % 5) + 0.5) / 5;
      this.sGain[i] = 0.7 + rng.next() * 0.6;
    }

    //  ---- motor binding ----------------------------------------------
    //  Motor neurons are dealt into one pool per action. Shuffled first, so a
    //  pool is not a contiguous run of node ids — ids correlate with region
    //  and community, and a pool built from a contiguous run would be reading
    //  one corner of the graph rather than a genuine readout of it.
    const motor = graph.byClass(CLASS.MOTOR);
    rng.shuffle(motor);
    this.mPool = ACTIONS.map(() => []);
    for (let i = 0; i < motor.length; i++) this.mPool[i % ACTIONS.length].push(motor[i]);
    //  flattened, because iterating arrays of arrays every tick is the kind of
    //  thing that looks free and is not
    this.mFlat = new Int32Array(motor.length);
    this.mSign = new Float32Array(motor.length);
    this.mStart = new Int32Array(ACTIONS.length + 1);
    let k = 0;
    for (let a = 0; a < ACTIONS.length; a++) {
      this.mStart[a] = k;
      for (const id of this.mPool[a]) {
        this.mFlat[k] = id;
        //  Signed, not a plain average.
        //
        //  Averaging a pool sounds like the neutral choice and is not: the
        //  mean of n activations regresses toward the population mean as n
        //  grows, so a bigger graph produces a *less* responsive readout. It
        //  showed up as separation falling monotonically with size — 0.043 at
        //  100 nodes down to 0.008 at 5000, the opposite of what more neurons
        //  ought to buy. A signed projection has no such collapse: its
        //  variance is independent of pool size.
        this.mSign[k] = rng.next() < 0.5 ? -1 : 1;
        k++;
      }
    }
    this.mStart[ACTIONS.length] = k;
    this.mBias = new Float32Array(ACTIONS.length);    // zero until a readout is trained (Phase 10)

    //  ---- modulatory pathway -----------------------------------------
    //  A separate CSR over edges whose source is a sign-0 neuron. Those edges
    //  carry weight 0 in the main CSR (the sign is folded in there), so they
    //  would otherwise be silently inert. Here they are read as gain changes:
    //  a modulatory neuron does not push its target, it changes how hard
    //  everything else pushing that target lands.
    const modEdges = graph.edges.filter((e) => graph.nodes[e.src].sign === 0);
    const cnt = new Int32Array(this.n);
    for (const e of modEdges) cnt[e.src]++;
    this.modStart = new Int32Array(this.n + 1);
    for (let i = 0; i < this.n; i++) this.modStart[i + 1] = this.modStart[i] + cnt[i];
    this.modIdx = new Int32Array(modEdges.length);
    this.modW = new Float32Array(modEdges.length);
    const cur = Int32Array.from(this.modStart.subarray(0, this.n));
    for (const e of modEdges) { const j = cur[e.src]++; this.modIdx[j] = e.dst; this.modW[j] = e.w; }

    //  ---- the core owns its weights -----------------------------------
    //  graph.csr() hands back a *cached, shared* object. Two cores built on
    //  one graph would therefore share one mutable weight array, and a lesion
    //  study — which §25's ablation needs — would silently damage every other
    //  core in the process. Caught by a test that knocked out inhibition in
    //  one core and measured zero difference, because it had knocked it out
    //  in the control too. Structure (start/idx) is shared because it is never
    //  written; weights are copied because they are.
    const shared = graph.csr();
    this.start = shared.start;
    this.idx = shared.idx;
    this.w = Float32Array.from(shared.w);

    //  ---- gain control, by spectral radius -----------------------------
    //  The first attempt normalised each neuron's *incoming* weights to sum to
    //  recGain. That does bound the dynamics, and it destroys the signal while
    //  doing it: a neuron with twenty afferents gives each of them a twentieth
    //  of its drive, so any one source's influence falls by that factor at
    //  every hop, and over the four hops from sense to muscle a sensory
    //  neuron's contribution is down by about 10^-5. Measured exactly that —
    //  six wildly different situations produced action vectors a mean L1
    //  distance of 0.008 apart, and only one distinct preferred action between
    //  them. The network was bounded, stable, and deaf.
    //
    //  Scaling the whole matrix by one factor instead keeps the relative
    //  structure — hubs stay hubs, a strong synapse stays strong — while still
    //  bounding the recurrence, because what has to sit below 1 is the
    //  spectral radius, not every row sum. Power iteration is a handful of
    //  sweeps at construction and never runs again.
    {
      const v = new Float64Array(this.n), nx = new Float64Array(this.n);
      const seed = makeRng(o.seed ^ 0x51ec);
      for (let i = 0; i < this.n; i++) v[i] = seed.next() - 0.5;
      let radius = 0;
      for (let it = 0; it < 40; it++) {
        nx.fill(0);
        for (let src = 0; src < this.n; src++) {
          const a = v[src];
          if (a === 0) continue;
          for (let k = this.start[src]; k < this.start[src + 1]; k++) nx[this.idx[k]] += a * this.w[k];
        }
        let norm = 0;
        for (let i = 0; i < this.n; i++) norm += nx[i] * nx[i];
        norm = Math.sqrt(norm);
        if (!(norm > 1e-12)) { radius = 0; break; }
        radius = norm;
        for (let i = 0; i < this.n; i++) v[i] = nx[i] / norm;
      }
      this.radius = radius;
      //  A disconnected or vanishing matrix leaves the weights alone rather
      //  than dividing by something near zero and producing infinities.
      if (radius > 1e-6) {
        const scale = o.recGain / radius;
        for (let k = 0; k < this.w.length; k++) this.w[k] *= scale;
      }
      //  The modulatory pathway is bounded the same way, and separately: it is
      //  multiplied into the gain rather than summed into the drive, so it has
      //  its own stability question.
      let mMax = 0;
      const mIn = new Float64Array(this.n);
      for (let src = 0; src < this.n; src++) {
        for (let k = this.modStart[src]; k < this.modStart[src + 1]; k++) mIn[this.modIdx[k]] += Math.abs(this.modW[k]);
      }
      for (let i = 0; i < this.n; i++) if (mIn[i] > mMax) mMax = mIn[i];
      if (mMax > 1e-6) for (let k = 0; k < this.modW.length; k++) this.modW[k] /= mMax;
    }

    this.rng = makeRng(o.seed ^ 0x9e37);
    this.ticks = 0;
    this.faults = 0;
    this.reset();
  }

  reset() {
    this.act.fill(0);
    this.net.fill(0);
    this.mod.fill(0);
    this.ticks = 0;
  }

  //  ---- one tick -----------------------------------------------------
  //  dt is in seconds of *game* time. The leak is converted from a per-tick
  //  constant to a rate so that running the core at 10 Hz and at 20 Hz gives
  //  the same behaviour rather than the same numbers — §28 lets the rate
  //  change with load, and dynamics that shift when the rate shifts would
  //  make the boss behave differently on a slow phone.
  step(inputs, dt) {
    const o = this.o, n = this.n;
    const act = this.act, net = this.net, mod = this.mod;
    const start = this.start, idx = this.idx, w = this.w;
    const step = Math.max(1e-3, Math.min(0.5, dt || 0.1));
    const keep = Math.pow(o.decay, step / 0.1);       // decay normalised to a 10 Hz reference

    //  1. drive the sensory population
    net.fill(0);
    mod.fill(0);
    for (let i = 0; i < this.sIdx.length; i++) {
      let x = inputs[CHANNELS[this.sChan[i]]];
      x = (typeof x === 'number' && Number.isFinite(x)) ? (x < 0 ? 0 : x > 1 ? 1 : x) : 0;
      const d = (x - this.sMu[i]) / o.tuneWidth;
      net[this.sIdx[i]] += Math.exp(-d * d) * this.sGain[i] * o.gain;
    }

    //  2. propagate last tick's activity — this is where recurrence lives
    for (let v = 0; v < n; v++) {
      const a = act[v];
      if (a > -1e-4 && a < 1e-4) continue;            // sparse activity is most of the saving
      for (let j = start[v], e = start[v + 1]; j < e; j++) net[idx[j]] += a * w[j];
      for (let j = this.modStart[v], e = this.modStart[v + 1]; j < e; j++) mod[this.modIdx[j]] += a * this.modW[j];
    }

    //  3. modulation scales the drive; it never becomes the drive
    //  Clamped either side so a runaway modulatory loop cannot flip a sign or
    //  blow the activation up — it can make a neuron nearly deaf or roughly
    //  twice as sensitive, and nothing beyond that.
    const ms = o.modStrength;
    for (let i = 0; i < n; i++) {
      if (mod[i] !== 0) {
        let gmul = 1 + ms * Math.tanh(mod[i]);
        if (gmul < 0.15) gmul = 0.15; else if (gmul > 2.0) gmul = 2.0;
        net[i] *= gmul;
      }
      net[i] += this.bias[i];
    }

    //  4. leaky integration
    if (o.noise > 0) {
      for (let i = 0; i < n; i++) net[i] += (this.rng.next() - 0.5) * o.noise;
    }
    const c = o.clamp;
    for (let i = 0; i < n; i++) {
      let x = net[i];
      if (x > c) x = c; else if (x < -c) x = -c;
      act[i] = act[i] * keep + Math.tanh(x) * (1 - keep);
    }

    this.ticks++;
    //  §32: a core that has gone non-finite must be caught here, not three
    //  layers up where the symptom is a boss standing still forever.
    if ((this.ticks & 15) === 0 && !this.healthy()) { this.faults++; this.reset(); return this.readout(true); }
    return this.readout(false);
  }

  //  ---- readout ------------------------------------------------------
  readout(faulted) {
    const scores = {}, raw = {};
    let best = null, bestV = -Infinity, sum = 0;
    for (let a = 0; a < ACTIONS.length; a++) {
      const s = this.mStart[a], e = this.mStart[a + 1];
      let acc = 0;
      for (let i = s; i < e; i++) acc += this.act[this.mFlat[i]] * this.mSign[i];
      //  scaled by sqrt(n), which is what keeps the variance size-independent
      const mean = (e > s ? acc / Math.sqrt(e - s) : 0) + this.mBias[a];
      raw[ACTIONS[a]] = mean;
      //  tanh already bounds activation to (-1, 1); shifting to 0..1 keeps the
      //  scores comparable with the utility terms the Tactical Brain adds in
      //  Phase 6 without needing a softmax temperature nobody has tuned yet.
      const v = (Math.tanh(mean) + 1) * 0.5;
      scores[ACTIONS[a]] = v;
      sum += v;
      if (v > bestV) { bestV = v; best = ACTIONS[a]; }
    }
    //  A share as well as a level: the level says how strongly the network
    //  wants something, the share says how much it prefers it to the
    //  alternatives, and Phase 4 needs the second one to decide whether the
    //  core is confident enough to be allowed to act on it.
    const share = {};
    for (const a of ACTIONS) share[a] = sum > 0 ? scores[a] / sum : 1 / ACTIONS.length;
    return { scores, raw, share, best, confidence: sum > 0 ? bestV / sum * ACTIONS.length - 1 : 0, faulted: !!faulted };
  }

  healthy() {
    for (let i = 0; i < this.n; i++) {
      const a = this.act[i];
      if (!Number.isFinite(a) || a > 1.5 || a < -1.5) return false;
    }
    return true;
  }

  //  ---- introspection, for §30's debug view ---------------------------
  //  Mean activity per functional class. This is the "Neural Activity" block
  //  the spec draws as bar graphs, and it is cheap enough to compute whenever
  //  the overlay is open.
  activity() {
    const acc = {}, cnt = {};
    for (const c of Object.keys(CLASS)) { acc[c] = 0; cnt[c] = 0; }
    for (let i = 0; i < this.n; i++) { acc[this.g.nodes[i].cls] += Math.abs(this.act[i]); cnt[this.g.nodes[i].cls]++; }
    const out = {};
    for (const c of Object.keys(CLASS)) out[c] = cnt[c] ? +(acc[c] / cnt[c]).toFixed(4) : 0;
    return out;
  }

  //  ---- Phase 10: a trained readout ----------------------------------
  //  The connectome itself is never trained — it stays the fixed, recurrent
  //  "reservoir" the mock was built to be. What is learned, offline in the
  //  lab (§20), is how the motor neurons are read: one weight per motor
  //  neuron in place of its random sign, and a bias per action. Same shape,
  //  same cost per tick. It is only valid for the graph and seed it was
  //  trained on, so it carries both and is refused on anything else.
  getReadout() {
    return { v: 1, graph: this.g.fingerprint ? this.g.fingerprint() : null, seed: this.o.seed,
             w: Array.from(this.mSign, (x) => +x.toFixed(5)), b: Array.from(this.mBias, (x) => +x.toFixed(5)) };
  }
  setReadout(p) {
    if (!p || p.v !== 1 || !Array.isArray(p.w) || !Array.isArray(p.b)) return false;
    if (p.w.length !== this.mSign.length || p.b.length !== ACTIONS.length) return false;
    if (!p.w.every(Number.isFinite) || !p.b.every(Number.isFinite)) return false;
    if (p.seed !== undefined && p.seed !== this.o.seed) return false;
    if (p.graph && this.g.fingerprint && p.graph !== this.g.fingerprint()) return false;
    this.mSign = Float32Array.from(p.w);
    this.mBias = Float32Array.from(p.b);
    return true;
  }

  //  A compact snapshot for the replay system (§31). Rounded hard on purpose:
  //  a replay that stores full precision for a few thousand neurons per tick
  //  is bigger than the game.
  snapshot() {
    const a = new Int8Array(this.n);
    for (let i = 0; i < this.n; i++) a[i] = Math.max(-127, Math.min(127, Math.round(this.act[i] * 127)));
    return { t: this.ticks, act: a, faults: this.faults };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NeuralCore, ACTIONS, CHANNELS };
}
