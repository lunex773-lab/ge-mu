'use strict';
//  ============================================================
//  CONNECTOME COMPRESSION  (spec §8)
//  ============================================================
//
//  The spec is emphatic about two things here and both are worth repeating
//  where the code lives:
//
//    "初期ターゲット: 1000〜5000ノード程度。ただし固定値にしない。"
//    "「最もノード数が多いものが最強」とは考えない。"
//
//  So every strategy below takes a target as a parameter, all of them are
//  measured the same way, and the module's job is to make them comparable
//  rather than to pick a winner. The winner is chosen in Phase 2 from a table
//  of measurements on the actual target device, not here from intuition.
//
//  What a compressor must not do is obvious only once you have watched one do
//  it: keeping the highest-degree nodes produces a beautiful dense core with
//  every sensory-to-motor path severed. A smaller graph that cannot carry a
//  signal from a sense to a muscle is not a compressed brain, it is rubble.
//  Every strategy here is therefore scored on reachability, and the one the
//  pipeline uses by default is the one built around preserving it.

const { Graph, CLASS, analyse } = require('./connectome.js');
const { makeRng } = require('./rng.js');

//  ---- shared: rebuild a graph from a kept-node set --------------------
//  Node ids are positional — the CSR depends on it — so a subgraph has to be
//  renumbered rather than filtered in place.
function subgraph(g, keep, label) {
  const map = new Int32Array(g.n).fill(-1);
  const nodes = [];
  for (let i = 0; i < g.n; i++) {
    if (!keep[i]) continue;
    map[i] = nodes.length;
    const s = g.nodes[i];
    nodes.push({ id: nodes.length, region: s.region, depth: s.depth, cls: s.cls,
                 nt: s.nt, sign: s.sign, comm: s.comm, meta: Object.assign({ was: s.id }, s.meta) });
  }
  const edges = [];
  for (const e of g.edges) {
    const a = map[e.src], b = map[e.dst];
    if (a < 0 || b < 0) continue;
    edges.push({ src: a, dst: b, w: e.w, type: e.type, conf: e.conf });
  }
  return new Graph(nodes, edges, Object.assign({}, g.meta, {
    compressed: label, fromNodes: g.n, fromEdges: g.m,
  }));
}

//  ---- 1. degree-based filtering ---------------------------------------
//  The obvious one, and the one that quietly breaks reachability. Kept so the
//  comparison has an honest baseline to beat.
function byDegree(g, target) {
  const { out, inn } = g.degrees();
  const order = Array.from({ length: g.n }, (_, i) => i)
    .sort((a, b) => (out[b] + inn[b]) - (out[a] + inn[a]));
  const keep = new Uint8Array(g.n);
  for (let i = 0; i < Math.min(target, g.n); i++) keep[order[i]] = 1;
  return subgraph(g, keep, 'degree');
}

//  ---- 2. region-based filtering ---------------------------------------
//  Keeps whole regions. Coarse, but it is the strategy that maps most
//  directly onto how real connectome data is published and filtered.
function byRegion(g, target, regions) {
  const want = new Set(regions || ['VIS', 'AUD', 'MECH', 'LOB', 'CX', 'PRE', 'VNC']);
  const keep = new Uint8Array(g.n);
  let k = 0;
  for (let i = 0; i < g.n; i++) if (want.has(g.nodes[i].region)) { keep[i] = 1; k++; }
  if (k > target) {                                   // still too big: thin by degree within
    const { out, inn } = g.degrees();
    const kept = [];
    for (let i = 0; i < g.n; i++) if (keep[i]) kept.push(i);
    kept.sort((a, b) => (out[b] + inn[b]) - (out[a] + inn[a]));
    keep.fill(0);
    for (let i = 0; i < target; i++) keep[kept[i]] = 1;
  }
  return subgraph(g, keep, 'region');
}

