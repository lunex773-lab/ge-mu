'use strict';
//  ============================================================
//  WORLDSTATE  (spec §12)
//  ============================================================
//
//  The boundary. Everything the boss knows about the world crosses it as one
//  of the fields below, and nothing else crosses it at all: the Neural Core,
//  the Player Model and the Tactical Brain never see a THREE.Vector3, a peer
//  record, a key map or a function of the engine. That is what §12 asks for,
//  and it is also what lets every layer above it be tested with no game
//  attached.
//
//  Two decisions shape the file.
//
//  1. Raw units, not 0..1. A distance is metres and a time is seconds. The
//     Tactical Brain has to ask "is the player inside a 8.5 m scythe arc", and
//     it cannot ask that of a number somebody already squashed. The squashing
//     into the Neural Core's 0..1 channels happens once, in `toChannels`, in
//     one place that can be read and argued with.
//
//  2. A flat Float32Array behind named indices. Phase 4's reaction delay is a
//     ring of past WorldStates, and the fields being one typed array makes a
//     snapshot a single `set()` — no allocation, no garbage on the phone (D8).
//
//  What is NOT here is as deliberate as what is. §11 lists stamina, defence
//  state and skill state; this game has no stamina, no block, and its only
//  skill (the cloak) is only observable as the player being hard to see —
//  which `player_visible` already carries. They are listed in UNAVAILABLE
//  with the reason, rather than faked as constant fields that a learner could
//  latch onto.

//  [name, min, max, unit, group, note]
const FIELDS = [
  // ---- the player the boss is attending to (a belief, not the truth) ----
  ['has_target',              0,    1, 'bool', 'player', 'a living player in this world is known at all'],
  ['player_distance',         0,  400, 'm',    'player', 'to the believed position'],
  ['player_bearing',      -3.1416, 3.1416, 'rad', 'player', 'relative to the boss facing; + is to its right'],
  ['player_height_diff',    -60,   60, 'm',    'player', 'player above (+) or below the boss'],
  ['player_speed',            0,   30, 'm/s',  'player', 'estimated from seen positions'],
  ['player_radial_speed',   -30,   30, 'm/s',  'player', '+ moving away from the boss'],
  ['player_lateral_speed',    0,   30, 'm/s',  'player', 'across the line to the boss'],
  ['player_vertical_speed', -30,   30, 'm/s',  'player', 'jumping / falling'],
  ['player_health',           0,    1, 'frac', 'player', 'as the HP bar over their head shows it'],
  ['player_visible',          0,    1, 'frac', 'player', 'seen this tick; a cloak only shows up close, and faintly'],
  ['player_confidence',       0,    1, 'frac', 'player', 'how much the belief is still worth'],
  ['time_since_seen',         0,  600, 's',    'player', ''],
  ['player_attacking',        0,    1, 'frac', 'player', 'a shot seen or heard from them, decaying'],
  ['time_since_player_attack', 0, 600, 's',    'player', ''],
  ['player_facing_me',        0,    1, 'frac', 'player', 'their avatar is turned toward the boss'],
  ['player_dodging',          0,    1, 'frac', 'player', 'a sharp sideways change of direction, decaying'],
  ['player_airborne',         0,    1, 'bool', 'player', ''],
  ['player_approaching',      0,    1, 'frac', 'player', 'closing speed over run speed'],
  ['player_retreating',       0,    1, 'frac', 'player', 'opening speed over run speed'],
  ['player_noise',            0,    1, 'frac', 'player', 'loudness of the last thing heard from them, decaying'],
  ['player_cover',            0,    1, 'frac', 'player', 'line of sight broken, and walls close around where they are believed to be'],
  ['los_blocked',             0,    1, 'bool', 'player', 'in range and in front, but something is in the way'],

  // ---- the boss itself ----
  ['self_health',             0,    1, 'frac', 'self',   ''],
  ['self_speed',              0,   40, 'm/s',  'self',   ''],
  ['self_altitude',           0,   80, 'm',    'self',   'above the ground under it; the wings are for flying'],
  ['self_cooldown',           0,    1, 'frac', 'self',   'of the current attack cooldown still to run'],
  ['self_state',              0,   15, 'enum', 'self',   'the body state the engine reports'],
  ['time_since_self_attack',  0,  600, 's',    'self',   ''],
  ['self_cover',              0,    1, 'frac', 'self',   'walls close around the boss'],

  // ---- the surroundings ----
  ['players_near',            0,   16, 'count', 'env',   'living players known within 30 m'],
  ['players_known',           0,   16, 'count', 'env',   'living players in this world it has a belief about'],
  ['allies_near',             0,   16, 'count', 'env',   ''],

  // ---- events ----
  ['damage_taken_recent',     0,    1, 'frac', 'event',  'of max health, over the last 3 s'],
  ['time_since_damaged',      0,  600, 's',    'event',  ''],
  ['damage_dealt_recent',     0,    1, 'frac', 'event',  'of a player\'s health, over the last 3 s'],
  ['threat',                  0,    1, 'frac', 'event',  'derived: close, armed, facing, hurting'],
];

