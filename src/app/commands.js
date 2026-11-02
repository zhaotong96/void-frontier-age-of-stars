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
import { canAfford, pay, debit, credit } from '../domain/economy/ledger.js';
import { canStart, startResearch } from '../domain/research/research.js';
import { marketBuy, marketSell } from '../domain/economy/market.js';
import { validateFit, hullDef, computeShipStats } from '../domain/ships/ship.js';
import { getMod } from '../domain/factions/modifiers.js';
import { declareWar, createTreaty, treatyAcceptanceScore, getRelation } from '../domain/diplomacy/war.js';
import { RNG } from '../core/rng.js';

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
    if (!['hold', 'patrol', 'aggressive', 'escort'].includes(cmd.params.stance)) {
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

function outpostCost(mult) {
  return { alloy: Math.round(20 * mult), credits: Math.round(150 * mult) };
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
    if (!canAfford(ctx.world, cmd.actorId, outpostCost(mult))) {
      return { ok: false, code: 'NO_FUNDS', reason: '资源不足：需要 合金×20 信用点×150' };
    }
    if (planet.habitability < 20) {
      return { ok: false, code: 'HABITABILITY', reason: `宜居度过低（${planet.habitability}），需要环境改造或穹顶科技` };
    }
    return { ok: true };
  },
  execute(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId);
    const mult = getMod(ctx.world, cmd.actorId, 'colonizationCost', 'mult') || 1;
    pay(ctx.world, cmd.actorId, outpostCost(mult), 'foundOutpost', planet.id);
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
