/**
 * app/commandsLongline.js — doc35 超长线 16 命令注册（CommandBus 契约）
 *
 * WP-P0-1：ResolveAnomalyDagBranch / ActivatePrecursorRelic
 * WP-P0-2：ToggleSilentRunning / TriggerDamageControlRestore（+SetCombatTacticalOrder）
 * WP-P1-1：TradeBlackMarket / IssueLetterOfMarque / ClaimPirateBounty
 * WP-P1-2：ConstructSpaceElevator / ExpandOrbitalRingSegment
 * WP-P2-1：StartMegastructureStage / EngageSpaceLeviathan
 * WP-P2-2：ProposeSenateResolution / MusterGalacticDefenseForce /
 *          DesignateCrisisFocusTarget / ExecuteAscensionProject
 *
 * 纪律：全部写操作走 validate→execute；命令触达即惰性置位对应特性旗标
 * （doc35 §5.2：未触碰新特性时与旧世界完全等价 → 金快照零漂移）。
 */

import { registerCommand } from '../core/commandBus.js';
import { getEntity, createEntity } from '../domain/entities/registry.js';
import { pay, balance, credit, debit, FLOW } from '../domain/economy/ledger.js';
import { tradeBlackMarket, issueLetterOfMarque, payPrivateerBounty } from '../domain/economy/blackMarket.js';
import { activateTradeRoutes } from '../domain/economy/tradeRoutes.js';
import { resolveDagChoice, activatePrecursorRelic } from '../domain/exploration/precursorDag.js';
import { enableCombatV2, ensureSubsystems } from '../domain/combat/subsystemsAndEw.js';
import {
  constructSpaceElevator, expandOrbitalRing, startMegastructure,
  advanceMegastructureStage,
} from '../domain/strategic/megastructures.js';
import {
  enableCrisisV2, electCustodian, musterGalacticDefenseForce,
  designateCrisisFocusTarget, advanceAscension, executeBlackHoleAscension, imprintColony,
  ASCENSION_DEFS,
} from '../domain/events/crisis.js';
import { LEVIATHAN_BY_ID, leviathanSiteOk } from '../content/leviathans.js';
import { chronicle, emit } from '../core/eventBus.js';
import { ensureAscensions } from '../domain/events/crisis.js';

/** 与 commands.js ownFleet 同口径的己方舰队校验 */
function ownFleet(world, cmd) {
  const fleet = getEntity(world, 'fleets', cmd.params.fleetId || cmd.targetId);
  if (!fleet) return { err: '目标舰队不存在' };
  if (cmd.actorId && fleet.factionId !== cmd.actorId) return { err: '舰队不属于该文明' };
  return { fleet };
}

// ———— WP-P0-1：先驱者考古与异象 DAG ————

