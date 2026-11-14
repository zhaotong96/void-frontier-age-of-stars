/**
 * domain/planets/ecologicalPhaseArc.js — S2 行星深层开采与生态相变弧
 * （SPEC-PLAN-044 阶段一 M1 Task 1.5；责任人：Eng-A / Eng-B 协同，本卷 Eng-B 落地）
 *
 * 职责（doc44 §Task 1.5 逐条契约）：
 *  1. IndustrialPerturbation（envVector[7]）三级阈值机制：
 *     - 稳态基线 15.0（createCompactPlanetState 初值；Slow Tick 漂移向 envBaseline 回归）；
 *     - 月度钩子：每座重工业/深层采矿井（compact tiles buildingId 32-47）每月 +1.8，
 *       外加深层地壳 depthTier × 1.8/月；
 *     - 黄色警戒（>40）：月度确定性事件三选一（磁暴护盾离线 / 重金属水污染农业 -20% /
 *       孢子潮停工；deriveSeed(ARC_S2_ECOLOGY, planetId, monthIndex)）；
 *     - 红色局势（>75）：立即 spawn「行星环境恶化」S2 局势（初始进度 20、基础 +4.0/月）。
 *  2. 三大对策：CONSUME_WORLD(+6/月, 宜居度 -2%/月, 稳定度 -10 → climax 熔岩锻炉星) /
 *     TERRAFORMING_ADAPTATION(立即扣 5000 能量槽 stockpile[0]，不足则 throw，幸福度 -20%
 *     存续期, +3/月 → climax 理想城) / FRUITFUL_PARTNERSHIP(矿物重工 -15%、舒适度消耗
 *     -10%、-3.0/月 → climax 共生孢子母星)。
 *  3. climax 统一收口：envVector[7] 回落至 40、appendHistory、emit 事件
 *     （SituationResolved 由引擎统一发射）。
 *
 * 纪律（doc43 §1.4）：月度钩子首行守卫 world.spaceOperaState；未殖民/无 compactState
 * 行星零写入；零 Math.random / Date.now；不触世界主随机流。
 */

import {
  registerSituationArc,
  registerSituationMonthlyHook,
  spawnSituation,
  listActiveSituations,
} from '../events/situationEngine.js';
import { DOMAIN_SALTS, deriveSeed } from '../world/deterministicRng.js';
import { appendHistory, HISTORY_EVENT_CODES, numericEntityKey, STATUS_FLAG } from './planetStateSchema.js';
import { emit } from '../../core/eventBus.js';
import { TICKS_PER_MONTH } from '../../core/clock.js';

/* ============================== 三级阈值与月度扰动参数（doc44 Task 1.5 §1） ============================== */

export const S2_PERTURBATION_BASELINE = 15.0; // 稳态基线（createCompactPlanetState envVector[7] 初值）
export const S2_YELLOW_THRESHOLD = 40.0; // 黄色警戒：月度局部环境灾害
export const S2_RED_THRESHOLD = 75.0; // 红色局势：强制触发 S2 环境恶化局势
export const S2_PER_INDUSTRY_TILE_PER_MONTH = 1.8; // 每座重工业/深层采矿井每月推高量
export const S2_SPAWN_PROGRESS = 20; // 局势生成初始进度
export const S2_SPAWN_MONTHLY_DELTA = 4.0; // 局势基础增速（未选对策前）

/* ============================== 三大对策参数（doc44 Task 1.5 §2） ============================== */

export const S2_CONSUME_MONTHLY_DELTA = 6.0;
export const S2_CONSUME_HABITABILITY_DECAY = 0.02; // 宜居度每月 -2.0%（相对衰减）
export const S2_CONSUME_STABILITY_COST = 10; // 稳定度一次性 -10
export const S2_TERRAFORM_MONTHLY_DELTA = 3.0;
export const S2_TERRAFORM_COST = 5000; // 立即扣除能量槽 stockpile[0]
export const S2_TERRAFORM_HAPPINESS_MULT = 0.8; // 存续期幸福度一次性 -20%
export const S2_PARTNERSHIP_MONTHLY_DELTA = -3.0;
export const S2_PARTNERSHIP_MINERAL_MULT = 0.85; // 矿物与重工产能 -15%
export const S2_PARTNERSHIP_AMENITIES_MULT = 0.90; // 舒适度消耗 -10%

/** climax 统一收口：envVector[7] 回落值 */
export const S2_CLIMAX_PERTURBATION_SETTLE = 40.0;
/** climax 相变产出参数：熔岩锻炉星合金矿物 +50% / 共生孢子母星生物增速 +35% */
export const S2_VOLCANIC_INDUSTRY_BONUS = 0.5;
export const S2_HIVE_BIO_GROWTH_BONUS = 0.35;

