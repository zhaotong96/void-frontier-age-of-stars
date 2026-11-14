/**
 * simulation/HourlySystems.js — 高频世界结算（任务书 4.10 阶段顺序）
 *
 * 阶段（注册顺序 = 执行顺序，勿随意调整）：
 *  orders → navigation → combat → exploration → production →
 *  research → diplomacy → ai
 */

import { registerHourly } from './TickPipeline.js';
import { registerSpaceOperaPhases } from './SpaceOperaWiring.js';
import { BUILDINGS } from '../content/buildings.js';
import { BAL } from '../content/constants.js';
import { stepBattles } from '../domain/combat/BattleSimulation.js';
import { stepMission } from '../domain/ground/GroundMission.js';
import { checkEngagements } from '../domain/combat/engagement.js';
import { advanceFleets } from '../domain/fleets/navigation.js';
import { runDiplomacyTimers } from '../domain/diplomacy/war.js';
import { tickScanning, tickAnomalyInvestigation } from '../domain/exploration/scan.js';
import { tickColonyProduction, tickColonyConstruction, buildingDef } from '../domain/planets/colony.js';
import { tickResearch } from '../domain/research/research.js';
import { createShip } from '../domain/ships/ship.js';
import { getMod } from '../domain/factions/modifiers.js';
import { registerAI } from '../domain/ai/FactionAI.js';
import { factionShipMods } from '../domain/fleets/fleet.js';
import { stepPlanetIndustry, NODE_IDX } from '../domain/industry/planetaryLogistics.js';
import { stepCatapult, settleOrbitalBuffer } from '../domain/industry/catapult.js';
// doc35 WP-P1-1/P1-2：太空电梯（elevator online 时替代弹射井路径）+ 物理商队步进
import { stepSpaceElevator } from '../domain/strategic/megastructures.js';
import { stepTradeRoutes } from '../domain/economy/tradeRoutes.js';
import { tickPlanetaryThreatIndex } from '../domain/ground/planetaryThreat.js';
import { firePlanetaryIonBatteries, hostileFleetsInSystemOf, announceIonSalvo } from '../domain/strategic/orbitalSynergy.js';
// SPEC-PLAN-050 Task 50.2（M4 工位 B）：双轨经济桥逆向修正注入（GAP-02 消除落点）
import { TICKS_PER_MONTH } from '../core/clock.js';
import {
  syncColonyToSpaceOpera,
  getSpaceOperaModifiers,
  applyBeholderPsychicConversion,
} from '../domain/planets/spaceOperaColonyBridge.js';
import { pay } from '../domain/economy/ledger.js';

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
  // doc22 WP-3：高地离子炮越级齐射（仅 planet.fort 已初始化的行星；金快照零漂移）
  for (const pid of Object.keys(world.entities.planets).sort()) {
    const planet = world.entities.planets[pid];
    if (!planet.fort || planet.fort.v !== 1) continue;
    const hostiles = hostileFleetsInSystemOf(world, planet);
    if (hostiles.length > 0) {
      const hits = firePlanetaryIonBatteries(world, planet, hostiles);
      announceIonSalvo(world, planet, hits);
    }
  }
  checkEngagements(world);
  stepBattles(world);
  settleCombatCharacterFx(world);
});

// 舰船损毁 → 人物命运（crew 钩子注入，战斗经验分配）
import { setFateHook } from '../domain/ships/ship.js';
import { onShipDestroyed, gainXp } from '../domain/characters/crew.js';
setFateHook(onShipDestroyed);

function settleCombatCharacterFx(world) {
  // 战斗结束的指挥官经验（从战报增量结算，幂等标记）
  for (const bid of Object.keys(world.battles.history).sort()) {
    const rep = world.battles.history[bid];
    if (rep._xpSettled) continue;
    rep._xpSettled = true;
    for (const fid of [rep.sides.a, rep.sides.b]) {
      const fleet = Object.values(world.entities.fleets).find((f) => f.factionId === fid);
      if (fleet?.commanderId) gainXp(world, fleet.commanderId, 20 + (rep.losses[fid === rep.sides.a ? 'a' : 'b'] || 0) * 5, '战斗');
    }
  }
}

registerHourly('exploration', (world) => {
  for (const id of Object.keys(world.entities.fleets).sort()) {
    tickScanning(world, world.entities.fleets[id]);
  }
  tickAnomalyInvestigation(world);
});

