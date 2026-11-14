/**
 * domain/characters/galacticParagons.js — 星海群像英雄系统（Galactic Paragons）
 * （SPEC-PLAN-046 阶段三 M3 Task 3.2；责任人：Eng-C）
 *
 * 职责（doc46 §Task 3.2 + doc42 §五.2 人物弧线逐条契约）：
 *  1. XP 引擎（三职业精确入账表）：MONTHLY_XP{ruler:12.0, councilOrGovernor:5.0} /
 *     BUILD_COMPLETION_XP=10.0 / SPACE_BATTLE_XP{base:5.0, perKill:0.05, perDisengage:0.025}×ShipSize /
 *     GROUND_BATTLE_XP{base:100.0, perArmy:0.25} / SCIENTIST_XP_RANGE=[25,120]
 *     （deriveSeed(PARAGON_DESTINY,…) 按难度确定性取值）；
 *     grantMonthlyXp / grantBattleXp / grantGroundXp / grantBuildXp / grantScientistXp API。
 *  2. 领袖容量软惩罚：LEADER_CAP_DEFAULT=4（每职业）；upkeepMultiplier(N,C)=N/C、
 *     xpGainMultiplier(N,C)=0.85^(N−C)（整商形式保证 0.7225 逐位精确，见函数注释）；
 *     leaderCapStats(world, profession) 统计在编数。
 *  3. Lv8 天命：DESTINY_TRAITS 9 条（≥6）；lv8Offers(leader) 确定性三项；
 *     assignParagonDestinyTrait 固化（scientist_instant_research 立即结算当前科技 25% 进度）。
 *  4. 创伤特质：TRAUMA_TRAITS 精确表（SUBSTANCE_ABUSER/MELANCHOLIC/LAVISH_LIFESTYLE/
 *     DESTRUCTIVE/CORRUPT，t1/t2 数值与 doc46 表逐格一致）；traumaCheck(leader, event, tick)
 *     四类触发事件（旗舰被毁/挚友阵亡/考古惨剧/政治免职）确定性检定挂载 tier。
 *  5. 伦理辐射：governorEthicsRadiation(leader)：本星 +50%、星区他星 +25%
 *     （写 compact colony.ethicsDriftWeights 漂移权重，结算层消费）。
 *  6. 忠诚政变：tickLeaderLoyalty(world)（挂 clock leader 桶）：无任命/麾下舰队损失衰减；
 *     loyalty ≤ 5 且 traits 含 CRUEL/AMBITIOUS → 月度检定 → 边境军阀政变
 *     （舰队 factionId 改写 'rebel_<leaderId>' / 总督辖星 ownerId 置叛）+ emit BorderlordCoup。
 *  7. 传奇群像：LEGENDARY_PARAGONS{TUBOREK, THE_BEHOLDER}；ensureParagonProfile 惰性；
 *     toggleBeholderMode（MURMURING_MONOLITH → 矿工岗位全部转「灵能合唱体 Telepaths」，
 *     产出 = 能量 + 凝聚双通道；WARSHIP_COMMANDER → 恢复矿工 + 舰队火控视野/灵能护盾穿透旗标）；
 *     hireEnclaveMentor（四城邦 Lv5 导师，capExempt）；attackEnclaveConsequence
 *     （导师立即离职 + 内阁议程进度 −20%）。
 *
 * 接线裁决（与 M2 archetypeMechanics 同构）：
 *  - import 期经 registerSituationMonthlyHook 登记 grantMonthlyXp / stepLegendaryParagonRecruitment
 *    月度钩子（首行守卫 world.spaceOperaState，金快照世界零读取零写入）；
 *  - leaderTick 经动态 import SpaceOperaClock → setClockHooks 注入（doc42 §六.3 Slow 桶
 *    「3 名领袖忠诚检定」槽位，M3 权威占用）；套件/集成层 await ensureLeaderHookInjected()；
 *  - 实战结算接入（doc42 总纲终审整改）：grantSpaceBattleParagonXp 挂 BattleSimulation.
 *    finishBattle（双侧指挥官太空战役 XP + 全灭旗舰创伤检定）、grantGroundMissionParagonXp
 *    挂 GroundMission.finishMission（小队陆战 XP + 惨败挚友阵亡创伤检定）、
 *    grantBuildXp 挂 colony.tickColonyConstruction 竣工路径（调用方守卫 spaceOperaState）、
 *    traumaCheck 政治免职挂 AppointOverseer 换任路径（commands.js）。
 *
 * 复用纪律（crew.js 勿重建）：人物实体沿用 crew.js 字段（level/xp/traits/loyalty/history），
 * 本模块仅在 character.paragon 惰性容器上扩展群像状态，绝不重建人物工厂
 * （createCharacter 消费 world.rng —— 本模块零 world.rng 消费，人物一律确定性构造）。
 * 事件名补录裁决：BorderlordCoup / BeholderModeToggled / ParagonDestinyAssigned /
 * ParagonTraumaTriggered / EnclaveMentorDeparted 等新事件中文名由集成阶段补录
 * src/content/eventNames.js（本任务交付面锁定为两文件，见施工 notes）。
 */

import {
  registerSituationMonthlyHook,
} from '../events/situationEngine.js';
import { DOMAIN_SALTS, deriveSeed, mix32, sampleFloat01 } from '../world/deterministicRng.js';
import { ensureSpaceOperaState } from '../world/worldMigration.js';
import { numericEntityKey, ensureCompactPlanetState } from '../planets/planetStateSchema.js';
import { techDef } from '../research/research.js';
import { shipSizeOf } from '../fleets/fleetDoctrineAndScars.js';
import { createEntity, removeEntity } from '../entities/registry.js';
import { emit, chronicle } from '../../core/eventBus.js';
import { hash32 } from '../../core/serialization.js';
import { TICKS_PER_MONTH } from '../../core/clock.js';

/** 群像确定性子流盐值（DOMAIN_SALTS 冻结表：特质觉醒/创伤检定/政变判定域） */
const PARAGON_SALT = DOMAIN_SALTS.PARAGON_DESTINY;

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clampTick = (t) => (Number.isFinite(t) ? Math.max(0, Math.trunc(t)) : 0);
const monthOf = (tick) => Math.floor(clampTick(tick) / TICKS_PER_MONTH);

/** 实体解析（数字 id 直查 + 前缀回查；与 commandsSpaceOpera resolvePlanetEntity 同构） */
function resolveEntity(world, collection, prefix, id) {
  const bag = world && world.entities && world.entities[collection];
  if (!bag) return null;
  if (bag[id]) return bag[id];
  return bag[`${prefix}_${id}`] || null;
}

/* ============================== Task 3.2 §1 XP 引擎 ============================== */

/** 月度 XP 精确入账（doc46 §Task 3.2 §1：统治者 +12.0 / 内阁或总督 +5.0） */
export const MONTHLY_XP = Object.freeze({ ruler: 12.0, councilOrGovernor: 5.0 });

/** 总督辖区每竣工 1 座建筑/星环模块/巨构阶段 XP（精确 10.0） */
export const BUILD_COMPLETION_XP = 10.0;

/** 太空战役 XP（基础 5.0 + 每击毁 0.05×ShipSize + 每迫使撤退 0.025×ShipSize） */
export const SPACE_BATTLE_XP = Object.freeze({ base: 5.0, perKill: 0.05, perDisengage: 0.025 });

/** 地面登陆战役 XP（基础 100.0 + 每歼灭 1 支陆军 0.25） */
export const GROUND_BATTLE_XP = Object.freeze({ base: 100.0, perArmy: 0.25 });

/** 科学家勘探/特殊工程/考古阶段 XP 区间（按难度 deriveSeed 确定性取值） */
export const SCIENTIST_XP_RANGE = Object.freeze([25, 120]);

/** 职业枚举（doc46 三职业体系） */
export const PARAGON_PROFESSIONS = Object.freeze(['commander', 'official', 'scientist']);

/**
 * 惰性挂载 character.paragon 群像档案（幂等；绝不消费 world.rng）。
 * 结构：{ paragonId, legendary, capExempt, profession, commandPath, mode, councilPosition,
 *         governedPlanetId, destinyPending, destinyTrait, destinyOffer, trauma[],
 *         enclaveMentor, worldSeed, lastLoyaltyMonth, lastCoupCheckMonth, fleetControlFlags,
 *         anchoredPlanetId, beholderConversion }
 * profession 推断：role==='science' → scientist；有 fleetId → commander；否则 official。
 * world 提供时固化 worldSeed（traumaCheck 无参 world 时消费该种子，确定性闭环）。
 *
 * @param {object} character - 人物实体（crew.js 形态；勿重建）
 * @param {object} [world] - 世界根对象（可选；用于固化 worldSeed）
 * @param {string} [professionOverride] - 显式职业覆盖（'commander'|'official'|'scientist'）
 * @returns {object} character.paragon（幂等：两次调用同一引用）
 */
export function ensureParagonProfile(character, world = null, professionOverride = null) {
  if (!isPlainObject(character)) throw new Error('SO: ensureParagonProfile 需要 character 实体');
  if (isPlainObject(character.paragon)) {
    if (professionOverride && PARAGON_PROFESSIONS.includes(professionOverride)) {
      character.paragon.profession = professionOverride;
    }
    return character.paragon;
  }
  character.paragon = {
    paragonId: null,
    legendary: false,
    capExempt: false,
    profession: inferProfession(character, professionOverride),
    commandPath: character.fleetId ? 'ADMIRAL' : 'GENERAL',
    mode: 'WARSHIP_COMMANDER',
    councilPosition: null,
    governedPlanetId: null,
    anchoredPlanetId: null,
    destinyPending: false,
    destinyTrait: null,
    destinyOffer: null,
    trauma: [],
    enclaveMentor: null,
    worldSeed: (world && Number.isFinite(world.seed)) ? world.seed >>> 0 : 0,
    lastLoyaltyMonth: null,
    lastCoupCheckMonth: null,
    fleetControlFlags: null,
    beholderConversion: null,
  };
  return character.paragon;
}