//  ---- 3. community detection ------------------------------------------
//  Label propagation: each node repeatedly takes the most common label among
//  its neighbours. It is the cheapest community method that actually works,
//  it needs no parameter, and it is deterministic here because the visiting
//  order comes from the seeded rng rather than from Math.random.
function communities(g, seed) {
  const rng = makeRng(seed || 0xc0ffee);
  const { start, idx } = g.csr();
  //  undirected neighbour list — communities are not a directed notion
  const nbr = Array.from({ length: g.n }, () => []);
  for (let v = 0; v < g.n; v++) {
    for (let k = start[v]; k < start[v + 1]; k++) { nbr[v].push(idx[k]); nbr[idx[k]].push(v); }
  }

  //  Modularity optimisation (the local-moving phase of Louvain), not label
  //  propagation.
  //
  //  Label propagation was tried twice and collapsed to a single community
  //  both times — once because ties broke toward the lowest label, which is a
  //  systematic drift, and again with random tie-breaks because this graph is
  //  a small world: roughly a fifth of its edges are long-range, and that is
  //  more than enough for one label to sweep the whole network. Propagation
  //  has no defence against that, because "everything is one community" is a
  //  perfectly stable fixed point of the rule.
  //
  //  Modularity does have a defence, and it is structural rather than a
  //  tuning parameter: the single-community partition scores exactly zero, so
  //  any genuine grouping beats it and the collapse stops being an attractor.
  const deg = new Float64Array(g.n);
  for (let v = 0; v < g.n; v++) deg[v] = nbr[v].length;
  const twoM = deg.reduce((a, b) => a + b, 0) || 1;

  const comm = new Int32Array(g.n);
  for (let i = 0; i < g.n; i++) comm[i] = i;
  const tot = Float64Array.from(deg);          // summed degree per community

  const order = Array.from({ length: g.n }, (_, i) => i);
  const link = new Map();
  for (let pass = 0; pass < 8; pass++) {
    rng.shuffle(order);
    let moved = 0;
    for (const v of order) {
      if (!nbr[v].length) continue;
      const home = comm[v];
      //  weight from v into each neighbouring community
      link.clear();
      for (const u of nbr[v]) link.set(comm[u], (link.get(comm[u]) || 0) + 1);
      //  take v out of its own community before comparing, or it competes
      //  against a community that still contains it
      tot[home] -= deg[v];
      const kIn = link.get(home) || 0;
      let best = home, bestGain = kIn - (tot[home] * deg[v]) / twoM, ties = 1;
      for (const [c, w] of link) {
        if (c === home) continue;
        const gain = w - (tot[c] * deg[v]) / twoM;
        if (gain > bestGain + 1e-12) { bestGain = gain; best = c; ties = 1; }
        else if (Math.abs(gain - bestGain) <= 1e-12) { ties++; if (rng.next() < 1 / ties) best = c; }
      }
      tot[best] += deg[v];
      if (best !== home) { comm[v] = best; moved++; }
    }
    if (!moved) break;
  }

  //  Relabel to a dense range so callers can use the labels as indices.
  const remap = new Map();
  const out = new Int32Array(g.n);
  for (let i = 0; i < g.n; i++) {
    if (!remap.has(comm[i])) remap.set(comm[i], remap.size);
    out[i] = remap.get(comm[i]);
  }
  return out;
}

