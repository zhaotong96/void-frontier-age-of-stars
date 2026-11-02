/**
 * simulation/DailySystems.js — 每日结算
 * 人口日结 → 账本日结/损耗 → 市场定价 → 外交漂移。
 */

import { registerDaily } from './TickPipeline.js';
import { dailyPopulation } from '../domain/planets/colony.js';
import { closeDailyLedgers, applyDecay } from '../domain/economy/ledger.js';
import { updateMarketPrices } from '../domain/economy/market.js';
import { resourceDef, allResourceIds } from '../content/resources.js';
import { emit } from '../core/eventBus.js';
import { getMod } from '../domain/factions/modifiers.js';

registerDaily('population', (world) => {
  for (const id of Object.keys(world.entities.colonies).sort()) {
    const colony = world.entities.colonies[id];
    const r = dailyPopulation(world, colony);
    if (r.after <= 0 && r.before > 0) {
      emit(world, 'ColonyLost', { colonyId: id, planetId: colony.planetId }, 'colony');
    }
  }
});

registerDaily('ledger', (world) => {
  // 资源损耗（decayRule）
  const decayRules = {};
  for (const rid of allResourceIds()) decayRules[rid] = resourceDef(rid).decayRule;
  for (const fid of Object.keys(world.economy.ledgers).sort()) {
    applyDecay(world, fid, allResourceIds(), decayRules);
  }
  // 殖民地库存损耗
  for (const cid of Object.keys(world.entities.colonies).sort()) {
    const colony = world.entities.colonies[cid];
    if (!colony.stockpile) continue;
    for (const rid of Object.keys(colony.stockpile).sort()) {
      const rule = decayRules[rid];
      if (!rule || rule.perDayPct <= 0) continue;
      const cur = colony.stockpile[rid];
      const loss = Math.min(cur, Math.round(cur * rule.perDayPct / 100));
      if (loss > 0) colony.stockpile[rid] -= loss;
    }
  }
  // 日结流水归档（统计口径）
  const closed = closeDailyLedgers(world);
  world.stats.lastDailyFlows = closed;
});

registerDaily('market', (world) => {
  updateMarketPrices(world);
});

registerDaily('diplomacy-drift', (world) => {
  // 关系自然回归：无互动时 opinion 缓慢向 0 收敛；贸易依赖提供正向漂移
  for (const key of Object.keys(world.relations.diplomacy).sort()) {
    const rel = world.relations.diplomacy[key];
    if (rel.contactState !== 'contacted') continue;
    rel.opinion = Math.round(rel.opinion * 0.995);
    rel.borderTension = Math.max(0, rel.borderTension - 0.2);
  }
});