function inferProfession(character, override) {
  if (override && PARAGON_PROFESSIONS.includes(override)) return override;
  if (character && character.role === 'science') return 'scientist';
  if (character && character.fleetId) return 'commander';
  return 'official';
}

/* ============================== Task 3.2 §2 领袖容量软惩罚 ============================== */

/** 每职业领袖容量默认上限（doc46 精确值 4） */
export const LEADER_CAP_DEFAULT = 4;

/**
 * 维护费放大倍率：N ≤ C → 1.0（doc42「当 N > C 时」语义：未超编不放大）；
 * N > C → N / C（C=4, N=6 → 1.5× 逐位精确）。
 */
export function upkeepMultiplier(n, c) {
  const N = Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0));
  const C = Math.max(1, Math.trunc(Number.isFinite(c) ? c : LEADER_CAP_DEFAULT));
  return N > C ? N / C : 1.0;
}

/**
 * 经验获取倍率：N ≤ C → 1.0；N > C → 0.85^(N−C)。
 * 精确性裁决（CHK-M3-02：C=4,N=6 → 0.7225× 逐位精确）：Math.pow(0.85, 2) 在 IEEE-754
 * 下为 0.7224999999999999 ≠ 0.7225 字面量 —— 故按整商形式 85^k / 100^k 计算
 * （7225/10000 的最近双精度与字面量 0.7225 逐位相等）。
 */
export function xpGainMultiplier(n, c) {
  const N = Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0));
  const C = Math.max(1, Math.trunc(Number.isFinite(c) ? c : LEADER_CAP_DEFAULT));
  if (N <= C) return 1.0;
  const k = N - C;
  return Math.pow(85, k) / Math.pow(100, k);
}

/** 每职业容量上限覆盖（world.spaceOperaState.leaderCaps[profession] 惰性，缺省 LEADER_CAP_DEFAULT） */
export function leaderCapOf(world, profession) {
  const so = world && world.spaceOperaState;
  const over = so && isPlainObject(so.leaderCaps) ? so.leaderCaps[profession] : undefined;
  return Number.isFinite(over) && over >= 1 ? Math.trunc(over) : LEADER_CAP_DEFAULT;
}

/**
 * 统计某职业在编领袖数与软惩罚倍率（纯读，零写入）：
 *  在编口径：health !== 'dead' 且 profession 匹配且 非 capExempt（传奇/导师不占容量）。
 */
export function leaderCapStats(world, profession) {
  const characters = world && world.entities && world.entities.characters ? world.entities.characters : {};
  let employed = 0;
  for (const key of Object.keys(characters).sort()) {
    const ch = characters[key];
    const p = ch && ch.paragon;
    if (!ch || !isPlainObject(p)) continue;
    if (ch.health === 'dead') continue;
    if (p.profession !== profession) continue;
    if (p.capExempt === true) continue;
    employed += 1;
  }
  const cap = leaderCapOf(world, profession);
  return {
    profession,
    employed,
    cap,
    upkeepMultiplier: upkeepMultiplier(employed, cap),
    xpGainMultiplier: xpGainMultiplier(employed, cap),
  };
}

/* ============================== XP 结算内核 ============================== */

/** 创伤效果聚合（见 traumaEffects）内的忧郁症 XP 惩罚在 grantParagonXp 内消费 */
function grantParagonXp(world, leader, rawAmount, reason) {
  const p = leader.paragon;
  let amount = Number(rawAmount) || 0;
  if (amount <= 0) return 0;
  // 创伤 MELANCHOLIC（经验获取 −15% / −30%）+ crew 'bookish'（+20%）+ 容量超编衰减
  const te = traumaEffects(leader);
  amount *= te.xpMult;
  if (Array.isArray(leader.traits) && leader.traits.includes('bookish')) amount *= 1.2;
  const cap = leaderCapStats(world, p.profession);
  amount *= cap.xpGainMultiplier;

  leader.xp = (Number.isFinite(leader.xp) ? leader.xp : 0) + amount;
  const promoted = [];
  // Lv8 天命暂停常规升级（xp 继续累积，level 封顶 8）
  while (leader.level < 8 && leader.xp >= leader.level * 100) {
    leader.xp -= leader.level * 100;
    leader.level += 1;
    promoted.push(leader.level);
    if (leader.level === 8 && p.destinyPending === false && !p.destinyTrait) {
      p.destinyPending = true;
      p.destinyOffer = lv8Offers(leader);
      emit(world, 'ParagonDestinyOffered', {
        leaderId: leader.id,
        offers: p.destinyOffer,
      }, 'politics');
    }
  }
  if (promoted.length > 0) {
    (leader.history || (leader.history = [])).push({
      tick: world.tick,
      event: promoted.length > 1 ? `晋升 Lv${promoted[promoted.length - 1]}` : `晋升 Lv${promoted[0]}`,
      reason: reason || '',
    });
    emit(world, 'ParagonLeaderPromoted', { leaderId: leader.id, level: leader.level }, 'politics');
  }
  return amount;
}

/** 统治者/内阁/总督月度身份 XP 推断（纯读）：RULER > 总督/内阁 > 无 */
function monthlyXpRole(world, leader, p) {
  if (p.councilPosition === 'RULER' || p.rank === 'ruler') return 'ruler';
  if (p.governedPlanetId != null || p.councilPosition) return 'councilOrGovernor';
  // 无档案登记时兜底扫描（overseerId 链接，colonyGovernance 口径）
  const planet = findGovernedPlanet(world, leader);
  if (planet) return 'councilOrGovernor';
  return null;
}

/** 查找人物担任总督的行星（planet.soc.overseerId === leader.id；键序确定性，纯读） */
function findGovernedPlanet(world, leader) {
  const planets = world && world.entities && world.entities.planets ? world.entities.planets : {};
  for (const key of Object.keys(planets).sort()) {
    const planet = planets[key];
    if (planet && planet.soc && planet.soc.overseerId === leader.id) return planet;
  }
  return null;
}

/**
 * 月度 XP 入账（registerSituationMonthlyHook 注册形态；月末 tick%720===0 触发）。
 * 首行守卫 world.spaceOperaState；仅处理已挂 paragon 档案的存活人物（惰性容器守卫：
 * tick 期绝不 ensure 新档案）。统治者 +12.0、内阁/总督 +5.0，容量超编衰减在
 * grantParagonXp 内统一结算。
 *
 * @returns {{granted: number, rulers: number, council: number}} 本月统计
 */
export function grantMonthlyXp(world) {
  const stats = { granted: 0, rulers: 0, council: 0 };
  if (!world || !world.spaceOperaState) return stats;
  const characters = world.entities && world.entities.characters ? world.entities.characters : {};
  for (const key of Object.keys(characters).sort()) {
    const ch = characters[key];
    if (!ch || !isPlainObject(ch.paragon) || ch.health === 'dead') continue;
    const role = monthlyXpRole(world, ch, ch.paragon);
    if (!role) continue;
    const amount = role === 'ruler' ? MONTHLY_XP.ruler : MONTHLY_XP.councilOrGovernor;
    stats.granted += grantParagonXp(world, ch, amount, role === 'ruler' ? '月度统治者俸禄' : '月度治理俸禄');
    if (role === 'ruler') stats.rulers += 1;
    else stats.council += 1;
  }
  return stats;
}

// —— import 副作用：登记群像月度 XP 钩子（经动态 import SpaceOperaClock → setClockHooks 注入，
//    与 S2/S3/S4/S6 弧月度钩子同款接线；函数体首行守卫 world.spaceOperaState）——
registerSituationMonthlyHook(grantMonthlyXp);

/**
 * 总督辖区竣工 XP（每竣工 1 座地表建筑/星环模块/恒星巨构阶段 +10.0）。
 * 总督定位：planet.soc.overseerId（colonyGovernance 口径）优先，其次档案 governedPlanetId。
 * 目标行星不存在或无总督 → 零操作返回 null。
 */
export function grantBuildXp(world, planetId) {
  const planet = resolveEntity(world, 'planets', 'plt', planetId);
  if (!planet) return null;
  let leader = null;
  if (planet.soc && planet.soc.overseerId && world.entities.characters) {
    leader = world.entities.characters[planet.soc.overseerId] || null;
  }
  if (!leader && isPlainObject(planet.compactState)) {
    const pid = planet.id;
    const characters = world.entities.characters || {};
    for (const key of Object.keys(characters).sort()) {
      const ch = characters[key];
      if (ch && isPlainObject(ch.paragon) && ch.paragon.governedPlanetId === pid) {
        leader = ch;
        break;
      }
    }
  }
  if (!leader) return null;
  ensureParagonProfile(leader, world);
  const gained = grantParagonXp(world, leader, BUILD_COMPLETION_XP, `辖区竣工 ${String(planetId)}`);
  return { leaderId: leader.id, gained };
}

/**
 * 太空战役 XP：基础 5.0 + 每击毁 1 艘敌舰 +0.05×ShipSize + 每迫使 1 艘撤退 +0.025×ShipSize。
 * ShipSize = fleetDoctrineAndScars.shipSizeOf 口径（基础补给费 5/10/20）；此处入参直传数值。
 * 指挥官定位：commanderId 直查；容量超编衰减在 grantParagonXp 内结算。
 */
