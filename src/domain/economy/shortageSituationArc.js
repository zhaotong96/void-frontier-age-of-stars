/**
 * domain/economy/shortageSituationArc.js — S4 星际宏观经济、奇异工业与断供违约弧
 * （SPEC-PLAN-044 阶段一 M1 Task 1.6；责任人：Eng-B）
 *
 * 职责（doc44 §Task 1.6 逐条契约）：
 *  1. computeAccessibility(planet, colonies)：BaseAccess 0.5 + Σ(友方殖民地 dist≤20LY
 *     → +0.08) − 封锁罚（星系坐标 1 单位 = 1 LY 裁决，见施工 notes）；
 *  2. installIndustryMod(world, planetId, modId)：'PRISTINE_NANOFORGE'（舰船品质 +40%、
 *     关注度 +4）/ 'SYNCHROTRON'（燃料产出 +100%），写 compact.urbanZones.industryMods；
 *  3. watchStrategicStockpiles(world)（月度钩子）：遍历含 compactState 的行星，任一
 *     STRATEGIC 槽 stockpile===0 且 netFlow<0 → spawn 局势（初始 15.0 精确）；
 *  4. 月度 ΔP = +5.0 × clamp(|netFlow|/totalConsumption, 0.1, 1.0)（赤字）或 −5.0/月
 *     （盈余，归 0 安全解除）；阶段每 25 点一档（shortageStageOf / shortagePenaltyMultiplier）；
 *  5. CUT_INVESTMENTS 对策：工匠/冶金产出 -25%、维护消耗 -50%
 *     （productionModifier(world) 汇总供结算钩子消费）；
 *  6. progress≥100 → EMPIRE_DEFAULTED：untilTick = tick + 86400（10 年 = 3600 逻辑日 × 24），
 *     五项惩罚常量 + 确定性清空高维护建筑（compact tiles 按 buildingId 降序清前 N）+
 *     emit EmpireDefaulted。
 *
 * 纪律（doc43 §1.4）：月度钩子首行守卫 world.spaceOperaState；无 compactState 行星跳过；
 * 零 Math.random / Date.now；不触世界主随机流。
 */

import {
  registerSituationArc,
  registerSituationMonthlyHook,
  spawnSituation,
  switchSituationApproach,
  listActiveSituations,
} from '../events/situationEngine.js';
import { STRATEGIC_RESOURCE_INDEXES, OPERA_RESOURCE_KEYS } from '../planets/planetStateSchema.js';
import { packTile, unpackTile } from '../planets/planetStateSchema.js';
import { emit } from '../../core/eventBus.js';

/* ============================== 通达度（doc44 Task 1.6 §1） ============================== */

export const ACCESS_BASE = 0.5;
export const ACCESS_PER_FRIENDLY_COLONY = 0.08;
export const ACCESS_RADIUS_LY = 20;
/**
 * 星系策略坐标（0..1000）→ 光年换算裁决：1 坐标单位 = 1 LY（工程内无既有 LY 约定，
 * 本常量为 S4 通达度唯一权威换算，见施工 notes）。
 */
export const LY_PER_GALAXY_UNIT = 1.0;

/**
 * 殖民地通达度（纯函数）：
 *   Accessibility(p) = BaseAccess(0.5) + Σ_{友方 c, dist(p,c) ≤ 20LY} 0.08 − 封锁罚合计。
 *
 * @param {{x: number, y: number}} planet - 行星所属星系的策略空间坐标（经 systemPosOf 解析）
 * @param {Array<{x: number, y: number, friendly?: boolean, blockadePenalty?: number}>} colonies
 *        殖民地坐标表（friendly 缺省视为友方；敌对条目按 blockadePenalty（缺省 0）扣减）
 * @returns {number} 通达度（敌对罚可致负值，交由上层 clamp）
 */
