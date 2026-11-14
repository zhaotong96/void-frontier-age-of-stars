/**
 * domain/politics/colonySocialArc.js — S3 殖民地社会演化与意识形态博弈弧
 * （SPEC-PLAN-045 阶段二 M2 Task 2.4；责任人：Eng-B）
 *
 * 职责（doc45 §Task 2.4 逐条契约）：
 *  1. 三阶层（Strata）与舒适度（Amenities）精确核算：
 *     - 政治权重 STRATA_POLITICAL_WEIGHTS = {Elites:10, Specialists:3, Workers:1}
 *       （与 planetStateSchema.createCompactPlanetState colony.strata row[2] 默认值同源）；
 *     - 单位人口舒适度消耗 AMENITIES_COST_PER_POP = {citizen:1.0, slave:0.75, robot:0.5}；
 *     - computeAmenitiesNet(compact)：按阶层人口加权（阶层消耗类别经
 *       compact.colony.strataCostClasses 逐行覆写，缺省全为 citizen，见 STRATA_COST_CLASSES）。
 *  2. 行星稳定度非线性产出映射（返回百分点数值，结算层以 1 + value/100 消费）：
 *     - computeStabilityOutputMultiplier(st)：st>50 → +(st−50)×0.6%（100 → +30% 封顶）；
 *       st<50 → (st−50)×1.0%（0 → −50% 下限）；
 *     - computeImmigrationAttraction(st)：st>50 → +(st−50)×1.0%（封顶 +50%），否则 0。
 *  3. 行星叛乱局势触发与三大对策（doc45 §Task 2.4 §3 精确参数表）：
 *     - 月度钩子：stability < 25 → colony.lowStabilityMonths +1 否则归 0；累计 ≥ 12 个月
 *       或 colony.incitedByAgitators 煽动旗标（S6 活跃激进细胞置位，S7 谍报亦可置位）→
 *       spawnSituation(arcId 'PLANETARY_REVOLT'，初始进度 10；arc 定义即本模块 S3 弧)；
 *     - USE_PROPAGANDA（岗位产出 −10%，−2.0/月）/ SEEK_COMPROMISE（岗位产出 −5%，立即
 *       stability −5，−3.5/月，meta.negotiationsActive 内阁谈判议程时额外 −15/月）/
 *       CRACK_DOWN（立即 stability −10，+4.0/月）/ PURGE_SABOTEURS 变体（能量与凝聚力
 *       产出 −25%、幸福度 −25%，+4.0/月）；
 *     - CRACK_DOWN 族对策在驻军充足（computeGarrisonPower ≥ progress）时强行压制：
 *       progress 清零 → 引擎归零收束（defused）；
 *     - CRACK_DOWN 族持续满 6 个月（月历游标整计）解锁 Total Crackdown ——
 *       enactMartialLaw(world, planetId, crackDownLevel)：level 1 执行镇压（stability +10、
 *       全阶层幸福度 −10）；level 2 全面戒严（驻防战力 ≥ 25 时清零局势 + 10 年免疫旗标
 *       colony.martialLawUntilTick = tick + 86400）。
 *  4. progress ≥ 100 终局（climax）：殖民地独立（compact.colony.ownerId = −1）+ 本地船坞
 *     叛军防御舰队（world.entities.fleets 确定性编成，composition 由
 *     deriveSeed(world.seed, ARC_S3_SOCIETY, compact.id, month) 派生）+
 *     world.spaceOperaState.pendingSystemShocks 注入 REVOLT_SHOCK = {S4:+18.0, S5:+22.0}
 *     （供 simulation/jacobianCoupling.js consumePendingShocks 月末消费）+
 *     appendHistory + emit PlanetaryRevolt。
 *
 * 弧注册口径（施工 notes 裁决）：registerSituationArc('S3', def) 提供七系统 S3 弧定义的
 * 权威断言面（getSituationArc('S3') 供套件断言 + jacobianCoupling ENDOGENOUS_PUSH_DEFAULTS.S3
 * 语义锚），同一 def 对象再注册为 'PLANETARY_REVOLT'（SITUATION_ARC_IDS 既有枚举成员）承载
 * 每星叛乱局势实例 —— spawnSituation('PLANETARY_REVOLT') 命中的即 S3 弧定义（doc45 Task 2.4
 * §3「挂 S3 弧定义」契约）。叛乱局势 meta 携带 {endogenousSystem:'S3', endogenousPush:3.0}
 * 供 jacobianCoupling resolveEndogenousPush（src/simulation/jacobianCoupling.js:274-305）按
 * S3 下标聚合内生推动。
 *
 * 纪律（doc43 §1.4）：月度钩子首行守卫 world.spaceOperaState；未殖民/无 compactState
 * 行星零写入；零 Math.random / Date.now（舰队编成采样 deriveSeed(ARC_S3_SOCIETY)）；
 * 不触世界主随机流；未触达世界（无 spaceOperaState）逐位零漂移。
 */