export function grantBattleXp(world, commanderId, kills = 0, disengages = 0, shipSize = 5) {
  const leader = resolveEntity(world, 'characters', 'chr', commanderId);
  if (!leader || leader.health === 'dead') return null;
  ensureParagonProfile(leader, world);
  const size = Math.max(0, Number(shipSize) || 0);
  const k = Math.max(0, Math.trunc(Number(kills) || 0));
  const d = Math.max(0, Math.trunc(Number(disengages) || 0));
  const amount = SPACE_BATTLE_XP.base
    + SPACE_BATTLE_XP.perKill * size * k
    + SPACE_BATTLE_XP.perDisengage * size * d;
  const gained = grantParagonXp(world, leader, amount, '太空战役');
  return { leaderId: leader.id, gained };
}

/**
 * 地面登陆战役 XP：基础 100.0 + 每歼灭 1 支敌方陆军 +0.25（精确）。
 */
export function grantGroundXp(world, commanderId, armiesDestroyed = 0) {
  const leader = resolveEntity(world, 'characters', 'chr', commanderId);
  if (!leader || leader.health === 'dead') return null;
  ensureParagonProfile(leader, world);
  const armies = Math.max(0, Number(armiesDestroyed) || 0);
  const amount = GROUND_BATTLE_XP.base + GROUND_BATTLE_XP.perArmy * armies;
  const gained = grantParagonXp(world, leader, amount, '地面战役');
  return { leaderId: leader.id, gained };
}

/* ============================== 实战结算接入（doc42 总纲终审整改） ============================== */

/**
 * 太空战役结算接线（BattleSimulation.finishBattle 调用；42 号 §五.2「参与太空战役
 * （每次 +5 XP…）持续成长」实战可达整改）：
 *  - 双侧舰队指挥官（fleet.commanderId）各入账 grantBattleXp：击毁数 = 对方 losses、
 *    迫使撤退数 = 对方存活且 order==='retreat' 的单位数、ShipSize = 己方舰队首艘
 *    活体舰 shipSizeOf 口径（缺省 5）；
 *  - 惨烈战败创伤检定：本侧单位全灭 → 该侧指挥官 traumaCheck('flagship_destroyed')。
 * 首行守卫 world.spaceOperaState（金快照/默认流程世界零读取零写入零漂移）。
 *
 * @param {object} world - 世界根对象
 * @param {object} battle - 战斗实例（BattleSimulation 形态）
 * @returns {{commanders: number, trauma: number}|null} 入账摘要（守卫拦截返回 null）
 */
export function grantSpaceBattleParagonXp(world, battle) {
  if (!world || !world.spaceOperaState || !battle || typeof battle !== 'object') return null;
  const fleets = world.entities && world.entities.fleets ? world.entities.fleets : {};
  const chars = world.entities && world.entities.characters ? world.entities.characters : {};
  const ships = world.entities && world.entities.ships ? world.entities.ships : {};
  const losses = battle.losses && typeof battle.losses === 'object' ? battle.losses : {};
  const units = Array.isArray(battle.units) ? battle.units : [];
  const summary = { commanders: 0, trauma: 0 };
  for (const side of ['a', 'b']) {
    const fleetId = battle.fleetIds ? battle.fleetIds[side] : null;
    const fleet = fleetId != null ? fleets[fleetId] : null;
    const commanderId = fleet ? fleet.commanderId : null;
    const leader = commanderId != null ? chars[commanderId] : null;
    if (!leader || leader.health === 'dead') continue;
    const enemySide = side === 'a' ? 'b' : 'a';
    const kills = Math.max(0, Math.trunc(Number(losses[enemySide]) || 0));
    const enemyUnits = units.filter((u) => u && u.side === enemySide);
    const disengages = enemyUnits.filter((u) => !u.destroyed && u.order === 'retreat').length;
    let shipSize = 5;
    if (Array.isArray(fleet.shipIds)) {
      for (const sid of fleet.shipIds) {
        const ship = ships[sid];
        if (ship && ship.status === 'active') {
          shipSize = shipSizeOf(ship);
          break;
        }
      }
    }
    grantBattleXp(world, leader.id, kills, disengages, shipSize);
    summary.commanders++;
    const ownUnits = units.filter((u) => u && u.side === side);
    const ownLost = ownUnits.filter((u) => u.destroyed).length;
    if (ownUnits.length > 0 && ownLost === ownUnits.length
      && traumaCheck(leader, 'flagship_destroyed', clampTick(world.tick))) {
      summary.trauma++;
    }
  }
  return summary;
}

/**
 * 地面战役结算接线（GroundMission.finishMission 调用；42 号 §五.2「陆战（每次
 * +100 XP…）」实战可达整改）：
 *  - 小队存活角色各入账 grantGroundXp（歼灭数 = mission.stats.kills；阵亡队员不入账）；
 *  - 惨烈战败创伤检定：任务失败且有伤亡 → 幸存角色 traumaCheck('friend_killed')。
 * 首行守卫 world.spaceOperaState（金快照/默认流程世界零读取零写入零漂移）。
 *
 * @param {object} world - 世界根对象
 * @param {object} mission - 地面任务实体（finishMission 结算后的 results 已就位）
 * @returns {{leaders: number, trauma: number}|null} 入账摘要（守卫拦截返回 null）
 */
export function grantGroundMissionParagonXp(world, mission) {
  if (!world || !world.spaceOperaState || !mission || typeof mission !== 'object') return null;
  const stats = mission.stats && typeof mission.stats === 'object' ? mission.stats : {};
  const armies = Math.max(0, Math.trunc(Number(stats.kills) || 0));
  const summary = { leaders: 0, trauma: 0 };
  const survivors = [];
  const seen = new Set();
  for (const u of Array.isArray(mission.playerUnits) ? mission.playerUnits : []) {
    const cid = u && u.characterId;
    if (cid == null || seen.has(cid)) continue;
    seen.add(cid);
    if (u.state === 'dead') continue; // 阵亡队员指挥链失能，不入账
    if (grantGroundXp(world, cid, armies)) {
      summary.leaders++;
      survivors.push(cid);
    }
  }
  const results = mission.results;
  if (results && results.outcome === 'failed' && Number(results.casualties) > 0) {
    for (const cid of survivors) {
      const leader = resolveEntity(world, 'characters', 'chr', cid);
      if (leader && traumaCheck(leader, 'friend_killed', clampTick(world.tick))) summary.trauma++;
    }
  }
  return summary;
}

/**
 * 科学家勘探/特殊工程/考古阶段 XP：[25, 120] 按难度确定性取值。
 *   f = clamp01(difficulty/3) × roll01（roll01 = sampleFloat01(seed, PARAGON_DESTINY, key, tick)）
 *   amount = 25 + 95 × f（区间下界 25 恒保持；difficulty=3 且 roll=1 → 精确 120）
 */
export function grantScientistXp(world, scientistId, difficulty = 1) {
  const leader = resolveEntity(world, 'characters', 'chr', scientistId);
  if (!leader || leader.health === 'dead') return null;
  const p = ensureParagonProfile(leader, world);
  const seed = p.worldSeed;
  const key = numericEntityKey(leader.id);
  const tick = clampTick(world && world.tick);
  const roll = sampleFloat01(seed, PARAGON_SALT, key, tick);
  const diffNorm = Math.max(0, Math.min(1, (Number(difficulty) || 0) / 3));
  const amount = SCIENTIST_XP_RANGE[0]
    + (SCIENTIST_XP_RANGE[1] - SCIENTIST_XP_RANGE[0]) * (diffNorm * roll);
  const gained = grantParagonXp(world, leader, amount, '异象勘探阶段完成');
  return { leaderId: leader.id, gained, amount };
}

/* ============================== Task 3.2 §3 Lv8 天命特质 ============================== */

/**
 * 天命特质表（≥6 条；bonus 键供 paragonFleetModifiers / paragonGovernorModifiers /
 * 立即结算钩子消费；M3 裁决数值，doc46 仅锚定两条语义）。
 */
export const DESTINY_TRAITS = Object.freeze({
  scientist_instant_research: Object.freeze({
    nameZh: '灵光乍现', profession: 'scientist',
    descZh: '立即完成当前科技 25% 进度（授任瞬间结算）',
  }),
  scientist_living_metal: Object.freeze({
    nameZh: '活体金属学', profession: 'scientist',
    bonus: Object.freeze({ buildCostSaving: 0.15 }),
    descZh: '建筑与星环模块建造费 −15%',
  }),
  scientist_star_whisper: Object.freeze({
    nameZh: '星语聆听', profession: 'scientist',
    bonus: Object.freeze({ archaeologySpeed: 0.25 }),
    descZh: '考古与异象勘探速度 +25%',
  }),
  commander_unyielding_shields: Object.freeze({
    nameZh: '不屈护盾', profession: 'commander',
    bonus: Object.freeze({ shieldRegen: 0.25 }),
    descZh: '全舰队护盾再生 +25%',
  }),
  commander_master_siege: Object.freeze({
    nameZh: '攻城大师', profession: 'commander',
    bonus: Object.freeze({ orbitalBombardment: 0.20, baseDamage: 0.20 }),
    descZh: '轨道轰炸效率与对星际基地伤害 +20%',
  }),
  commander_ghost_disengage: Object.freeze({
    nameZh: '幽影撤退', profession: 'commander',
    bonus: Object.freeze({ disengageChance: 0.15 }),
    descZh: '紧急撤退成功率 +15%',
  }),
  commander_veteran_gunnery: Object.freeze({
    nameZh: '老兵炮术', profession: 'commander',
    bonus: Object.freeze({ weaponDamage: 0.15 }),
    descZh: '舰队武器伤害 +15%',
  }),
  commander_iron_logistics: Object.freeze({
    nameZh: '铁血后勤', profession: 'commander',
    bonus: Object.freeze({ supplySaving: 0.10 }),
    descZh: '舰队补给消耗 −10%',
  }),
  official_pillar_stability: Object.freeze({
    nameZh: '定海基石', profession: 'official',
    bonus: Object.freeze({ stabilityBonus: 10 }),
    descZh: '辖星稳定度 +10',
  }),
  official_merchant_prince: Object.freeze({
    nameZh: '商贾亲王', profession: 'official',
    bonus: Object.freeze({ taxBaseBonus: 0.15 }),
    descZh: '辖星税基与贸易收益 +15%',
  }),
  official_loyal_machine: Object.freeze({
    nameZh: '忠嗣机器', profession: 'official',
    bonus: Object.freeze({ loyaltyDecayMult: 0.5 }),
    descZh: '忠诚衰减减半',
  }),
});