export function computeAccessibility(planet, colonies) {
  let access = ACCESS_BASE;
  const px = planet && Number.isFinite(planet.x) ? planet.x : null;
  const py = planet && Number.isFinite(planet.y) ? planet.y : null;
  if (px != null && py != null && Array.isArray(colonies)) {
    for (const c of colonies) {
      if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
      if (c.friendly === false) {
        access -= Number.isFinite(c.blockadePenalty) ? Math.abs(c.blockadePenalty) : 0;
        continue;
      }
      const dist = Math.hypot(c.x - px, c.y - py) * LY_PER_GALAXY_UNIT;
      if (dist <= ACCESS_RADIUS_LY) access += ACCESS_PER_FRIENDLY_COLONY;
    }
  }
  return access;
}

/** 行星 → 所属星系策略坐标 {x, y}（星系实体缺失返回 null） */
export function systemPosOf(world, planetId) {
  const planets = world && world.entities && world.entities.planets ? world.entities.planets : {};
  const planet = planets[planetId];
  const systems = world && world.entities && world.entities.systems ? world.entities.systems : {};
  const sys = planet && planet.systemId != null ? systems[planet.systemId] : null;
  return sys && Number.isFinite(sys.x) && Number.isFinite(sys.y) ? { x: sys.x, y: sys.y } : null;
}

/* ============================== 奇异工业模组（doc44 Task 1.6 §1） ============================== */

/**
 * 奇异工业模组定义（写 compact.urbanZones.industryMods）：
 *  - PRISTINE_NANOFORGE：舰船制造品质 +40%（shipQualityBonus 0.40）+ 行星工业关注度 +4；
 *  - SYNCHROTRON：反物质燃料产出 +100%（fuelOutputMult 2.0）。
 */
export const INDUSTRY_MOD_DEFS = Object.freeze({
  PRISTINE_NANOFORGE: Object.freeze({ nameZh: '完美纳米锻炉', shipQualityBonus: 0.40, fuelOutputMult: 1.0, industrialAttention: 4 }),
  SYNCHROTRON: Object.freeze({ nameZh: '同步加速器', shipQualityBonus: 0.0, fuelOutputMult: 2.0, industrialAttention: 0 }),
});

/**
 * 安装奇异工业模组（供 M1 命令 handler 直接调用）：
 *  - 写 compact.urbanZones.industryMods[modId]（安装记账：参数快照 + installedAtTick）；
 *  - PRISTINE_NANOFORGE 同步累加 compact.colony.industrialAttention +4（激进渗透关注度）。
 * 业务失败（行星不存在 / 未知模组 / 重复安装）抛 Error('SO:…') → 命令总线回滚。
 */
export function installIndustryMod(world, planetId, modId) {
  const def = INDUSTRY_MOD_DEFS[modId];
  if (!def) throw new Error(`SO: 未知奇异工业模组 ${String(modId)}（合法 ${Object.keys(INDUSTRY_MOD_DEFS).join('|')}）`);
  const planets = world && world.entities && world.entities.planets ? world.entities.planets : {};
  const planet = planets[planetId];
  if (!planet) throw new Error(`SO: 安装目标行星不存在 ${String(planetId)}`);
  const compact = planet.compactState;
  if (!compact || !compact.urbanZones || !compact.colony) {
    throw new Error(`SO: 行星 ${String(planetId)} 缺少紧凑态（须先经行星底座命令初始化）`);
  }
  if (!compact.urbanZones.industryMods) compact.urbanZones.industryMods = {};
  if (compact.urbanZones.industryMods[modId]) {
    throw new Error(`SO: 模组 ${modId} 已安装于行星 ${String(planetId)}`);
  }
  compact.urbanZones.industryMods[modId] = {
    installedAtTick: Number.isFinite(world.tick) ? world.tick : 0,
    shipQualityBonus: def.shipQualityBonus,
    fuelOutputMult: def.fuelOutputMult,
    industrialAttention: def.industrialAttention,
  };
  if (def.industrialAttention > 0) {
    compact.colony.industrialAttention = (compact.colony.industrialAttention || 0) + def.industrialAttention;
  }
  return compact.urbanZones.industryMods[modId];
}

/* ============================== 短缺监视与演进方程（doc44 Task 1.6 §2） ============================== */