import {
  registerSituationArc,
  registerSituationMonthlyHook,
  spawnSituation,
  listActiveSituations,
  getSituation,
  switchSituationApproach,
  resolveSituationClimax,
} from '../events/situationEngine.js';
import { appendHistory } from '../planets/planetStateSchema.js';
import { DOMAIN_SALTS, deriveSeed } from '../world/deterministicRng.js';
import { emit } from '../../core/eventBus.js';
import { nextId } from '../../core/ids.js';
import { TICKS_PER_MONTH } from '../../core/clock.js';

/* ============================== 阶层与舒适度（doc45 Task 2.4 §1） ============================== */

/** 三阶层标签序（与 compact.colony.strata 行序一一对应：0 精英 / 1 专家 / 2 劳工） */
export const STRATA_LABELS = Object.freeze(['Elites', 'Specialists', 'Workers']);

/** 三阶层政治权重（doc45 §Task 2.4 §1 精确值；与 createCompactPlanetState strata row[2] 同源） */
export const STRATA_POLITICAL_WEIGHTS = Object.freeze({ Elites: 10, Specialists: 3, Workers: 1 });

/** 单位人口基础舒适度消耗系数（doc45 §Task 2.4 §1 精确值） */
export const AMENITIES_COST_PER_POP = Object.freeze({ citizen: 1.0, slave: 0.75, robot: 0.5 });

/**
 * 阶层行 → 舒适度消耗类别缺省映射（施工 notes 裁决：doc44 紧凑态 strata 三行不携带
 * 人口类别位段，缺省口径为全体自由公民（1.0/人口）；奴隶/智械构成由殖民地
 * compact.colony.strataCostClasses = ['citizen'|'slave'|'robot'] × 3 逐行覆写，见
 * computeAmenitiesNet —— 不改 doc44 三元组契约，零额外位段膨胀）。
 */
export const STRATA_COST_CLASSES = Object.freeze(['citizen', 'citizen', 'citizen']);

/**
 * 舒适度净额核算（纯函数；按阶层人口加权）：
 *   Σ_i strata[i][0] × AMENITIES_COST_PER_POP[class_i]
 *   class_i = colony.strataCostClasses?.[i]（合法枚举）‖ STRATA_COST_CLASSES[i]。
 *
 * 只读不改写（colony.amenitiesNet 的落账由结算层/城市区划配置负责，与本纯函数解耦，
 * 避免与 configureUrbanZone 的商贸港 +2/区 语义互相覆写）。
 *
 * @param {object} compact - 紧凑 PlanetState 容器
 * @returns {number} 舒适度净额（人口加权消耗合计）
 */
export function computeAmenitiesNet(compact) {
  if (!compact || typeof compact !== 'object' || !compact.colony) return 0;
  const colony = compact.colony;
  const strata = Array.isArray(colony.strata) ? colony.strata : [];
  const classes = Array.isArray(colony.strataCostClasses) ? colony.strataCostClasses : null;
  let net = 0;
  for (let i = 0; i < strata.length; i++) {
    const row = strata[i];
    const pop = Array.isArray(row) && Number.isFinite(row[0]) && row[0] > 0 ? row[0] : 0;
    let cls = STRATA_COST_CLASSES[i] || 'citizen';
    const override = classes ? classes[i] : null;
    if (override === 'citizen' || override === 'slave' || override === 'robot') cls = override;
    net += pop * AMENITIES_COST_PER_POP[cls];
  }
  return net;
}

/* ============================== 稳定度产出映射（doc45 Task 2.4 §2） ============================== */

/** 产出映射封顶（稳定度 100 → +30%）与下限（稳定度 0 → −50%），百分点口径 */
export const STABILITY_OUTPUT_CAP_PCT = 30.0;
export const STABILITY_OUTPUT_FLOOR_PCT = -50.0;
/** 移民吸引力封顶（稳定度 100 → +50%），百分点口径 */
export const IMMIGRATION_ATTRACTION_CAP_PCT = 50.0;