/** 职业天命池（lv8Offers 抽样域；每职业 ≥ 3 条保证三项可分） */
const DESTINY_POOL = Object.freeze({
  scientist: Object.freeze(['scientist_instant_research', 'scientist_living_metal', 'scientist_star_whisper']),
  commander: Object.freeze([
    'commander_unyielding_shields', 'commander_master_siege', 'commander_ghost_disengage',
    'commander_veteran_gunnery', 'commander_iron_logistics',
  ]),
  official: Object.freeze(['official_pillar_stability', 'official_merchant_prince', 'official_loyal_machine']),
});

/**
 * Lv8 天命抉择确定性三项（deriveSeed(PARAGON_DESTINY, leaderId, 0) + mix32 链三路独立抽取，
 * 三项互异；同 leaderId 永远同一组合）。
 */
export function lv8Offers(leader) {
  const p = isPlainObject(leader) && isPlainObject(leader.paragon) ? leader.paragon : null;
  const pool = DESTINY_POOL[p && p.profession] || DESTINY_POOL.official;
  const seed = p ? p.worldSeed : 0;
  const key = numericEntityKey(leader && leader.id);
  const r0 = deriveSeed(seed, PARAGON_SALT, key, 0);
  const i0 = r0 % pool.length;
  const r1 = mix32(r0 ^ 0x9e3779b9);
  let i1 = r1 % pool.length;
  if (i1 === i0) i1 = (i1 + 1) % pool.length;
  const r2 = mix32(r1 ^ 0x7f4a7c15);
  let i2 = r2 % pool.length;
  for (let off = 1; off < pool.length && (i2 === i0 || i2 === i1); off++) {
    i2 = (r2 % pool.length + off) % pool.length; // 自 r2 原像逐偏移去重（len ≥ 3 必有解）
  }
  return [pool[i0], pool[i1], pool[i2]];
}

/**
 * 固化 Lv8 天命特质（AssignParagonDestinyTrait 命令领域落点；M3 编排层注入 handler）。
 * 前置：领袖 level ≥ 8 且 destinyTraitId ∈ lv8Offers（或已挂 destinyOffer）。
 * scientist_instant_research 授任瞬间结算：leader.factionId 科研栈第一条活跃科技
 * progress += 0.25 × tech.cost（research.js {projectId, techId, progress} 形态）。
 * 业务失败（人物不存在 / 未达 Lv8 / 非法特质 / 不在三选项内）抛 Error('SO:…') → 回滚。
 */
export function assignParagonDestinyTrait(world, leaderId, destinyTraitId) {
  const leader = resolveEntity(world, 'characters', 'chr', leaderId);
  if (!leader) throw new Error(`SO: 天命目标领袖不存在 ${String(leaderId)}`);
  const p = ensureParagonProfile(leader, world);
  if (!Number.isFinite(leader.level) || leader.level < 8) {
    throw new Error(`SO: 领袖未达 Lv8，禁止天命固化（实测 Lv ${String(leader.level)}）`);
  }
  const def = DESTINY_TRAITS[destinyTraitId];
  if (!def) {
    throw new Error(`SO: 未知天命特质 ${String(destinyTraitId)}（合法集 ${Object.keys(DESTINY_TRAITS).join('|')}）`);
  }
  const offers = Array.isArray(p.destinyOffer) ? p.destinyOffer : lv8Offers(leader);
  if (!offers.includes(destinyTraitId)) {
    throw new Error(`SO: 天命特质 ${String(destinyTraitId)} 不在本届三选项 [${offers.join('|')}]`);
  }
  p.destinyTrait = destinyTraitId;
  p.destinyPending = false;
  p.destinyOffer = offers;

  if (destinyTraitId === 'scientist_instant_research') {
    const rs = world.research && world.research[leader.factionId];
    const active = rs && Array.isArray(rs.active) ? rs.active[0] : null;
    if (active) {
      // 科技 cost 权威来源：content/technologies.js（经 research.techDef 读取，与 tickResearch 同口径）
      const tech = techDef(active.techId);
      const cost = tech && Number.isFinite(tech.cost) ? tech.cost : null;
      if (Number.isFinite(cost) && cost > 0) {
        active.progress = Math.min(cost, (active.progress || 0) + cost * 0.25);
      }
    }
  }
  emit(world, 'ParagonDestinyAssigned', {
    leaderId: leader.id,
    destinyTraitId,
    profession: p.profession,
  }, 'politics');
  chronicle(world, 'politics', `${leader.name} 觉醒天命特质「${def.nameZh}」`, { leaderId: leader.id });
  return p;
}

/* ============================== Task 3.2 §4 创伤特质（精确表） ============================== */

/**
 * 负面心理创伤特质精确表（doc46 §Task 3.2 §3 表逐格一致；字段命名 t1X / t2X 族）。
 */
export const TRAUMA_TRAITS = Object.freeze({
  SUBSTANCE_ABUSER: Object.freeze({ nameZh: '药物成瘾', t1Lifespan: -10, t2Lifespan: -30 }),
  MELANCHOLIC: Object.freeze({ nameZh: '幽暗抑郁症', t1Xp: -0.15, t1Lifespan: -10, t2Xp: -0.30, t2Lifespan: -20 }),
  LAVISH_LIFESTYLE: Object.freeze({ nameZh: '穷奢极欲', t1EnergyUpkeep: 10, t2EnergyUpkeep: 20 }),
  DESTRUCTIVE: Object.freeze({ nameZh: '暴躁破坏狂', t1AlloyUpkeep: 5, t2AlloyUpkeep: 10, t2DmodChance: 2 }),
  CORRUPT: Object.freeze({ nameZh: '贪腐受贿', t1Crime: 10, t2Crime: 25 }),
});

/** 创伤触发事件 → 特质抽样池（doc46 四类触发语义） */
const TRAUMA_EVENT_TRAITS = Object.freeze({
  flagship_destroyed: Object.freeze(['DESTRUCTIVE', 'MELANCHOLIC', 'SUBSTANCE_ABUSER']),
  friend_killed: Object.freeze(['MELANCHOLIC', 'SUBSTANCE_ABUSER']),
  archaeology_disaster: Object.freeze(['MELANCHOLIC', 'DESTRUCTIVE']),
  political_dismissal: Object.freeze(['LAVISH_LIFESTYLE', 'CORRUPT', 'MELANCHOLIC']),
});

/** 创伤检定阈值：r < 0.30 → Tier II；r < 0.65 → Tier I；否则免检（M3 裁决） */
const TRAUMA_TIER2_P = 0.30;
const TRAUMA_TIER1_P = 0.65;

/**
 * 创伤检定（四类触发事件；deriveSeed(PARAGON_DESTINY, leaderId, tick) 确定性）：
 *   r0 = sampleFloat01(seed, SALT, key, tick)   → tier（II / I / 免检）
 *   r1 = deriveSeed(seed, SALT, key, tick + 1)  → 特质抽取（事件池内）
 * 同特质重复触发 → 升 tier（max）并刷新 sinceTick；traitId 追加 leader.traits（幂等）。
 * 种子来源：paragon.worldSeed（ensureParagonProfile 固化；无 world 场景缺省 0，同 leader 恒定）。
 *
 * @param {object} leader - 领袖实体（须先 ensureParagonProfile）
 * @param {string} event - 触发事件（flagship_destroyed|friend_killed|archaeology_disaster|political_dismissal）
 * @param {number} tick - 触发逻辑帧（检定 step）
 * @returns {object|null} 挂载结果 {traitId, tier}（免检返回 null）
 */
export function traumaCheck(leader, event, tick) {
  if (!isPlainObject(leader)) throw new Error('SO: traumaCheck 需要 leader 实体');
  const pool = TRAUMA_EVENT_TRAITS[event];
  if (!pool) {
    throw new Error(`SO: 未知创伤触发事件 ${String(event)}（合法集 ${Object.keys(TRAUMA_EVENT_TRAITS).join('|')}）`);
  }
  const p = isPlainObject(leader.paragon) ? leader.paragon : ensureParagonProfile(leader);
  const seed = Number.isFinite(p.worldSeed) ? p.worldSeed >>> 0 : 0;
  const key = numericEntityKey(leader.id);
  const t = Math.max(0, Math.trunc(Number.isFinite(tick) ? tick : 0));
  const r0 = sampleFloat01(seed, PARAGON_SALT, key, t);
  if (r0 >= TRAUMA_TIER1_P) return null;
  const tier = r0 < TRAUMA_TIER2_P ? 2 : 1;
  const traitId = pool[deriveSeed(seed, PARAGON_SALT, key, t + 1) % pool.length];

  const existing = Array.isArray(p.trauma) ? p.trauma.find((x) => x && x.traitId === traitId) : null;
  if (existing) {
    existing.tier = Math.max(existing.tier, tier);
    existing.sinceTick = t;
  } else {
    (p.trauma || (p.trauma = [])).push({ traitId, tier, sinceTick: t });
    if (Array.isArray(leader.traits) && !leader.traits.includes(traitId)) leader.traits.push(traitId);
  }
  // 创伤记入人物史（traumaCheck 契约无 world 入参 → 领域事件由携带 world 的
  // 上层调用方（战斗/叙事结算）经 emit 统一补发；本函数零事件副作用）
  (leader.history || (leader.history = [])).push({ tick: t, event: `创伤特质 ${traitId} T${tier}`, note: event });
  return { traitId, tier };
}

