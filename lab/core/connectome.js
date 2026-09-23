'use strict';
//  ============================================================
//  CONNECTOME DATA LAYER  (spec §5, §6, §7)
//  ============================================================
//
//  A connectome as this project needs it: neurons, directed weighted synapses,
//  and enough structure on top to be worth calling a brain rather than a
//  random graph.
//
//  SCIENTIFIC HONESTY (spec §26, §7)
//  ---------------------------------
//  Nothing here is a claim about a fly. The functional classes below are
//  *game-side abstractions* — labels this project assigns so that a pipeline
//  can route sensory input toward motor output. Real connectome data does not
//  arrive annotated with "this neuron is the memory neuron", and §7 is
//  explicit that we must not pretend otherwise. When real FlyWire data is
//  substituted for this mock (spec §11 of the plan), the classes will be
//  *derived* — from region, cell type and graph position — and will still be
//  an abstraction, not a discovery.
//
//  What this mock *does* try to reproduce faithfully are the statistical
//  properties that make connectome-derived topology behave differently from
//  a random graph, because those are the only reason to do any of this:
//
//    1. a sensory -> integration -> motor gradient, with recurrence
//    2. community structure (dense local wiring, sparse long-range)
//    3. a heavy-tailed degree distribution (a few enormous hubs)
//    4. Dale's principle — a neuron's outgoing synapses all share its sign
//    5. an excitatory/inhibitory balance in roughly the observed proportion
//    6. right-skewed synaptic weights
//
//  Swapping this file for a real-data loader must not change anything
//  downstream: the Graph it returns is the contract.

const { makeRng } = require('./rng.js');

//  ---- functional classes (spec §7) ------------------------------------
//  Deliberately including UNKNOWN. Real data will have neurons that none of
//  our heuristics classify, and a pipeline that cannot represent "we do not
//  know what this is" will quietly mislabel them instead.
const CLASS = {
  SENSORY: 'SENSORY',
  INTEGRATION: 'INTEGRATION',
  MEMORY_RELATED: 'MEMORY_RELATED',
  DECISION_RELATED: 'DECISION_RELATED',
  MOTOR: 'MOTOR',
  MODULATORY: 'MODULATORY',
  UNKNOWN: 'UNKNOWN',
};
const CLASS_LIST = Object.keys(CLASS);

//  ---- neurotransmitters, and the sign they imply ----------------------
//  The sign lives on the *neuron*, not the synapse. That is Dale's principle,
//  it is true of real connectomes, and it matters here: it means inhibition
//  is a property of a cell's identity, so knocking out one hub removes a
//  coherent block of inhibition rather than a scatter of random negatives.
//  A network wired with per-synapse random signs does not behave this way.
const NT = {
  ACH:  { name: 'ACH',  sign: +1 },   // excitatory, the bulk
  GLU:  { name: 'GLU',  sign: +1 },   // excitatory
  GABA: { name: 'GABA', sign: -1 },   // inhibitory
  GLY:  { name: 'GLY',  sign: -1 },   // inhibitory
  DA:   { name: 'DA',   sign:  0 },   // modulatory: gates, does not drive
  OA:   { name: 'OA',   sign:  0 },   // modulatory
};

//  Observed proportions are roughly 3:1 excitatory to inhibitory with a small
//  modulatory population. Exact numbers vary by dataset and region; these are
//  a plausible mixture, not a citation.
const NT_MIX = [
  { nt: 'ACH',  p: 0.46 },
  { nt: 'GLU',  p: 0.22 },
  { nt: 'GABA', p: 0.19 },
  { nt: 'GLY',  p: 0.06 },
  { nt: 'DA',   p: 0.04 },
  { nt: 'OA',   p: 0.03 },
];

