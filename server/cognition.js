//  ============================================================
//  CONTOUR — the great ones' slow brain: an LLM, through Workers AI
//  ============================================================
//  ACIS × BIO-BRAIN §4.2, §20–§26, §44: the fast brain (shared/biobrain.js,
//  and each boss's body) fights; the slow brain, now and then, reflects —
//  "the approach itself may be a lure", "they always jump: bait it" — and
//  proposes a strategy, an intent and a line to say. It never moves anyone,
//  touches no rule, and what it says is checked against the boss's own
//  genome before it counts (biobrain.js validateThought / adoptThought).
//
//  The game never talks to the LLM: a room (this, in the GameRoom Durable
//  Object) does, for the bosses it runs, and for a player alone whose game
//  runs them (relay.js 'think' → 'thought'). Only on events the brain names
//  (wantsThought: a phase, a pattern found, a prediction failed, a player
//  down …), no more than one a boss every PER_BOSS_MS and PER_HOUR a room,
//  each given TIMEOUT_MS — and after BREAKER_FAILS failures in a row it is
//  left alone for BREAKER_MS. Without the AI binding (every test, and a
//  deploy without Workers AI) it does nothing, and nothing depends on it:
//  the fast brain is the fallback, always there (AC§44).

export const MODEL = '@cf/meta/llama-3.1-8b-instruct';
export const LIMITS = { perBossMs: 30000, perHour: 40, timeoutMs: 4500, breakerFails: 3, breakerMs: 300000, maxTokens: 220, maxCtx: 2000 };

//  AC§22: what comes back, as a shape the model is held to
export const SCHEMA = {
  type: 'object',
  properties: {
    internalAssessment: { type: 'object', properties: { situation: { type: 'string' }, predictedPlayerAction: { type: 'string' }, uncertainty: { type: 'number' } } },
    intent: { type: 'object', properties: { primary: { type: 'string' } }, required: ['primary'] },
    strategyProposal: { type: 'object', properties: { strategy: { type: 'string' }, reason: { type: 'string' }, confidence: { type: 'number' } }, required: ['strategy'] },
    dialogue: { type: 'string' },
  },
  required: ['intent', 'strategyProposal'],
};

//  AC§21: the character, what it has perceived and believes (never the truth), what it may choose
export function messages(ctx) {
  const c = ctx || {};
  const sys = 'You are the slow, reflective mind of ' + String(c.name || 'a boss') + ', a boss in a Japanese open-city action game. ' +
    'Stay in character: ' + String(c.character || '') + '. ' +
    'You are shown only what this boss has perceived and believes, which may be wrong. Reflect briefly, then answer with JSON only: ' +
    '{"internalAssessment":{"situation":"...","predictedPlayerAction":"...","uncertainty":0.0},' +
    '"intent":{"primary":"<one of: ' + (c.intents || []).join(', ') + '>"},' +
    '"strategyProposal":{"strategy":"<one of: ' + (c.strategies || []).join(', ') + '>","reason":"<short, English>","confidence":0.0},' +
    '"dialogue":"<one line the boss says aloud, in Japanese, at most 24 characters, in its own voice>"}';
  return [{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify(c).slice(0, LIMITS.maxCtx) }];
}

//  what the model said, as an object (Workers AI gives an object in JSON
//  mode, a string otherwise — and a model sometimes wraps it in prose)
export function parse(res) {
  let r = res && typeof res === 'object' && 'response' in res ? res.response : res;
  if (r && typeof r === 'object') return r;
  if (typeof r !== 'string') return null;
  const a = r.indexOf('{'), b = r.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(r.slice(a, b + 1)); } catch (e) { return null; }
}

export class Cognition {
  //  ai: the Workers AI binding (env.AI), or anything with run(model, input) → Promise
  constructor({ ai = null, model = MODEL, now = () => Date.now(), limits = {} } = {}) {
    this.ai = ai; this.model = model || MODEL; this.now = now;
    this.L = Object.assign({}, LIMITS, limits);
    this.last = new Map();                 // boss key → when it last thought
    this.hour = []; this.fails = 0; this.until = 0;
    this.calls = 0; this.ok = 0; this.bad = 0; this.lastError = '';
  }
  //  may this boss (key) think now?
  want(key) {
    if (!this.ai) return false;
    const now = this.now();
    if (now < this.until) return false;
    if (now - (this.last.get(key) || -Infinity) < this.L.perBossMs) return false;
    while (this.hour.length && now - this.hour[0] > 3600000) this.hour.shift();
    return this.hour.length < this.L.perHour;
  }
  //  → { v: what it proposed (unchecked: the brain checks it) | null, why }
  async think(key, ctx) {
    if (!this.want(key)) return { v: null, why: 'not now' };
    const now = this.now();
    this.last.set(key, now); this.hour.push(now); this.calls++;
    let timer = null;
    try {
      const run = this.ai.run(this.model, { messages: messages(ctx), max_tokens: this.L.maxTokens, response_format: { type: 'json_schema', json_schema: SCHEMA } });
      const late = new Promise((_, no) => { timer = setTimeout(() => no(new Error('timeout')), this.L.timeoutMs); });
      const v = parse(await Promise.race([run, late]));
      if (!v) throw new Error('not JSON');
      this.fails = 0; this.ok++;
      return { v, why: 'ok' };
    } catch (e) {
      this.bad++; this.lastError = String(e && e.message || e).slice(0, 160);
      if (++this.fails >= this.L.breakerFails) { this.until = this.now() + this.L.breakerMs; this.fails = 0; }
      return { v: null, why: this.lastError };
    } finally { if (timer) clearTimeout(timer); }
  }
  stats() { return { model: this.model, calls: this.calls, ok: this.ok, bad: this.bad, lastError: this.lastError, pausedFor: Math.max(0, this.until - this.now()) }; }
}