registerHourly('production', (world) => {
  // —— SPEC-PLAN-050 Task 50.2：帝国级太空歌剧修正一次结算（违约 → 船坞/建费倍率）——
  const soEmpireMods = world.spaceOperaState ? getSpaceOperaModifiers(null, world) : null;
  const soBuildCostMult = soEmpireMods ? soEmpireMods.buildingCostMultiplier : 1;
  const soShipyardMult = soEmpireMods ? soEmpireMods.shipyardMultiplier : 1;
  // —— SPEC-PLAN-050 Task 50.2：The Beholder 灵能矿工转化帝国账本月度落账 ——
  //    月界（tick % 720 === 0）恰好一次；金快照世界（无 spaceOperaState）零开销直返。
  if (world.spaceOperaState && world.tick > 0 && world.tick % TICKS_PER_MONTH === 0) {
    applyBeholderPsychicConversion(world);
  }
  for (const id of Object.keys(world.entities.colonies).sort()) {
    const colony = world.entities.colonies[id];
    // —— S4 国家违约建造费 +25% 附加费（tickColonyConstruction 的 pay(def.cost) 在
    //    colony.js:317 原子扣款；非侵入式附加费在此预扣 25% 差额，一次性旗标防重扣）——
    if (soBuildCostMult !== 1) applySpaceOperaBuildSurcharge(world, colony, soBuildCostMult);
    // —— 正向同步 + S3/S4 产能倍率注入 ——
    //    tickColonyProduction（colony.js:277）经 b.efficiencyMult 消费产能倍率：
    //    eff = clamp(pf × hab × efficiencyMult × factionMod, 0.1, 2.0) —— productionMultiplier
    //    经该通道等比缩放周期推进速率（= 产出/小时等比缩放，非侵入权威消费点）。
    if (world.spaceOperaState) {
      syncColonyToSpaceOpera(colony, world);
      const pm = getSpaceOperaModifiers(colony, world).productionMultiplier;
      for (const b of colony.buildings) {
        if (b.state === 'construction' || b.state === 'suspended') continue;
        if (pm === 1) {
          if (b.efficiencyMult !== undefined) delete b.efficiencyMult;
        } else {
          b.efficiencyMult = pm;
        }
      }
    }
    tickColonyProduction(world, colony);
    tickColonyConstruction(world, colony);
  }
  tickShipyards(world, soShipyardMult);
  // —— doc19 v0.4 WP-4：行星局部工业 + 货运弹射井 + 近地中转站三级分发 ——
  //   仅遍历已激活工业星（planet.ind），零 planet.ind 星球为 0 开销（金快照零漂移）
  for (const pid of Object.keys(world.entities.planets).sort()) {
    const planet = world.entities.planets[pid];
    if (!planet.ind || !planet.ind.v) continue;
    const colony = Object.values(world.entities.colonies).find((cc) => cc.planetId === pid);
    const fid = colony ? colony.factionId : world.playerFactionId;
    const defs = BUILDINGS;
    stepPlanetIndustry(world, planet, planet.ind, defs, 1);
    const grid0 = (planet.ind.grids || [])[0] || null;
    const cat0 = planet.ind.catapult;
    if (cat0 && grid0) {
      // 弹射井由其所属子电网供能（取 catapult 节点的 gridId）
      const catNode = (planet.ind.nodes || []).find((n) => n[NODE_IDX.DEF] >= 0
        && BUILDINGS[n[NODE_IDX.DEF]] && BUILDINGS[n[NODE_IDX.DEF]].catapult);
      const grid = catNode
        ? (planet.ind.grids || []).find((g) => g.id === catNode[NODE_IDX.GRID]) || grid0
        : grid0;
      // doc35 WP-P1-2：太空电梯在线时由电梯接管舱段提拉（能耗 -93%、PTI 增量恒 0）；
      // 未建电梯的行星走既有弹射井路径（金快照零漂移）
      const elev = planet.ind.elevator;
      if (elev && elev[3] === 1) {
        stepSpaceElevator(world, planet, planet.ind, grid, 1);
      } else {
        stepCatapult(world, planet, planet.ind, grid, 1);
      }
      settleOrbitalBuffer(world, planet, planet.ind);
    }
    // doc20 WP-3：PTI 微分推进——仅对已初始化 threat 的行星（曾登陆/激活威胁系统），
    // 未触达星球零写入（金快照 68462446 零漂移红线）
    if (planet.threat && planet.threat.v === 1) {
      tickPlanetaryThreatIndex(world, planet);
    }
    void fid;
  }
});