export const S4_INITIAL_PROGRESS = 15.0; // 局势生成初始进度（精确）
export const S4_DELTA_MAX_PER_MONTH = 5.0; // 赤字月增速上限
export const S4_REGRESS_PER_MONTH = -5.0; // 盈余月固定回退
export const S4_STAGE_SIZE = 25; // 每 25 点一个恶化阶段

/** 恶化阶段（progress → 1..4；CHK-M1-07 口径 Stage1: 0-24 … Stage4: 75-99） */
export function shortageStageOf(progress) {
  const p = Number.isFinite(progress) ? progress : 0;
  return Math.min(4, Math.max(1, Math.floor(p / S4_STAGE_SIZE) + 1));
}

/** 阶段惩罚阶梯乘子（Stage1..4 → 0 / 0.25 / 0.50 / 0.75） */
export function shortagePenaltyMultiplier(progress) {
  return (shortageStageOf(progress) - 1) * 0.25;
}

/**
 * S4 月度钩子：遍历含 compactState 的行星，任一 STRATEGIC 槽（能量/矿物/食物/合金/
 * 消费品/奇异物质 = stockpile 槽位 0..5）stockpile === 0 且 netFlow < 0 → spawn 短缺局势
 * （初始进度精确 15.0；每星同时至多一条活跃 S4）。
 * 由 situationEngine.registerSituationMonthlyHook 登记，月末 tick%720===0 触发。
 *
 * @returns {{scanned: number, spawned: number}} 本月统计
 */
export function watchStrategicStockpiles(world) {
  const stats = { scanned: 0, spawned: 0 };
  if (!world || !world.spaceOperaState) return stats;
  const planets = world.entities && world.entities.planets ? world.entities.planets : {};
  const activeS4 = new Set();
  for (const s of listActiveSituations(world)) {
    if (s.systemArcId === 'S4') activeS4.add(String(s.targetEntityId));
  }

  for (const key of Object.keys(planets).sort()) {
    const planet = planets[key];
    const compact = planet && planet.compactState;
    const colony = compact && compact.colony;
    if (!compact || !colony || !Array.isArray(colony.stockpile) || !Array.isArray(colony.netFlow)) continue;
    stats.scanned++;
    if (activeS4.has(String(planet.id))) continue;

    for (const i of STRATEGIC_RESOURCE_INDEXES) {
      const stockpile = Number(colony.stockpile[i]);
      const netFlow = Number(colony.netFlow[i]);
      if (stockpile === 0 && netFlow < 0) {
        spawnSituation(world, {
          arcId: 'S4',
          targetEntityId: planet.id,
          progress: S4_INITIAL_PROGRESS,
          monthlyDelta: 0, // 首步由弧 onStep 依净流公式重算
          meta: { resourceIndex: i, resourceKey: OPERA_RESOURCE_KEYS[i] != null ? OPERA_RESOURCE_KEYS[i] : String(i) },
        });
        emit(world, 'ResourceShortageStarted', {
          planetId: planet.id,
          situationArcId: 'S4',
          resourceIndex: i,
          resourceKey: OPERA_RESOURCE_KEYS[i] != null ? OPERA_RESOURCE_KEYS[i] : String(i),
          netFlow,
        }, 'economy');
        stats.spawned++;
        break; // 每星每月至多生成一条短缺局势（其余槽位下月续检）
      }
    }
  }
  return stats;
}

// import 副作用：登记 S4 月度钩子（经动态 import SpaceOperaClock → setClockHooks 注入）
registerSituationMonthlyHook(watchStrategicStockpiles);

/* ============================== CUT_INVESTMENTS 对策与违约终局（doc44 Task 1.6 §3） ============================== */

export const S4_CUT_ARTISAN_OUTPUT_MULT = 0.75; // 工匠产出 -25%
export const S4_CUT_METALLURGIST_OUTPUT_MULT = 0.75; // 冶金学家产出 -25%
export const S4_CUT_MAINTENANCE_MULT = 0.5; // 原料维护消耗 -50%