/**
 * 稳定度 → 全行星岗位资源/贸易价值产出修正（百分点；Δ = Stability − 50）：
 *  Δ > 0 → +Δ×0.6（封顶 +30）；Δ < 0 → Δ×1.0（下限 −50）。
 * 精确性：30×0.6 与 30×1.0 在 IEEE-754 下均精确命中 18.0 / 30.0（CHK-M2-05 口径）。
 *
 * @param {number} stability - 行星稳定度 [0,100]
 * @returns {number} 产出修正百分点（结算层以 1 + value/100 消费）
 */
export function computeStabilityOutputMultiplier(stability) {
  const d = (Number.isFinite(stability) ? stability : 50) - 50;
  if (d > 0) return Math.min(d * 0.6, STABILITY_OUTPUT_CAP_PCT);
  return Math.max(d * 1.0, STABILITY_OUTPUT_FLOOR_PCT);
}

/**
 * 稳定度 → 外来移民吸引力修正（百分点；Δ > 0 → +Δ×1.0 封顶 +50；否则 0）。
 */
export function computeImmigrationAttraction(stability) {
  const d = (Number.isFinite(stability) ? stability : 50) - 50;
  return d > 0 ? Math.min(d * 1.0, IMMIGRATION_ATTRACTION_CAP_PCT) : 0;
}

/* ============================== 叛乱触发与对策参数（doc45 Task 2.4 §3） ============================== */

/** 叛乱触发阈值：稳定度低于该值开始累计 lowStabilityMonths */
export const REVOLT_STABILITY_THRESHOLD = 25.0;
/** 触发所需持续月数（1 年 = 12 个月度 Slow Tick，doc45 §Task 2.4 §3） */
export const REVOLT_TRIGGER_MONTHS = 12;
/** 叛乱局势生成初始进度（精确 10） */
export const REVOLT_SPAWN_PROGRESS = 10;
/** 未选对策时的基础月增速（施工 notes 裁决：doc45 未给无对策速率，M2 取 +2.0/月温和发酵） */
export const REVOLT_BASE_MONTHLY_DELTA = 2.0;

/** 四条对策的月度进度增量（doc45 §Task 2.4 §3 精确值表） */
export const S3_APPROACH_MONTHLY_DELTA = Object.freeze({
  USE_PROPAGANDA: -2.0,
  SEEK_COMPROMISE: -3.5,
  CRACK_DOWN: 4.0,
  PURGE_SABOTEURS: 4.0,
});

/** USE_PROPAGANDA / SEEK_COMPROMISE 的岗位产出乘数（−10% / −5%） */
export const S3_PROPAGANDA_OUTPUT_MULT = 0.90;
export const S3_COMPROMISE_OUTPUT_MULT = 0.95;
/** PURGE_SABOTEURS：能量与凝聚力产出 −25%、人口幸福度 −25% */
export const S3_PURGE_ENERGY_UNITY_MULT = 0.75;
export const S3_PURGE_HAPPINESS_MULT = 0.75;
/** SEEK_COMPROMISE 立即稳定度代价 −5；CRACK_DOWN 立即稳定度代价 −10 */
export const S3_COMPROMISE_STABILITY_COST = 5;
export const S3_CRACKDOWN_STABILITY_COST = 10;
/** SEEK_COMPROMISE 内阁谈判议程（meta.negotiationsActive）额外削减 −15/月 */
export const S3_NEGOTIATIONS_EXTRA_DELTA = -15.0;

/** CRACK_DOWN 族对策（铁腕镇压/清洗破坏分子）月历游标解锁阈值（持续满 6 个月） */
export const MARTIAL_LAW_UNLOCK_MONTHS = 6;
/** 全面戒严（Total Crackdown）免疫时长：10 年 = 8640 tick/年 × 10 = 86400 tick */
export const MARTIAL_LAW_DURATION_TICKS = 86400;
/** level 1 执行镇压的立即稳定度恢复 / 全阶层幸福度代价（施工 notes 裁决，commandSchemas 口径） */
export const MARTIAL_LAW_L1_STABILITY_RESTORE = 10;
export const MARTIAL_LAW_L1_HAPPINESS_COST = 10;
/** 每座堡垒防御与治安区（urbanZones.zoneSlots = 4）提供的地面驻防战力（M2 裁决） */
export const GARRISON_POWER_PER_FORTRESS = 30;
/** level 2 全面戒严所需的最低地面驻防战力（M2 裁决：约一个基准驻防旅） */
export const MARTIAL_LAW_MIN_GARRISON = 25;

/** 叛乱终局经 7×7 雅可比矩阵注入的系统冲击（doc45 §Task 2.4 §4：S4 断供 / S5 内战） */
export const REVOLT_SHOCK = Object.freeze({ S4: 18.0, S5: 22.0 });

