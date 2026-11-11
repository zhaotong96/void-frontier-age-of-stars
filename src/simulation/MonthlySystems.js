/**
 * simulation/MonthlySystems.js — 月度结算
 * 市场补货、条约月度履约反馈、历史归档。
 */

import { registerMonthly } from './TickPipeline.js';
import { restockMarkets } from '../domain/economy/colonyTrade.js';
import { getRelation } from '../domain/diplomacy/war.js';
import { chronicle } from '../core/eventBus.js';
import { registerCrisis } from '../domain/events/crisis.js';
import { settleMegastructureOutputs } from '../domain/strategic/megastructures.js';
import { recoverRaidedRoutes } from '../domain/economy/tradeRoutes.js';

registerCrisis();

registerMonthly('stats-guard', (world) => {
  world.stats.monthlyCloses = (world.stats.monthlyCloses || 0) + 1;
});

registerMonthly('market-restock', (world) => {
  restockMarkets(world);
});

registerMonthly('treaty-upkeep', (world) => {
  // 贸易/科研条约的月度履约反馈（信任缓慢累积 —— DIP-02 正向路径）
  for (const tid of Object.keys(world.entities.treaties).sort()) {
    const t = world.entities.treaties[tid];
    if (t.status !== 'active') continue;
    const rel = getRelation(world, t.parties[0], t.parties[1]);
    if (t.kind === 'trade' || t.kind === 'research') {
      rel.trust = Math.min(100, rel.trust + 1);
      rel.tradeInterdependence = Math.min(100, (rel.tradeInterdependence || 0) + 2);
    }
  }
});

registerMonthly('chronicle-archive', (world) => {
  // 纪年归档：超出容量的旧条目折叠为摘要（防长期膨胀 —— 任务书 7.5）
  const cap = 800;
  if (world.events.chronicle.length > cap) {
    const cut = world.events.chronicle.length - cap;
    world.stats.archivedChronicle = (world.stats.archivedChronicle || 0) + cut;
    world.events.chronicle.splice(0, cut);
  }
});

// doc35 WP-P1-1/P2-1：巨构月度产出结算 + 被劫航线自愈（均惰性：无巨构/未激活航线时零开销）
registerMonthly('megastructure-output', (world) => {
  settleMegastructureOutputs(world);
  recoverRaidedRoutes(world);
});
