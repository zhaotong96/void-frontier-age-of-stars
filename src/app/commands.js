/**
 * app/commands.js — 玩家/系统命令注册中心（任务书 2.4）
 *
 * 所有可执行命令在此集中注册；UI 与 AI 都经由 CommandBus 调用，
 * 权限与前置检查一体适用。validate 不得改状态；execute 失败抛错由总线回滚。
 */

import { registerCommand } from '../core/commandBus.js';
import { getEntity, createEntity } from '../domain/entities/registry.js';
import { canScanTarget, startScan, scanPower } from '../domain/exploration/scan.js';
import { orderMove, addShipToFleet, createFleet } from '../domain/fleets/fleet.js';
import { orderRetreat, findAttackTarget } from '../domain/combat/engagement.js';
import { foundColony, buildingDef } from '../domain/planets/colony.js';
import { canAfford, pay, debit, credit, balance, creditColony } from '../domain/economy/ledger.js';
import { canStart, startResearch } from '../domain/research/research.js';
import { marketBuy, marketSell } from '../domain/economy/market.js';
import { validateFit, hullDef, computeShipStats } from '../domain/ships/ship.js';
import { getMod } from '../domain/factions/modifiers.js';
import { declareWar, createTreaty, treatyAcceptanceScore, getRelation, resolvePeaceProposal, annexOccupiedSystem, warScore, OCCUPATION_ANNEX_THRESHOLD } from '../domain/diplomacy/war.js';
import { buildTerrainField, TERRAIN_FLAGS } from '../domain/ground/terrainField.js';
import {
  applyEdit, attachTerrainEdits, serializeEdits, deserializeEdits,
  checkBuildingPlacement, rebuildDirtyChunks, BRUSH_LIMITS,
} from '../domain/ground/terrainEdits.js';
import { sampleTerrain } from '../domain/ground/surfaceQueries.js';
import { BUILDINGS } from '../content/buildings.js';
import { RNG } from '../core/rng.js';
import { emit } from '../core/eventBus.js';
import { advanceSpeciesDiscovery, collectSpecimenSample, ensurePlanetEco } from '../domain/ground/xenobiology.js';
import {
  ensureSurfaceDelta, triggerSosBeaconOutcome, placeFieldDeployable,
  startDeepCoreExtraction, interactPoiStage,
} from '../domain/ground/surfaceEvents.js';
import {
  ensurePlanetRuin, tryCompleteExcavation, inscribeDialectPylon,
  rotateResonatorTower, reportGuardianDefeated, extractMonolithCore,
} from '../domain/ground/monolithRuins.js';
import {
  ensurePlanetInd, rebuildPowerGrids, createBeltTuple, NODE_IDX, NODE_STATE, BELT_IDX,
} from '../domain/industry/planetaryLogistics.js';
import { feedCatapult, resIdToIdx } from '../domain/industry/catapult.js';
import { attachDagIfTemplate } from '../domain/exploration/precursorDag.js';
import './commandsLongline.js'; // doc35：超长线 16 命令注册（ResolveAnomalyDagBranch 等）
import './commandsSpaceOpera.js'; // doc43：太空歌剧 18 命令注册（Phase 0 契约壳，handler 由阶段编排层注入）
import { breakLeviathanPart, reportLeviathanDefeated } from '../domain/ground/planetaryThreat.js';
import { traumaCheck, ensureParagonProfile } from '../domain/characters/galacticParagons.js'; // 42 号 §五.2：总督政治免职创伤检定接线
import {
  ensurePlanetSoc, deriveColonyAgents, resolveColonyDilemma, reportRebellionSuppressed,
  COLONY_EDICTS,
} from '../domain/planets/colonyGovernance.js';
import {
  ensurePlanetFort, callOrbitalSupport, firePlanetaryIonBatteries,
  hostileFleetsInSystemOf, announceIonSalvo,
} from '../domain/strategic/orbitalSynergy.js';
import { checkBuildingPlacementExtended } from '../domain/ground/terrainEdits.js';

function ownFleet(world, cmd) {
  const fleet = getEntity(world, 'fleets', cmd.params.fleetId || cmd.targetId);
  if (!fleet) return { err: '目标舰队不存在' };
  if (cmd.actorId && fleet.factionId !== cmd.actorId) return { err: '舰队不属于该文明' };
  return { fleet };
}

// —— 探索 ————————————————————————————————————————

registerCommand('IssueScanOrder', {
  desc: '命令舰队扫描目标星系',
  validate(ctx, cmd) {
    const { fleet, err } = ownFleet(ctx.world, cmd);
    if (err) return { ok: false, code: 'NO_TARGET', reason: err };
    const chk = canScanTarget(ctx.world, fleet, cmd.params.targetSystemId);
    if (!chk.ok) return { ok: false, code: 'RANGE', reason: chk.reason };
    if (scanPower(ctx.world, fleet, fleet.factionId) <= 0) {
      return { ok: false, code: 'NO_SENSOR', reason: '舰队没有具备传感器的舰船' };
    }
    return { ok: true };
  },
  execute(ctx, cmd) {
    const fleet = getEntity(ctx.world, 'fleets', cmd.params.fleetId);
    startScan(ctx.world, fleet, cmd.params.targetSystemId);
  },
});