/** 叛乱局势的 S3 内生推动量（= jacobianCoupling.ENDOGENOUS_PUSH_DEFAULTS.S3） */
export const S3_REVOLT_ENDOGENOUS_PUSH = 3.0;

/** 历史环负值段事件码（planetStateSchema HISTORY_EVENT_CODES 注释口径：负值段留给局势弧） */
const HIST_S3_REVOLT_INDEPENDENCE = -301;
const HIST_S3_REVOLT_SUPPRESSED = -302;

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function clampStability(v) {
  return Math.max(0, Math.min(100, v));
}

function monthOf(tick) {
  return Math.floor((Number.isFinite(tick) ? Math.max(0, Math.trunc(tick)) : 0) / TICKS_PER_MONTH);
}

/** 行星实体解析（数字 planetId 直查 + 'plt_N' 前缀回查；与 commandsSpaceOpera 同构） */
function resolvePlanetEntity(world, planetId) {
  const bag = world && world.entities && world.entities.planets ? world.entities.planets : {};
  if (bag[planetId]) return bag[planetId];
  return bag[`plt_${planetId}`] || null;
}

/** 局势目标行星的 {planet, compact}（缺失返回 null；immediate/climax 防御性取用） */
function compactOfSituation(world, situation) {
  const planet = resolvePlanetEntity(world, situation && situation.targetEntityId);
  const compact = planet && planet.compactState;
  return compact && compact.colony ? { planet, compact } : null;
}

/**
 * 地面驻防战力（纯函数；M2 裁决：每座堡垒防御与治安区 zoneSlots = 4 提供
 * GARRISON_POWER_PER_FORTRESS 点战力，doc44 城市功能区语义的治安承载面）。
 */
export function computeGarrisonPower(compact) {
  const uz = compact && compact.urbanZones;
  if (!uz || !Array.isArray(uz.zoneSlots)) return 0;
  let power = 0;
  for (let i = 0; i < uz.zoneSlots.length; i++) {
    if ((uz.zoneSlots[i] | 0) === 4) power += GARRISON_POWER_PER_FORTRESS;
  }
  return power;
}

/**
 * CRACK_DOWN 族对策存续期的岗位/能量/凝聚力产出修正汇总（供结算钩子/集成层消费）：
 *  { jobOutputMult, energyOutputMult, unityOutputMult }；无活跃叛乱或对策未生效时全 1.0。
 */
export function colonySocialOutputModifiers(world, planetId) {
  const base = { jobOutputMult: 1.0, energyOutputMult: 1.0, unityOutputMult: 1.0 };
  for (const s of listActiveSituations(world)) {
    if (s.systemArcId !== 'PLANETARY_REVOLT') continue;
    if (s.targetEntityId !== planetId && String(s.targetEntityId) !== String(planetId)) continue;
    if (s.currentApproach === 'USE_PROPAGANDA') base.jobOutputMult *= S3_PROPAGANDA_OUTPUT_MULT;
    if (s.currentApproach === 'SEEK_COMPROMISE') base.jobOutputMult *= S3_COMPROMISE_OUTPUT_MULT;
    if (s.currentApproach === 'PURGE_SABOTEURS') {
      base.energyOutputMult *= S3_PURGE_ENERGY_UNITY_MULT;
      base.unityOutputMult *= S3_PURGE_ENERGY_UNITY_MULT;
    }
  }
  return base;
}

/**
 * 切换内阁谈判议程 Call for Negotiations（SEEK_COMPROMISE 存续期每月额外 −15 进度；
 * 供 M2 集成命令 handler 直接调用）。目标须为活跃 PLANETARY_REVOLT 局势。
 */
export function setNegotiationsActive(world, situationId, active = true) {
  const situation = getSituation(world, situationId);
  if (!situation || situation.systemArcId !== 'PLANETARY_REVOLT') {
    throw new Error(`SO: 谈判议程目标须为活跃叛乱局势（实测 ${String(situationId)}）`);
  }
  if (situation.resolvedTick != null) throw new Error(`SO: 局势 ${situation.id} 已收束，禁止切换谈判议程`);
  situation.meta.negotiationsActive = active === true;
  return situation;
}

/* ============================== S3 月度钩子（叛乱触发计数） ============================== */

/**
 * S3 月度钩子（经 registerSituationMonthlyHook 登记，月末 tick%720===0 由
 * SpaceOperaClock 触发）：低稳定度月数计数 + 叛乱局势触发。
 * 首行守卫：world.spaceOperaState 缺失（默认流程/金快照世界）→ 零扫描零写入。
 *
 * @returns {{scanned: number, spawned: number}} 本月统计
 */