/** 局势弧负值段历史码（planetStateSchema HISTORY_EVENT_CODES 注释口径：负值段留给局势弧） */
const HIST_S2_DEFUSED = -201;

/** climax 相变类型 → historyRing impactCode */
const S2_TRANSFORM_IMPACT_CODES = Object.freeze({ CONSUME_WORLD: 1, TERRAFORMING_ADAPTATION: 2, FRUITFUL_PARTNERSHIP: 3 });

/** 黄色警戒月度确定性灾害表（deriveSeed(ARC_S2_ECOLOGY,…) 三选一） */
const S2_HAZARDS = Object.freeze([
  { id: 'GEOMAGNETIC_STORM', nameZh: '磁暴护盾离线' },
  { id: 'HEAVY_METAL_POLLUTION', nameZh: '重金属水污染' },
  { id: 'SPORE_TIDE', nameZh: '孢子潮停工' },
]);

/* ============================== 月度扰动推进（月度钩子；SpaceOperaClock 注入） ============================== */

/** 统计 compact tiles 中 buildingId ∈ [32,47] 的奇异工业设施座数（位运算直读，零分配） */
export function countExoticIndustryTiles(compact) {
  if (!compact || !Array.isArray(compact.tiles)) return 0;
  let count = 0;
  for (let i = 0; i < compact.tiles.length; i++) {
    const bid = (compact.tiles[i] >>> 16) & 0x3f;
    if (bid >= 32 && bid <= 47) count++;
  }
  return count;
}

/** 应用黄色警戒月度灾害（pick ∈ 0..2；全部为确定性、有界的一次性结算） */
function applyEcologicalHazard(compact, pick) {
  const colony = compact.colony;
  if (pick === 0) {
    // 磁暴护盾离线：剥离全部 Tile 的 SHIELDED 旗标（Bit 28）
    if (Array.isArray(compact.tiles)) {
      const clearMask = ~(STATUS_FLAG.SHIELDED << 26);
      for (let i = 0; i < compact.tiles.length; i++) {
        compact.tiles[i] = (compact.tiles[i] & clearMask) >>> 0;
      }
    }
    return;
  }
  if (!Array.isArray(colony.stockpile)) return;
  const slot = pick === 1 ? 2 : 1; // 1 重金属水污染 → 农业食物 [2]；2 孢子潮停工 → 矿物 [1]
  const v = Number(colony.stockpile[slot]);
  if (Number.isFinite(v) && v > 0) colony.stockpile[slot] = v * 0.8; // 产出停摆 -20% 一次性结算
}

/**
 * S2 月度钩子：工业扰动推进 + 黄色警戒灾害 + 红色局势生成。
 * 由 situationEngine.registerSituationMonthlyHook 登记，月末 tick%720===0 触发。
 * 首行守卫：容器缺失（默认流程/金快照世界）→ 零扫描零写入。
 *
 * @returns {{scanned: number, hazardEvents: number, spawned: number}} 本月统计
 */
export function stepEcologicalPerturbation(world) {
  const stats = { scanned: 0, hazardEvents: 0, spawned: 0 };
  if (!world || !world.spaceOperaState) return stats;
  const planets = world.entities && world.entities.planets ? world.entities.planets : {};
  const activeS2 = new Set();
  for (const s of listActiveSituations(world)) {
    if (s.systemArcId === 'S2') activeS2.add(String(s.targetEntityId));
  }
  const month = Math.floor(world.tick / TICKS_PER_MONTH);

  for (const key of Object.keys(planets).sort()) {
    const planet = planets[key];
    const compact = planet && planet.compactState;
    const colony = compact && compact.colony;
    if (!compact || !colony || !(Number(colony.ownerId) >= 0)) continue; // 未殖民行星零扰动零写入
    stats.scanned++;

    const env = compact.envVector;
    const industryTiles = countExoticIndustryTiles(compact);
    const depthTier = compact.subterraneanLayer ? compact.subterraneanLayer.depthTier : 0;
    const inc = industryTiles * S2_PER_INDUSTRY_TILE_PER_MONTH + depthTier * S2_PER_INDUSTRY_TILE_PER_MONTH;
    if (inc > 0 && Array.isArray(env)) {
      env[7] = Math.min(100, env[7] + inc);
    }
    const p7 = Array.isArray(env) ? env[7] : 0;

    if (p7 > S2_RED_THRESHOLD) {
      // 红色局势：立即激活（每星同时至多一条活跃 S2）
      if (!activeS2.has(String(planet.id))) {
        spawnSituation(world, {
          arcId: 'S2',
          targetEntityId: planet.id,
          progress: S2_SPAWN_PROGRESS,
          monthlyDelta: S2_SPAWN_MONTHLY_DELTA,
          meta: { triggeredByPerturbation: p7, monthIndex: month },
        });
        emit(world, 'EnvironmentalDeterioration', {
          planetId: planet.id,
          perturbation: p7,
          situationArcId: 'S2',
          monthIndex: month,
        }, 'colony');
        stats.spawned++;
      }
    } else if (p7 > S2_YELLOW_THRESHOLD) {
      // 黄色警戒：月度确定性灾害三选一（deriveSeed(ARC_S2_ECOLOGY, planetId, monthIndex)）
      const pick = deriveSeed(world.seed, DOMAIN_SALTS.ARC_S2_ECOLOGY, numericEntityKey(planet.id), month) % 3;
      const hazard = S2_HAZARDS[pick] || S2_HAZARDS[0];
      applyEcologicalHazard(compact, pick);
      emit(world, 'EnvironmentalHazardEvent', {
        planetId: planet.id,
        hazardId: hazard.id,
        nameZh: hazard.nameZh,
        monthIndex: month,
        perturbation: p7,
      }, 'colony');
      stats.hazardEvents++;
    }
  }
  return stats;
}