registerHourly('research', (world) => {
  // —— SPEC-PLAN-050 Task 50.2：S1 考古对策 + S4 违约帝国科研倍率（empire-level）——
  const soResearchMult = world.spaceOperaState
    ? getSpaceOperaModifiers(null, world).researchMultiplier : 1;
  // 每文明科研点：基础 + 实验室加成
  for (const fid of Object.keys(world.research).sort()) {
    const labCount = countBuildings(world, fid, 'science');
    const base = 1 + labCount * 1.5;
    const mult = getMod(world, fid, 'researchOutput', 'mult') || 1;
    tickResearch(world, fid, base * mult * soResearchMult);
  }
});

registerHourly('diplomacy', (world) => {
  runDiplomacyTimers(world);
});

// 地面行动：1 战略 tick = 30 任务秒（与战斗同口径）
registerHourly('ground', (world) => {
  const dt = 1 / 30;
  let seconds = BAL.combat.tickBattleSeconds;
  const missions = Object.values(world.entities.groundMissions).filter((m) => (m.status === 'active' || m.state === 'active'));
  while (seconds > 0) {
    const step = Math.min(1 / 30, seconds);
    for (const m of missions) {
      // P0-C：GroundMission 状态键为 status；保留 state 读取以兼容旧存档口径
      if ((m.status || m.state) !== 'active') continue;
      try {
        stepMission(world, m, dt);
      } catch (e) {
        m.status = 'failed';
        m.state = 'failed';
        m.results = { outcome: 'failed', error: String(e && e.message) };
      }
    }
    seconds -= step;
  }
});

// 文明 AI 最后执行（依赖前序阶段的状态产物）
registerAI();

// ——

/** 船坞队列推进（建造完成 → 生成舰船）；
 *  SPEC-PLAN-050 Task 50.2：工时推进乘以 mods.shipyardMultiplier（S4 违约 ×0.75），
 *  倍率为 1 时与既有逐 tick −1 口径逐位一致（金快照零漂移）。 */
function tickShipyards(world, shipyardMult = 1) {
  const drain = Number.isFinite(shipyardMult) && shipyardMult > 0 ? shipyardMult : 1;
  for (const sid of Object.keys(world.entities.stations).sort()) {
    const station = world.entities.stations[sid];
    const q = station.buildQueue;
    if (!q || q.length === 0) continue;
    const job = q[0];
    job.remainingHours -= drain;
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
          factionMods: factionShipMods(world, job.factionId), // TD3：文明战斗特质汇入 computeShipStats
        });
      }
      q.shift();
      world.stats.shipsBuilt = (world.stats.shipsBuilt || 0) + 1;
    }
  }
}

/**
 * SPEC-PLAN-050 Task 50.2：S4 国家违约建筑费 +25% 非侵入式附加费。
 * tickColonyConstruction（colony.js:317）以 def.cost 原子扣款且该文件不在工位 B
 * 独占清单 —— 附加费在队列头等待/缺料态时预扣 25% 差额（整数化）；
 * job.soSurchargePaid 一次性旗标防等待期逐 tick 重扣；支付失败（账本不足）保持等待。
 */
function applySpaceOperaBuildSurcharge(world, colony, buildingCostMult) {
  if (!colony || !world.spaceOperaState) return;
  const q = colony.constructionQueue;
  const job = q && q[0];
  if (!job) return;
  if (job.state !== 'waiting' && job.state !== 'missing-material') return;
  if (job.soSurchargePaid === true) return;
  const def = buildingDef(job.defId);
  if (!def || !(def.cost > 0)) return;
  const extra = Math.round(def.cost * (buildingCostMult - 1));
  if (extra > 0 && pay(world, colony.factionId, extra, `build:soSurcharge:${def.id}`, colony.id)) {
    job.soSurchargePaid = true;
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

// doc35 WP-P1-1：物理商队航线步进（tradeRoutesActive 旗标未置位时零开销直返 → 金快照零漂移）
registerHourly('trade-routes', (world) => {
  stepTradeRoutes(world);
});

// 太空歌剧三级时钟阶段注册（显式调用置于本文件全部 registerHourly 之后 → space-opera 每 tick 最后执行；
// 静态打包产物中顶层 await 为语法错误、动态 import 相对说明符不可达，统一静态接线）
registerSpaceOperaPhases();