//  Keeps the largest communities whole. Preserves local circuitry — which is
//  where recurrence lives — at the cost of possibly dropping a whole sense.
function byCommunity(g, target, seed) {
  const label = communities(g, seed);
  const size = new Map();
  for (let i = 0; i < g.n; i++) size.set(label[i], (size.get(label[i]) || 0) + 1);
  const order = [...size.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const keepLabels = new Set();
  let k = 0;
  for (const [lab, sz] of order) { if (k >= target) break; keepLabels.add(lab); k += sz; }
  const keep = new Uint8Array(g.n);
  for (let i = 0; i < g.n; i++) if (keepLabels.has(label[i])) keep[i] = 1;
  //  A compressor that returns more than it was asked for has not compressed
  //  anything, and detection can legitimately come back with one giant
  //  community on a graph that genuinely has no modular structure. Thin by
  //  degree within what was kept rather than handing the caller a graph the
  //  size of the input and calling it a result.
  let held = 0;
  for (let i = 0; i < g.n; i++) if (keep[i]) held++;
  if (held > target) {
    const { out, inn } = g.degrees();
    const kept = [];
    for (let i = 0; i < g.n; i++) if (keep[i]) kept.push(i);
    kept.sort((a, b) => (out[b] + inn[b]) - (out[a] + inn[a]) || a - b);
    keep.fill(0);
    for (let i = 0; i < target; i++) keep[kept[i]] = 1;
  }
  return subgraph(g, keep, 'community');
}

//  ---- 4. important-path preservation ----------------------------------
//  Walk every sensory -> motor shortest path and protect the nodes on it,
//  then spend whatever budget is left on hubs. This is the strategy that
//  answers the failure mode described at the top of the file.
function byPath(g, target) {
  const keep = new Uint8Array(g.n);
  const { out, inn } = g.degrees();
  const deg = (i) => out[i] + inn[i];

  //  Seeds are sampled, not taken wholesale.
  //
  //  The first version protected every sensory neuron and then every node on
  //  a path to every motor neuron. At a gentle compression ratio that is fine.
  //  At a hard one it is self-defeating: a 3000-node graph has ~630 sensory
  //  neurons, so a target of 150 was blown before a single path had been
  //  walked, the overflow guard thinned the set by degree, and the paths it
  //  had just protected were the first thing thrown away — reachability 0.
  //
  //  A compressed brain does not need every sensory neuron. It needs some of
  //  each modality, some motor output, and intact wiring between them. So the
  //  budget is split: a slice for seeds, a slice for outputs, the rest for
  //  whatever the paths and the hubs need.
  const sample = (ids, budget) => {
    //  round-robin by region so no modality is dropped entirely, and highest
    //  degree first within each, because a well-connected sensory neuron is
    //  the one carrying that modality into the rest of the graph
    const byReg = new Map();
    for (const i of ids) {
      const r = g.nodes[i].region;
      if (!byReg.has(r)) byReg.set(r, []);
      byReg.get(r).push(i);
    }
    for (const list of byReg.values()) list.sort((a, b) => deg(b) - deg(a) || a - b);
    const regs = [...byReg.keys()].sort();
    const picked = [];
    for (let round = 0; picked.length < budget; round++) {
      let any = false;
      for (const r of regs) {
        const list = byReg.get(r);
        if (round >= list.length) continue;
        picked.push(list[round]); any = true;
        if (picked.length >= budget) break;
      }
      if (!any) break;
    }
    return picked;
  };

  const sensory = g.byClass(CLASS.SENSORY);
  const motorAll = g.byClass(CLASS.MOTOR);
  const seedBudget = Math.max(1, Math.min(sensory.length, Math.round(target * 0.18)));
  const outBudget = Math.max(1, Math.min(motorAll.length, Math.round(target * 0.18)));
  const seeds = sample(sensory, seedBudget);
  const outs = sample(motorAll, outBudget);

  let kept = 0;
  for (const s of seeds) if (!keep[s]) { keep[s] = 1; kept++; }

  //  BFS from the seeds, one parent each. One parent is enough: we want *a*
  //  path preserved per output, not every path, and storing every path is how
  //  a compressor stops compressing.
  const { start, idx } = g.csr();
  const prev = new Int32Array(g.n).fill(-1);
  const seen = new Uint8Array(g.n);
  const q = seeds.slice();
  for (const s of seeds) seen[s] = 1;
  for (let h = 0; h < q.length; h++) {
    const v = q[h];
    for (let k = start[v]; k < start[v + 1]; k++) {
      const u = idx[k];
      if (seen[u]) continue;
      seen[u] = 1; prev[u] = v; q.push(u);
    }
  }

  //  Outputs are taken whole-path or not at all, so a half-protected path
  //  never spends budget on a route that does not conduct.
  for (const mnode of outs) {
    if (!seen[mnode] || kept >= target) continue;
    let need = 0;
    for (let v = mnode; v !== -1 && !keep[v]; v = prev[v]) need++;
    if (kept + need > target) continue;
    for (let v = mnode; v !== -1 && !keep[v]; v = prev[v]) { keep[v] = 1; kept++; }
  }

  //  Whatever is left goes to the biggest hubs, which is where the network's
  //  capacity to integrate anything lives.
  if (kept < target) {
    const rest = [];
    for (let i = 0; i < g.n; i++) if (!keep[i]) rest.push(i);
    rest.sort((a, b) => deg(b) - deg(a) || a - b);
    for (let i = 0; i < rest.length && kept < target; i++) { keep[rest[i]] = 1; kept++; }
  }
  return subgraph(g, keep, 'path');
}

//  ---- 5. graph simplification (edge pruning) --------------------------
//  Leaves the node set alone and drops the weakest, least confident synapses.
//  Node count is not the only cost: the hot loop runs over *edges*, so this is
//  the strategy that most directly buys inference time.
function simplify(g, keepFraction) {
  const f = Math.max(0.02, Math.min(1, keepFraction));
  const order = g.edges.map((e, i) => i).sort((a, b) => {
    const A = g.edges[a], B = g.edges[b];
    return (B.w * B.conf) - (A.w * A.conf);
  });
  const take = Math.round(g.m * f);
  const keepEdge = new Uint8Array(g.m);
  for (let i = 0; i < take; i++) keepEdge[order[i]] = 1;
  const edges = [];
  for (let i = 0; i < g.m; i++) if (keepEdge[i]) {
    const e = g.edges[i];
    edges.push({ src: e.src, dst: e.dst, w: e.w, type: e.type, conf: e.conf });
  }
  const nodes = g.nodes.map((s) => ({ id: s.id, region: s.region, depth: s.depth, cls: s.cls,
                                      nt: s.nt, sign: s.sign, comm: s.comm, meta: s.meta }));
  return new Graph(nodes, edges, Object.assign({}, g.meta, { compressed: 'simplify', keepFraction: f }));
}

//  ---- 6. hybrid, and the default --------------------------------------
//  Paths first so the graph still conducts, then the strongest edges so the
//  cost lands where the arithmetic actually happens.
function hybrid(g, target, edgeKeep) {
  return simplify(byPath(g, target), edgeKeep === undefined ? 0.7 : edgeKeep);
}

const STRATEGIES = {
  degree: (g, t) => byDegree(g, t),
  region: (g, t) => byRegion(g, t),
  community: (g, t) => byCommunity(g, t),
  path: (g, t) => byPath(g, t),
  hybrid: (g, t) => hybrid(g, t),
};

//  Runs every strategy at one target and reports them side by side. This is
//  the comparison §8 asks for, and it is a function rather than a script so
//  that Phase 2 can call it on the device instead of reading a number I
//  guessed on a workstation.
function compare(g, target) {
  const rows = [];
  for (const name of Object.keys(STRATEGIES)) {
    const t0 = Date.now();
    const c = STRATEGIES[name](g, target);
    const ms = Date.now() - t0;
    const a = analyse(c);
    rows.push({ strategy: name, ms, nodes: a.nodes, edges: a.edges,
                meanDegree: a.meanDegree, reach: a.reach, isolated: a.isolated,
                density: +a.density.toFixed(5) });
  }
  return rows;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { subgraph, byDegree, byRegion, communities, byCommunity, byPath, simplify, hybrid, STRATEGIES, compare };
}