/**
 * 创伤效果聚合（纯读；结算层消费）：
 * { lifespanYears, xpMult, energyUpkeep, alloyUpkeep, dmodChanceMult, crimeAdd }
 */
export function traumaEffects(leader) {
  const out = {
    lifespanYears: 0,
    xpMult: 1.0,
    energyUpkeep: 0,
    alloyUpkeep: 0,
    dmodChanceMult: 1,
    crimeAdd: 0,
  };
  const p = isPlainObject(leader) && isPlainObject(leader.paragon) ? leader.paragon : null;
  const trauma = p && Array.isArray(p.trauma) ? p.trauma : [];
  for (const entry of trauma) {
    const def = TRAUMA_TRAITS[entry && entry.traitId];
    if (!def) continue;
    const t2 = entry.tier >= 2;
    if (t2) {
      if (Number.isFinite(def.t2Lifespan)) out.lifespanYears += def.t2Lifespan;
      if (Number.isFinite(def.t2Xp)) out.xpMult += def.t2Xp;
      if (Number.isFinite(def.t2EnergyUpkeep)) out.energyUpkeep += def.t2EnergyUpkeep;
      if (Number.isFinite(def.t2AlloyUpkeep)) out.alloyUpkeep += def.t2AlloyUpkeep;
      if (Number.isFinite(def.t2Crime)) out.crimeAdd += def.t2Crime;
      if (Number.isFinite(def.t2DmodChance)) out.dmodChanceMult *= def.t2DmodChance;
    } else {
      if (Number.isFinite(def.t1Lifespan)) out.lifespanYears += def.t1Lifespan;
      if (Number.isFinite(def.t1Xp)) out.xpMult += def.t1Xp;
      if (Number.isFinite(def.t1EnergyUpkeep)) out.energyUpkeep += def.t1EnergyUpkeep;
      if (Number.isFinite(def.t1AlloyUpkeep)) out.alloyUpkeep += def.t1AlloyUpkeep;
      if (Number.isFinite(def.t1Crime)) out.crimeAdd += def.t1Crime;
    }
  }
  return out;
}

/* ============================== Task 3.2 §5 伦理思潮辐射 ============================== */

/** 总督伦理辐射：本星 +50%（×1.5）、星区他星 +25%（×1.25） */
export const ETHICS_LOCAL_RADIATION = 1.5;
export const ETHICS_SECTOR_RADIATION = 1.25;

/** 伦理轴漂移权重容器（colony.ethicsDriftWeights；5 轴与 compact.colony.ethicsApproval 对位） */
function ensureEthicsDriftWeights(colony) {
  if (!Array.isArray(colony.ethicsDriftWeights) || colony.ethicsDriftWeights.length !== 5) {
    colony.ethicsDriftWeights = [1, 1, 1, 1, 1];
  }
  return colony.ethicsDriftWeights;
}

/**
 * 总督伦理思潮辐射（governorEthicsRadiation(leader, world?)）：
 *  - 总督伦理轴：deriveSeed(PARAGON_DESTINY, leaderId, 0xA7E1) % 5（同 leader 恒定）；
 *  - 本星（planet.soc.overseerId === leader.id 或档案 governedPlanetId）：
 *    colony.ethicsDriftWeights[axis] = 1.5（+50%）；
 *  - 星区他星（同 systemId 且无专属总督）：[axis] = 1.25（+25%）。
 * world 缺省时仅按档案 governedPlanetId 辐射本星（纯档案口径）。
 *
 * @returns {{axis: number, applied: boolean, localPlanets: number, sectorPlanets: number}}
 */
export function governorEthicsRadiation(leader, world = null) {
  const p = isPlainObject(leader) && (isPlainObject(leader.paragon)
    ? leader.paragon
    : ensureParagonProfile(leader, world || undefined));
  const seed = p && Number.isFinite(p.worldSeed) ? p.worldSeed >>> 0 : 0;
  const key = numericEntityKey(leader && leader.id);
  const axis = deriveSeed(seed, PARAGON_SALT, key, 0xa7e1) % 5;
  const out = { axis, applied: false, localPlanets: 0, sectorPlanets: 0 };
  if (!world) return out;

  const planets = world.entities && world.entities.planets ? world.entities.planets : {};
  // 本星：显式 overseerId 链接优先，其次档案 governedPlanetId / anchoredPlanetId
  let localPlanet = findGovernedPlanet(world, leader);
  if (!localPlanet && p.governedPlanetId != null) {
    localPlanet = resolveEntity(world, 'planets', 'plt', p.governedPlanetId);
  }
  if (!localPlanet && p.anchoredPlanetId != null) {
    localPlanet = resolveEntity(world, 'planets', 'plt', p.anchoredPlanetId);
  }
  if (!localPlanet) return out;

  const sectorSystemId = localPlanet.systemId;
  for (const pk of Object.keys(planets).sort()) {
    const planet = planets[pk];
    if (!planet || planet === localPlanet) continue;
    if (planet.systemId !== sectorSystemId) continue;
    const compact = planet.compactState;
    if (!compact || !compact.colony) continue;
    if (planet.soc && planet.soc.overseerId) continue; // 有专属总督 → 不吃星区辐射
    const w = ensureEthicsDriftWeights(compact.colony);
    w[axis] = ETHICS_SECTOR_RADIATION;
    out.sectorPlanets += 1;
  }
  const localCompact = localPlanet.compactState || ensureCompactPlanetState(localPlanet, world);
  if (localCompact && localCompact.colony) {
    const w = ensureEthicsDriftWeights(localCompact.colony);
    w[axis] = ETHICS_LOCAL_RADIATION;
    out.localPlanets += 1;
    out.applied = true;
  }
  return out;
}

/* ============================== Task 3.2 §6 忠诚政变 ============================== */

/** 无任命月度忠诚衰减（M3 裁决值） */
export const UNAPPOINTED_LOYALTY_DECAY = 3.0;
/** 麾下舰队损失一次性忠诚打击（M3 裁决值） */
export const FLEET_LOSS_LOYALTY_HIT = 10.0;
/** 政变检定阈值：loyalty ≤ 5 且 traits 含 CRUEL / AMBITIOUS */
export const COUP_LOYALTY_THRESHOLD = 5;
/** 政变月度检定成功率（deriveSeed 确定性 roll < 该值） */
export const COUP_MONTHLY_CHANCE = 0.5;

/**
 * 忠诚检定（clock leader 桶钩子注入形态）：
 *  - tickLeaderLoyalty(world)          → 全量扫（键序确定性）；
 *  - tickLeaderLoyalty(world, leader)  → 单领袖（SpaceOperaClock hooks.leaderTick 签名）。
 * 首行守卫 world.spaceOperaState；仅处理已挂 paragon 档案的存活领袖（tick 期绝不 ensure）。
 * 月历游标（lastLoyaltyMonth）推进：首遇对齐不衰减；无任命（无舰队/无辖星/无内阁职）
 * 每月 −3.0；麾下舰队丢失（fleetId 指向不存在实体）一次性 −10.0 并清除任命；
 * loyalty ≤ 5 且 traits 含 CRUEL/AMBITIOUS → 月度检定（roll < 0.5）→ 边境军阀政变。
 *
 * @returns {object|null} 单领袖步进摘要（全量扫返回汇总）
 */
export function tickLeaderLoyalty(world, leader = null) {
  if (!world || !world.spaceOperaState) return leader ? null : { scanned: 0, decayed: 0, coups: 0 };
  if (leader) {
    // —— 单领袖入口（clock leader 桶钩子签名）——
    // M3 集成修复（GATE-15-M1 CHK-M1-04 暴露）：钩子经 setClockHooks 注册后，clock 桶对
    // bucket 内每个 character 调用本入口 —— crew.js 形态的无 paragon 档案人物（真实游戏
    // 与合成满载星区均有）此前会在 tickLeaderLoyaltyFor 的 p.lastLoyaltyMonth 读取处崩溃。
    // 与全量扫路径同口径：未挂档案 / 已阵亡领袖零处理零写入（tick 期绝不 ensure 档案）。
    if (!isPlainObject(leader.paragon) || leader.health === 'dead') return null;
    return tickLeaderLoyaltyFor(world, leader);
  }
  const characters = world.entities && world.entities.characters ? world.entities.characters : {};
  const summary = { scanned: 0, decayed: 0, coups: 0 };
  for (const key of Object.keys(characters).sort()) {
    const ch = characters[key];
    if (!ch || !isPlainObject(ch.paragon) || ch.health === 'dead') continue;
    summary.scanned += 1;
    const res = tickLeaderLoyaltyFor(world, ch);
    if (res && res.decayApplied) summary.decayed += 1;
    if (res && res.coup) summary.coups += 1;
  }
  return summary;
}