//  ---- regions ---------------------------------------------------------
//  A region carries a processing depth. Depth is what gives the graph its
//  direction: most edges run from lower depth to higher, which is what makes
//  "sensory in, motor out" a property of the wiring rather than something the
//  Neural Core has to be told separately.
const REGIONS = [
  { name: 'VIS',  depth: 0, cls: CLASS.SENSORY,          share: 0.10 },
  { name: 'AUD',  depth: 0, cls: CLASS.SENSORY,          share: 0.06 },
  { name: 'MECH', depth: 0, cls: CLASS.SENSORY,          share: 0.05 },
  { name: 'LOB',  depth: 1, cls: CLASS.INTEGRATION,      share: 0.17 },
  { name: 'CX',   depth: 2, cls: CLASS.INTEGRATION,      share: 0.16 },
  { name: 'MB',   depth: 2, cls: CLASS.MEMORY_RELATED,   share: 0.12 },
  { name: 'PRE',  depth: 3, cls: CLASS.DECISION_RELATED, share: 0.13 },
  { name: 'VNC',  depth: 4, cls: CLASS.MOTOR,            share: 0.13 },
  { name: 'MOD',  depth: 2, cls: CLASS.MODULATORY,       share: 0.05 },
  { name: 'UNK',  depth: 2, cls: CLASS.UNKNOWN,          share: 0.03 },
];
const MAX_DEPTH = 4;

//  ======================================================================
//  Graph
//  ======================================================================
//  Plain arrays plus an optional CSR view. The CSR is what the Neural Core
//  will actually propagate over — an adjacency list of objects would spend
//  more time chasing pointers than doing arithmetic, and this has to run on a
//  phone next to 48 demodogs.
class Graph {
  constructor(nodes, edges, meta) {
    this.nodes = nodes;          // [{ id, region, depth, cls, nt, sign, meta }]
    this.edges = edges;          // [{ src, dst, w, type, conf }]
    this.meta = meta || {};
    this._csr = null;
  }

  get n() { return this.nodes.length; }
  get m() { return this.edges.length; }

  //  Compressed sparse row over outgoing edges. Built once, reused.
  csr() {
    if (this._csr) return this._csr;
    const n = this.nodes.length, m = this.edges.length;
    const count = new Int32Array(n);
    for (let i = 0; i < m; i++) count[this.edges[i].src]++;
    const start = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) start[i + 1] = start[i] + count[i];
    const idx = new Int32Array(m), w = new Float32Array(m);
    const cur = Int32Array.from(start.subarray(0, n));
    for (let i = 0; i < m; i++) {
      const e = this.edges[i], k = cur[e.src]++;
      idx[k] = e.dst;
      //  sign folded in here, once, so the hot loop never branches on it
      w[k] = e.w * this.nodes[e.src].sign;
    }
    this._csr = { start, idx, w };
    return this._csr;
  }

  degrees() {
    const out = new Int32Array(this.n), inn = new Int32Array(this.n);
    for (const e of this.edges) { out[e.src]++; inn[e.dst]++; }
    return { out, inn };
  }

  byClass(cls) {
    const r = [];
    for (let i = 0; i < this.nodes.length; i++) if (this.nodes[i].cls === cls) r.push(i);
    return r;
  }

  //  A stable string, for asserting that two builds are identical. Cheaper
  //  and far more readable in a failure than comparing objects.
  fingerprint() {
    let h = 2166136261 >>> 0;
    const mix = (s) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } };
    for (const nd of this.nodes) mix(nd.region + '|' + nd.nt + '|' + nd.cls);
    for (const e of this.edges) mix(e.src + '>' + e.dst + ':' + e.w.toFixed(4) + ':' + e.type);
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}