/**
 * CUT_INVESTMENTS 开关包装（供 EmergencyDebtRestructure 命令 handler 直接调用）；
 * 受引擎统一策略切换冷却约束（720 tick，冷却中抛 Error('SO:approach cooldown')）。
 *
 * @param {boolean} enabled - true 启用削减投资；false 切回 STATUS_QUO
 * @returns {object} 局势实例
 */
export function setCutInvestments(world, situationId, enabled) {
  return switchSituationApproach(world, situationId, enabled ? 'CUT_INVESTMENTS' : 'STATUS_QUO');
}

/**
 * 削减投资生产修正汇总（供结算钩子/集成层消费；任一活跃 S4 处于 CUT_INVESTMENTS
 * 即取最严值）：
 *  { artisanOutputMult: 0.75, metallurgistOutputMult: 0.75, maintenanceCostMult: 0.5 }
 */
export function productionModifier(world) {
  const base = {
    artisanOutputMult: 1.0,
    metallurgistOutputMult: 1.0,
    maintenanceCostMult: 1.0,
  };
  for (const s of listActiveSituations(world)) {
    if (s.systemArcId !== 'S4' || s.currentApproach !== 'CUT_INVESTMENTS') continue;
    base.artisanOutputMult = Math.min(base.artisanOutputMult, S4_CUT_ARTISAN_OUTPUT_MULT);
    base.metallurgistOutputMult = Math.min(base.metallurgistOutputMult, S4_CUT_METALLURGIST_OUTPUT_MULT);
    base.maintenanceCostMult = Math.min(base.maintenanceCostMult, S4_CUT_MAINTENANCE_MULT);
  }
  return base;
}

/* —— 国家主权违约（Empire Defaulted）终局 —— */

/** 违约持续时长：10 年 = 3600 逻辑日 × 24 tick/日 = 86400 tick */
export const EMPIRE_DEFAULT_DURATION_TICKS = 86400;

/**
 * 五项全局惩罚（doc44 Task 1.6 §3 精确数值表；CHK-M1-07 逐项断言）：
 * 建造费 +25% / 影响力 -50% / 凝聚力 -50% / 武器伤害 -25% / 阶层降级时间 -50%。
 */
export const EMPIRE_DEFAULT_PENALTIES = Object.freeze({
  buildCost: 0.25,
  influence: -0.50,
  unity: -0.50,
  weaponDamage: -0.25,
  demotionTime: -0.50,
});

/** 违约强制清空的高维护建筑座数（compact tiles 按 buildingId 降序清前 N；M1 粗配） */
export const EMPIRE_DEFAULT_CLEARED_BUILDINGS = 12;

/** 违约状态判定（untilTick 未到期即生效） */
export function isEmpireDefaulted(world) {
  const soState = world && world.spaceOperaState;
  if (!soState || !soState.empireDefaulted) return false;
  const tick = Number.isFinite(world.tick) ? world.tick : 0;
  return tick < soState.empireDefaulted.untilTick;
}

/**
 * 确定性清空高维护建筑：目标行星 compact tiles 中 buildingId > 0 的格按 buildingId
 * 降序（tie: 下标升序）清前 N = EMPIRE_DEFAULT_CLEARED_BUILDINGS 座（buildingId 置 0，
 * 其余位段无损保留）。
 *
 * @returns {number} 实际清空座数
 */
export function clearHighMaintenanceBuildings(world, planetId) {
  const planets = world && world.entities && world.entities.planets ? world.entities.planets : {};
  const planet = planets[planetId];
  const compact = planet && planet.compactState;
  if (!compact || !Array.isArray(compact.tiles)) return 0;
  const occupied = [];
  for (let i = 0; i < compact.tiles.length; i++) {
    const bid = (compact.tiles[i] >>> 16) & 0x3f;
    if (bid > 0) occupied.push({ idx: i, bid });
  }
  occupied.sort((a, b) => (b.bid - a.bid) || (a.idx - b.idx));
  let cleared = 0;
  for (const { idx } of occupied) {
    if (cleared >= EMPIRE_DEFAULT_CLEARED_BUILDINGS) break;
    const u = unpackTile(compact.tiles[idx] >>> 0);
    compact.tiles[idx] = packTile({ ...u, buildingId: 0 });
    cleared++;
  }
  return cleared;
}