function tickLeaderLoyaltyFor(world, leader) {
  const p = leader.paragon;
  const tick = clampTick(world.tick);
  const month = monthOf(tick);
  const out = { decayApplied: false, coup: false };

  // —— 月历游标推进（首遇对齐，杜绝注入钩子后的追涨突刺）——
  if (!Number.isFinite(p.lastLoyaltyMonth)) {
    p.lastLoyaltyMonth = month;
    return out;
  }
  const months = Math.min(24, month - p.lastLoyaltyMonth);
  if (months <= 0) return out;
  p.lastLoyaltyMonth = month;

  // —— 麾下舰队损失：fleetId 指向不存在实体 → 一次性忠诚打击并清除任命 ——
  if (leader.fleetId && !(world.entities.fleets && world.entities.fleets[leader.fleetId])) {
    leader.loyalty = Math.max(0, (Number.isFinite(leader.loyalty) ? leader.loyalty : 0) - FLEET_LOSS_LOYALTY_HIT);
    (leader.history || (leader.history = [])).push({ tick, event: '麾下舰队损失', note: leader.fleetId });
    leader.fleetId = null;
    out.decayApplied = true;
  }

  // —— 无任命月度衰减（有舰队 / 有辖星 / 有内阁职皆视为任命）——
  const hasFleet = !!leader.fleetId;
  const hasColony = p.governedPlanetId != null || !!findGovernedPlanet(world, leader);
  const hasOffice = !!p.councilPosition;
  if (!hasFleet && !hasColony && !hasOffice) {
    const loyalMachine = p.destinyTrait === 'official_loyal_machine' ? 0.5 : 1.0;
    const decay = UNAPPOINTED_LOYALTY_DECAY * months * loyalMachine;
    leader.loyalty = Math.max(0, (Number.isFinite(leader.loyalty) ? leader.loyalty : 0) - decay);
    out.decayApplied = true;
  }
  leader.loyalty = Math.max(0, Math.min(100, Number.isFinite(leader.loyalty) ? leader.loyalty : 0));

  // —— 月度政变检定 ——
  if (Number.isFinite(p.lastCoupCheckMonth)) {
    if (month <= p.lastCoupCheckMonth) return out;
  }
  p.lastCoupCheckMonth = month;
  const cruelOrAmbitious = Array.isArray(leader.traits)
    && (leader.traits.includes('CRUEL') || leader.traits.includes('AMBITIOUS'));
  if (leader.loyalty > COUP_LOYALTY_THRESHOLD || !cruelOrAmbitious) return out;

  const seed = Number.isFinite(p.worldSeed) ? p.worldSeed >>> 0 : 0;
  const roll = sampleFloat01(seed, PARAGON_SALT, numericEntityKey(leader.id), month);
  if (roll >= COUP_MONTHLY_CHANCE) return out;
  const coup = performBorderlordCoup(world, leader);
  if (coup) out.coup = true;
  return out;
}

/**
 * 边境军阀政变（月度检定成功后执行）：
 *  - 指挥官路径：麾下舰队 factionId（含舰船）改写为确定性叛军派系 'rebel_<leaderId>'
 *    （world.entities.factions 惰性建档）；
 *  - 总督路径：辖星 compact.colony.ownerId 置叛（opera 层数字键口径 = hash32(rebelId)，
 *    同时落 colony.coupRebelFactionId 字符串派系 id 供外交层精确回查 —— 与 doc45
 *    shadowSyndicateArc「ownerId 数字键与派系字符串 id 尚无桥接」口径相容）；
 *  - 双路径皆无资产 → 不政变（返回 null）；政变后 loyalty 复位 60（夺权士气）。
 */
function performBorderlordCoup(world, leader) {
  const p = leader.paragon;
  const rebelId = `rebel_${leader.id}`;
  const factions = world.entities.fleets && world.entities.factions ? world.entities.factions : null;
  if (!factions) return null;
  if (!world.entities.factions[rebelId]) {
    createEntity(world, 'factions', {
      id: rebelId,
      name: `边境军阀·${leader.name || rebelId}`,
      adjective: '叛军',
      personality: 'aggressive',
      ethosTag: null,
      color: '#c0392b',
      originType: 'borderlord_rebellion',
      homeSystemId: null,
      isPlayer: false,
      policySlots: 0,
      policies: {},
    });
  }
  let mode = null;
  const fleet = leader.fleetId && world.entities.fleets[leader.fleetId]
    ? world.entities.fleets[leader.fleetId]
    : null;
  if (fleet) {
    fleet.factionId = rebelId;
    if (Array.isArray(fleet.shipIds)) {
      for (const sid of fleet.shipIds) {
        const ship = world.entities.ships ? world.entities.ships[sid] : null;
        if (ship) ship.factionId = rebelId;
      }
    }
    mode = 'fleet';
  } else if (p.governedPlanetId != null) {
    const planet = resolveEntity(world, 'planets', 'plt', p.governedPlanetId);
    const colony = planet && isPlainObject(planet.compactState) ? planet.compactState.colony : null;
    if (colony) {
      colony.ownerId = hash32(rebelId) % 2147483647; // opera 层数字键（叛军派系确定性哈希）
      colony.coupRebelFactionId = rebelId;
      mode = 'colony';
    }
  }
  if (!mode) return null;
  leader.loyalty = 60;
  (leader.history || (leader.history = [])).push({ tick: world.tick, event: '边境军阀政变', note: rebelId });
  emit(world, 'BorderlordCoup', {
    leaderId: leader.id,
    rebelFactionId: rebelId,
    mode,
    fleetId: mode === 'fleet' ? fleet.id : null,
    planetId: mode === 'colony' ? p.governedPlanetId : null,
  }, 'politics');
  chronicle(world, 'politics', `${leader.name} 发动边境军阀政变（${mode === 'fleet' ? '舰队叛乱' : '辖星叛离'}）`, {
    leaderId: leader.id,
    rebelFactionId: rebelId,
  });
  return { rebelId, mode };
}

/* ============================== Task 3.2 §7 传奇群像 ============================== */

/** 具名传奇领袖内置表（capExempt：不占领袖容量；M3 权威语义） */
export const LEGENDARY_PARAGONS = Object.freeze({
  TUBOREK: Object.freeze({ nameZh: '图博雷克', capExempt: true, buildSpeedBonus: 1.0 }),
  THE_BEHOLDER: Object.freeze({ nameZh: '全视凝视者', capExempt: true, dualMode: true }),
});

/** 灵能合唱体月产额（每名/月；M3 裁决值，产出 = 能量 + 凝聚双通道） */
export const TELEPATH_ENERGY_PER_POP_MONTH = 8.0;
export const TELEPATH_UNITY_PER_POP_MONTH = 6.0;

/**
 * 授予具名传奇身份（集成层/事件流调用；幂等）：写入 paragonId / legendary / capExempt，
 * TUBOREK 携带 buildSpeedBonus: 1.0（星环与纳米锻炉建设加速消费），THE_BEHOLDER 携带
 * dualMode: true（toggleBeholderMode 前置）。
 */
export function applyLegendaryParagon(world, characterId, paragonId) {
  const def = LEGENDARY_PARAGONS[paragonId];
  if (!def) {
    throw new Error(`SO: 未知传奇群像 ${String(paragonId)}（合法集 ${Object.keys(LEGENDARY_PARAGONS).join('|')}）`);
  }
  const leader = resolveEntity(world, 'characters', 'chr', characterId);
  if (!leader) throw new Error(`SO: 传奇授任目标人物不存在 ${String(characterId)}`);
  const p = ensureParagonProfile(leader, world);
  p.paragonId = paragonId;
  p.legendary = true;
  p.capExempt = def.capExempt === true;
  if (Number.isFinite(def.buildSpeedBonus)) p.buildSpeedBonus = def.buildSpeedBonus;
  if (def.dualMode === true) p.dualMode = true;
  return p;
}

/**
 * 切换 The Beholder 形态（ToggleBeholderMode 命令领域落点；M3 编排层注入 handler）。
 *  - MURMURING_MONOLITH：降落行星地表（planetId 显式参数 > 档案 governedPlanetId /
 *    anchoredPlanetId），将 compact colony 矿工岗位（Workers 层人口 = 采矿岗位承载）
 *    全部转化为「灵能合唱体 Telepaths」：colony.jobRoles = {miner: 0, telepath: n}，
 *    产出 = 能量 + 凝聚双通道（netFlow[0] += 8.0×n/月；colony.telepathUnity += 6.0×n/月）；
 *  - WARSHIP_COMMANDER：恢复矿工岗位（colony.jobRoles = {miner: n, telepath: 0}），
 *    双通道产出精确回冲，并置舰队旗标 fleetControlFlags =
 *    {crossSpaceFireControl: true, psychicShieldPenetration: true}
 *    （全星系跨超空间火控视野 / 灵能护盾穿透）。
 * 业务失败（人物不存在 / 非 THE_BEHOLDER / 非法形态 / 无锚定行星 / 未殖民）抛 Error('SO:…') → 回滚。
 *
 * @param {object} world - 世界根对象
 * @param {number|string} paragonId - Beholder 人物 ID（数字键或 'chr_N'）
 * @param {string} mode - 'WARSHIP_COMMANDER' | 'MURMURING_MONOLITH'
 * @param {number|string} [planetId] - 显式锚定行星（MONOLITH 形态必填或档案已有）
 */