//  ======================================================================
//  Mock connectome generator
//  ======================================================================
//
//  targetNodes is a target, not a promise — the region shares are rounded and
//  the result lands within a node or two. §8 is explicit that node count must
//  be a comparable parameter rather than a constant, so nothing downstream is
//  allowed to assume a particular size.
function buildMockConnectome(opts) {
  const o = Object.assign({
    nodes: 1000,
    seed: 0x5eed,
    communities: 0,        // 0 = derive from size
    edgeFactor: 12,        // mean out-degree target
    recurrence: 0.22,      // share of edges that are lateral or backward
    hubExponent: 1.35,     // preferential attachment strength
    localBias: 0.78,       // share of edges kept inside a community
  }, opts || {});

  const rng = makeRng(o.seed);
  const N = Math.max(10, o.nodes | 0);
  const K = o.communities > 0 ? o.communities : Math.max(3, Math.round(Math.sqrt(N) / 2));

  //  ---- nodes -------------------------------------------------------
  const nodes = [];
  //  Region shares are normalised rather than trusted to sum to 1, so editing
  //  the table above cannot silently change the population size.
  const shareSum = REGIONS.reduce((a, r) => a + r.share, 0);
  //  Largest-remainder allocation, not independent rounding.
  //
  //  Rounding each region's share on its own and letting the last one absorb
  //  the difference works until the roundings happen to all go up, at which
  //  point the last region is asked for a negative number of neurons, builds
  //  none, and the population overshoots. On a ten-node graph that produced
  //  eleven nodes and — because the last region is where the loop's source
  //  cursor started — no edges at all. Largest remainder always sums to N.
  const quota = REGIONS.map((R) => N * (R.share / shareSum));
  const counts = quota.map(Math.floor);
  let short = N - counts.reduce((a, b) => a + b, 0);
  const rema = quota.map((q, i) => ({ i, f: q - Math.floor(q) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; k < short; k++) counts[rema[k % rema.length].i]++;
  let assigned = 0;
  for (let ri = 0; ri < REGIONS.length; ri++) {
    const R = REGIONS[ri];
    const want = Math.max(0, counts[ri]);
    for (let i = 0; i < want; i++) {
      const nt = pickNT(rng);
      nodes.push({
        id: nodes.length,
        region: R.name,
        depth: R.depth,
        cls: R.cls,
        nt,
        sign: NT[nt].sign,
        comm: 0,                       // assigned below, in blocks
        meta: {},
      });
    }
    assigned += want;
  }
  //  Communities are assigned in contiguous blocks within each region rather
  //  than scattered uniformly. Uniform scattering gives every community a
  //  member in every region, which is not community structure at all — it is
  //  a colouring, and no detector will recover it because there is nothing
  //  there to recover.
  {
    const byRegion = new Map();
    for (const nd of nodes) {
      if (!byRegion.has(nd.region)) byRegion.set(nd.region, []);
      byRegion.get(nd.region).push(nd);
    }
    let c = 0;
    for (const [, list] of byRegion) {
      const per = Math.max(1, Math.ceil(list.length / Math.max(1, Math.round(K / byRegion.size) || 1)));
      for (let i = 0; i < list.length; i++) list[i].comm = (c + Math.floor(i / per)) % K;
      c = (c + Math.ceil(list.length / per)) % K;
    }
  }

  //  A modulatory region is not the only home of modulatory cells. Anything
  //  carrying DA or OA is modulatory whatever region it sits in — the class
  //  follows the chemistry, which is how it works in the data too.
  for (const nd of nodes) if (NT[nd.nt].sign === 0 && nd.cls === CLASS.INTEGRATION) nd.cls = CLASS.MODULATORY;

  //  ---- edges -------------------------------------------------------
  //  Targets are drawn with preferential attachment, so in-degree develops a
  //  heavy tail and the graph grows hubs. A uniform draw gives a Poisson
  //  degree distribution and none of the structure that makes hubs worth
  //  having — knocking out a uniform node does nothing, knocking out a hub
  //  changes the network, and that difference is the whole point.
  const byDepth = [];
  for (let d = 0; d <= MAX_DEPTH; d++) byDepth.push([]);
  for (const nd of nodes) byDepth[nd.depth].push(nd.id);

  const allIds = nodes.map((nd) => nd.id);
  const attach = new Float64Array(N).fill(1);     // running preferential weight
  const seen = new Set();
  const edges = [];
  const targetM = Math.round(N * o.edgeFactor);

  //  Draw a destination for a source, honouring depth direction and community.
  const drawTarget = (srcNode) => {
    const backward = rng.chance(o.recurrence);
    let d;
    if (backward) {
      //  lateral or one step back — recurrence is what gives the core any
      //  temporal behaviour at all
      d = rng.chance(0.6) ? srcNode.depth : Math.max(0, srcNode.depth - 1);
    } else {
      d = Math.min(MAX_DEPTH, srcNode.depth + (rng.chance(0.82) ? 1 : 2));
    }
    let pool = byDepth[d];
    if (!pool || !pool.length) pool = byDepth[Math.min(MAX_DEPTH, srcNode.depth)];
    if (!pool || !pool.length) pool = allIds;
    //  Preferential attachment by tournament: sample a handful of candidates
    //  and keep the best-connected of them.
    //
    //  The first attempt at this used rejection sampling against a running
    //  attachment score, and it produced a flat degree distribution — because
    //  the attachment scores were only summed up *after* the edge loop had
    //  finished, so every candidate scored 1 throughout and the draw was
    //  uniform. Max degree came out at 2.2x the mean; a real connectome is
    //  an order of magnitude past that. A tournament cannot fail this way:
    //  it compares live values or it has nothing to compare.
    //  The community bias applies to lateral and feedback wiring only.
    //
    //  Applying it to feed-forward projections as well looks like the same
    //  idea and is not: communities are blocks *within* a region, so a
    //  projection from one processing stage to the next is cross-community
    //  almost by construction. Penalising those is penalising the feed-forward
    //  pathway itself, and it showed up immediately as sensory-to-motor
    //  reachability falling to 0.72 — nearly a third of the motor population
    //  had stopped being connected to any sense at all. Local recurrent
    //  circuitry is within-community; long-range projections are not.
    const local = !backward ? false : rng.chance(o.localBias);
    let best = -1, bestScore = -1;
    const T = 6;
    for (let t = 0; t < T; t++) {
      const cand = pool[rng.int(pool.length)];
      if (cand === undefined || cand === srcNode.id) continue;
      let score = Math.pow(attach[cand], o.hubExponent) * (0.35 + rng.next());
      if (local) score *= nodes[cand].comm === srcNode.comm ? 8 : 0.10;
      if (score > bestScore) { bestScore = score; best = cand; }
    }
    return best;
  };

  //  The source sweeps the population by its own counter, not by how many
  //  edges have been made. Indexing it by edges.length looks equivalent and
  //  is not: when a neuron cannot find a legal target the loop adds nothing,
  //  the index does not move, and the same neuron is retried until the guard
  //  expires — which on a ten-node graph produced exactly zero edges.
  let guard = 0, cursor = 0;
  while (edges.length < targetM && guard < targetM * 40) {
    guard++;
    const src = nodes[cursor++ % N];
    const dst = drawTarget(src);
    if (dst < 0 || dst === src.id) continue;
    const key = src.id * N + dst;
    if (seen.has(key)) continue;
    seen.add(key);
    //  Weight magnitude is right-skewed; the sign comes from the source's
    //  neurotransmitter when the CSR is built, never from here.
    const w = Math.min(8, Math.max(0.05, rng.logish(-0.55, 0.62)));
    edges.push({
      src: src.id,
      dst,
      w,
      type: src.depth === nodes[dst].depth ? 'lateral'
          : nodes[dst].depth > src.depth ? 'feedforward' : 'feedback',
      //  Confidence is part of the spec's synapse model (§6). Real data has
      //  it because automated synapse detection is not certain; carrying it
      //  through the mock means the compressor can already use it.
      conf: Math.min(1, 0.55 + rng.next() * 0.45),
    });
    //  during, not after — this is what makes the tail
    attach[dst] += 1;
  }

  //  Minimum innervation: every non-sensory neuron gets at least one afferent.
  //
  //  Preferential attachment concentrates in-degree by design, and on a graph
  //  this sparse that leaves a long tail of neurons with no input whatsoever.
  //  For most of the population that is harmless. For the motor population it
  //  is fatal — a motor neuron nothing projects to is not a motor neuron, it
  //  is a disconnected node wearing the label — and it showed up as
  //  sensory-to-motor reachability sitting at 0.65 however well the rest of
  //  the graph was wired. Sensory neurons are exempt: having no afferents is
  //  what makes them sensory.
  {
    const inDeg = new Int32Array(N);
    for (const e of edges) inDeg[e.dst]++;
    for (const nd of nodes) {
      if (nd.depth === 0 || inDeg[nd.id] > 0) continue;
      //  draw from any shallower depth, preferring one step back
      let pool = byDepth[nd.depth - 1];
      if (!pool || !pool.length) {
        for (let d = nd.depth - 1; d >= 0 && (!pool || !pool.length); d--) pool = byDepth[d];
      }
      if (!pool || !pool.length) continue;
      let src = -1, bestScore = -1;
      for (let t = 0; t < 6; t++) {
        const cand = pool[rng.int(pool.length)];
        if (cand === undefined || cand === nd.id) continue;
        const sc = Math.pow(attach[cand], 0.5) * (0.35 + rng.next());
        if (sc > bestScore) { bestScore = sc; src = cand; }
      }
      if (src < 0) continue;
      const key = src * N + nd.id;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        src, dst: nd.id,
        w: Math.min(8, Math.max(0.05, rng.logish(-0.55, 0.62))),
        type: 'feedforward',
        conf: Math.min(1, 0.55 + rng.next() * 0.45),
      });
      attach[nd.id] += 1;
    }
  }

  return new Graph(nodes, edges, {
    kind: 'mock',
    seed: o.seed,
    communities: K,
    opts: o,
    note: 'Connectome-inspired abstraction. Not a model of any real organism.',
  });
}