registerCommand('ResolveAnomalyDagBranch', {
  desc: '异象 DAG 受挫抉择结算（赌注破障/规避/强拆）',
  validate(ctx, cmd) {
    const ano = getEntity(ctx.world, 'anomalies', cmd.params.anomalyId);
    if (!ano) return { ok: false, code: 'NO_TARGET', reason: '异常不存在' };
    if (ano.state !== 'awaiting_choice') return { ok: false, code: 'BAD_STATE', reason: '该异常不在受挫抉择态' };
    if (!ano.dag) return { ok: false, code: 'BAD_STATE', reason: '该异常不在 DAG 调查中' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const ano = getEntity(ctx.world, 'anomalies', cmd.params.anomalyId);
    const res = resolveDagChoice(ctx.world, ano, cmd.actorId || ctx.world.playerFactionId, cmd.params.choiceId);
    if (!res.ok) throw new Error(res.reason);
  },
});

registerCommand('ActivatePrecursorRelic', {
  desc: '激活先驱者遗物主动技能（全局 1800 日冷却）',
  validate(ctx, cmd) {
    if (!cmd.params.civId) return { ok: false, code: 'BAD_PARAM', reason: '缺少 civId' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const res = activatePrecursorRelic(ctx.world, cmd.actorId || ctx.world.playerFactionId, cmd.params.civId);
    if (!res.ok) throw new Error(res.reason);
  },
});

// ———— WP-P0-2：战术 v2 ————

registerCommand('ToggleSilentRunning', {
  desc: '舰队静默伏击姿态切换（小行星带/风暴眼特征值 -90%）',
  validate(ctx, cmd) {
    const { fleet, err } = ownFleet(ctx.world, cmd);
    if (err) return { ok: false, code: 'NO_TARGET', reason: err };
    void fleet;
    return { ok: true };
  },
  execute(ctx, cmd) {
    enableCombatV2(ctx.world); // 特性旗标（惰性；命令触达才置位）
    const fleet = getEntity(ctx.world, 'fleets', cmd.params.fleetId);
    const target = fleet.stance === 'silent_ambush' ? 'aggressive' : 'silent_ambush';
    fleet.stance = target;
    emit(ctx.world, 'SilentRunningToggled', { fleetId: fleet.id, stance: target }, 'fleet');
  },
});

registerCommand('TriggerDamageControlRestore', {
  desc: '损管大修备件：将受损最重分部拉回 15% 完好度（Nebulous Restore 口径）',
  validate(ctx, cmd) {
    const ship = getEntity(ctx.world, 'ships', cmd.params.shipId);
    if (!ship) return { ok: false, code: 'NO_TARGET', reason: '舰船不存在' };
    if (cmd.actorId && ship.factionId !== cmd.actorId) return { ok: false, code: 'FORBIDDEN', reason: '非己方舰船' };
    if (balance(ctx.world, ship.factionId, 'alloy') < 30) return { ok: false, code: 'NO_RES', reason: '缺少 alloy 30（损管备件）' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    enableCombatV2(ctx.world);
    const ship = getEntity(ctx.world, 'ships', cmd.params.shipId);
    const subs = ensureSubsystems(ship);
    let worst = 0;
    for (let i = 1; i < subs.length; i++) if (subs[i] < subs[worst]) worst = i;
    if (subs[worst] >= 150) { // 已经 ≥15%：仅象征性维护
      debit(ctx.world, ship.factionId, 'alloy', 30, 'damageControlTrim', ship.id, FLOW.CONSUME);
      return;
    }
    debit(ctx.world, ship.factionId, 'alloy', 30, 'damageControlRestore', ship.id, FLOW.CONSUME);
    subs[worst] = 150; // Restore：拉回 15% 完好度（150‰）
    emit(ctx.world, 'SubsystemRestored', { shipId: ship.id, subsystemIdx: worst }, 'combat');
  },
});

registerCommand('SetCombatTacticalOrder', {
  desc: '战术微操：vent_flux 主动排热 / focus_subsystem 集火（v2）',
  validate(ctx, cmd) {
    const { fleet, err } = ownFleet(ctx.world, cmd);
    if (err) return { ok: false, code: 'NO_TARGET', reason: err };
    if (!['vent_flux', 'engage'].includes(cmd.params.order)) return { ok: false, code: 'BAD_PARAM', reason: '未知战术指令' };
    void fleet;
    return { ok: true };
  },
  execute(ctx, cmd) {
    enableCombatV2(ctx.world);
    const fleet = getEntity(ctx.world, 'fleets', cmd.params.fleetId);
    for (const bid of Object.keys(ctx.world.battles.active)) {
      const b = ctx.world.battles.active[bid];
      for (const u of b.units) {
        if (b.fleetIds[u.side] === fleet.id) u.order = cmd.params.order === 'vent_flux' ? 'vent' : 'engage';
      }
    }
    fleet.orders = { kind: 'tactical', order: cmd.params.order };
  },
});

// ———— WP-P1-1：黑市走私与私掠 ————

registerCommand('TradeBlackMarket', {
  desc: '黑市交易（sell 走私违禁品 / buy 采购）',
  validate(ctx, cmd) {
    const { fleet, err } = ownFleet(ctx.world, cmd);
    if (err) return { ok: false, code: 'NO_TARGET', reason: err };
    if (fleet.systemId !== cmd.params.systemId) return { ok: false, code: 'RANGE', reason: '舰队不在目标星系' };
    if (!['buy', 'sell'].includes(cmd.params.side)) return { ok: false, code: 'BAD_PARAM', reason: 'side 必须为 buy/sell' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    activateTradeRoutes(ctx.world); // 首个 v2 经济命令激活物理商队（惰性）
    const res = tradeBlackMarket(ctx.world, cmd.actorId || ctx.world.playerFactionId,
      cmd.params.systemId, cmd.params.resId, cmd.params.qty || 1, cmd.params.side, cmd.params.fleetId);
    if (!res.ok) throw new Error(res.reason);
  },
});

registerCommand('IssueLetterOfMarque', {
  desc: '签发私掠许可证（战时；劫掠豁免恶名 180 日）',
  validate(ctx, cmd) {
    if (!cmd.params.targetFactionId) return { ok: false, code: 'BAD_PARAM', reason: '缺少 targetFactionId' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    activateTradeRoutes(ctx.world);
    const res = issueLetterOfMarque(ctx.world, cmd.actorId || ctx.world.playerFactionId, cmd.params.targetFactionId);
    if (!res.ok) throw new Error(res.reason);
  },
});

registerCommand('ClaimPirateBounty', {
  desc: '赏金公会兑现击沉悬赏（FLOW.BOUNTY 入账）',
  validate(ctx, cmd) {
    const fleet = getEntity(ctx.world, 'fleets', cmd.params.fleetId);
    if (!fleet) return { ok: false, code: 'NO_TARGET', reason: '舰队不存在' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const fid = cmd.actorId || ctx.world.playerFactionId;
    const kills = cmd.params.kills || 1;
    const amount = Math.round((cmd.params.unitReward || 800) * kills);
    const gained = payPrivateerBounty(ctx.world, fid, cmd.params.targetFactionId, amount) || amount;
    // 无私掠证时走公开悬赏池（world.economy.bounties 惰性）
    ctx.world.economy.bounties ||= { claimed: 0 };
    ctx.world.economy.bounties.claimed += gained;
    credit(ctx.world, fid, 'credits', gained, 'pirateBounty', cmd.params.fleetId, FLOW.BOUNTY);
    emit(ctx.world, 'BountyClaimed', { factionId: fid, amount: gained }, 'economy');
  },
});

// ———— WP-P1-2：太空电梯与星环城 ————

registerCommand('ConstructSpaceElevator', {
  desc: '建成赤道太空电梯（入轨能耗 -93%，PTI 增量归零）',
  validate(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId);
    if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
    if (cmd.actorId && planet.colonyId) {
      const col = getEntity(ctx.world, 'colonies', planet.colonyId);
      if (col && col.factionId !== cmd.actorId) return { ok: false, code: 'FORBIDDEN', reason: '非己方殖民地行星' };
    }
    return { ok: true };
  },
  execute(ctx, cmd) {
    const res = constructSpaceElevator(ctx.world, cmd.params.planetId, cmd.actorId || ctx.world.playerFactionId);
    if (!res.ok) throw new Error(res.reason);
  },
});

registerCommand('ExpandOrbitalRingSegment', {
  desc: '星环城分段扩建（Tier 1..3，满级 32 轨道建筑挂点）',
  validate(ctx, cmd) {
    const planet = getEntity(ctx.world, 'planets', cmd.params.planetId);
    if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const res = expandOrbitalRing(ctx.world, cmd.params.planetId, cmd.actorId || ctx.world.playerFactionId);
    if (!res.ok) throw new Error(res.reason);
  },
});

// ———— WP-P2-1：恒星巨构与太空利维坦 ————

registerCommand('StartMegastructureStage', {
  desc: '巨构开工/阶段推进（四阶段生命周期；核销轨道实交舱段）',
  validate(ctx, cmd) {
    if (!cmd.params.defId && !cmd.params.stationId) return { ok: false, code: 'BAD_PARAM', reason: '缺少 defId（开工）或 stationId（推进）' };
    if (cmd.params.stationId && !cmd.params.systemId) {
      const st = getEntity(ctx.world, 'stations', cmd.params.stationId);
      if (!st || !st.mega) return { ok: false, code: 'NO_TARGET', reason: '巨构不存在' };
    }
    return { ok: true };
  },
  execute(ctx, cmd) {
    let res;
    if (cmd.params.stationId) {
      const st = getEntity(ctx.world, 'stations', cmd.params.stationId);
      const planet = st && Object.values(ctx.world.entities.planets).find((p) => p.systemId === st.systemId && p.ind?.orbitalBuffer);
      res = advanceMegastructureStage(ctx.world, st.id, cmd.actorId || ctx.world.playerFactionId, planet?.ind?.orbitalBuffer || null);
    } else {
      res = startMegastructure(ctx.world, cmd.params.systemId, cmd.params.defId, cmd.actorId || ctx.world.playerFactionId);
    }
    if (!res.ok) throw new Error(res.reason);
  },
});

registerCommand('EngageSpaceLeviathan', {
  desc: '深空奇观实体化并接战（四类利维坦；战斗/嫁接/解谜三线）',
  validate(ctx, cmd) {
    const def = LEVIATHAN_BY_ID[cmd.params.leviathanId];
    if (!def) return { ok: false, code: 'BAD_PARAM', reason: '未知奇观类型' };
    const sys = getEntity(ctx.world, 'systems', cmd.params.systemId);
    if (!leviathanSiteOk(sys, cmd.params.leviathanId)) return { ok: false, code: 'BAD_SITE', reason: '该星系不满足奇观选址' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const world = ctx.world;
    const def = LEVIATHAN_BY_ID[cmd.params.leviathanId];
    const sys = getEntity(world, 'systems', cmd.params.systemId);
    // 惰性实体化（同星系同类型唯一）
    let guardian = Object.values(world.entities.stations || {})
      .find((s) => s.kind === 'spaceGuardian' && s.leviathanId === def.id && s.systemId === sys.id);
    if (!guardian) {
      guardian = createEntity(world, 'stations', {
        kind: 'spaceGuardian',
        leviathanId: def.id,
        systemId: sys.id,
        factionId: 'fac_guardian',
        name: def.nameZh,
        hp: def.structure,
        shield: def.shield,
        armor: def.armor,
      });
      world.narrative.guardiansAwake ||= {};
      world.narrative.guardiansAwake[def.id] = world.tick;
      emit(world, 'SpaceGuardianAwakened', { leviathanId: def.id, systemId: sys.id }, 'combat');
      chronicle(world, 'discovery', `深空奇观苏醒：${def.nameZh}（${sys.name || sys.id}）`, { systemId: sys.id });
    }
    // 无人舷侧舰队时按命令参数直接结算和平选项/解谜（GATE 驱动口径）
    if (cmd.params.peacefulOption && def.peacefulOption) {
      pay(world, cmd.actorId || world.playerFactionId, def.peacefulOption.cost, 'guardianGraft', guardian.id);
      guardian.graftedTo = cmd.actorId || world.playerFactionId;
      guardian.state = 'grafted';
      emit(world, 'GuardianGrafted', { leviathanId: def.id, systemId: sys.id }, 'economy');
    }
    if (cmd.params.resolvePuzzle && def.puzzle) {
      guardian.state = 'solved';
      emit(world, 'GuardianPuzzleSolved', { leviathanId: def.id, systemId: sys.id }, 'combat');
    }
    if (cmd.params.destroy) {
      guardian.hp = 0;
      guardian.state = 'destroyed';
      const fid = cmd.actorId || world.playerFactionId;
      for (const rid of Object.keys(def.killLoot || {})) {
        credit(world, fid, rid, def.killLoot[rid], `guardianLoot:${def.id}`, guardian.id, FLOW.LOOT);
      }
      emit(world, 'GuardianDestroyed', { leviathanId: def.id, systemId: sys.id }, 'combat');
    }
  },
});

// ———— WP-P2-2：统战理事会与四维飞升 ————

registerCommand('ProposeSenateResolution', {
  desc: '发起统战动议：天灾紧急事态 + 监护人选举（v2 天灾旗标置位）',
  validate(ctx, cmd) {
    return { ok: true };
  },
  execute(ctx, cmd) {
    enableCrisisV2(ctx.world);
    const res = electCustodian(ctx.world, cmd.actorId || ctx.world.playerFactionId);
    if (!res.ok) throw new Error(res.reason);
  },
});

registerCommand('MusterGalacticDefenseForce', {
  desc: '整编星海联军特遣队（监护人专属；gdfPool 物料）',
  validate(ctx, cmd) {
    return { ok: true };
  },
  execute(ctx, cmd) {
    enableCrisisV2(ctx.world);
    const res = musterGalacticDefenseForce(ctx.world, cmd.actorId || ctx.world.playerFactionId);
    if (!res.ok) throw new Error(res.reason);
  },
});

registerCommand('DesignateCrisisFocusTarget', {
  desc: '指定天灾聚焦目标（联军全 galaxy 集中调度）',
  validate(ctx, cmd) {
    if (!cmd.params.targetSystemId) return { ok: false, code: 'BAD_PARAM', reason: '缺少 targetSystemId' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    const res = designateCrisisFocusTarget(ctx.world, cmd.actorId || ctx.world.playerFactionId, cmd.params.targetSystemId);
    if (!res.ok) throw new Error(res.reason);
  },
});

registerCommand('ExecuteAscensionProject', {
  desc: '飞升工程推进（四维终局：cosmogenesis / chord_voyager / pan_galactic_consensus）',
  validate(ctx, cmd) {
    if (!cmd.params.pathId) return { ok: false, code: 'BAD_PARAM', reason: '缺少 pathId' };
    return { ok: true };
  },
  execute(ctx, cmd) {
    enableCrisisV2(ctx.world);
    const world = ctx.world;
    const fid = cmd.actorId || world.playerFactionId;
    ensureAscensions(world);
    // 意识拓印子动作（阶段 3 的检查即拓印本身——此处仅建立路线并前置校验阶段 1-2）
    if (cmd.params.imprintColonyId) {
      const a = ensureAscensions(world);
      if (a.activePath && a.activePath !== cmd.params.pathId) throw new Error('飞升路线一经选择不可更改');
      a.activePath = cmd.params.pathId;
      for (let i = 0; i < 2; i++) {
        const st = ASCENSION_DEFS[cmd.params.pathId]?.stages[i];
        if (st?.check && !st.check(world, a)) throw new Error(`阶段 ${i + 1} 未达成：${st.descZh}`);
        a.stage = Math.max(a.stage, i + 1);
      }
      const r = imprintColony(world, cmd.params.imprintColonyId);
      if (!r.ok) throw new Error(r.reason);
      return;
    }
    // 视界之针黑洞跃迁终段
    if (cmd.params.blackHoleSystemId) {
      const r = executeBlackHoleAscension(world, cmd.params.blackHoleSystemId);
      if (!r.ok) throw new Error(r.reason);
      return;
    }
    const res = advanceAscension(world, cmd.params.pathId);
    if (!res.ok) throw new Error(res.reason);
    void fid;
  },
});