export function stepColonySocialArc(world) {
  const stats = { scanned: 0, spawned: 0 };
  if (!world || !world.spaceOperaState) return stats;
  const planets = world.entities && world.entities.planets ? world.entities.planets : {};
  const tick = Number.isFinite(world.tick) ? Math.max(0, Math.trunc(world.tick)) : 0;

  const activeRevoltPlanets = new Set();
  for (const s of listActiveSituations(world)) {
    if (s.systemArcId === 'PLANETARY_REVOLT' && s.resolvedTick == null) {
      activeRevoltPlanets.add(String(s.targetEntityId));
    }
  }

  for (const key of Object.keys(planets).sort()) {
    const planet = planets[key];
    const compact = planet && planet.compactState;
    const colony = compact && compact.colony;
    if (!compact || !colony || !(Number(colony.ownerId) >= 0)) continue; // 未殖民行星零写入
    stats.scanned++;

    // —— 低稳定度月数：stability < 25 → +1，否则归 0（doc45 §Task 2.4 §3）——
    const stability = Number(colony.stability);
    if (Number.isFinite(stability) && stability < REVOLT_STABILITY_THRESHOLD) {
      colony.lowStabilityMonths = ((colony.lowStabilityMonths | 0) + 1);
    } else {
      colony.lowStabilityMonths = 0;
    }

    if (activeRevoltPlanets.has(String(planet.id))) continue; // 每星同时至多一条活跃叛乱
    if (Number.isFinite(colony.martialLawUntilTick) && tick < colony.martialLawUntilTick) continue; // 戒严免疫期

    const incited = colony.incitedByAgitators === true; // 敌方间谍/激进组织煽动旗标（S6/S7 置位）
    if ((colony.lowStabilityMonths | 0) >= REVOLT_TRIGGER_MONTHS || incited) {
      spawnSituation(world, {
        arcId: 'PLANETARY_REVOLT',
        targetEntityId: planet.id,
        progress: REVOLT_SPAWN_PROGRESS,
        meta: {
          triggerMonths: colony.lowStabilityMonths | 0,
          incited,
          endogenousSystem: 'S3',
          endogenousPush: S3_REVOLT_ENDOGENOUS_PUSH,
        },
      });
      colony.lowStabilityMonths = 0; // 触发即消费（免疫再触发直至局势收束）
      colony.incitedByAgitators = false;
      activeRevoltPlanets.add(String(planet.id));
      stats.spawned++;
    }
  }
  return stats;
}

// import 副作用：登记 S3 月度钩子（经动态 import SpaceOperaClock → setClockHooks 注入，
// 与 shortageSituationArc 的接线方式一致）
registerSituationMonthlyHook(stepColonySocialArc);

/* ============================== 弧注册（import 期自注册） ============================== */