function pickNT(rng) {
  const r = rng.next();
  let a = 0;
  for (const m of NT_MIX) { a += m.p; if (r <= a) return m.nt; }
  return 'ACH';
}

//  ======================================================================
//  Metrics (spec §8 evaluation, §24)
//  ======================================================================
function analyse(g) {
  const { out, inn } = g.degrees();
  let exc = 0, inh = 0, mod = 0;
  const cls = {};
  for (const c of CLASS_LIST) cls[c] = 0;
  for (const nd of g.nodes) {
    cls[nd.cls]++;
    if (nd.sign > 0) exc++; else if (nd.sign < 0) inh++; else mod++;
  }
  let maxDeg = 0, sumDeg = 0;
  for (let i = 0; i < g.n; i++) { const d = out[i] + inn[i]; sumDeg += d; if (d > maxDeg) maxDeg = d; }
  const mean = g.n ? sumDeg / g.n : 0;
  //  Sorted degrees let us state the tail as a number instead of asserting
  //  "heavy-tailed" and hoping.
  const sorted = Array.from({ length: g.n }, (_, i) => out[i] + inn[i]).sort((a, b) => b - a);
  const top1 = sorted.slice(0, Math.max(1, Math.round(g.n * 0.01)));
  const top1Share = sumDeg ? top1.reduce((a, b) => a + b, 0) / sumDeg : 0;

  return {
    nodes: g.n,
    edges: g.m,
    density: g.n > 1 ? g.m / (g.n * (g.n - 1)) : 0,
    meanDegree: +mean.toFixed(2),
    maxDegree: maxDeg,
    hubRatio: +(mean ? maxDeg / mean : 0).toFixed(1),
    top1PctDegreeShare: +top1Share.toFixed(3),
    excitatory: exc, inhibitory: inh, modulatory: mod,
    eiRatio: inh ? +(exc / inh).toFixed(2) : Infinity,
    classes: cls,
    isolated: countIsolated(out, inn),
    reach: sensoryToMotorReach(g),
  };
}

