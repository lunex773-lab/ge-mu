'use strict';
//  ============================================================
//  lab/tools/replay.js — reading back what he decided  (§31)
//  ============================================================
//  §31: "なぜこの攻撃をしたのか を後から再現できる". The game keeps the last
//  minute of Beelzebub's decisions; F3 then F4 saves it as JSON. This prints
//  it as a timeline, or explains one moment in full.
//
//    node lab/tools/replay.js replay.json               timeline, changes of action only
//    node lab/tools/replay.js replay.json --attacks     every swing, with what it believed
//    node lab/tools/replay.js replay.json --at 123.4    everything about the nearest decision

const fs = require('fs');

function load(file) {
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!r || r.v !== 1 || !Array.isArray(r.records) || !Array.isArray(r.fields)) throw new Error(file + ': not a Beelzebub replay');
  const idx = {}; r.fields.forEach((f, i) => { idx[f] = i; });
  r.get = (rec, name) => rec.ws[idx[name]];
  return r;
}

const f2 = (x) => (x === undefined || x === null ? '—' : (+x).toFixed(2));
function line(r, rec) {
  const d = r.get(rec, 'player_distance'), vis = r.get(rec, 'player_visible');
  const pred = rec.pred ? rec.pred[0] + ' ' + f2(rec.pred[1]) + (rec.pred[2] ? '*' : '') : '—';
  return rec.t.toFixed(1).padStart(8) + '  ' + (rec.action + (rec.attack ? ':' + rec.attack : '')).padEnd(18) +
    ' d ' + f2(d).padStart(6) + '  vis ' + f2(vis) + '  pred ' + pred.padEnd(20) +
    ' hp ' + String(rec.bossHp).padStart(5) + ' / ' + String(rec.playerHp).padStart(3) + (rec.faulted ? '  FSM' : '');
}

function explain(r, rec) {
  const out = ['t = ' + rec.t + ' s', 'chose ' + rec.action + (rec.attack ? ' (' + rec.attack + ')' : '') + (rec.faulted ? ' — by the FSM fallback' : ''), ''];
  out.push('what it believed:');
  for (const f of ['has_target', 'player_distance', 'player_bearing', 'player_visible', 'player_confidence', 'player_attacking',
    'player_facing_me', 'player_dodging', 'player_radial_speed', 'player_lateral_speed', 'player_cover', 'self_health', 'self_altitude',
    'damage_taken_recent', 'threat']) out.push('  ' + f.padEnd(22) + f2(r.get(rec, f)));
  out.push('', 'prediction: ' + (rec.pred ? rec.pred[0] + ' at ' + f2(rec.pred[1]) + (rec.pred[2] ? ', acted on' : ', below the confidence gate') : 'none'));
  if (rec.cand) { out.push('', 'the options it weighed:'); for (const [a, u] of rec.cand) out.push('  ' + a.padEnd(12) + f2(u)); }
  out.push('', 'ADAPTIVE level ' + f2(rec.lvl));
  return out.join('\n');
}

if (require.main === module) {
  const [file, flag, arg] = process.argv.slice(2);
  if (!file) { console.error('usage: node lab/tools/replay.js replay.json [--attacks | --at <t>]'); process.exit(1); }
  const r = load(file);
  if (flag === '--at') {
    const t = +arg;
    let best = r.records[0];
    for (const rec of r.records) if (Math.abs(rec.t - t) < Math.abs(best.t - t)) best = rec;
    console.log(explain(r, best));
  } else {
    console.log('       t  action              distance      seen  prediction              boss / player hp');
    let last = null;
    for (const rec of r.records) {
      const show = flag === '--attacks' ? !!rec.attack : rec.action !== last;
      if (show) console.log(line(r, rec));
      last = rec.action;
    }
  }
}

module.exports = { load, explain, line };