export function toggleBeholderMode(world, paragonId, mode, planetId = null) {
  if (mode !== 'WARSHIP_COMMANDER' && mode !== 'MURMURING_MONOLITH') {
    throw new Error(`SO: 非法 Beholder 形态 ${String(mode)}（合法 WARSHIP_COMMANDER | MURMURING_MONOLITH）`);
  }
  const leader = resolveEntity(world, 'characters', 'chr', paragonId);
  if (!leader) throw new Error(`SO: Beholder 人物不存在 ${String(paragonId)}`);
  const p = ensureParagonProfile(leader, world);
  if (p.paragonId !== 'THE_BEHOLDER') {
    throw new Error(`SO: 人物 ${String(leader.id)} 非传奇灵能机械核心 THE_BEHOLDER`);
  }
  if (p.mode === mode) return p; // 幂等：同形态切换零操作

  if (mode === 'MURMURING_MONOLITH') {
    const targetId = planetId != null ? planetId : (p.governedPlanetId != null ? p.governedPlanetId : p.anchoredPlanetId);
    if (targetId == null) throw new Error('SO: 低语方尖碑形态需要锚定行星（planetId 或总督档案）');
    const planet = resolveEntity(world, 'planets', 'plt', targetId);
    if (!planet) throw new Error(`SO: 方尖碑锚定行星不存在 ${String(targetId)}`);
    const compact = ensureCompactPlanetState(planet, world);
    const colony = compact.colony;
    if (!(Number(colony.ownerId) >= 0)) throw new Error(`SO: 行星 ${String(planet.id)} 未殖民，方尖碑无法扎根`);
    if (!Array.isArray(colony.netFlow)) throw new Error(`SO: 行星 ${String(planet.id)} 殖民地缺少 8 维净流量数组，方尖碑能量通道无法挂载`);
    const miners = colonyJobMiners(colony);
    p.beholderConversion = { planetId: planet.id, miners, sinceTick: clampTick(world.tick) };
    colony.jobRoles = { miner: 0, telepath: miners };
    colony.netFlow[0] += TELEPATH_ENERGY_PER_POP_MONTH * miners; // 能量通道（月流量口径）
    colony.telepathUnity = (Number.isFinite(colony.telepathUnity) ? colony.telepathUnity : 0)
      + TELEPATH_UNITY_PER_POP_MONTH * miners; // 凝聚通道（8 维 stockpile 无 unity 槽 → 独立字段）
    colony.beholderAnchored = true;
    p.anchoredPlanetId = planet.id;
    p.mode = 'MURMURING_MONOLITH';
    emit(world, 'BeholderModeToggled', {
      paragonId: leader.id,
      mode,
      planetId: planet.id,
      telepaths: miners,
      energyPerMonth: TELEPATH_ENERGY_PER_POP_MONTH * miners,
      unityPerMonth: TELEPATH_UNITY_PER_POP_MONTH * miners,
    }, 'world');
    return p;
  }

  // —— WARSHIP_COMMANDER：恢复矿工 + 精确回冲双通道 + 火控/穿透旗标 ——
  const conv = p.beholderConversion;
  if (conv) {
    const planet = resolveEntity(world, 'planets', 'plt', conv.planetId);
    const colony = planet && isPlainObject(planet.compactState) ? planet.compactState.colony : null;
    if (colony) {
      colony.jobRoles = { miner: conv.miners, telepath: 0 };
      colony.netFlow[0] -= TELEPATH_ENERGY_PER_POP_MONTH * conv.miners;
      colony.telepathUnity = (Number.isFinite(colony.telepathUnity) ? colony.telepathUnity : 0)
        - TELEPATH_UNITY_PER_POP_MONTH * conv.miners;
      colony.beholderAnchored = false;
    }
    p.beholderConversion = null;
  }
  p.fleetControlFlags = { crossSpaceFireControl: true, psychicShieldPenetration: true };
  p.mode = 'WARSHIP_COMMANDER';
  emit(world, 'BeholderModeToggled', {
    paragonId: leader.id,
    mode,
    fleetControlFlags: p.fleetControlFlags,
  }, 'world');
  return p;
}

/** 采矿岗位承载（Workers 层人口；M3 岗位映射裁决口径） */
function colonyJobMiners(colony) {
  const workers = Array.isArray(colony.strata) && Array.isArray(colony.strata[2])
    ? colony.strata[2][0] : 0;
  return Math.max(0, Math.trunc(Number.isFinite(workers) ? workers : 0));
}

/* ============================== 中立星际城邦导师 ============================== */

/** 中立星际城邦类型（Lv5 导师雇佣域） */
export const ENCLAVE_TYPES = Object.freeze(['curators', 'artisans', 'salvagers', 'mercenaries']);

const ENCLAVE_MENTOR_PROFILES = Object.freeze({
  curators: Object.freeze({ nameZh: '策展人导师', profession: 'scientist', role: 'science', roleName: '城邦导师' }),
  artisans: Object.freeze({ nameZh: '工匠剧团导师', profession: 'official', role: 'diplomat', roleName: '城邦导师' }),
  salvagers: Object.freeze({ nameZh: '打捞者导师', profession: 'official', role: 'engineer', roleName: '城邦导师' }),
  mercenaries: Object.freeze({ nameZh: '雇佣兵导师', profession: 'commander', role: 'tactical', roleName: '城邦导师' }),
});

/** 导师愤然离职的内阁议程惩罚（精确 −20%） */
export const COUNCIL_AGENDA_PENALTY = 20.0;

/**
 * 雇佣中立星际城邦 Lv5 导师（capExempt：不占领袖容量）。
 * 人物确定性构造（零 world.rng）：固定名/特质/忠诚 85/level 5；档案 enclaveMentor = 城邦类型。
 * @param {string} enclaveType - 'curators'|'artisans'|'salvagers'|'mercenaries'
 * @returns {object} 新建导师实体（写入 world.entities.characters）
 */
export function hireEnclaveMentor(world, enclaveType) {
  const profile = ENCLAVE_MENTOR_PROFILES[enclaveType];
  if (!profile) {
    throw new Error(`SO: 未知城邦类型 ${String(enclaveType)}（合法集 ${ENCLAVE_TYPES.join('|')}）`);
  }
  const pf = world && world.playerFactionId;
  if (!pf) throw new Error('SO: 雇佣城邦导师需要已定义的玩家派系（world.playerFactionId）');
  const mentor = createEntity(world, 'characters', {
    factionId: pf,
    name: `${profile.nameZh}·${ENCLAVE_TYPES.indexOf(enclaveType) + 1} 号`,
    species: 'human',
    age: 55,
    role: profile.role,
    roleName: profile.roleName,
    fleetId: null,
    level: 5,
    xp: 0,
    traits: ['steady'],
    loyalty: 85,
    stress: 0,
    health: 'healthy',
    history: [],
    note: `${profile.nameZh}（Lv5 城邦导师）`,
    statModifiers: {},
  });
  const p = ensureParagonProfile(mentor, world, profile.profession);
  p.enclaveMentor = enclaveType;
  p.capExempt = true;
  emit(world, 'EnclaveMentorHired', {
    mentorId: mentor.id,
    enclaveType,
    level: mentor.level,
  }, 'politics');
  return mentor;
}

/**
 * 攻击中立城邦后果：该城邦雇佣导师立即愤然离职（从 world.entities.characters 移除并
 * 清理引用：fleet.commanderId / planet.soc.overseerId / leader.fleetId 反向链接），
 * 且帝国当前内阁议程进度瞬间倒扣 −20%（world.spaceOperaState.councilAgendaProgress
 * 惰性字段，首次触达初始化 100.0；下限 0）。
 * 业务失败（导师不存在 / 非城邦导师）抛 Error('SO:…') → 事务回滚。
 */
export function attackEnclaveConsequence(world, mentorId) {
  const mentor = resolveEntity(world, 'characters', 'chr', mentorId);
  if (!mentor) throw new Error(`SO: 城邦导师不存在 ${String(mentorId)}`);
  const p = isPlainObject(mentor.paragon) ? mentor.paragon : ensureParagonProfile(mentor, world);
  if (!p.enclaveMentor) throw new Error(`SO: 人物 ${String(mentor.id)} 非城邦导师，无离职后果`);

  // —— 引用清理（完整检查不变量：fleet.commanderId / soc.overseerId 不得悬挂）——
  const fleets = world.entities && world.entities.fleets ? world.entities.fleets : {};
  for (const fid of Object.keys(fleets).sort()) {
    if (fleets[fid] && fleets[fid].commanderId === mentor.id) fleets[fid].commanderId = null;
  }
  const planets = world.entities && world.entities.planets ? world.entities.planets : {};
  for (const pid of Object.keys(planets).sort()) {
    const soc = planets[pid] && planets[pid].soc;
    if (soc && soc.overseerId === mentor.id) soc.overseerId = null;
  }

  removeEntity(world, 'characters', mentor.id);

  // —— 内阁议程进度 −20%（惰性字段，首次触达 100.0 满议程）——
  const soState = ensureSpaceOperaState(world);
  if (!Number.isFinite(soState.councilAgendaProgress)) soState.councilAgendaProgress = 100.0;
  soState.councilAgendaProgress = Math.max(0, soState.councilAgendaProgress - COUNCIL_AGENDA_PENALTY);

  emit(world, 'EnclaveMentorDeparted', {
    mentorId: mentor.id,
    enclaveType: p.enclaveMentor,
    councilAgendaProgress: soState.councilAgendaProgress,
  }, 'politics');
  chronicle(world, 'politics', `城邦导师 ${mentor.name} 愤然离职，内阁议程进度 −20%`, {
    enclaveType: p.enclaveMentor,
  });
  return { mentorId: mentor.id, councilAgendaProgress: soState.councilAgendaProgress };
}

/* ============================== 群像修正消费口（集成层） ============================== */

/**
 * 指挥官天命/传奇加成汇总（战斗结算与舰队层消费）：
 * 天命 commander_* 数值 + Beholder WARSHIP_COMMANDER 跨超空间火控视野 / 灵能护盾穿透旗标。
 */