// import 副作用：登记 S2 月度钩子（经动态 import SpaceOperaClock → setClockHooks 注入）
registerSituationMonthlyHook(stepEcologicalPerturbation);

/* ============================== 局势实例辅助 ============================== */

/** 局势目标行星的 {planet, compact}（缺失返回 null；climax/immediate 的防御性取用） */
function compactOfSituation(world, situation) {
  const planets = world && world.entities && world.entities.planets ? world.entities.planets : {};
  const planet = planets[situation.targetEntityId];
  const compact = planet && planet.compactState;
  return compact && compact.colony ? { planet, compact } : null;
}

/**
 * FRUITFUL_PARTNERSHIP 存续期修正汇总（供结算钩子/集成层消费）：
 * 矿物与重工产能 ×0.85、舒适度消耗 ×0.90（每条活跃共生局势取最严值）。
 */
export function ecologicalModifiers(world) {
  const base = { mineralIndustryMult: 1.0, amenitiesConsumptionMult: 1.0 };
  for (const s of listActiveSituations(world)) {
    if (s.systemArcId !== 'S2' || s.currentApproach !== 'FRUITFUL_PARTNERSHIP') continue;
    base.mineralIndustryMult = Math.min(base.mineralIndustryMult, S2_PARTNERSHIP_MINERAL_MULT);
    base.amenitiesConsumptionMult = Math.min(base.amenitiesConsumptionMult, S2_PARTNERSHIP_AMENITIES_MULT);
  }
  return base;
}

/* ============================== 弧注册（import 期自注册） ============================== */