function countIsolated(out, inn) {
  let k = 0;
  for (let i = 0; i < out.length; i++) if (out[i] === 0 && inn[i] === 0) k++;
  return k;
}

//  The one metric that actually matters for compression: after throwing nodes
//  away, can signal still get from a sense to a muscle? A compressor that
//  keeps the biggest hubs but severs every sensory->motor path has produced a
//  smaller graph and a useless one.
function sensoryToMotorReach(g) {
  const src = g.byClass(CLASS.SENSORY);
  const motor = g.byClass(CLASS.MOTOR);
  if (!src.length || !motor.length) return 0;
  const { start, idx } = g.csr();
  const seen = new Uint8Array(g.n);
  const q = src.slice();
  for (const s of src) seen[s] = 1;
  for (let h = 0; h < q.length; h++) {
    const v = q[h];
    for (let k = start[v]; k < start[v + 1]; k++) {
      const u = idx[k];
      if (!seen[u]) { seen[u] = 1; q.push(u); }
    }
  }
  let hit = 0;
  for (const mnode of motor) if (seen[mnode]) hit++;
  return +(hit / motor.length).toFixed(3);
}

//  ======================================================================
//  Packing — so the game can carry a built graph instead of building one
//  ======================================================================
//  Building and compressing the mock takes ~75 ms here and several times
//  that on a phone: a stall, at the moment the boss appears, that D8 does
//  not allow. So lab/inline.js builds it once and embeds it in index.html
//  as base64: node classes, regions and transmitters as short strings,
//  edges as Uint16 endpoints and Float32 weights. Unpacking is a copy.
const B64 = typeof Buffer !== 'undefined'
  ? { enc: (u8) => Buffer.from(u8).toString('base64'), dec: (s) => new Uint8Array(Buffer.from(s, 'base64')) }
  : { enc: (u8) => { let t = ''; for (let i = 0; i < u8.length; i++) t += String.fromCharCode(u8[i]); return btoa(t); },
      dec: (s) => { const t = atob(s), u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; } };