const S3_ARC_DEF = {
  progressMax: 100,
  baseMonthlyDelta: REVOLT_BASE_MONTHLY_DELTA,
  actBounds: [
    [0, 25],
    [25, 50],
    [50, 75],
    [75, 100],
  ],

  approaches: {
    USE_PROPAGANDA: {
      monthlyDelta: S3_APPROACH_MONTHLY_DELTA.USE_PROPAGANDA,
      outputMult: S3_PROPAGANDA_OUTPUT_MULT,
      nameZh: '舆论宣传机器',
      immediate(world, situation) {
        situation.meta.propagandaActive = true;
      },
    },
    SEEK_COMPROMISE: {
      monthlyDelta: S3_APPROACH_MONTHLY_DELTA.SEEK_COMPROMISE,
      outputMult: S3_COMPROMISE_OUTPUT_MULT,
      nameZh: '寻求阶级妥协',
      immediate(world, situation) {
        const loc = compactOfSituation(world, situation);
        if (!loc) throw new Error('SO: 阶级妥协需要行星紧凑态与殖民地');
        loc.compact.colony.stability = clampStability(
          Number(loc.compact.colony.stability) - S3_COMPROMISE_STABILITY_COST,
        );
        situation.meta.compromiseActive = true;
      },
    },
    CRACK_DOWN: {
      monthlyDelta: S3_APPROACH_MONTHLY_DELTA.CRACK_DOWN,
      nameZh: '铁腕镇压',
      immediate(world, situation) {
        const loc = compactOfSituation(world, situation);
        if (!loc) throw new Error('SO: 铁腕镇压需要行星紧凑态与殖民地');
        loc.compact.colony.stability = clampStability(
          Number(loc.compact.colony.stability) - S3_CRACKDOWN_STABILITY_COST,
        );
        // 镇压持续月数（月历游标整计，杜绝 10/720 浮点累加误差；切换即重开新一连续 stint）
        situation.meta.crackDownMonths = 0;
        situation.meta.lastCrackdownMonth = monthOf(world.tick);
      },
    },
    PURGE_SABOTEURS: {
      monthlyDelta: S3_APPROACH_MONTHLY_DELTA.PURGE_SABOTEURS,
      energyUnityOutputMult: S3_PURGE_ENERGY_UNITY_MULT,
      happinessMult: S3_PURGE_HAPPINESS_MULT,
      nameZh: '清洗破坏分子',
      immediate(world, situation) {
        const loc = compactOfSituation(world, situation);
        if (!loc) throw new Error('SO: 清洗破坏分子需要行星紧凑态与殖民地');
        for (const row of loc.compact.colony.strata) {
          if (Array.isArray(row) && Number.isFinite(row[1])) row[1] = Math.max(0, row[1] * S3_PURGE_HAPPINESS_MULT);
        }
        situation.meta.purgeSaboteurs = true;
        situation.meta.crackDownMonths = 0;
        situation.meta.lastCrackdownMonth = monthOf(world.tick);
      },
    },
  },

  /**
   * 每次桶步进（SpaceOperaClock stepSituation 注入）：
   *  1. 月度进度增量 = 对策基值 +（SEEK_COMPROMISE 且谈判议程时 −15）；
   *  2. CRACK_DOWN 族对策月历游标整计持续月数（≥ 6 解锁 Total Crackdown）；
   *  3. 驻军充足（garrisonPower ≥ progress）→ 强行压制：progress/monthlyDelta 清零，
   *     引擎归零收束（defused）。
   */
  onStep(world, situation) {
    const approach = situation.currentApproach;
    let delta = Number.isFinite(S3_APPROACH_MONTHLY_DELTA[approach])
      ? S3_APPROACH_MONTHLY_DELTA[approach]
      : REVOLT_BASE_MONTHLY_DELTA;
    if (approach === 'SEEK_COMPROMISE' && situation.meta.negotiationsActive === true) {
      delta += S3_NEGOTIATIONS_EXTRA_DELTA;
    }
    situation.monthlyDelta = delta;

    if (approach === 'CRACK_DOWN' || approach === 'PURGE_SABOTEURS') {
      const month = monthOf(world.tick);
      if (!Number.isFinite(situation.meta.lastCrackdownMonth)) situation.meta.lastCrackdownMonth = month;
      if (month > situation.meta.lastCrackdownMonth) {
        situation.meta.crackDownMonths = (situation.meta.crackDownMonths | 0) + (month - situation.meta.lastCrackdownMonth);
        situation.meta.lastCrackdownMonth = month;
      }
      if ((situation.meta.crackDownMonths | 0) >= MARTIAL_LAW_UNLOCK_MONTHS) {
        situation.meta.totalCrackdownUnlocked = true;
      }
      const loc = compactOfSituation(world, situation);
      if (loc && computeGarrisonPower(loc.compact) >= situation.progress) {
        situation.progress = 0;
        situation.monthlyDelta = 0;
        situation.meta.suppressedByGarrison = true; // 驻军充足强行压制 → 引擎归零收束
      }
    }
  },

  /**
   * 收官钩子：
   *  - defused（归零收束：妥协/宣传逆转或驻军强行压制/全面戒严清零）→ 影响记账 + 低稳定
   *    计数与煽动旗标复位 + 负值段历史码；
   *  - climax（progress ≥ 100）→ 殖民地独立（ownerId = −1）+ 本地船坞叛军防御舰队
   *    （deriveSeed(ARC_S3_SOCIETY) 确定性编成）+ pendingSystemShocks 注入 REVOLT_SHOCK +
   *    appendHistory + emit PlanetaryRevolt（SituationResolved 由引擎统一发射）。
   */
  climax(world, situation, outcome) {
    const loc = compactOfSituation(world, situation);
    if (outcome !== 'climax') {
      situation.impact = situation.meta.suppressedByGarrison
        ? 'S3:REVOLT_SUPPRESSED_BY_GARRISON'
        : 'S3:REVOLT_SUPPRESSED';
      if (loc) {
        const colony = loc.compact.colony;
        colony.lowStabilityMonths = 0;
        colony.incitedByAgitators = false;
        appendHistory(loc.compact, world.tick, HIST_S3_REVOLT_SUPPRESSED, Number(colony.ownerId) >= 0 ? colony.ownerId : -1, situation.meta.crackDownMonths | 0);
      }
      return;
    }

    // —— 叛乱成功：殖民地独立（投靠邻国的派系拓扑 M3 接入，M2 权威口径为 ownerId = −1）——
    if (loc) {
      const prevOwner = Number(loc.compact.colony.ownerId);
      loc.compact.colony.ownerId = -1;
      loc.compact.colony.lowStabilityMonths = 0;
      loc.compact.colony.incitedByAgitators = false;
      appendHistory(loc.compact, world.tick, HIST_S3_REVOLT_INDEPENDENCE, Number.isFinite(prevOwner) ? prevOwner : -1, situation.progress | 0);
      spawnRebelDefenseFleet(world, loc.planet, loc.compact);
    }
    injectRevoltShock(world);
    situation.impact = 'S3:PLANETARY_REVOLT_INDEPENDENCE;REBEL_FLEET_SEIZED;S4_+18;S5_+22';
    emit(world, 'PlanetaryRevolt', {
      planetId: situation.targetEntityId,
      situationId: situation.id,
      ownerId: loc ? loc.compact.colony.ownerId : -1,
      shocks: REVOLT_SHOCK,
    }, 'politics');
  },
};

