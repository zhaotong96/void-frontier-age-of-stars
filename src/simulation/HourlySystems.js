/**
 * simulation/HourlySystems.js — 高频世界结算（任务书 4.10 阶段顺序）
 *
 * 阶段（注册顺序 = 执行顺序，勿随意调整）：
 *  orders → navigation → combat → exploration → production →
 *  research → diplomacy → ai
 */

import { registerHourly } from './TickPipeline.js';
import { BAL } from '../content/constants.js';
import { stepBattles } from '../domain/combat/BattleSimulation.js';
import { checkEngagements } from '../domain/combat/engagement.js';
import { advanceFleets } from '../domain/fleets/navigation.js';
import { runDiplomacyTimers } from '../domain/diplomacy/war.js';
import { tickScanning, tickAnomalyInvestigation } from '../domain/exploration/scan.js';
import { tickColonyProduction, tickColonyConstruction, buildingDef } from '../domain/planets/colony.js';
import { tickResearch } from '../domain/research/research.js';
import { createShip } from '../domain/ships/ship.js';
import { getMod } from '../domain/factions/modifiers.js';
import { registerAI } from '../domain/ai/FactionAI.js';

registerHourly('orders', (world) => {
  // AI 命令超时与目标清理（防无限重试 —— RISK-06）
  const ai = world.ai;
  for (const fid of Object.keys(ai).sort()) {
    const st = ai[fid];
    if (!st.orders) continue;
    for (const oid of Object.keys(st.orders)) {
      const o = st.orders[oid];
      if (world.tick - o.createdTick > BAL.ai.commandTimeoutTicks) {
        o.status = 'timeout';
        st.cooldowns[o.kind] = world.tick + BAL.ai.cooldownTicks;
        delete st.orders[oid];
      }
    }
  }
});

registerHourly('navigation', (world) => {
  advanceFleets(world);
});

registerHourly('combat', (world) => {
  checkEngagements(world);
  stepBattles(world);
});

registerHourly('exploration', (world) => {
  for (const id of Object.keys(world.entities.fleets).sort()) {
    tickScanning(world, world.entities.fleets[id]);
  }
  tickAnomalyInvestigation(world);
});

registerHourly('production', (world) => {
  for (const id of Object.keys(world.entities.colonies).sort()) {
    const colony = world.entities.colonies[id];
    tickColonyProduction(world, colony);
    tickColonyConstruction(world, colony);
  }
  tickShipyards(world);
});

registerHourly('research', (world) => {
  // 每文明科研点：基础 + 实验室加成
  for (const fid of Object.keys(world.research).sort()) {
    const labCount = countBuildings(world, fid, 'science');
    const base = 1 + labCount * 1.5;
    const mult = getMod(world, fid, 'researchOutput', 'mult') || 1;
    tickResearch(world, fid, base * mult);
  }
});

registerHourly('diplomacy', (world) => {
  runDiplomacyTimers(world);
});

// 文明 AI 最后执行（依赖前序阶段的状态产物）
registerAI();

// ——

/** 船坞队列推进（建造完成 → 生成舰船） */
function tickShipyards(world) {
  for (const sid of Object.keys(world.entities.stations).sort()) {
    const station = world.entities.stations[sid];
    const q = station.buildQueue;
    if (!q || q.length === 0) continue;
    const job = q[0];
    job.remainingHours -= 1;
    if (job.remainingHours <= 0) {
      const bp = world.entities.blueprints[job.blueprintId];
      if (bp) {
        createShip(world, {
          factionId: job.factionId,
          hullId: bp.hullId,
          moduleIds: bp.modules,
          blueprintId: bp.id,
          systemId: station.systemId,
          name: bp.name,
        });
      }
      q.shift();
      world.stats.shipsBuilt = (world.stats.shipsBuilt || 0) + 1;
    }
  }
}

function countBuildings(world, factionId, category) {
  let n = 0;
  for (const cid of Object.keys(world.entities.colonies)) {
    const c = world.entities.colonies[cid];
    if (c.factionId !== factionId) continue;
    for (const b of c.buildings) {
      if (b.state === 'active' && buildingDef(b.defId)?.category === category) n++;
    }
  }
  return n;
}