const REGION_NAMES = () => REGIONS.map((r) => r.name);
function packGraph(g) {
  if (g.n > 65535) throw new Error('packGraph: more than 65535 nodes');
  const rn = REGION_NAMES(), nn = Object.keys(NT);
  const src = new Uint16Array(g.m), dst = new Uint16Array(g.m), w = new Float32Array(g.m), ty = new Uint8Array(g.m);
  const types = [];
  g.edges.forEach((e, i) => {
    src[i] = e.src; dst[i] = e.dst; w[i] = e.w;
    let t = types.indexOf(e.type); if (t < 0) { t = types.length; types.push(e.type); } ty[i] = t;
  });
  const code = (list, x) => String.fromCharCode(65 + list.indexOf(x));
  return {
    v: 1, n: g.n, m: g.m, types,
    cls: g.nodes.map((nd) => code(CLASS_LIST, nd.cls)).join(''),
    region: g.nodes.map((nd) => code(rn, nd.region)).join(''),
    nt: g.nodes.map((nd) => code(nn, nd.nt)).join(''),
    src: B64.enc(new Uint8Array(src.buffer)), dst: B64.enc(new Uint8Array(dst.buffer)),
    w: B64.enc(new Uint8Array(w.buffer)), ty: B64.enc(ty),
    meta: g.meta || {},
  };
}
function unpackGraph(p) {
  if (!p || p.v !== 1) throw new Error('unpackGraph: not a packed graph');
  const rn = REGION_NAMES(), nn = Object.keys(NT);
  const u16 = (s) => { const b = B64.dec(s); return new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2); };
  const f32 = (s) => { const b = B64.dec(s); const c = new Uint8Array(b); return new Float32Array(c.buffer, 0, c.byteLength / 4); };
  const src = u16(p.src), dst = u16(p.dst), w = f32(p.w), ty = B64.dec(p.ty);
  const nodes = [];
  for (let i = 0; i < p.n; i++) {
    const nt = nn[p.nt.charCodeAt(i) - 65];
    const reg = REGIONS[p.region.charCodeAt(i) - 65];
    nodes.push({ id: i, region: reg.name, depth: reg.depth,
                 cls: CLASS_LIST[p.cls.charCodeAt(i) - 65], nt, sign: NT[nt].sign, meta: null });
  }
  const edges = [];
  for (let i = 0; i < p.m; i++) edges.push({ src: src[i], dst: dst[i], w: w[i], type: p.types[ty[i]], conf: 1 });
  return new Graph(nodes, edges, p.meta);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CLASS, CLASS_LIST, NT, NT_MIX, REGIONS, MAX_DEPTH, Graph, buildMockConnectome, analyse, sensoryToMotorReach,
                     packGraph, unpackGraph };
}
