/**
 * tests/tools/sim-cli.mjs — 离线批量模拟 CLI（任务书 13.5 平衡调参）
 *
 * 用法：
 *   node tests/tools/sim-cli.mjs --seed 24601 --years 10
 *   node tests/tools/sim-cli.mjs --seeds 5 --years 20 --json
 * 输出各文明信用点/殖民地/科技/战争/危机等关键指标。
 */

import { createStarterCampaign } from '../../src/devtools/scenarioFactory.js';
import { advanceTicks } from '../../src/simulation/WorldSimulation.js';
import { checkWorldInvariants } from '../../src/core/invariant.js';
import { worldHash } from '../../src/core/serialization.js';

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? (args[i + 1] !== undefined ? args[i + 1] : true) : def;
};
const seedArg = getArg('seed', 24601);
const seedsCount = parseInt(getArg('seeds', 1), 10);
const years = parseInt(getArg('years', 10), 10);
const asJson = args.includes('--json');
const TICKS = years * 8640;

function runOne(seed) {
  const t0 = Date.now();
  const w = createStarterCampaign({ seed });
  advanceTicks(w, TICKS);
  const ms = Date.now() - t0;
  const inv = checkWorldInvariants(w);
  const rels = Object.values(w.relations.diplomacy);
  return {
    seed,
    ms,
    hash: worldHash(w),
    invariants: inv.length === 0 ? 'PASS' : inv.slice(0, 2),
    colonies: Object.keys(w.entities.colonies).length,
    ships: Object.keys(w.entities.ships).length,
    battles: w.battles.history.length,
    wars: Object.values(w.entities.wars).filter((x) => x.status === 'active').length,
    treaties: Object.keys(w.entities.treaties).length,
    anomalies: Object.keys(w.entities.anomalies).length,
    contactedPairs: rels.filter((r) => r.contactState === 'contacted').length,
    aiErrors: (w.events.log.system || []).filter((e) => e.type === 'AIError').length,
    credits: Object.values(w.entities.factions).map((f) => Math.round(w.economy.ledgers[f.id]?.balances?.credits ?? 0)),
    techDone: Object.values(w.research).map((r) => r.completed.length),
    victory: w.victory.ended ? `${w.victory.ended.routeId}:${w.victory.ended.endingId}` : null,
    crisis: Object.values(w.entities.crises).map((c) => `${c.kind}:${c.phase}:${Math.round(c.progress)}`),
    fails: w.stats.commandsFailed || {},
  };
}

const results = [];
for (let i = 0; i < seedsCount; i++) {
  results.push(runOne((typeof seedArg === 'number' ? seedArg : parseInt(seedArg, 10) || 24601) + i * 7919));
}

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const r of results) {
    console.log(`—— 种子 ${r.seed}（${years} 年，${r.ms}ms）——`);
    console.log(`  不变量: ${r.invariants} | 殖民地: ${r.colonies} | 舰船: ${r.ships} | 战斗: ${r.battles} | 战争: ${r.wars} | 条约: ${r.treaties}`);
    console.log(`  异常: ${r.anomalies} | 接触对: ${r.contactedPairs} | AI错误: ${r.aiErrors} | 胜利: ${r.victory} | 危机: ${r.crisis.join(' ') || '无'}`);
    console.log(`  信用点: [${r.credits.join(', ')}]`);
    console.log(`  科技: [${r.techDone.join(', ')}]`);
    console.log(`  失败命令: ${JSON.stringify(r.fails)}`);
  }
}