// import 期自注册：'S3' 为七系统弧定义权威面；同一 def 对象再注册为 PLANETARY_REVOLT
// （SITUATION_ARC_IDS 既有枚举）—— spawnSituation('PLANETARY_REVOLT') 命中的即 S3 弧定义
// （doc45 Task 2.4 §3「挂 S3 弧定义」契约）。
registerSituationArc('S3', S3_ARC_DEF);
registerSituationArc('PLANETARY_REVOLT', S3_ARC_DEF);

/* ============================== 叛乱终局：叛军舰队与雅可比冲击 ============================== */

/**
 * 本地船坞叛军防御舰队（确定性编成）：
 *  - 编成采样 deriveSeed(world.seed, ARC_S3_SOCIETY, compact.id, month×4+1/+2)：
 *    护卫舰 2–4（r1 % 3）+ 驱逐舰 0–1（r2 % 2）；
 *  - 舰队实体落入 world.entities.fleets（nextId('fleet') 确定性 ID；shipIds 留空 ——
 *    叛军 Composition 以纯数据 rebelComposition 记账，M3 自主舰队层按编成实体化）。
 */
function spawnRebelDefenseFleet(world, planet, compact) {
  const fleets = world.entities && world.entities.fleets ? world.entities.fleets : null;
  if (!fleets) return null;
  const seed = (typeof world.seed === 'number' && Number.isFinite(world.seed)) ? world.seed >>> 0 : 0;
  const month = monthOf(world.tick);
  const r1 = deriveSeed(seed, DOMAIN_SALTS.ARC_S3_SOCIETY, compact.id, month * 4 + 1);
  const r2 = deriveSeed(seed, DOMAIN_SALTS.ARC_S3_SOCIETY, compact.id, month * 4 + 2);
  const frigates = 2 + (r1 % 3);
  const destroyers = r2 % 2;
  const id = nextId(world, 'fleet');
  const fleet = {
    id,
    name: `叛军防御舰队·${planet && planet.name ? planet.name : id}`,
    factionId: null, // 独立叛军（脱离原属派系；M3 海盗联动按 rebelOfPlanetId 认领）
    shipIds: [],
    systemId: planet && planet.systemId != null ? planet.systemId : null,
    stance: 'aggressive',
    status: 'idle',
    orders: null,
    transit: null,
    commanderId: null,
    supplyDays: 60,
    morale: 80,
    role: 'combat',
    rebelOfPlanetId: planet ? planet.id : null,
    rebelComposition: { frigates, destroyers, total: frigates + destroyers },
    rebelSeedMonth: month,
  };
  fleets[id] = fleet;
  return fleet;
}

/**
 * 向 world.spaceOperaState.pendingSystemShocks 注入 REVOLT_SHOCK（{S4:+18.0, S5:+22.0}）；
 * 同键累加（jacobianCoupling.consumePendingShocks 合成 playerImpulse 并于月末清空字典）。
 */
function injectRevoltShock(world) {
  const soState = world && world.spaceOperaState;
  if (!soState) return;
  if (!isPlainObject(soState.pendingSystemShocks)) soState.pendingSystemShocks = {};
  for (const key of Object.keys(REVOLT_SHOCK)) {
    soState.pendingSystemShocks[key] = (Number(soState.pendingSystemShocks[key]) || 0) + REVOLT_SHOCK[key];
  }
}

/* ============================== Total Crackdown（全面戒严） ============================== */

