/**
 * simulation/DailySystems.js — 每日结算
 * 人口日结 → 账本日结/损耗 → 市场定价 → 外交漂移。
 */

import { registerDaily } from './TickPipeline.js';
import { dailyEventCheck, expirePendingChoices } from '../domain/events/narrative.js';
import { dailyPolicySettlement } from '../domain/politics/policy.js';
import { dailyPopulation } from '../domain/planets/colony.js';
import { closeDailyLedgers, applyDecay } from '../domain/economy/ledger.js';
import { updateMarketPrices } from '../domain/economy/market.js';
import { dailyColonyCommerce, restockMarkets } from '../domain/economy/colonyTrade.js';
import { resourceDef, allResourceIds } from '../content/resources.js';
import { emit } from '../core/eventBus.js';
import { chronicle } from '../core/eventBus.js';
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

registerDaily('narrative', (world) => {
  dailyEventCheck(world);
  expirePendingChoices(world);
});

registerDaily('policies', (world) => {
  dailyPolicySettlement(world);
});

registerDaily('market', (world) => {
  // 殖民地商业闭环：盈余出售 + 税收上缴 + 需求注入
  dailyColonyCommerce(world);
  updateMarketPrices(world);
});

registerDaily('diplomacy-drift', (world) => {
  // 关系自然回归 + 边境实际态势驱动的紧张/威胁漂移
  for (const key of Object.keys(world.relations.diplomacy).sort()) {
    const rel = world.relations.diplomacy[key];
    if (rel.contactState !== 'contacted') continue;
    const [a, b] = rel.parties;
    rel.opinion = Math.round(rel.opinion * 0.995);
    rel.trust = Math.min(100, rel.trust + 0.02); // 接触时间的信任累积
    // 边境接壤 → 紧张度自然累积；贸易依赖缓解
    const adjacent = borderAdjacent(world, a, b);
    if (adjacent) {
      rel.borderTension = Math.min(100, rel.borderTension + 0.35);
    } else {
      rel.borderTension = Math.max(0, rel.borderTension - 0.25);
    }
    // 威胁感知：军力比与扩张速度
    const pa = factionPower(world, a);
    const pb = factionPower(world, b);
    const ratio = pa / Math.max(1, pb);
    rel.threat = Math.max(0, Math.min(100, rel.threat + (ratio - 1) * 0.12 - 0.05));
    // 贸易依赖缓解紧张
    if (rel.tradeInterdependence > 30) rel.borderTension = Math.max(0, rel.borderTension - 0.3);
  }
});

function borderAdjacent(world, a, b) {
  for (const sid of Object.keys(world.entities.systems)) {
    const s = world.entities.systems[sid];
    if (s.ownerFactionId !== a) continue;
    for (const nid of s.lanes) {
      if (world.entities.systems[nid].ownerFactionId === b) return true;
    }
  }
  return false;
}

function factionPower(world, fid) {
  let p = 0;
  for (const sid of Object.keys(world.entities.ships)) {
    const s = world.entities.ships[sid];
    if (s.factionId === fid && s.status === 'active') p += 1;
  }
  return p + Object.keys(world.entities.colonies).length; // 殖民也算国力分量
}