registerSituationArc('S2', {
  progressMax: 100,
  baseMonthlyDelta: S2_SPAWN_MONTHLY_DELTA,
  actBounds: [
    [0, 25],
    [25, 50],
    [50, 75],
    [75, 100],
  ],

  approaches: {
    CONSUME_WORLD: {
      monthlyDelta: S2_CONSUME_MONTHLY_DELTA,
      immediate(world, situation) {
        const loc = compactOfSituation(world, situation);
        if (!loc) throw new Error('SO: 竭泽而渔需要行星紧凑态与殖民地');
        if (situation.meta.consumeWorld) return; // 幂等（重复切换防御）
        situation.meta.consumeWorld = true;
        // 对策生效月锁定宜居度衰减游标：下一个完整月界起每月 -2%
        situation.meta.lastHabitMonth = Math.floor((Number.isFinite(world.tick) ? world.tick : 0) / TICKS_PER_MONTH);
        loc.compact.colony.stability = Math.max(0, loc.compact.colony.stability - S2_CONSUME_STABILITY_COST);
      },
    },
    TERRAFORMING_ADAPTATION: {
      monthlyDelta: S2_TERRAFORM_MONTHLY_DELTA,
      immediate(world, situation) {
        const loc = compactOfSituation(world, situation);
        if (!loc) throw new Error('SO: 大气重塑需要行星紧凑态与殖民地');
        const stock = loc.compact.colony.stockpile;
        const have = Array.isArray(stock) ? Number(stock[0]) : NaN;
        if (!Number.isFinite(have) || have < S2_TERRAFORM_COST) {
          throw new Error(`SO: 能量槽库存不足 ${S2_TERRAFORM_COST}，无法执行大气重塑（实测 ${String(have)}）`);
        }
        stock[0] -= S2_TERRAFORM_COST; // 精确扣除 5000
        for (const row of loc.compact.colony.strata) {
          if (Array.isArray(row) && Number.isFinite(row[1])) row[1] = Math.max(0, row[1] * S2_TERRAFORM_HAPPINESS_MULT);
        }
        situation.meta.terraforming = true;
      },
    },
    FRUITFUL_PARTNERSHIP: {
      monthlyDelta: S2_PARTNERSHIP_MONTHLY_DELTA,
      immediate(world, situation) {
        situation.meta.partnership = true; // 产能/舒适度修正经 ecologicalModifiers 汇总生效
      },
    },
  },

  /** 每次桶步进：CONSUME_WORLD 月界推进宜居度 -2%（相对衰减，一次性/月） */
  onStep(world, situation) {
    if (situation.currentApproach !== 'CONSUME_WORLD') return;
    const month = Math.floor(world.tick / TICKS_PER_MONTH);
    if (situation.meta.lastHabitMonth == null) {
      // 兜底（对策切换游标缺失时）：生效当月不计，次月界起衰
      situation.meta.lastHabitMonth = month;
      return;
    }
    if (month <= situation.meta.lastHabitMonth) return;
    situation.meta.lastHabitMonth = month;
    const planets = world.entities && world.entities.planets ? world.entities.planets : {};
    const planet = planets[situation.targetEntityId];
    if (planet && Number.isFinite(planet.habitability)) {
      planet.habitability = Math.max(0, planet.habitability * (1 - S2_CONSUME_HABITABILITY_DECAY));
    }
  },

  /**
   * 收官钩子（统一收口：envVector[7] 回落 40 + appendHistory；SituationResolved
   * 事件由引擎统一 emit）：
   *  - CONSUME_WORLD → 熔岩锻炉星：合金矿物产出 +50%、农业归零、epochStage → 3；
   *  - TERRAFORMING_ADAPTATION → 理想城：城市区划容量翻倍（planet.maxDistricts ×2）、epochStage → 3；
   *  - FRUITFUL_PARTNERSHIP → 共生孢子母星：生物科研与人口增速 +35%、epochStage → 3；
   *  - defused（FRUITFUL 逆转归零）→ 危机受控逆转（非相变，记负值段历史码）。
   */
  climax(world, situation, outcome) {
    const loc = compactOfSituation(world, situation);
    if (loc && Array.isArray(loc.compact.envVector)) {
      loc.compact.envVector[7] = S2_CLIMAX_PERTURBATION_SETTLE;
    }
    if (outcome === 'climax') {
      const approach = situation.currentApproach;
      if (approach === 'CONSUME_WORLD') {
        if (loc && loc.planet) {
          loc.planet.volcanicWorld = true;
          loc.planet.volcanicIndustryBonus = S2_VOLCANIC_INDUSTRY_BONUS;
        }
        if (loc && loc.compact && loc.compact.colony && Array.isArray(loc.compact.colony.netFlow)) {
          loc.compact.colony.netFlow[2] = 0; // 农业归零
        }
        situation.impact = 'S2:VOLCANIC_WORLD;ALLOY_MINERAL_+50%;FOOD_ZEROED';
      } else if (approach === 'TERRAFORMING_ADAPTATION') {
        if (loc && loc.planet) {
          loc.planet.arcologyWorld = true;
          if (Number.isFinite(loc.planet.maxDistricts)) loc.planet.maxDistricts = loc.planet.maxDistricts * 2;
        }
        situation.impact = 'S2:ARCOLOGY;URBAN_CAPACITY_x2';
      } else {
        if (loc && loc.planet) {
          loc.planet.mycelialHiveWorld = true;
          loc.planet.bioGrowthBonus = S2_HIVE_BIO_GROWTH_BONUS;
        }
        situation.impact = 'S2:MYCELIAL_HIVE;BIO_GROWTH_+35%';
      }
      if (loc && loc.compact) {
        if (loc.compact.epochStage < 3) loc.compact.epochStage = 3;
        appendHistory(
          loc.compact,
          world.tick,
          HISTORY_EVENT_CODES.EPOCH_TRANSFORMED,
          loc.compact.colony ? loc.compact.colony.ownerId : -1,
          S2_TRANSFORM_IMPACT_CODES[approach] != null ? S2_TRANSFORM_IMPACT_CODES[approach] : 0,
        );
      }
    } else {
      situation.impact = 'S2:ECO_CRISIS_DEFUSED';
      if (loc && loc.compact) {
        appendHistory(
          loc.compact,
          world.tick,
          HIST_S2_DEFUSED,
          loc.compact.colony ? loc.compact.colony.ownerId : -1,
          0,
        );
      }
    }
  },
});