/**
 * Total Crackdown / 执行镇压（EnactColonyMartialLaw 命令领域落点；M2 集成 handler 注入）。
 *
 * 前置：目标行星存在活跃 PLANETARY_REVOLT 局势。
 *  - level 1（执行镇压）：立即 stability +10、全阶层幸福度 −10（commandSchemas
 *    postCondition「立即修正稳定度与阶层幸福度」）；不授免疫旗标；
 *  - level 2（全面戒严）：须已解锁（CRACK_DOWN 族持续满 6 月，meta.totalCrackdownUnlocked）
 *    且地面驻防战力 ≥ MARTIAL_LAW_MIN_GARRISON；达成则清零局势（resolveSituationClimax
 *    → defused）并挂 10 年免疫旗标 colony.martialLawUntilTick = tick + 86400。
 *
 * 业务失败（无活跃叛乱 / 未解锁 / 驻防不足 / 非法档位）抛 Error('SO:…') → 命令总线回滚。
 *
 * @param {object} world - 世界根对象
 * @param {number|string} planetId - 目标行星 ID
 * @param {number} crackDownLevel - 1 = 执行镇压 | 2 = 全面戒严（commandSchemas 枚举 [1,2]）
 * @returns {object} 处置后的局势实例（level 2 全清时已移入 resolved 历史）
 */
export function enactMartialLaw(world, planetId, crackDownLevel) {
  const level = crackDownLevel | 0;
  if (level !== 1 && level !== 2) {
    throw new Error(`SO: crackDownLevel 必须为 1|2（实测 ${String(crackDownLevel)}）`);
  }
  const planet = resolvePlanetEntity(world, planetId);
  if (!planet) throw new Error(`SO: 戒严目标行星不存在 ${String(planetId)}`);
  const compact = planet.compactState;
  if (!compact || !compact.colony) throw new Error(`SO: 行星 ${String(planetId)} 缺少紧凑态殖民地`);

  const situation = listActiveSituations(world).find((s) => s.systemArcId === 'PLANETARY_REVOLT'
    && (s.targetEntityId === planet.id || String(s.targetEntityId) === String(planet.id)));
  if (!situation) throw new Error(`SO: 行星 ${String(planetId)} 无活跃叛乱局势，禁止戒严`);

  const colony = compact.colony;
  const tick = Number.isFinite(world.tick) ? Math.max(0, Math.trunc(world.tick)) : 0;

  if (level === 1) {
    colony.stability = clampStability(Number(colony.stability) + MARTIAL_LAW_L1_STABILITY_RESTORE);
    for (const row of colony.strata) {
      if (Array.isArray(row) && Number.isFinite(row[1])) row[1] = Math.max(0, row[1] - MARTIAL_LAW_L1_HAPPINESS_COST);
    }
    situation.meta.martialLawLevel1AtTick = tick;
    return situation;
  }

  // —— level 2 全面戒严：解锁检定 + 驻防战力检定 → 清零局势 + 10 年免疫 ——
  if (situation.meta.totalCrackdownUnlocked !== true) {
    throw new Error(`SO: 全面戒严未解锁（CRACK_DOWN 须持续满 ${MARTIAL_LAW_UNLOCK_MONTHS} 个月，实测 ${situation.meta.crackDownMonths | 0}）`);
  }
  const garrison = computeGarrisonPower(compact);
  if (garrison < MARTIAL_LAW_MIN_GARRISON) {
    throw new Error(`SO: 驻防战力不足以执行全面戒严（实测 ${garrison} < ${MARTIAL_LAW_MIN_GARRISON}）`);
  }
  situation.progress = 0;
  situation.monthlyDelta = 0;
  situation.meta.martialLawCleared = true;
  colony.martialLawUntilTick = tick + MARTIAL_LAW_DURATION_TICKS; // 10 年免疫再次叛乱
  resolveSituationClimax(world, situation); // defused 收束（引擎记账 + emit SituationResolved）
  return situation;
}

/**
 * 铁腕镇压入口包装（供 M2 集成 handler 切换对策；受引擎统一 720 tick 策略冷却约束）。
 */
export function setCrackDown(world, situationId, variant = 'CRACK_DOWN') {
  if (variant !== 'CRACK_DOWN' && variant !== 'PURGE_SABOTEURS') {
    throw new Error(`SO: 镇压对策变体非法（合法 CRACK_DOWN|PURGE_SABOTEURS，实测 ${String(variant)}）`);
  }
  return switchSituationApproach(world, situationId, variant);
}

/* —— SPEC-PLAN-049 Task 49.3 别名导出（doc49 导入名 ≙ M2 权威实现；零行为增量）—— */
export { stepColonySocialArc as stepColonySocialMonthly };
