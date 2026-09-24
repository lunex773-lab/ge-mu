'use strict';
//  ============================================================
//  CONTOUR — the rules both sides play by  (brief §24 SHARED)
//  ============================================================
//  The numbers the game plays with and the room server holds it to. The
//  game takes them from here (lab/inline.js copies this file into
//  index.html); the server imports it. Change one here and both change.

module.exports = {
  HP_MAX: 100,
  DMG: 20,                  // a shot
  FIRE_INTERVAL: 0.22,      // s between shots
  MAX_RANGE: 300,           // m a bullet carries
  EYE: 1.68,                // m from the feet to the eye (a state's y is the feet)
  BANANA_HEAL: 40,
  KILL_CREDIT_MS: 12000,    // a death goes to whoever shot you in the last 12 s
  RUN: 10.2,                // m/s, running (the fastest anyone moves on their own feet)
  WORLD: 700,               // m across; the game keeps everyone within ±WORLD × 0.48
};