/* ============================== 弧注册（import 期自注册） ============================== */

registerSituationArc('S4', {
  progressMax: 100,
  baseMonthlyDelta: 0, // 初始无方向；首步由 onStep 依净流公式定值
  actBounds: [
    [0, 25],
    [25, 50],
    [50, 75],
    [75, 100],
  ],

  approaches: {
    STATUS_QUO: {
      monthlyDelta: 0, // 基线：不改变进度速率（ΔP 由净流公式决定）
      immediate(world, situation) {
        situation.meta.cutInvestments = false;
      },
    },
    CUT_INVESTMENTS: {
      monthlyDelta: 0, // 对策不改速率：止血来自产出/维护修正（productionModifier）
      immediate(world, situation) {
        situation.meta.cutInvestments = true;
      },
    },
  },

  /**
   * 每次桶步进重算月度增速（doc44 Task 1.6 §2 演进方程）：
   *  - 赤字（netFlow[i] < 0）：ΔP = +5.0 × clamp(|netFlow| / totalConsumption, 0.1, 1.0)
   *    （totalConsumption = 殖民地全槽位净流出合计；退化情形取 |netFlow| 防除零）；
   *  - 盈余：ΔP = −5.0/月（归 0 由引擎安全解除）。
   */
  onStep(world, situation) {
    const planets = world.entities && world.entities.planets ? world.entities.planets : {};
    const planet = planets[situation.targetEntityId];
    const colony = planet && planet.compactState && planet.compactState.colony ? planet.compactState.colony : null;
    const i = Number.isFinite(situation.meta.resourceIndex) ? situation.meta.resourceIndex : 0;
    const netFlow = colony && Array.isArray(colony.netFlow) ? Number(colony.netFlow[i]) : NaN;
    if (!Number.isFinite(netFlow)) {
      situation.monthlyDelta = S4_REGRESS_PER_MONTH; // 目标殖民地缺失 → 按盈余安全回退
      return;
    }
    if (netFlow < 0) {
      let totalConsumption = 0;
      for (const f of colony.netFlow) {
        if (Number.isFinite(f) && f < 0) totalConsumption += -f;
      }
      if (totalConsumption <= 0) totalConsumption = -netFlow;
      const r = Math.min(1.0, Math.max(0.1, -netFlow / totalConsumption));
      situation.monthlyDelta = S4_DELTA_MAX_PER_MONTH * r;
    } else {
      situation.monthlyDelta = S4_REGRESS_PER_MONTH;
    }
  },

  /**
   * 收官钩子：climax = 灾难性赤字 → 国家主权违约（挂载 empireDefaulted 修正、确定性
   * 清空高维护建筑、emit EmpireDefaulted）；defused = 盈余归零安全解除。
   */
  climax(world, situation, outcome) {
    if (outcome !== 'climax') {
      situation.impact = 'S4:SHORTAGE_SAFE_RESOLVED';
      return;
    }
    const soState = world.spaceOperaState;
    const untilTick = (Number.isFinite(world.tick) ? world.tick : 0) + EMPIRE_DEFAULT_DURATION_TICKS;
    soState.empireDefaulted = { untilTick, situationId: situation.id };
    const cleared = clearHighMaintenanceBuildings(world, situation.targetEntityId);
    situation.impact = `S4:EMPIRE_DEFAULTED_UNTIL_${untilTick};CLEARED_${cleared}`;
    emit(world, 'EmpireDefaulted', {
      planetId: situation.targetEntityId,
      situationId: situation.id,
      untilTick,
      clearedBuildings: cleared,
      penalties: EMPIRE_DEFAULT_PENALTIES,
    }, 'economy');
  },
});

/* —— SPEC-PLAN-049 Task 49.3 别名导出（doc49 导入名 ≙ M1 权威实现；零行为增量）—— */
export { watchStrategicStockpiles as stepStrategicShortageMonthly };
