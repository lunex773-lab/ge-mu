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

//  The models asked, in order. Workers AI retires models (the first choice,
//  @cf/meta/llama-3.1-8b-instruct, went on 2026-05-30: "5028: … was
//  deprecated"), so when the one in use is gone — or will not take a JSON
//  schema — the room moves on at once, within the same thought, and stays
//  there. AI_MODEL (wrangler.jsonc vars) puts one at the front.
export const MODELS = ['@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/mistralai/mistral-small-3.1-24b-instruct'];
export const MODEL = MODELS[0];
const GONE = /\b5028\b|\b5007\b|deprecat|no such model|unknown model|model[^.]{0,40}not found/i;   // this model is not there to ask
const NO_SCHEMA = /response_format|json_schema|json mode|schema/i;                               // it is, but not with a schema
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
//  mode, a string otherwise — some models in the chat-completions shape —
//  and a model sometimes wraps it in prose)
export function parse(res) {
  let r = res && typeof res === 'object' && 'response' in res ? res.response : res;
  if (r && typeof r === 'object' && Array.isArray(r.choices)) r = r.choices[0] && r.choices[0].message ? r.choices[0].message.content : null;
  if (r && typeof r === 'object') return r;
  if (typeof r !== 'string') return null;
  const a = r.indexOf('{'), b = r.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(r.slice(a, b + 1)); } catch (e) { return null; }
}

export class Cognition {
  //  ai: the Workers AI binding (env.AI), or anything with run(model, input) → Promise
  //  model: one to ask first (AI_MODEL); the others follow it, in MODELS' order
  constructor({ ai = null, model = null, now = () => Date.now(), limits = {} } = {}) {
    this.ai = ai; this.now = now;
    this.models = model ? [model].concat(MODELS.filter((m) => m !== model)) : MODELS.slice();
    this.mi = 0;                           // the one asked now (moved on from those that are gone)
    this.noSchema = new Set();             // models that are there, but will not take a schema
    this.L = Object.assign({}, LIMITS, limits);
    this.last = new Map();                 // boss key → when it last thought
    this.hour = []; this.fails = 0; this.until = 0;
    this.calls = 0; this.ok = 0; this.bad = 0; this.lastError = ''; this.gone = [];
  }
  get model() { return this.models[this.mi]; }
  //  may this boss (key) think now?
  want(key) {
    if (!this.ai) return false;
    const now = this.now();
    if (now < this.until) return false;
    if (now - (this.last.get(key) || -Infinity) < this.L.perBossMs) return false;
    while (this.hour.length && now - this.hour[0] > 3600000) this.hour.shift();
    return this.hour.length < this.L.perHour;
  }
  //  → { v: what it proposed (unchecked: the brain checks it) | null, why, model: the one asked last }
  async think(key, ctx) {
    if (!this.want(key)) return { v: null, why: 'not now' };
    const now = this.now();
    this.last.set(key, now); this.hour.push(now); this.calls++;
    //  (a model that is gone, or will not take the schema, answers at once: the next is asked in the same thought)
    for (let tries = 0; ; tries++) {
      const model = this.model;
      let timer = null;
      try {
        const input = { messages: messages(ctx), max_tokens: this.L.maxTokens };
        if (!this.noSchema.has(model)) input.response_format = { type: 'json_schema', json_schema: SCHEMA };
        const run = this.ai.run(model, input);
        const late = new Promise((_, no) => { timer = setTimeout(() => no(new Error('timeout')), this.L.timeoutMs); });
        const v = parse(await Promise.race([run, late]));
        if (!v) throw new Error('not JSON');
        this.fails = 0; this.ok++;
        return { v, why: 'ok', model };
      } catch (e) {
        const msg = String(e && e.message || e).slice(0, 160);
        if (tries < this.models.length && msg !== 'timeout') {
          if (GONE.test(msg) && this.mi < this.models.length - 1) { this.gone.push(model); this.mi++; continue; }
          if (NO_SCHEMA.test(msg) && !this.noSchema.has(model)) { this.noSchema.add(model); continue; }
        }
        this.bad++; this.lastError = msg;
        if (++this.fails >= this.L.breakerFails) { this.until = this.now() + this.L.breakerMs; this.fails = 0; }
        return { v: null, why: this.lastError, model };
      } finally { if (timer) clearTimeout(timer); }
    }
  }
  stats() { return { model: this.model, gone: this.gone.slice(), calls: this.calls, ok: this.ok, bad: this.bad, lastError: this.lastError, pausedFor: Math.max(0, this.until - this.now()) }; }
}