const UNAVAILABLE = {
  stamina:          'the game has no stamina',
  defense_state:    'the game has no block or guard',
  skill_state:      'the only skill is the cloak, which is only observable as reduced visibility (player_visible)',
  hazards:          'the map has no environmental hazards',
};

const F = {};                    // name -> index
const LO = new Float32Array(FIELDS.length), HI = new Float32Array(FIELDS.length);
FIELDS.forEach((f, i) => { F[f[0]] = i; LO[i] = f[1]; HI[i] = f[2]; });
Object.freeze(F);
const N_FIELDS = FIELDS.length;
const NEVER = 600;               // the value a "time since" field holds when it never happened

class WorldState {
  constructor() {
    this.v = new Float32Array(N_FIELDS);
    this.t = 0;                  // game seconds this state describes
    this.reset();
  }
  reset() {
    this.v.fill(0);
    this.v[F.time_since_seen] = NEVER;
    this.v[F.time_since_player_attack] = NEVER;
    this.v[F.time_since_self_attack] = NEVER;
    this.v[F.time_since_damaged] = NEVER;
    this.v[F.self_health] = 1;
    this.v[F.player_health] = 1;
    return this;
  }
  get(name) { return this.v[F[name]]; }
  set(name, x) { this.v[F[name]] = x; return this; }
  copyFrom(o) { this.v.set(o.v); this.t = o.t; return this; }
  clone() { return new WorldState().copyFrom(this); }
  //  Clamp into the declared ranges and scrub anything non-finite. A sensor
  //  bug has to make the boss confused, never make it NaN.
  sanitize() {
    const v = this.v;
    for (let i = 0; i < N_FIELDS; i++) {
      const x = v[i];
      v[i] = x !== x ? LO[i] : x < LO[i] ? LO[i] : x > HI[i] ? HI[i] : x;
    }
    return this;
  }
  toObject() {
    const o = { t: this.t };
    for (let i = 0; i < N_FIELDS; i++) o[FIELDS[i][0]] = +this.v[i].toFixed(4);
    return o;
  }
}

//  Problems, as strings, for tests and the debug overlay. Empty is healthy.
function validate(ws) {
  const out = [];
  if (!(ws instanceof WorldState)) return ['not a WorldState'];
  if (ws.v.length !== N_FIELDS) out.push('wrong length ' + ws.v.length);
  for (let i = 0; i < N_FIELDS; i++) {
    const x = ws.v[i];
    if (!Number.isFinite(x)) out.push(FIELDS[i][0] + ' is ' + x);
    else if (x < LO[i] - 1e-4 || x > HI[i] + 1e-4) out.push(FIELDS[i][0] + '=' + x + ' outside ' + LO[i] + '..' + HI[i]);
  }
  return out;
}

//  ---- WorldState -> Neural Core channels ------------------------------
//  The only place a metre becomes a 0..1. The ranges are the ones a fight
//  with this boss actually spans, not the ones the schema allows: a distance
//  of 120 m is "at the edge of anything that matters" for a thing with an
//  8.5 m scythe, even though it can perceive further.
const CH_DIST = 120;             // m
const CH_SPEED = 12;             // m/s, a little over run speed
const CH_SEEN = 8;               // s, the time constant of "a while ago"
const CH_ALLIES = 8;

const clamp01 = (x) => (x !== x ? 0 : x < 0 ? 0 : x > 1 ? 1 : x);

function toChannels(ws, out) {
  const v = ws.v;
  const o = out || {};
  const known = v[F.has_target] > 0.5;
  o.player_distance    = known ? clamp01(v[F.player_distance] / CH_DIST) : 1;
  //  The core's convention: 0 behind, 0.5 flank, 1 dead ahead. Left and right
  //  fold together here on purpose — which side is a positioning question for
  //  the Tactical Brain, which reads the signed bearing straight off the state.
  o.player_bearing     = known ? clamp01(1 - Math.abs(v[F.player_bearing]) / Math.PI) : 0.5;
  o.player_speed       = clamp01(v[F.player_speed] / CH_SPEED);
  o.player_approaching = clamp01(v[F.player_approaching]);
  o.player_attacking   = clamp01(v[F.player_attacking]);
  o.player_visible     = clamp01(v[F.player_visible]);
  o.player_noise       = clamp01(v[F.player_noise]);
  o.self_health        = clamp01(v[F.self_health]);
  o.self_cooldown      = clamp01(v[F.self_cooldown]);
  o.threat             = clamp01(v[F.threat]);
  o.cover              = clamp01(v[F.player_cover]);
  o.allies_near        = clamp01(v[F.allies_near] / CH_ALLIES);
  o.damage_recent      = clamp01(v[F.damage_taken_recent] * 4);   // a quarter of its health in 3 s is "a lot"
  o.time_since_seen    = known ? clamp01(1 - Math.exp(-v[F.time_since_seen] / CH_SEEN)) : 1;
  return o;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FIELDS, F, N_FIELDS, UNAVAILABLE, NEVER, WorldState, validate, toChannels };
}
