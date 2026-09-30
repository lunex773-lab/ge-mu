//  ============================================================
//  The great ones' slow brain, with a stand-in for Workers AI  (node)
//  ============================================================
//  server/cognition.js: what the model is asked (only the brain's own view),
//  how often (per boss, per room, never on a broken line), what happens when
//  it is slow, silent, down or talking nonsense (AC§44: the fast brain goes
//  on), and a proposal taken into a boss's brain only as its genome allows.
//
//    node server/test/cognition.test.js

import BB from '../../shared/biobrain.js';
import { Cognition, messages, parse, schemaFor, LIMITS, MODEL, MODELS } from '../cognition.js';

const results = []; let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else fail++; results.push((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '\n         ' + detail : '')); }
let clock = 1_000_000;
const now = () => clock;
//  a stand-in model: answers as told (an object, a string, prose, nothing, or never)
function fakeAI(answer) {
  const ai = { asked: [], run: async (model, input) => {
    ai.asked.push({ model, input });
    const a = typeof answer === 'function' ? answer(input) : answer;
    if (a === 'hang') return new Promise(() => {});
    if (a instanceof Error) throw a;
    return a;
  } };
  return ai;
}

(async () => {
  //  a VECNA who has watched a player jump his wave again and again
  const B = BB.make('vecna');
  let t = 0;
  for (let i = 0; i < 6; i++) { BB.event(B, t, 'dodged', { key: 'p1', how: 'jump' }); for (let k = 0; k < 20; k++) { t += 0.05; BB.tick(B, t, 0.05, { hp: 0.8, d: 20 }); BB.observe(B, t, 'p1', { d: 20, vr: 0, vl: 0, jumping: true }); } }
  const ctx = BB.llmContext(B, 'pattern');

  // ---- what it is asked ----------------------------------------------------------------
  {
    const m = messages(ctx), sys = m[0].content, user = m[1].content;
    check('the model is asked in character, with only what VECNA perceived and believes, and told what it may choose',
      /VECNA/.test(sys) && /OBSERVE/.test(sys) && /COUNTER/.test(sys) && /bait/.test(sys) && /Japanese/.test(sys) && user.length <= LIMITS.maxCtx && /player_jumps/.test(user) && !/"x":/.test(user),
      sys.length + ' + ' + user.length + ' chars');
  }

  // ---- a good answer -----------------------------------------------------------------------
  {
    const ai = fakeAI({ response: { internalAssessment: { situation: 'they jump every wave', predictedPlayerAction: 'jump', uncertainty: 0.2 },
      intent: { primary: 'bait' }, strategyProposal: { strategy: 'COUNTER', reason: 'bait the jump, punish the landing', confidence: 0.8 }, dialogue: 'また跳ぶのだろう？' } });
    const C = new Cognition({ ai, now });
    const r = await C.think('vec', ctx);
    const v = BB.validateThought(B, r.v);
    const took = BB.adoptThought(B, t, v, 'llm');
    check('a good answer is taken: its strategy leans his for a while, its line is his to say — and it asked the model named, in JSON mode',
      r.why === 'ok' && v.strategy === 'COUNTER' && v.intent === 'bait' && took && B.strat.llm && B.strat.llm.name === 'COUNTER' && B.say.some((q) => q.src === 'llm' && q.text === 'また跳ぶのだろう？') &&
      ai.asked[0].model === MODEL && ai.asked[0].input.response_format.type === 'json_schema', JSON.stringify(v));
    const sc = ai.asked[0].input.response_format.json_schema, flayer = schemaFor(BB.llmContext(BB.make('mind_flayer'), 'phase'));
    check('… held to a schema of this boss\'s own: only its strategies and intents to choose from, and always a line',
      sc.properties.strategyProposal.properties.strategy.enum.length === 6 && sc.properties.strategyProposal.properties.strategy.enum.indexOf('COUNTER') >= 0 && sc.properties.strategyProposal.properties.strategy.enum.indexOf('SEND_MINIONS') < 0 &&
      flayer.properties.strategyProposal.properties.strategy.enum.indexOf('SEND_MINIONS') >= 0 && sc.properties.intent.properties.primary.enum.indexOf('bait') >= 0 && sc.required.indexOf('dialogue') >= 0,
      JSON.stringify(sc.properties.strategyProposal.properties.strategy.enum) + ' / ' + JSON.stringify(flayer.properties.strategyProposal.properties.strategy.enum));
  }

  // ---- how often -----------------------------------------------------------------------------
  {
    const ai = fakeAI({ response: '{"intent":{"primary":"observe"},"strategyProposal":{"strategy":"OBSERVE"}}' });
    const C = new Cognition({ ai, now, limits: { perHour: 3 } });
    const a = await C.think('vec', ctx), b = await C.think('vec', ctx);
    clock += LIMITS.perBossMs + 1;
    const c = await C.think('vec', ctx), d = await C.think('mf:0', ctx), e = await C.think('bzb', ctx);
    check('no more than one thought a boss every half-minute, nor more than the room\'s hour allows',
      a.why === 'ok' && b.why === 'not now' && c.why === 'ok' && d.why === 'ok' && e.why === 'not now' && ai.asked.length === 3, [a, b, c, d, e].map((q) => q.why).join(', '));
  }

  // ---- when it goes wrong (AC§44) ----------------------------------------------------------------
  {
    const slow = new Cognition({ ai: fakeAI('hang'), now, limits: { timeoutMs: 60 } });
    const t0 = Date.now(), r = await slow.think('vec', ctx);
    check('a model that does not answer is given its few seconds, then the fight goes on without it', r.v === null && r.why === 'timeout' && Date.now() - t0 < 1000, r.why + ' after ' + (Date.now() - t0) + ' ms');
    let n = 0;
    const down = new Cognition({ ai: fakeAI(() => { n++; return new Error('AiError: 3036: daily free allocation exceeded'); }), now, limits: { perBossMs: 0 } });
    for (let i = 0; i < 5; i++) await down.think('vec', ctx);
    const paused = down.stats().pausedFor;
    clock += LIMITS.breakerMs + 1;
    await down.think('vec', ctx);
    check('a model that keeps failing (down, or its day\'s allowance used) is left alone for a while, then tried again',
      n === 4 && paused > 0 && /allocation/.test(down.stats().lastError), n + ' calls for 6 asks; paused ' + Math.round(paused / 1000) + ' s');
    const junk = new Cognition({ ai: fakeAI({ response: 'I think VECNA should rule the world.' }), now });
    const j = await junk.think('vec', ctx);
    const alien = BB.validateThought(B, { strategyProposal: { strategy: 'SEND_MINIONS' }, intent: { primary: 'nuke' }, dialogue: '' });
    check('nonsense is dropped, and a proposal outside VECNA\'s genome (the flayer\'s strategy, an unknown intent) is not his to take',
      j.v === null && j.why === 'not JSON' && alien === null && parse('before {"a":1} after').a === 1, j.why);
    //  Workers AI retires models (the first one used here went on 2026-05-30, error 5028): the room moves on
    const retired = fakeAI((input) => (retired.asked.length === 1 ? new Error('5028: @cf/meta/infire-llama-3.1-8b-instruct was deprecated on 2026-05-30. See the model catalog for alternatives') :
      retired.asked.length === 2 ? new Error('AiError: this model does not support response_format json_schema') : { response: { intent: { primary: 'observe' }, strategyProposal: { strategy: 'OBSERVE' } } }));
    const R = new Cognition({ ai: retired, now, limits: { perBossMs: 0 } });
    const r1 = await R.think('vec', ctx);
    const r2 = await R.think('vec', ctx);
    const m = retired.asked.map((q) => q.model);
    check('a model that has been retired is left for the next, in the same thought; one that will not take a schema is asked without it — and the room stays with what works',
      r1.why === 'ok' && r2.why === 'ok' && m[0] === MODELS[0] && m[1] === MODELS[1] && m[2] === MODELS[1] && m[3] === MODELS[1] && !retired.asked[2].input.response_format && !retired.asked[3].input.response_format &&
      R.stats().model === MODELS[1] && R.stats().gone[0] === MODELS[0] && R.bad === 0, m.join(' → ') + '; ' + JSON.stringify(R.stats()));
    const chat = parse({ choices: [{ message: { content: 'Here: {"intent":{"primary":"bait"}}' } }] });
    const named = new Cognition({ ai: fakeAI({ response: {} }), model: '@cf/some/other-model' });
    check('… an answer in the chat-completions shape is read too, and AI_MODEL puts a model of one\'s own choosing first',
      chat && chat.intent.primary === 'bait' && named.model === '@cf/some/other-model' && named.models.length === MODELS.length + 1);
    const none = new Cognition({ now });
    check('with no AI (every test, a deploy without it) nothing is asked, and nothing waits on it', !none.want('vec') && (await none.think('vec', ctx)).why === 'not now');
  }

  console.log('\nTHE SLOW BRAIN — an LLM, through Workers AI (a stand-in here)\n');
  console.log(results.join('\n'));
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