registerCommand('InvestigateAnomaly', {
  desc: '派遣舰队调查异常',
  validate(ctx, cmd) {
    const { fleet, err } = ownFleet(ctx.world, cmd);
    if (err) return { ok: false, code: 'NO_TARGET', reason: err };
    const ano = getEntity(ctx.world, 'anomalies', cmd.params.anomalyId);
    if (!ano) return { ok: false, code: 'NO_TARGET', reason: '异常不存在' };
    if (ano.state === 'resolved') return { ok: false, code: 'DONE', reason: '该异常已完成调查' };
    if (fleet.systemId !== ano.systemId) return { ok: false, code: 'RANGE', reason: '舰队不在异常所在星系' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const ano = getEntity(ctx.world, 'anomalies', cmd.params.anomalyId);
    const fleet = getEntity(ctx.world, 'fleets', cmd.params.fleetId);
    // doc35 WP-P0-1：玩家调查默认升级为 DAG 异象树（attachDagIfTemplate 无模板时原样返回；
    // AI 从不下达本命令 → 金快照 8be8ce2c 零漂移）
    attachDagIfTemplate(ctx.world, ano);
    ano.state = 'analyzing';
    fleet.orders = { kind: 'investigate', anomalyId: ano.id, stage: 'underway' };
  },
});

// —— 舰队 ————————————————————————————————————————

registerCommand('OrderFleetMove', {
  desc: '舰队沿航路移动',
  validate(ctx, cmd) {
    const { fleet, err } = ownFleet(ctx.world, cmd);
    if (err) return { ok: false, code: 'NO_TARGET', reason: err };
    if (fleet.shipIds.length === 0) return { ok: false, code: 'EMPTY', reason: '舰队没有舰船' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const fleet = getEntity(ctx.world, 'fleets', cmd.params.fleetId);
    const res = orderMove(ctx.world, fleet, cmd.params.targetSystemId);
    if (!res.ok) throw new Error(res.reason);
  },
});

registerCommand('SetFleetStance', {
  desc: '设置舰队交战姿态',
  validate(ctx, cmd) {
    const { fleet, err } = ownFleet(ctx.world, cmd);
    if (err) return { ok: false, code: 'NO_TARGET', reason: err };
    if (!['hold', 'patrol', 'aggressive', 'escort', 'silent_ambush'].includes(cmd.params.stance)) {
      return { ok: false, code: 'BAD_PARAM', reason: '未知姿态' };
    }
    return { ok: true };
  },
  execute(ctx, cmd) {
    const fleet = getEntity(ctx.world, 'fleets', cmd.params.fleetId);
    fleet.stance = cmd.params.stance;
  },
});

registerCommand('OrderFleetRetreat', {
  desc: '命令战斗中的舰队跃迁撤离（蓄能后脱离）',
  validate(ctx, cmd) {
    const { fleet, err } = ownFleet(ctx.world, cmd);
    if (err) return { ok: false, code: 'NO_TARGET', reason: err };
    let inBattle = false;
    for (const bid of Object.keys(ctx.world.battles.active)) {
      const b = ctx.world.battles.active[bid];
      if (b.fleetIds && (b.fleetIds.a === fleet.id || b.fleetIds.b === fleet.id)) inBattle = true;
    }
    if (!inBattle) return { ok: false, code: 'NOT_IN_BATTLE', reason: '舰队不在战斗中' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const fleet = getEntity(ctx.world, 'fleets', cmd.params.fleetId);
    orderRetreat(ctx.world, fleet);
  },
});

registerCommand('OrderFleetAttack', {
  desc: '主动攻击同星系敌对舰队（触发交战判定）',
  validate(ctx, cmd) {
    const { fleet, err } = ownFleet(ctx.world, cmd);
    if (err) return { ok: false, code: 'NO_TARGET', reason: err };
    if (!fleet.systemId) return { ok: false, code: 'IN_TRANSIT', reason: '舰队在途中' };
    const target = findAttackTarget(ctx.world, fleet);
    if (!target) return { ok: false, code: 'NO_ENEMY', reason: '星系内无敌对舰队' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const fleet = getEntity(ctx.world, 'fleets', cmd.params.fleetId);
    fleet.stance = 'aggressive';
  },
});

// —— 殖民 ————————————————————————————————————————

function outpostCost(mult, world = null, factionId = null) {
  // 治理规模递增：每 +4 个殖民地，扩张成本 +30%（行政容量约束的扩张代价）
  let scale = 1;
  if (world && factionId) {
    const colonies = Object.values(world.entities.colonies).filter((c) => c.factionId === factionId).length;
    scale = 1 + Math.floor(colonies / 4) * 0.3;
  }
  return { alloy: Math.round(20 * mult * scale), credits: Math.round(150 * mult * scale) };
}

registerCommand('FoundOutpost', {
  desc: '在行星建立前哨（后续可升级为殖民地）',
  validate(ctx, cmd) {
    const { fleet, err } = ownFleet(ctx.world, cmd);
    if (err) return { ok: false, code: 'NO_TARGET', reason: err };
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId);
    if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
    if (planet.colonyId) return { ok: false, code: 'TAKEN', reason: '该行星已有殖民地' };
    if (fleet.systemId !== planet.systemId) return { ok: false, code: 'RANGE', reason: '舰队不在目标行星星系' };
    const mult = getMod(ctx.world, cmd.actorId, 'colonizationCost', 'mult') || 1;
    if (!canAfford(ctx.world, cmd.actorId, outpostCost(mult, ctx.world, cmd.actorId))) {
      const c = outpostCost(mult, ctx.world, cmd.actorId);
      return { ok: false, code: 'NO_FUNDS', reason: `资源不足：需要 合金×${c.alloy} 信用点×${c.credits}` };
    }
    if (planet.habitability < 20) {
      return { ok: false, code: 'HABITABILITY', reason: `宜居度过低（${planet.habitability}），需要环境改造或穹顶科技` };
    }
    return { ok: true };
  },
  execute(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId);
    const mult = getMod(ctx.world, cmd.actorId, 'colonizationCost', 'mult') || 1;
    pay(ctx.world, cmd.actorId, outpostCost(mult, ctx.world, cmd.actorId), 'foundOutpost', planet.id);
    foundColony(ctx.world, planet.id, cmd.actorId, 6, true);
    ctx.world.stats.coloniesFounded = (ctx.world.stats.coloniesFounded || 0) + 1;
  },
});

registerCommand('BuildOnColony', {
  desc: '在殖民地排入一项建造',
  validate(ctx, cmd) {
    const colony = getEntity(ctx.world, 'colonies', cmd.params.colonyId || cmd.targetId);
    if (!colony) return { ok: false, code: 'NO_TARGET', reason: '殖民地不存在' };
    if (cmd.actorId && colony.factionId !== cmd.actorId) return { ok: false, code: 'FORBIDDEN', reason: '非己方殖民地' };
    const def = buildingDef(cmd.params.defId);
    if (!def) return { ok: false, code: 'NO_DEF', reason: '未知建筑' };
    // 采掘类建筑必须与行星矿藏匹配（任务书 0.2：禁止装饰性数据）
    if (def.category === 'mining' && colony.planetId) {
      const planet = ctx.world.entities.planets[colony.planetId];
      if (planet && planet.deposits) {
        const depMap = { bld_mine_ferro: 'ferro', bld_mine_silicate: 'silicate', bld_mine_rare: 'rareEarth', bld_mine_heavy: 'heavyMetal', bld_volatile_well: 'hydrogen', bld_gas_harvester: 'helium3' };
        const need = depMap[def.id];
        if (need && !(planet.deposits[need] > 0)) {
          return { ok: false, code: 'NO_DEPOSIT', reason: `该行星缺乏${need}矿藏` };
        }
      }
    }
    if (def.techReq && !(ctx.world.research[colony.factionId]?.completed || []).includes(def.techReq)) {
      return { ok: false, code: 'NO_TECH', reason: '科技未解锁' };
    }
    const slots = colony.buildingSlots || 12;
    if (colony.buildings.length >= slots) return { ok: false, code: 'NO_SLOTS', reason: '建筑槽位已满' };
    if ((colony.constructionQueue || []).length >= 5) return { ok: false, code: 'QUEUE_FULL', reason: '建造队列已满' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const colony = getEntity(ctx.world, 'colonies', cmd.params.colonyId || cmd.targetId);
    colony.constructionQueue ||= [];
    colony.constructionQueue.push({ defId: cmd.params.defId, state: 'waiting', progress: 0 });
  },
});

registerCommand('UpgradeColony', {
  desc: '前哨升级为完整殖民地（支付资源，解锁完整人口增长）',
  validate(ctx, cmd) {
    const colony = getEntity(ctx.world, 'colonies', cmd.params.colonyId || cmd.targetId);
    if (!colony) return { ok: false, code: 'NO_TARGET', reason: '殖民地不存在' };
    if (!colony.isOutpost) return { ok: false, code: 'DONE', reason: '已是完整殖民地' };
    if (!canAfford(ctx.world, colony.factionId, { alloy: 30, credits: 220 })) {
      return { ok: false, code: 'NO_FUNDS', reason: '资源不足：合金×30 信用点×220' };
    }
    return { ok: true };
  },
  execute(ctx, cmd) {
    const colony = getEntity(ctx.world, 'colonies', cmd.params.colonyId || cmd.targetId);
    pay(ctx.world, colony.factionId, { alloy: 30, credits: 220 }, 'upgradeColony', colony.id);
    colony.isOutpost = false;
    colony.housing += 10;
    colony.stockpile.food = (colony.stockpile.food || 0) + 40; // 殖民物资补给
  },
});

// —— 科研 ————————————————————————————————————————

registerCommand('StartResearch', {
  desc: '启动科研项目（进入当前研究槽）',
  validate(ctx, cmd) {
    const chk = canStart(ctx.world, cmd.actorId, cmd.params.techId);
    if (!chk.ok) return { ok: false, code: 'PREREQ', reason: chk.reason };
    const rs = ctx.world.research[cmd.actorId];
    if (rs.active.length >= 2) return { ok: false, code: 'SLOTS_FULL', reason: '研究槽已满（最多 2 项并行）' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    startResearch(ctx.world, cmd.actorId, cmd.params.techId);
  },
});

registerCommand('QueueResearch', {
  desc: '将科技加入研究队列（开始时校验前置）',
  validate(ctx, cmd) {
    const rs = ctx.world.research[cmd.actorId];
    if (!rs) return { ok: false, code: 'NO_RESEARCH', reason: '科研状态未初始化' };
    if (rs.queue.length >= 8) return { ok: false, code: 'QUEUE_FULL', reason: '研究队列已满' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const rs = ctx.world.research[cmd.actorId];
    if (!rs.queue.includes(cmd.params.techId)) rs.queue.push(cmd.params.techId);
  },
});

// —— 市场 ————————————————————————————————————————

registerCommand('MarketBuy', {
  desc: '在星系市场购买资源',
  validate(ctx, cmd) {
    const sys = getEntity(ctx.world, 'systems', cmd.params.systemId || cmd.targetId);
    if (!sys) return { ok: false, code: 'NO_TARGET', reason: '星系不存在' };
    if (!(Math.floor(cmd.params.qty) > 0)) return { ok: false, code: 'BAD_PARAM', reason: '数量必须为正' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const res = marketBuy(ctx.world, cmd.actorId, cmd.params.systemId || cmd.targetId, cmd.params.resId, cmd.params.qty, { debit, credit });
    if (!res.ok) throw new Error(res.reason);
  },
});

registerCommand('MarketSell', {
  desc: '在星系市场出售资源',
  validate(ctx, cmd) {
    if (!(Math.floor(cmd.params.qty) > 0)) return { ok: false, code: 'BAD_PARAM', reason: '数量必须为正' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const res = marketSell(ctx.world, cmd.actorId, cmd.params.systemId || cmd.targetId, cmd.params.resId, cmd.params.qty, { debit, credit });
    if (!res.ok) throw new Error(res.reason);
  },
});

// —— 外交 ————————————————————————————————————————

registerCommand('DeclareWar', {
  desc: '正式宣战（需已接触且有战争理由评估）',
  validate(ctx, cmd) {
    const target = ctx.world.entities.factions[cmd.params.targetFactionId];
    if (!target) return { ok: false, code: 'NO_TARGET', reason: '目标文明不存在' };
    if (cmd.params.targetFactionId === cmd.actorId) return { ok: false, code: 'SELF', reason: '不能对自己宣战' };
    const rel = getRelation(ctx.world, cmd.actorId, cmd.params.targetFactionId);
    if (rel.contactState !== 'contacted') return { ok: false, code: 'NO_CONTACT', reason: '尚未完成首次接触' };
    if (rel.warId && ctx.world.entities.wars[rel.warId]?.status === 'active') {
      return { ok: false, code: 'AT_WAR', reason: '已处于战争状态' };
    }
    const wargoal = cmd.params.wargoal || 'borderSystems';
    if (!['borderSystems', 'haltExpansion', 'reparations', 'liberate', 'protectAlly'].includes(wargoal)) {
      return { ok: false, code: 'BAD_WARGOAL', reason: '未知战争目标' };
    }
    return { ok: true };
  },
  execute(ctx, cmd) {
    const war = declareWar(ctx.world, cmd.actorId, cmd.params.targetFactionId, [cmd.params.wargoal || 'borderSystems']);
    if (!war) throw new Error('宣战失败');
  },
});

registerCommand('OfferTreaty', {
  desc: '提出条约（接受概率由关系/人格效用决定）',
  validate(ctx, cmd) {
    const target = ctx.world.entities.factions[cmd.params.targetFactionId];
    if (!target) return { ok: false, code: 'NO_TARGET', reason: '目标文明不存在' };
    const rel = getRelation(ctx.world, cmd.actorId, cmd.params.targetFactionId);
    if (rel.contactState !== 'contacted') return { ok: false, code: 'NO_CONTACT', reason: '尚未完成首次接触' };
    if (rel.warId && ctx.world.entities.wars[rel.warId]?.status === 'active') {
      return { ok: false, code: 'AT_WAR', reason: '战争状态不能缔约' };
    }
    if (!['nonaggression', 'trade', 'research', 'openBorders', 'mutualDefense'].includes(cmd.params.type)) {
      return { ok: false, code: 'BAD_TYPE', reason: '未知条约类型' };
    }
    const dup = rel.treaties.some((tid) => {
      const t = ctx.world.entities.treaties[tid];
      return t && t.status === 'active' && t.kind === cmd.params.type;
    });
    if (dup) return { ok: false, code: 'DUP', reason: '同类条约已存在' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const score = treatyAcceptanceScore(ctx.world, cmd.actorId, cmd.params.targetFactionId, cmd.params.type);
    // 效用 → 接受概率（-40 → 5%，+60 → 95%）
    const p = Math.max(0.05, Math.min(0.95, (score + 40) / 100));
    if (RNG.chance(ctx.world, p)) {
      createTreaty(ctx.world, cmd.actorId, cmd.params.targetFactionId, cmd.params.type);
    } else {
      const rel = getRelation(ctx.world, cmd.actorId, cmd.params.targetFactionId);
      rel.opinion = Math.max(-100, rel.opinion - 2); // 被拒绝轻微恶化
      emit(ctx.world, 'TreatyRejected', {
        proposerId: cmd.actorId,
        targetId: cmd.params.targetFactionId,
        kind: cmd.params.type,
        score,
      }, 'diplomacy');
    }
  },
});

registerCommand('BreakTreaty', {
  desc: '单方面毁约（信任与好感重挫，记录违约）',
  validate(ctx, cmd) {
    const t = ctx.world.entities.treaties[cmd.params.treatyId];
    if (!t || t.status !== 'active') return { ok: false, code: 'NO_TREATY', reason: '条约不存在或已失效' };
    if (!t.parties.includes(cmd.actorId)) return { ok: false, code: 'FORBIDDEN', reason: '非缔约方' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const t = ctx.world.entities.treaties[cmd.params.treatyId];
    t.status = 'breached';
    const rel = getRelation(ctx.world, t.parties[0], t.parties[1]);
    rel.treaties = rel.treaties.filter((x) => x !== t.id);
    rel.trust = Math.max(0, rel.trust - 18);
    rel.opinion = Math.max(-100, rel.opinion - 15);
    rel.grievances += 1;
    emit(ctx.world, 'TreatyBreached', { treatyId: t.id, reason: 'unilateral' }, 'diplomacy');
  },
});

registerCommand('ImproveRelations', {
  desc: '赠送信用点改善关系（250 点起）',
  validate(ctx, cmd) {
    const rel = getRelation(ctx.world, cmd.actorId, cmd.params.targetFactionId);
    if (rel.contactState !== 'contacted') return { ok: false, code: 'NO_CONTACT', reason: '尚未接触' };
    const amount = cmd.params.amount || 250;
    if (amount < 100) return { ok: false, code: 'TOO_SMALL', reason: '最低 100 信用点' };
    if (!canAfford(ctx.world, cmd.actorId, { credits: amount })) return { ok: false, code: 'NO_FUNDS', reason: '信用点不足' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const amount = cmd.params.amount || 250;
    debit(ctx.world, cmd.actorId, 'credits', amount, 'diplomaticGift', cmd.params.targetFactionId);
    const rel = getRelation(ctx.world, cmd.actorId, cmd.params.targetFactionId);
    rel.opinion = Math.min(100, rel.opinion + Math.round(amount / 50));
    rel.trust = Math.min(100, rel.trust + 3);
    emit(ctx.world, 'DiplomaticGift', { from: cmd.actorId, to: cmd.params.targetFactionId, amount }, 'diplomacy');
  },
});

// —— 叙事 ————————————————————————————————————————

import { resolveChoice } from '../domain/events/narrative.js';
import { dispatchObjectiveFleet } from '../domain/events/objectives.js';
import { harvestPlanetPoi } from '../domain/ground/planetPOI.js';
import { canEnact, enactPolicy, revokePolicy } from '../domain/politics/policy.js';

registerCommand('EnactPolicy', {
  desc: '颁布政策（影响力成本 + 行政容量占用）',
  validate(ctx, cmd) {
    const r = canEnact(ctx.world, cmd.actorId, cmd.params.policyId);
    if (!r.ok) return { ok: false, code: r.code, reason: r.reason };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const r = enactPolicy(ctx.world, cmd.actorId, cmd.params.policyId);
    if (!r.ok) throw new Error(r.reason);
  },
});

registerCommand('RevokePolicy', {
  desc: '撤销政策（进入冷却，影响力不退还）',
  validate(ctx, cmd) {
    const fac = ctx.world.entities.factions[cmd.actorId];
    if (!fac?.policies?.[cmd.params.policyId]) {
      return { ok: false, code: 'NOT_ACTIVE', reason: '政策未生效' };
    }
    return { ok: true };
  },
  execute(ctx, cmd) {
    const r = revokePolicy(ctx.world, cmd.actorId, cmd.params.policyId);
    if (!r.ok) throw new Error(r.reason);
  },
});

registerCommand('ResolveEventChoice', {
  desc: '结算事件抉择',
  validate(ctx, cmd) {
    const pending = ctx.world.narrative.pendingChoices.some((p) => p.eventId === cmd.params.eventId);
    if (!pending) return { ok: false, code: 'NO_EVENT', reason: '事件不存在或已结算' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const r = resolveChoice(ctx.world, cmd.params.eventId, cmd.params.choiceId);
    if (!r.ok) throw new Error(r.reason);
  },
});

import { playerContribute } from '../domain/events/crisis.js';

registerCommand('ContributeToCrisis', {
  desc: '向危机应对投入科研数据（每次 ≥20）',
  validate(ctx, cmd) {
    const amount = cmd.params.amount || 20;
    if (amount < 20) return { ok: false, code: 'TOO_SMALL', reason: '每次至少投入 20 科研数据' };
    if ((ctx.world.economy.ledgers[cmd.actorId]?.balances?.researchData ?? 0) < amount) {
      return { ok: false, code: 'NO_FUNDS', reason: '科研数据不足' };
    }
    return { ok: true };
  },
  execute(ctx, cmd) {
    const r = playerContribute(ctx.world, cmd.params.crisisId, cmd.params.amount || 20);
    if (!r.ok) throw new Error(r.reason);
  },
});

// —— 空间任务目标（doc5 §3.6 / EVT-02） ————————————————————————

registerCommand('DispatchObjectiveFleet', {
  desc: '向空间任务目标派遣舰队（复用 OrderFleetMove 域路径）',
  validate(ctx, cmd) {
    const o = getEntity(ctx.world, 'objectives', cmd.params.objectiveId);
    if (!o) return { ok: false, code: 'NO_TARGET', reason: '任务目标不存在' };
    if (o.status !== 'active') return { ok: false, code: 'DONE', reason: '任务目标已结束' };
    const { fleet, err } = ownFleet(ctx.world, cmd);
    if (err) return { ok: false, code: 'NO_FLEET', reason: err };
    if (fleet.shipIds.length === 0) return { ok: false, code: 'EMPTY', reason: '舰队没有舰船' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const res = dispatchObjectiveFleet(ctx.world, cmd.params.objectiveId, cmd.params.fleetId);
    if (!res.ok) throw new Error(res.reason || '派遣失败');
  },
});

// —— 行星 POI（doc5 §3.7 / SAVE-03） ——————————————————————————————

registerCommand('HarvestPlanetPOI', {
  desc: '采样行星兴趣点（rewardPaid 严格幂等锁，绝不重复发奖）',
  validate(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId);
    if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
    const poi = (planet.pois || {})[cmd.params.poiId];
    if (!poi) return { ok: false, code: 'NO_POI', reason: '兴趣点不存在' };
    if (poi.rewardPaid || poi.state !== 'unexplored') {
      return { ok: false, code: 'ALREADY_HARVESTED', reason: '该兴趣点已采样结算' };
    }
    if (poi.kind === 'storm_vortex' && balance(ctx.world, cmd.actorId, 'powerCell') < 2) {
      return { ok: false, code: 'NO_FUNDS', reason: '大气探针需要 能量电池×2' };
    }
    return { ok: true };
  },
  execute(ctx, cmd) {
    const res = harvestPlanetPoi(ctx.world, cmd.params.planetId, cmd.params.poiId, cmd.actorId);
    if (!res.ok) throw new Error(res.reason || res.code);
  },
});

// —— 地面行动 ————————————————————————————————————————

import { createGroundMission, stepMission, abortMission } from '../domain/ground/GroundMission.js';
import { MISSION_TEMPLATES, findMissionTemplate } from '../content/missions.js';

registerCommand('BeginGroundMission', {
  desc: '在行星发起地面行动任务',
  validate(ctx, cmd) {
    const tpl = findMissionTemplate(cmd.params.templateId);
    if (!tpl) return { ok: false, code: 'NO_TEMPLATE', reason: '未知任务模板' };
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
    if ((ctx.world.entities.groundMissions[cmd.params.planetId] || null) && false) return { ok: true };
    const active = Object.values(ctx.world.entities.groundMissions)
      .some((m) => (m.status === 'active' || m.state === 'active') && m.planetId === planet.id); // VERIFY-07：实体状态字段为 status
    if (active) return { ok: false, code: 'ACTIVE', reason: '该行星已有进行中的行动' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    createGroundMission(ctx.world, {
      templateId: cmd.params.templateId,
      planetId: cmd.params.planetId || cmd.targetId,
      squadCharacterIds: cmd.params.squadCharacterIds || [],
    });
  },
});

registerCommand('SetGroundInput', {
  desc: '写入地面行动玩家输入帧（UI 每帧）',
  validate(ctx, cmd) {
    const m = ctx.world.entities.groundMissions[cmd.params.missionId];
    if (!m || (m.status || m.state) !== 'active') return { ok: false, code: 'NO_MISSION', reason: '无进行中的任务' }; // VERIFY-07
    return { ok: true };
  },
  execute(ctx, cmd) {
    const m = ctx.world.entities.groundMissions[cmd.params.missionId];
    const i = cmd.params.input || {};
    m.input = {
      moveDir: i.moveDir || { x: 0, y: 0 },
      sprint: !!i.sprint,
      attack: i.attack || null,
      dodgeDir: i.dodgeDir || null,
      block: !!i.block,
      interactTarget: i.interactTarget || null,
      switchUnit: Number.isInteger(i.switchUnit) ? i.switchUnit : null,
    };
  },
});

registerCommand('AbortGroundMission', {
  desc: '中止地面行动（无奖励）',
  validate(ctx, cmd) {
    const m = ctx.world.entities.groundMissions[cmd.params.missionId];
    if (!m || (m.status || m.state) !== 'active') return { ok: false, code: 'NO_MISSION', reason: '无进行中的任务' }; // VERIFY-07
    return { ok: true };
  },
  execute(ctx, cmd) {
    const m = ctx.world.entities.groundMissions[cmd.params.missionId];
    abortMission(ctx.world, m); // VERIFY-07：finishMission(w, m, 'aborted') 抛非法参数，必须走 abortMission
  },
});

// —— 地形整形与地表建造（doc7 TASK-5.1/5.2 槽位 5 / TERRAIN-06、GAME-06..08、SITE-07） ————

const SHAPE_OPS = new Set(['raise', 'lower', 'smooth', 'flatten', 'restore']);
const FLORA_OPS = new Set(['plant', 'removePlant']);

/** 采掘类建筑与行星矿藏匹配（与 BuildOnColony 同口径：禁止装饰性数据） */
function miningDepositOk(planet, defId) {
  const def = buildingDef(defId);
  if (!def || def.category !== 'mining' || !planet || !planet.deposits) return true;
  const depMap = { bld_mine_ferro: 'ferro', bld_mine_silicate: 'silicate', bld_mine_rare: 'rareEarth', bld_mine_heavy: 'heavyMetal', bld_volatile_well: 'hydrogen', bld_gas_harvester: 'helium3' };
  const need = depMap[def.id];
  return !need || planet.deposits[need] > 0;
}

/** 取（惰性初始化）行星地形编辑日志（纯 JSON 形态，随行星实体存档 —— SITE-07） */
function terrainEditLog(world, planetId) {
  const planet = world.entities.planets[planetId];
  if (!planet.terrainEdits) {
    planet.terrainEdits = { v: 1, rev: 0, seq: 0, ops: [] };
  }
  return planet.terrainEdits;
}

/** 命令时点校验/执行：由存档日志重建场域 + 活体编辑仓库（一次性成本，可接受） */
function loadLiveEdits(world, planetId) {
  const log = terrainEditLog(world, planetId);
  const field = buildTerrainField(world, planetId, {});
  const edits = deserializeEdits(log, field);
  attachTerrainEdits(field, edits);
  rebuildDirtyChunks(field); // 日志重放只标脏 —— 命令时点采样前须增量重建受影响区块
  return { field, edits };
}

/** ShapeTerrain/RestoreTerrain 共用参数校验（不改状态） */
function validateShapeParams(ctx, cmd, op) {
  const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
  if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
  if (!op) return { ok: false, code: 'BAD_OP', reason: '缺少编辑算子' };
  if (!Number.isFinite(cmd.params.x) || !Number.isFinite(cmd.params.z)) {
    return { ok: false, code: 'BAD_COORD', reason: '场域坐标非法' };
  }
  if (op === 'plant' && (typeof cmd.params.prefabId !== 'string' || cmd.params.prefabId.length === 0)) {
    return { ok: false, code: 'BAD_PARAM', reason: '植被移植需要 prefabId' };
  }
  if (op === 'removePlant' && typeof cmd.params.plantId !== 'string') {
    return { ok: false, code: 'BAD_PARAM', reason: '植被回收需要 plantId' };
  }
  if (SHAPE_OPS.has(op)) {
    const radius = Number(cmd.params.radius);
    if (!(radius > 0) || radius > BRUSH_LIMITS.maxRadiusM) {
      return { ok: false, code: 'BAD_RADIUS', reason: `刷子半径须在 (0,${BRUSH_LIMITS.maxRadiusM}] 米（TERRAIN-06 增量重建约束）` };
    }
    const strength = cmd.params.strength;
    if (op === 'raise' || op === 'lower') {
      if (!Number.isFinite(strength) || strength <= 0 || strength > BRUSH_LIMITS.maxStrokeM) {
        return { ok: false, code: 'BAD_STRENGTH', reason: `行程强度须在 (0,${BRUSH_LIMITS.maxStrokeM}] 米` };
      }
    } else if (op === 'smooth' || op === 'flatten') {
      if (!Number.isFinite(strength) || strength <= 0 || strength > 1) {
        return { ok: false, code: 'BAD_STRENGTH', reason: 'smooth/flatten 强度为混合系数 (0,1]' };
      }
    }
  }
  return { ok: true, planet };
}

/** ShapeTerrain/RestoreTerrain 共用执行体：应用编辑 → 写回存档日志 → 事件 */
function executeShape(ctx, cmd, op) {
  const planetId = cmd.params.planetId || cmd.targetId;
  const { field, edits } = loadLiveEdits(ctx.world, planetId);
  const res = applyEdit(field, edits, {
    kind: op,
    x: cmd.params.x,
    z: cmd.params.z,
    radius: cmd.params.radius,
    strength: cmd.params.strength,
    prefabId: cmd.params.prefabId,
    plantId: cmd.params.plantId,
  });
  // 写回行星实体（紧凑命令序列；GroundView 打开时由该日志确定性重放）
  ctx.world.entities.planets[planetId].terrainEdits = JSON.parse(serializeEdits(edits));
  emit(ctx.world, 'TerrainShaped', {
    planetId,
    op,
    x: cmd.params.x,
    z: cmd.params.z,
    radius: cmd.params.radius ?? null,
    strength: cmd.params.strength ?? null,
    revision: edits.revision,
    dirtyChunks: res.dirtyChunks,
    floraId: res.floraId ?? null,
  }, 'ground');
}

/** doc22：loadLiveEdits 域内引用（CallOrbitalSupport 激光开山复用同一口径） */
function liveEditsFor(world, planetId) {
  return loadLiveEdits(world, planetId);
}

registerCommand('ShapeTerrain', {
  desc: '地形整形器：raise/lower/smooth/flatten 刷子与植被移植（TERRAIN-06 增量重建）',
  validate(ctx, cmd) {
    const op = cmd.params.op;
    if (!SHAPE_OPS.has(op) && !FLORA_OPS.has(op)) {
      return { ok: false, code: 'BAD_OP', reason: `未知算子 ${op}` };
    }
    return validateShapeParams(ctx, cmd, op);
  },
  execute(ctx, cmd) {
    executeShape(ctx, cmd, cmd.params.op);
  },
});

registerCommand('RestoreTerrain', {
  desc: '一键恢复自然地貌（DSP 式：清除半径内全部编辑与凹陷影响）',
  validate(ctx, cmd) {
    return validateShapeParams(ctx, cmd, 'restore');
  },
  execute(ctx, cmd) {
    executeShape(ctx, cmd, 'restore');
  },
});

registerCommand('PlaceBuilding', {
  desc: '地表放置建筑：9 点三角网格投影坡度校验 + 自动地基承台（GAME-07）',
  validate(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
    const defId = cmd.params.defId;
    if (defId && !buildingDef(defId)) return { ok: false, code: 'NO_DEF', reason: '未知建筑' };
    if (!Number.isFinite(cmd.params.x) || !Number.isFinite(cmd.params.z)) {
      return { ok: false, code: 'BAD_COORD', reason: '场域坐标非法' };
    }
    if (defId && !miningDepositOk(planet, defId)) {
      return { ok: false, code: 'NO_DEPOSIT', reason: '该行星缺乏对应矿藏' };
    }
    // 命令时点校验：由存档编辑日志重建场域（含既有地形改造），做 9 点投影坡度校验
    const { field } = loadLiveEdits(ctx.world, planet.id);
    const chk = checkBuildingPlacement(field, cmd.params.x, cmd.params.z, {
      footprintHalfM: cmd.params.footprintHalfM,
      themeId: planet.primaryThemeId,
    });
    // doc22 WP-2：对空离子炮显著度扩展校验（桌山高脊 + 60° 天顶锥角）
    if (defId && buildingDef(defId) && buildingDef(defId).prominence) {
      const ext = checkBuildingPlacementExtended(field, cmd.params.x, cmd.params.z, { defId });
      if (!ext.ok) return { ok: false, code: ext.code || 'PROMINENCE', reason: ext.reason };
    }
    if (!chk.ok) {
      const reason = chk.code === 'SLOPE_TOO_STEEP'
        ? `坡度过大（${chk.maxSlopeDeg.toFixed(1)}° > 阈值），请先整地推平或改用主题桩基`
        : chk.code === 'HEIGHT_DELTA'
          ? `落点高差过大（${chk.maxHeightDeltaM.toFixed(2)}m > 阈值），请先整地或使用桩基`
          : '落点在可建造场域之外';
      return { ok: false, code: chk.code || 'OUT_OF_FIELD', reason, maxSlopeDeg: chk.maxSlopeDeg, maxHeightDeltaM: chk.maxHeightDeltaM };
    }
    return { ok: true, planet, foundation: chk.foundation, maxSlopeDeg: chk.maxSlopeDeg, maxHeightDeltaM: chk.maxHeightDeltaM };
  },
  execute(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    planet.groundBuildings ||= [];
    // validate 已通过坡度校验；此处的 foundation 由再次快速校验得出（同输入逐位一致）
    const { field } = loadLiveEdits(ctx.world, planet.id);
    const chk = checkBuildingPlacement(field, cmd.params.x, cmd.params.z, {
      footprintHalfM: cmd.params.footprintHalfM,
      themeId: planet.primaryThemeId,
    });
    const entry = {
      defId: cmd.params.defId || 'bld_generic_pad',
      x: cmd.params.x,
      z: cmd.params.z,
      foundation: chk.ok ? chk.foundation : { kind: 'flat', piling: 'standard', etaHeightM: 0 },
      maxSlopeDeg: chk.maxSlopeDeg,
      maxHeightDeltaM: chk.maxHeightDeltaM,
      placedTick: ctx.world.tick,
    };
    planet.groundBuildings.push(entry);
    emit(ctx.world, 'BuildingPlaced', {
      planetId: planet.id,
      defId: entry.defId,
      x: entry.x,
      z: entry.z,
      foundation: entry.foundation,
      index: planet.groundBuildings.length - 1,
    }, 'ground');
    // —— doc19 WP-1：L2 工业节点双写（电网/加工/分流/弹射定义的建筑同时入 planet.ind.nodes） ——
    const defIdx = BUILDINGS.findIndex((b) => b.id === entry.defId);
    const def2 = BUILDINGS[defIdx];
    if (defIdx >= 0 && def2 && (def2.wireRadiusM > 0 || def2.indRecipe || def2.splitter || def2.catapult)) {
      const ind = ensurePlanetInd(planet);
      ind.nodes.push([
        ind.nodes.reduce((m, n) => Math.max(m, n[NODE_IDX.ID]), 0) + 1,
        defIdx,
        Math.round(cmd.params.x * 10), Math.round(cmd.params.z * 10),
        Math.round((chk.ok ? entry.foundation.etaHeightM || 0 : 0) * 10),
        0, NODE_STATE.OFFLINE, 0, 0, 0, 0, 0, 0,
      ]);
      rebuildPowerGrids(ind, BUILDINGS);
    }
    // doc22 WP-2/WP-3：离子炮入 fort 台账（7 元组 [id, defIdx, x_dm, z_dm, y_dm, online, cdHours]）
    const defF = BUILDINGS.find((b) => b.id === entry.defId);
    if (defF && defF.ionBattery) {
      const fort = ensurePlanetFort(planet);
      fort.ionBatteries.push([
        fort.ionBatteries.reduce((m, b) => Math.max(m, b[0]), 0) + 1,
        defIdx,
        Math.round(cmd.params.x * 10), Math.round(cmd.params.z * 10),
        Math.round((entry.foundation && Number.isFinite(entry.foundation.etaHeightM) ? entry.foundation.etaHeightM : 0) * 10),
        1, 0,
      ]);
    }
    if (defF && defF.planetaryShield) {
      const fort = ensurePlanetFort(planet);
      fort.planetaryShield = { hp: 3000, hpMax: 3000 };
    }
  },
});

// —— WP-4 地质采掘（场域工程作业闭环） ————————————————————————————

/** 行星矿藏 → 采掘资源 id（与 miningDepositOk 同一优先序；缺省 ferro） */
function fieldOreResIdOf(planet) {
  const priority = ['ferro', 'silicate', 'heavyMetal', 'rareEarth'];
  for (let i = 0; i < priority.length; i++) {
    if (planet.deposits && planet.deposits[priority[i]] > 0) return priority[i];
  }
  return 'ferro';
}

registerCommand('HarvestTerrainOre', {
  desc: '地质采掘：场域 ORE 旗点位采矿（amount=1）入殖民地仓储（WP-4 工程作业）',
  validate(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
    if (!Number.isFinite(cmd.params.x) || !Number.isFinite(cmd.params.z)) {
      return { ok: false, code: 'BAD_COORD', reason: '场域坐标非法' };
    }
    const { field } = loadLiveEdits(ctx.world, planet.id);
    const s = sampleTerrain(field, cmd.params.x, cmd.params.z);
    if (!s || (s.flags & TERRAIN_FLAGS.ORE) === 0) {
      return { ok: false, code: 'NO_ORE', reason: '此处无矿脉' };
    }
    return { ok: true, planet, resId: fieldOreResIdOf(planet) };
  },
  execute(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    const resId = fieldOreResIdOf(planet);
    const colony = Object.values(ctx.world.entities.colonies || {})
      .find((c) => c.planetId === planet.id) || null;
    if (colony) {
      creditColony(ctx.world, colony, resId, 1, 'terrainHarvest', colony.id);
    }
    emit(ctx.world, 'TerrainOreHarvested', {
      planetId: planet.id, x: cmd.params.x, z: cmd.params.z, resId, credited: !!colony,
    }, 'ground');
  },
});

// —— doc19 v0.4：行星级工业与天地物流命令（WP-1/WP-2/WP-4） ——————————————

registerCommand('BuildConveyorBelt', {
  desc: '铺设样条传送带（FFF #176 12 元组；O(1) 步进；doc19 WP-2）',
  validate(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
    const ind = ensurePlanetInd(planet);
    const from = ind.nodes.find((n) => n[NODE_IDX.ID] === cmd.params.fromNodeId);
    const to = ind.nodes.find((n) => n[NODE_IDX.ID] === cmd.params.toNodeId);
    if (!from || !to) return { ok: false, code: 'NO_NODE', reason: '工业节点不存在' };
    if (from[NODE_IDX.ID] === to[NODE_IDX.ID]) return { ok: false, code: 'SELF_LINK', reason: '不可自连' };
    const tier = cmd.params.tier || 1;
    if (!(tier >= 1 && tier <= 3)) return { ok: false, code: 'BAD_TIER', reason: '传送带档位 1..3' };
    const dx = (from[NODE_IDX.X_DM] - to[NODE_IDX.X_DM]) / 10;
    const dz = (from[NODE_IDX.Z_DM] - to[NODE_IDX.Z_DM]) / 10;
    const lenM = Math.hypot(dx, dz);
    if (lenM < 1 || lenM > 128) return { ok: false, code: 'BAD_LEN', reason: `带长 1~128m（实测 ${lenM.toFixed(1)}m）` };
    if (ind.belts.length >= 96) return { ok: false, code: 'TOO_MANY', reason: '单星传送带预算上限 96 条' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    const ind = ensurePlanetInd(planet);
    const tier = cmd.params.tier || 1;
    const from = ind.nodes.find((n) => n[NODE_IDX.ID] === cmd.params.fromNodeId);
    const to = ind.nodes.find((n) => n[NODE_IDX.ID] === cmd.params.toNodeId);
    const lenM = Math.hypot((from[NODE_IDX.X_DM] - to[NODE_IDX.X_DM]) / 10, (from[NODE_IDX.Z_DM] - to[NODE_IDX.Z_DM]) / 10);
    const belt = createBeltTuple(ind, {
      fromNode: from[NODE_IDX.ID], fromSlot: cmd.params.fromSlot | 0,
      toNode: to[NODE_IDX.ID], toSlot: cmd.params.toSlot | 0,
      tier, lengthM: lenM, resTypeIdx: cmd.params.resTypeIdx | 0,
    });
    ind.belts.push(belt);
    emit(ctx.world, 'ConveyorBeltBuilt', { planetId: planet.id, beltId: belt[BELT_IDX.ID], lengthM }, 'ground');
  },
});

registerCommand('ConfigureSplitter', {
  desc: '设置分流器路由模式（0 轮询/1 优先/2 过滤 + 过滤资源；doc19 WP-3）',
  validate(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    if (!planet || !planet.ind) return { ok: false, code: 'NO_TARGET', reason: '行星无工业层' };
    const node = planet.ind.nodes.find((n) => n[NODE_IDX.ID] === cmd.params.nodeId);
    if (!node) return { ok: false, code: 'NO_NODE', reason: '分流器节点不存在' };
    const def = BUILDINGS[node[NODE_IDX.DEF]];
    if (!def || !def.splitter) return { ok: false, code: 'NOT_SPLITTER', reason: '目标不是分流器' };
    const mode = cmd.params.mode | 0;
    if (!(mode >= 0 && mode <= 2)) return { ok: false, code: 'BAD_MODE', reason: '模式 0..2' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    const node = planet.ind.nodes.find((n) => n[NODE_IDX.ID] === cmd.params.nodeId);
    node[NODE_IDX.ROT] = (node[NODE_IDX.ROT] & ~0b11) | ((cmd.params.mode | 0) & 0b11);
    node[NODE_IDX.RECIPE] = cmd.params.filterResIdx | 0;
    emit(ctx.world, 'SplitterConfigured', { planetId: planet.id, nodeId: node[NODE_IDX.ID], mode: cmd.params.mode | 0 }, 'ground');
  },
});

registerCommand('CatapultFeed', {
  desc: '货运弹射井物资汇集（每 50 单位装配 1 舱；doc19 WP-4）',
  validate(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    if (!planet || !planet.ind) return { ok: false, code: 'NO_TARGET', reason: '行星无工业层' };
    const node = planet.ind.nodes.find((n) => n[NODE_IDX.ID] === cmd.params.nodeId);
    if (!node) return { ok: false, code: 'NO_NODE', reason: '弹射井节点不存在' };
    const def = BUILDINGS[node[NODE_IDX.DEF]];
    if (!def || !def.catapult) return { ok: false, code: 'NOT_CATAPULT', reason: '目标不是弹射井' };
    const units = cmd.params.units | 0;
    if (!(units > 0)) return { ok: false, code: 'BAD_UNITS', reason: '汇集单位须 > 0' };
    const resId = cmd.params.resId || 'alloy';
    const colony = Object.values(ctx.world.entities.colonies || {}).find((cc) => cc.planetId === planet.id);
    if (colony && (colony.stockpile || {})[resId] !== undefined) {
      if ((colony.stockpile[resId] || 0) < units) return { ok: false, code: 'NO_FUNDS', reason: `${resId} 库存不足` };
    }
    return { ok: true };
  },
  execute(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    const resId = cmd.params.resId || 'alloy';
    const units = cmd.params.units | 0;
    const colony = Object.values(ctx.world.entities.colonies || {}).find((cc) => cc.planetId === planet.id);
    if (colony && (colony.stockpile || {})[resId] !== undefined) {
      colony.stockpile[resId] -= units;   // 从殖民地仓储扣料
    }
    feedCatapult(planet.ind, resIdToIdx(resId), units);
    emit(ctx.world, 'CatapultFed', { planetId: planet.id, resId, units }, 'ground');
  },
});

// —— doc20 v0.6：利维坦部位破坏与讨伐战果命令（WP-4） ——————————————————

registerCommand('BreakLeviathanPart', {
  desc: '利维坦部位破坏回执（背部散热晶核/毒素腺囊 → 6s 瘫痪硬直；doc20 WP-4）',
  validate(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    if (!planet || !planet.threat || !planet.threat.leviathan || !planet.threat.leviathan.active) {
      return { ok: false, code: 'NO_LEVIATHAN', reason: '利维坦未苏醒' };
    }
    if (!['back_core', 'toxin_sacs'].includes(cmd.params.part)) {
      return { ok: false, code: 'BAD_PART', reason: '部位非法' };
    }
    return { ok: true };
  },
  execute(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    const res = breakLeviathanPart(ctx.world, planet, cmd.params.part);
    if (!res.ok && !res.already) throw new Error(res.reason || '部位破坏失败');
  },
});

registerCommand('ReportLeviathanDefeated', {
  desc: '利维坦讨伐战果上报（PTI 归零 + 弹射井解锁 + exoticMatter ×5；doc20 WP-4）',
  validate(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    if (!planet || !planet.threat || !planet.threat.leviathan || !planet.threat.leviathan.active) {
      return { ok: false, code: 'NO_LEVIATHAN', reason: '利维坦未苏醒' };
    }
    return { ok: true };
  },
  execute(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    const res = reportLeviathanDefeated(ctx.world, planet);
    if (!res.ok) throw new Error(res.reason || '讨伐上报失败');
  },
});

// —— doc21 v0.8：驻星总督任命与聚落法典命令（WP-3/WP-4） ——————————————————

registerCommand('AppointOverseer', {
  desc: '任命驻星总督（world.entities.characters 领袖；性格特质修正聚落微模拟）',
  validate(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
    const ch = getEntity(ctx.world, 'characters', cmd.params.characterId);
    if (!ch) return { ok: false, code: 'NO_CHARACTER', reason: '人物不存在' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    ensurePlanetSoc(planet);
    const prevOverseerId = planet.soc.overseerId || null;
    planet.soc.overseerId = cmd.params.characterId;
    // —— 42 号总纲 §五.2 创伤检定实战可达整改：驻星总督遭政治免职（换任）→
    //    旧总督 traumaCheck('political_dismissal') 确定性检定（先以 world 固化
    //    paragon.worldSeed 种子，与 grant* 结算路径同源）。守卫 spaceOperaState：
    //    金快照/默认流程世界零读取零写入零漂移。 ——
    if (prevOverseerId && prevOverseerId !== planet.soc.overseerId && ctx.world.spaceOperaState) {
      const dismissed = ctx.world.entities.characters[prevOverseerId];
      if (dismissed) {
        ensureParagonProfile(dismissed, ctx.world);
        traumaCheck(dismissed, 'political_dismissal', ctx.world.tick);
      }
    }
    emit(ctx.world, 'OverseerAppointed', { planetId: planet.id, overseerId: planet.soc.overseerId }, 'ground');
  },
});

registerCommand('SignColonyEdict', {
  desc: '签署聚落法典（四大本地法典；与帝国政策互补；doc21 WP-3.3）',
  validate(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
    if (!COLONY_EDICTS[cmd.params.edictId]) return { ok: false, code: 'NO_EDICT', reason: '未知法典' };
    ensurePlanetSoc(planet);
    if (planet.soc.edicts.includes(cmd.params.edictId)) {
      return { ok: false, code: 'ALREADY_SIGNED', reason: '法典已生效' };
    }
    return { ok: true };
  },
  execute(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    planet.soc.edicts.push(cmd.params.edictId);
    emit(ctx.world, 'ColonyEdictSigned', { planetId: planet.id, edictId: cmd.params.edictId }, 'ground');
  },
});

registerCommand('RevokeColonyEdict', {
  desc: '废止聚落法典',
  validate(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    if (!planet || !planet.soc) return { ok: false, code: 'NO_TARGET', reason: '行星无聚落治理态' };
    if (!planet.soc.edicts.includes(cmd.params.edictId)) {
      return { ok: false, code: 'NOT_SIGNED', reason: '法典未生效' };
    }
    return { ok: true };
  },
  execute(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    planet.soc.edicts = planet.soc.edicts.filter((e) => e !== cmd.params.edictId);
    emit(ctx.world, 'ColonyEdictRevoked', { planetId: planet.id, edictId: cmd.params.edictId }, 'ground');
  },
});

registerCommand('ResolveColonyDilemma', {
  desc: '总督治理困境裁决（罢工/疫情/走私；长期记忆写入 planet.soc.history）',
  validate(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    if (!planet || !planet.soc || !planet.soc.pendingDilemma) {
      return { ok: false, code: 'NO_DILEMMA', reason: '无待裁决困境' };
    }
    if (!planet.soc.pendingDilemma.choices.some((x) => x.id === cmd.params.choiceId)) {
      return { ok: false, code: 'BAD_CHOICE', reason: '未知裁决选项' };
    }
    return { ok: true };
  },
  execute(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    const colony = Object.values(ctx.world.entities.colonies || {}).find((cc) => cc.planetId === planet.id);
    const res = resolveColonyDilemma(ctx.world, planet, colony || null, cmd.params.choiceId);
    if (!res.ok) throw new Error(res.reason || '裁决失败');
  },
});

registerCommand('ReportRebellionSuppressed', {
  desc: '武装平叛战果上报（gmt_suppress_rebellion 成功 → 重置不满/暴动态）',
  validate(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    if (!planet || !planet.soc || !planet.soc.rebellionActive) {
      return { ok: false, code: 'NO_REBELLION', reason: '该行星未处于暴动态' };
    }
    return { ok: true };
  },
  execute(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    const res = reportRebellionSuppressed(ctx.world, planet);
    if (!res.ok) throw new Error(res.reason || '平叛上报失败');
  },
});

// —— doc22 v1.0：天地一体协同命令（WP-1/WP-3） ——————————————————————————

registerCommand('CallOrbitalSupport', {
  desc: '轨道五大战术支援呼叫（激光洗地开山/动能打击/EW/机甲空投/补给舱；doc22 WP-1）',
  validate(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
    const kinds = ['support_orbital_laser', 'support_kinetic_strike', 'support_electronic_warfare', 'support_mech_drop', 'support_supply_pod'];
    if (!kinds.includes(cmd.params.kind)) return { ok: false, code: 'BAD_KIND', reason: '未知支援类型' };
    if (!Number.isFinite(cmd.params.x) || !Number.isFinite(cmd.params.z)) {
      return { ok: false, code: 'BAD_COORD', reason: '信标坐标非法' };
    }
    return { ok: true };
  },
  execute(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    const res = callOrbitalSupport(ctx.world, planet, cmd.params.kind, cmd.params.x, cmd.params.z);
    if (!res.ok) throw new Error(res.reason || '支援呼叫失败');
    // 激光洗地：扫过区域真实开山（ShapeTerrain lower + HarvestTerrainOre——doc22 WP-1.2）
    if (cmd.params.kind === 'support_orbital_laser') {
      const { field: fL, edits: eL } = liveEditsFor(ctx.world, planet.id);
      applyEdit(fL, eL, { kind: 'lower', x: cmd.params.x, z: cmd.params.z, radius: 5, strength: 1.5 });
      ctx.world.entities.planets[planet.id].terrainEdits = JSON.parse(serializeEdits(eL));
      emit(ctx.world, 'OrbitalLaserDug', { planetId: planet.id, x: cmd.params.x, z: cmd.params.z }, 'ground');
    }
  },
});

registerCommand('FirePlanetaryIonBattery', {
  desc: '高地离子炮越级齐射（HourlySystems combat 阶段亦自动触发；doc22 WP-3）',
  validate(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    const hostiles = hostileFleetsInSystemOf(ctx.world, planet);
    const hits = firePlanetaryIonBatteries(ctx.world, planet, hostiles);
    announceIonSalvo(ctx.world, planet, hits);
  },
});

// —— SPEC-39 Phase S1：行星地表深度交互四命令 ————————————————————————————

registerCommand('InteractPoiStage', {
  desc: '深度 POI 三步微副本推进：bit0 切割/清障 → bit1 通电/解密 → bit2 领奖/读日志（SPEC-39）',
  validate(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
    if (cmd.params.poiId == null) return { ok: false, code: 'NO_POI', reason: '缺少 poiId' };
    return { ok: true, planet };
  },
  execute(ctx, cmd) {
    const res = interactPoiStage(ctx.world, cmd.params.planetId || cmd.targetId, cmd.params.poiId, cmd.params.field || null);
    if (!res.ok) throw new Error(res.reason || res.code || 'InteractPoiStage 失败');
    return res;
  },
});

registerCommand('TriggerSosBeacon', {
  desc: 'SOS 求救信标处置（≤6m 触发）：幸存者救援 / 黑匣子绝笔 / 海盗伏击三分支（SPEC-39）',
  validate(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
    return { ok: true, planet };
  },
  execute(ctx, cmd) {
    const res = triggerSosBeaconOutcome(ctx.world, cmd.params.planetId || cmd.targetId, cmd.actorId);
    if (!res.ok) throw new Error(res.reason || res.code || 'TriggerSosBeacon 失败');
    return res;
  },
});

registerCommand('DeployFieldTool', {
  desc: '野战部署物放置：探地雷达 / 充能桩 / 哨兵塔 / 诱饵弹（场上 ≤8、冷却与资源校验，SPEC-39）',
  validate(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
    if (!cmd.params.kindId) return { ok: false, code: 'BAD_KIND', reason: '缺少 kindId' };
    if (!Number.isFinite(cmd.params.x) || !Number.isFinite(cmd.params.z)) {
      return { ok: false, code: 'BAD_POS', reason: '坐标非法' };
    }
    return { ok: true, planet };
  },
  execute(ctx, cmd) {
    const res = placeFieldDeployable(ctx.world, cmd.params.planetId || cmd.targetId, cmd.params.kindId, cmd.params.x, cmd.params.z);
    if (!res.ok) throw new Error(res.reason || res.code || 'DeployFieldTool 失败');
    return res;
  },
});

registerCommand('StartDeepCoreExtraction', {
  desc: '深核矿脉采掘：启动瞬间 +180‰ 热度，600s 钻探期 +4.5/s 噪音引增援，完成入账同位素罐（SPEC-39）',
  validate(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
    if (!Number.isFinite(cmd.params.x) || !Number.isFinite(cmd.params.z)) {
      return { ok: false, code: 'BAD_POS', reason: '坐标非法' };
    }
    return { ok: true, planet };
  },
  execute(ctx, cmd) {
    const res = startDeepCoreExtraction(ctx.world, cmd.params.planetId || cmd.targetId, cmd.params.x, cmd.params.z);
    if (!res.ok) throw new Error(res.reason || res.code || 'StartDeepCoreExtraction 失败');
    return res;
  },
});

// —— 外交战争终局（doc5 TD2 / DIP-02：和谈与占领吞并） ——————————————————

// —— WP-2/WP-3（doc18 v0.2）：异星生态科考与五阶段遗迹命令 ————————————————

registerCommand('ScanPlanetarySpecimens', {
  desc: '科考分析面罩：推进物种图鉴档位（1 Observed / 2 Identified；doc18 WP-2）',
  validate(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
    const stage = cmd.params.targetStage || 1;
    if (!(stage >= 1 && stage <= 3)) return { ok: false, code: 'BAD_STAGE', reason: '档位非法' };
    if (!Number.isInteger(cmd.params.speciesIdx) || cmd.params.speciesIdx < 0) {
      return { ok: false, code: 'BAD_SPECIES', reason: '物种序号非法' };
    }
    return { ok: true, planet, stage };
  },
  execute(ctx, cmd) {
    const res = advanceSpeciesDiscovery(ctx.world, cmd.params.planetId || cmd.targetId, cmd.params.speciesIdx, cmd.params.targetStage || 1);
    if (!res.ok) throw new Error(res.reason || 'ScanPlanetarySpecimens 失败');
    return res;
  },
});

registerCommand('SamplePlanetarySpecimen', {
  desc: '活体采样（Analyzed 里程碑）：入账科研点/生物质并标记 sampleMask（doc16 §4.3）',
  validate(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
    if (!Number.isInteger(cmd.params.speciesIdx) || cmd.params.speciesIdx < 0) {
      return { ok: false, code: 'BAD_SPECIES', reason: '物种序号非法' };
    }
    return { ok: true, planet };
  },
  execute(ctx, cmd) {
    const res = collectSpecimenSample(ctx.world, cmd.params.planetId || cmd.targetId, cmd.params.speciesIdx);
    if (!res.ok) throw new Error(res.reason || 'SamplePlanetarySpecimen 失败');
    return res;
  },
});

registerCommand('AdvanceMonolithStage', {
  desc: '五阶段巨石遗迹推进：excavate 除障 / inscribe 拓印 / rotate 对光 / guardian 守卫战果 / extract 核心破译（doc18 WP-3）',
  validate(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
    const actions = ['excavate', 'inscribe', 'rotate', 'guardianDefeated', 'extract'];
    if (!actions.includes(cmd.params.action)) {
      return { ok: false, code: 'BAD_ACTION', reason: '未知遗迹动作' };
    }
    return { ok: true, planet };
  },
  execute(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId || cmd.targetId);
    if (!planet.eco) ensurePlanetEco(ctx.world, planet);
    const { field } = loadLiveEdits(ctx.world, planet.id);
    ensurePlanetRuin(ctx.world, planet, field);
    let res;
    switch (cmd.params.action) {
      case 'excavate': res = tryCompleteExcavation(ctx.world, planet, field); break;
      case 'inscribe': res = inscribeDialectPylon(ctx.world, planet, cmd.params.pylonIdx | 0); break;
      case 'rotate': res = rotateResonatorTower(ctx.world, planet, cmd.params.towerIdx | 0, field); break;
      case 'guardianDefeated': res = reportGuardianDefeated(ctx.world, planet); break;
      case 'extract': res = extractMonolithCore(ctx.world, planet); break;
      default: res = { ok: false, reason: 'BadAction' };
    }
    if (!res.ok) throw new Error(res.reason || 'AdvanceMonolithStage 失败');
    return res;
  },
});
// —— 外交战争终局（doc5 TD2 / DIP-02：和谈与占领吞并） ——————————————————

registerCommand('ProposePeace', {
  desc: '向交战对方提出和谈（战争疲劳/战况决定接受概率）',
  validate(ctx, cmd) {
    const war = ctx.world.entities.wars[cmd.params.warId];
    if (!war || war.status !== 'active') return { ok: false, code: 'NO_WAR', reason: '战争不存在或已结束' };
    if (!war.attackers.includes(cmd.actorId) && !war.defenders.includes(cmd.actorId)) {
      return { ok: false, code: 'NOT_PARTY', reason: '非交战方' };
    }
    const terms = cmd.params.terms || 'whitePeace';
    if (!['whitePeace', 'enforceStatusQuo', 'sueForPeace'].includes(terms)) {
      return { ok: false, code: 'BAD_TERMS', reason: '未知和谈条款' };
    }
    return { ok: true };
  },
  execute(ctx, cmd) {
    const r = resolvePeaceProposal(ctx.world, cmd.actorId, cmd.params.warId, cmd.params.terms || 'whitePeace');
    if (!r.ok) throw new Error(r.reason || '和谈失败');
  },
});

registerCommand('AnnexOccupied', {
  desc: '正式吞并被占领星系（占领积分达阈值后方可割地）',
  validate(ctx, cmd) {
    const war = ctx.world.entities.wars[cmd.params.warId];
    if (!war) return { ok: false, code: 'NO_WAR', reason: '战争不存在' };
    if (!war.attackers.includes(cmd.actorId) && !war.defenders.includes(cmd.actorId)) {
      return { ok: false, code: 'NOT_PARTY', reason: '非交战方' };
    }
    const sys = getEntity(ctx.world, 'systems', cmd.params.systemId);
    if (!sys) return { ok: false, code: 'NO_TARGET', reason: '星系不存在' };
    if (war.occupiedSystems[cmd.params.systemId] !== cmd.actorId) {
      return { ok: false, code: 'NOT_OCCUPIED', reason: '该星系未被己方实际占领' };
    }
    if (warScore(war, cmd.actorId) < OCCUPATION_ANNEX_THRESHOLD) {
      return { ok: false, code: 'SCORE_TOO_LOW', reason: '占领积分不足，无法割地' };
    }
    return { ok: true };
  },
  execute(ctx, cmd) {
    const r = annexOccupiedSystem(ctx.world, cmd.params.warId, cmd.params.systemId, cmd.actorId);
    if (!r.ok) throw new Error(r.reason || '吞并失败');
  },
});

import { assignToFleet } from '../domain/characters/crew.js';

registerCommand('AssignCharacter', {
  desc: '任命人物为舰队指挥官',
  validate(ctx, cmd) {
    const c = getEntity(ctx.world, 'characters', cmd.params.characterId);
    if (!c || c.health === 'dead') return { ok: false, code: 'NO_CHAR', reason: '人物不可用' };
    if (cmd.actorId && c.factionId !== cmd.actorId) return { ok: false, code: 'FORBIDDEN', reason: '非本文明人物' };
    const f = getEntity(ctx.world, 'fleets', cmd.params.fleetId);
    if (!f || f.factionId !== cmd.actorId) return { ok: false, code: 'NO_FLEET', reason: '舰队不存在' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const r = assignToFleet(ctx.world, cmd.params.characterId, cmd.params.fleetId);
    if (!r.ok) throw new Error(r.reason);
  },
});

// —— 舰船与蓝图 ————————————————————————————————————————

function shipCost(hull, costMult) {
  const m = costMult || 1;
  return {
    credits: Math.round((hull.cost.credits || 0) * m),
    alloy: Math.round((hull.cost.alloy || 0) * m),
    polymer: Math.round((hull.cost.polymer || 0) * m),
  };
}

registerCommand('SaveBlueprint', {
  desc: '保存舰船设计蓝图',
  validate(ctx, cmd) {
    const v = validateFit(cmd.params.hullId, cmd.params.modules || []);
    if (!v.ok) return { ok: false, code: 'INVALID_FIT', reason: v.errors[0].reason };
    return { ok: true };
  },
  execute(ctx, cmd) {
    createEntity(ctx.world, 'blueprints', {
      factionId: cmd.actorId,
      name: cmd.params.name || '未命名设计',
      hullId: cmd.params.hullId,
      modules: (cmd.params.modules || []).slice().sort(),
    });
  },
});

registerCommand('ShipyardBuild', {
  desc: '船坞按蓝图建造舰船（事务：扣料 + 登记队列）',
  validate(ctx, cmd) {
    const bp = getEntity(ctx.world, 'blueprints', cmd.params.blueprintId);
    if (!bp) return { ok: false, code: 'NO_BLUEPRINT', reason: '蓝图不存在' };
    const station = getEntity(ctx.world, 'stations', cmd.params.stationId);
    if (!station || station.kind !== 'shipyard') return { ok: false, code: 'NO_SHIPYARD', reason: '需要轨道船坞' };
    const v = validateFit(bp.hullId, bp.modules);
    if (!v.ok) return { ok: false, code: 'INVALID_FIT', reason: v.errors[0].reason };
    const hull = hullDef(bp.hullId);
    const costMult = getMod(ctx.world, cmd.actorId, 'shipBuildCostReduction', 'mult') || 1;
    if (!canAfford(ctx.world, cmd.actorId, shipCost(hull, costMult))) {
      return { ok: false, code: 'NO_FUNDS', reason: '造船资源不足' };
    }
    return { ok: true };
  },
  execute(ctx, cmd) {
    const bp = getEntity(ctx.world, 'blueprints', cmd.params.blueprintId);
    const hull = hullDef(bp.hullId);
    const costMult = getMod(ctx.world, cmd.actorId, 'shipBuildCostReduction', 'mult') || 1;
    pay(ctx.world, cmd.actorId, shipCost(hull, costMult), 'shipyardBuild', bp.id);
    const station = getEntity(ctx.world, 'stations', cmd.params.stationId);
    station.buildQueue ||= [];
    station.buildQueue.push({
      blueprintId: bp.id,
      remainingHours: hull.buildHours,
      factionId: cmd.actorId,
    });
  },
});

registerCommand('AssembleFleet', {
  desc: '将舰船编入舰队（无 fleetId 则新建）',
  validate(ctx, cmd) {
    const ship = getEntity(ctx.world, 'ships', cmd.params.shipId);
    if (!ship || ship.status !== 'active') return { ok: false, code: 'NO_SHIP', reason: '舰船不可用' };
    if (cmd.actorId && ship.factionId !== cmd.actorId) return { ok: false, code: 'FORBIDDEN', reason: '非己方舰船' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const ship = getEntity(ctx.world, 'ships', cmd.params.shipId);
    let fleet = cmd.params.fleetId ? getEntity(ctx.world, 'fleets', cmd.params.fleetId) : null;
    if (!fleet) {
      fleet = createFleet(ctx.world, {
        factionId: ship.factionId,
        systemId: ship.systemId,
        name: cmd.params.name,
        ships: [],
        role: cmd.params.role || 'combat',
      });
    }
    ship.systemId = ship.systemId ?? fleet.systemId;
    addShipToFleet(ctx.world, fleet, ship.id);
  },
});
