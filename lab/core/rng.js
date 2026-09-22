'use strict';
//  Deterministic pseudo-random numbers.
//
//  The whole point of a mock connectome is that it is the *same* graph on
//  every machine and in every run. A boss whose brain differs between two
//  players is not a boss anybody can reason about or balance, and a test that
//  cannot reproduce the graph it failed on is not a test. So nothing in this
//  layer ever calls Math.random — every stochastic choice is drawn from a
//  seeded stream, and the seed is part of the artefact.
//
//  mulberry32 is the same generator the game already uses for its creature
//  rigs, kept identical so that a graph built in the lab and a graph built in
//  the browser are byte-for-byte the same object.

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

//  Draws that come up often enough to be worth naming, so the generator below
//  reads as what it is doing rather than as arithmetic.
function makeRng(seed) {
  const r = mulberry32(seed >>> 0);
  return {
    next: r,
    //  uniform in [lo, hi)
    range: (lo, hi) => lo + r() * (hi - lo),
    //  integer in [0, n)
    int: (n) => Math.floor(r() * n) % (n || 1),
    //  true with probability p
    chance: (p) => r() < p,
    //  Log-normal-ish positive magnitude. Synapse counts between two neurons
    //  are strongly right-skewed in every connectome that has been counted —
    //  a few very strong pairings and a long tail of single contacts — and a
    //  uniform weight would throw that away.
    logish: (mu, sigma) => Math.exp(mu + sigma * gauss(r)),
    //  pick one element
    pick: (arr) => arr[Math.floor(r() * arr.length) % arr.length],
    //  in-place shuffle, so orderings are reproducible too
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },
  };
}

//  Box-Muller, one value per call. The discarded second value costs a little
//  entropy and buys a much simpler call site.
function gauss(r) {
  let u = 0, v = 0;
  while (u === 0) u = r();
  while (v === 0) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307179586 * v);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { mulberry32, makeRng, gauss };