export function paragonFleetModifiers(character) {
  const out = {
    weaponDamage: 0, fireRate: 0, disengageChance: 0, shieldRegen: 0,
    baseDamage: 0, orbitalBombardment: 0, armyDamage: 0, supplySaving: 0,
    crossSpaceFireControl: false, psychicShieldPenetration: false,
  };
  const p = isPlainObject(character) && isPlainObject(character.paragon) ? character.paragon : null;
  if (!p) return out;
  const dt = p.destinyTrait ? DESTINY_TRAITS[p.destinyTrait] : null;
  if (dt && dt.bonus && dt.profession === 'commander') {
    for (const k of Object.keys(dt.bonus)) {
      if (typeof out[k] === 'number') out[k] += dt.bonus[k];
    }
  }
  if (p.paragonId === 'THE_BEHOLDER' && p.mode === 'WARSHIP_COMMANDER' && isPlainObject(p.fleetControlFlags)) {
    out.crossSpaceFireControl = p.fleetControlFlags.crossSpaceFireControl === true;
    out.psychicShieldPenetration = p.fleetControlFlags.psychicShieldPenetration === true;
  }
  return out;
}

/**
 * 行政官员天命加成汇总（治理结算层消费）：stabilityBonus / taxBaseBonus / loyaltyDecayMult。
 */
export function paragonGovernorModifiers(character) {
  const out = { stabilityBonus: 0, taxBaseBonus: 0, loyaltyDecayMult: 1 };
  const p = isPlainObject(character) && isPlainObject(character.paragon) ? character.paragon : null;
  if (!p) return out;
  const dt = p.destinyTrait ? DESTINY_TRAITS[p.destinyTrait] : null;
  if (dt && dt.bonus && dt.profession === 'official') {
    if (Number.isFinite(dt.bonus.stabilityBonus)) out.stabilityBonus += dt.bonus.stabilityBonus;
    if (Number.isFinite(dt.bonus.taxBaseBonus)) out.taxBaseBonus += dt.bonus.taxBaseBonus;
    if (Number.isFinite(dt.bonus.loyaltyDecayMult)) out.loyaltyDecayMult = Math.min(out.loyaltyDecayMult, dt.bonus.loyaltyDecayMult);
  }
  return out;
}

/** TUBOREK 建设加速（星环与纳米锻炉建设速度加成倍率；非图博雷克 → 0） */
export function tuborekBuildSpeedBonus(character) {
  const p = isPlainObject(character) && isPlainObject(character.paragon) ? character.paragon : null;
  return p && p.paragonId === 'TUBOREK' && Number.isFinite(p.buildSpeedBonus) ? p.buildSpeedBonus : 0;
}

/* ============================== 传奇群像实战抵达（doc42 总纲终审整改） ============================== */

/** 传奇群像逐月抵达检定概率（确定性 roll < 该值；M3 裁决） */
export const LEGENDARY_ARRIVAL_MONTHLY_CHANCE = 0.10;
/** 传奇群像抵达门槛月龄（TUBOREK 第 61 月起 / THE_BEHOLDER 第 121 月起；错峰抵达） */
export const LEGENDARY_ARRIVAL_MIN_MONTH = Object.freeze({ TUBOREK: 60, THE_BEHOLDER: 120 });

/** 传奇群像抵达人物确定性构造表（零 world.rng：名/职/级/特质全固定） */
const LEGENDARY_ARRIVAL_PROFILES = Object.freeze({
  TUBOREK: Object.freeze({
    name: '图博雷克', species: 'human', age: 74, role: 'engineer', roleName: '星环总师',
    level: 6, traits: Object.freeze(['steady', 'industrious']),
  }),
  THE_BEHOLDER: Object.freeze({
    name: '全视凝视者', species: 'machine', age: 0, role: 'tactical', roleName: '灵能机械核心',
    level: 6, traits: Object.freeze(['steady']),
  }),
});

/**
 * 传奇群像逐月抵达检定（registerSituationMonthlyHook 注册形态；42 号 §五.2「知名与
 * 传奇英雄（Renowned & Legendary Paragons）」+ §七.3 M3 实战可达整改）：
 *  - 门槛：month ≥ LEGENDARY_ARRIVAL_MIN_MONTH[paragonId]（TUBOREK 60 / THE_BEHOLDER 120）；
 *    该 paragonId 从未抵达过（soState.legendaryParagons 无记录，一次性事件不复活）；
 *  - 逐月确定性检定 sampleFloat01(seed, PARAGON_DESTINY, hash32(paragonId), month)
 *    < LEGENDARY_ARRIVAL_MONTHLY_CHANCE → 确定性构造人物（createEntity 零 world.rng）
 *    → applyLegendaryParagon 授任（capExempt / buildSpeedBonus / dualMode 随表生效）；
 *  - 抵达记录 soState.legendaryParagons[paragonId] = { leaderId, arrivedTick }（幂等防重）。
 * 首行守卫 world.spaceOperaState（金快照世界零读取零写入）；无玩家派系零动作。
 *
 * @returns {{checked: number[], arrived: string|null, leaderId: (number|string|null)}} 本月检定摘要
 */
export function stepLegendaryParagonRecruitment(world) {
  const stats = { checked: [], arrived: null, leaderId: null };
  if (!world || !world.spaceOperaState) return stats;
  const pf = world.playerFactionId;
  if (!pf) return stats;
  const soState = world.spaceOperaState;
  if (!isPlainObject(soState.legendaryParagons)) soState.legendaryParagons = {};
  const seed = Number.isFinite(world.seed) ? world.seed >>> 0 : 0;
  const month = monthOf(world.tick);
  for (const paragonId of Object.keys(LEGENDARY_PARAGONS)) {
    if (soState.legendaryParagons[paragonId]) continue; // 一次性抵达，永不复活
    const minMonth = LEGENDARY_ARRIVAL_MIN_MONTH[paragonId];
    if (!Number.isFinite(minMonth) || month < minMonth) continue;
    stats.checked.push(paragonId);
    const roll = sampleFloat01(seed, PARAGON_SALT, hash32(paragonId), month);
    if (roll >= LEGENDARY_ARRIVAL_MONTHLY_CHANCE) continue;
    const profile = LEGENDARY_ARRIVAL_PROFILES[paragonId];
    const mentor = createEntity(world, 'characters', {
      factionId: pf,
      name: profile.name,
      species: profile.species,
      age: profile.age,
      role: profile.role,
      roleName: profile.roleName,
      fleetId: null,
      level: profile.level,
      xp: 0,
      traits: [...profile.traits],
      loyalty: 90,
      stress: 0,
      health: 'healthy',
      history: [],
      note: `${profile.roleName}（传奇群像 ${paragonId} 抵达）`,
      statModifiers: {},
    });
    ensureParagonProfile(mentor, world);
    applyLegendaryParagon(world, mentor.id, paragonId);
    soState.legendaryParagons[paragonId] = { leaderId: mentor.id, arrivedTick: clampTick(world.tick) };
    stats.arrived = paragonId;
    stats.leaderId = mentor.id;
    emit(world, 'LegendaryParagonArrived', {
      paragonId,
      leaderId: mentor.id,
      arrivedTick: clampTick(world.tick),
    }, 'politics');
    chronicle(world, 'politics', `传奇群像 ${profile.name} 抵达帝国宫廷（${paragonId}）`, { leaderId: mentor.id });
    return stats; // 每月至多一位传奇抵达（检定序确定）
  }
  return stats;
}

// —— import 副作用：传奇群像逐月抵达检定登记（与 grantMonthlyXp 同款月度钩子接线；
//    函数体首行守卫 world.spaceOperaState，金快照 8be8ce2c 零漂移）——
registerSituationMonthlyHook(stepLegendaryParagonRecruitment);

/* ============================== clock leader 桶接线（动态 import，避免模块环） ============================== */

/** leaderTick 钩子入口（setClockHooks.leaderTick 注册形态；签名 (world, character)） */
function leaderTickEntry(world, character) {
  return tickLeaderLoyalty(world, character);
}

let hookInjectState = 'idle'; // idle → injecting → registered | failed
let hookInjectPromise = null;

/* 静态打包产物中动态 import 相对说明符不可达（404 静默降级）——统一静态接线（SpaceOperaWiring.js） */
import { setClockHooks } from '../../simulation/SpaceOperaClock.js';

/** setClockHooks 注入 leaderTick（幂等；M3 权威占用槽位） */
function injectLeaderTickHook() {
  if (hookInjectState !== 'idle') return;
  setClockHooks({ leaderTick: leaderTickEntry });
  hookInjectState = 'registered';}

/**
 * 幂等预注入 leader 桶钩子（返回注入完成的 Promise）。
 * 同步 import 本模块后「立即同步跑 tick 循环」的调用方（套件/集成层）必须先
 * await ensureLeaderHookInjected()，否则该轮同步循环内 leaderTick 尚未就位。
 *
 * @returns {Promise<void>} 注入完成（或已注入/已降级）信号
 */
export function ensureLeaderHookInjected() {
  injectLeaderTickHook();
  return Promise.resolve();
}

// import 副作用：向 SpaceOperaClock 注册 leaderTick（忠诚月检挂 clock leader 30 桶；
// 函数体首行守卫 world.spaceOperaState，未触达世界/金快照 8be8ce2c 零漂移）
injectLeaderTickHook();

/* —— SPEC-PLAN-049 Task 49.3 别名导出（doc49 导入名 ≙ leaderTick 桶钩子入口；零行为增量）—— */
export { leaderTickEntry as stepParagonLeaderTick };
