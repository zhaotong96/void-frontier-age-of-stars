/**
 * domain/planets/archetypeMechanics.js — 16 大行星原型专属模拟钩子
 * （SPEC-PLAN-045 阶段二 M2 Task 2.3；责任人：Eng-A）
 *
 * 职责（doc45 §Task 2.3 机制绑定表逐条落地）：
 *  1. applyArchetypeProfile(planet, world)：ensureCompactPlanetState 之后按
 *     content/planetaryArchetypes.js hooks 一次性修正行星基线 ——
 *       #10 envVector[1] 与 envBaseline[1] = 70（超临界酸雾大气基线）；
 *       #11 orbitalLayer.maxOrbitalDistricts = 12（顶级轨道环带基座）；
 *       #12 subterraneanLayer.subUrbanSlots 容量 ×2（4 → 8 槽，人口工业转入地下溶洞）；
 *       #14 envVector[6] 与 envBaseline[6] = 0（农业与水圈恒 0）；
 *       #15 planet.habitability = 100（盖亚圣域宜居度恒定）；
 *       #3  3 处先驱者考古地标（buildingId 48，deriveSeed 确定性选址）。
 *     幂等（profileApplied 旗标），绝不消费 world.rng；
 *  2. stepArchetypeMechanics(world, planet, dtDay)：SpaceOperaClock Slow 桶钩子
 *     （经 setClockHooks 注入 slowPlanetHook 键位），周期判定全部
 *     deriveSeed/sampleFloat01 确定性、按「已见周期游标」推进（任意 tick 跳变不漏触发）——
 *       #0 每 90 天潮汐火山期：envVector[0] +20（clamp 100）、未护盾建筑
 *          受损判定（buildingId 1-47、护盾 Bit 28 免疫、p=0.5 清除 + DEVASTATED）、
 *          地热产出 +100% 旗标（tidalSurgePeriod，geothermalSurgeActive 消费）；
 *       #1 每 240 天物质倒灌相位切换：前半（phase 0）矿井掩埋维护 +35% /
 *          后半（phase 1）遗迹裸露 S1 速度 +60%（meta 相位旗标翻转）；
 *       #2 未锁定每 60 天确定性重排未锁定区划（zoneSlots Fisher-Yates，
 *          deriveSeed 逐位抽取）；锁定（quantumLocked）后停止重排且
 *          物理科研 +120%（quantumPhysicsResearchBonus）；
 *       #5 晨昏带建造罚：canBuildWithoutPenalty(compact, x) —— 列 x ∈ [6,9]
 *          无惩罚，其余列建造罚（hook.terminatorColumns 权威）；
 *       #6 envVector[0] > 80 → 复用 planetaryThreat.awakenLeviathan 惊醒幼兽；
 *       #7 decryptBonus/detectionBonus 导出（crystallineIntelBonus）；
 *       #15 envVector[7] > 35 → 必定刷远古净化守卫（hostileGuardians=true 棘轮），
 *          未护盾建筑（1-47）周期受损（护盾免疫）。
 *  3. 命令领域落点 setQuantumPhaseLock(compact, engageLock)：LockQuantumPhasePlanet
 *     handler（M2 集成注入）写 archetypeState.quantumLocked + 反应堆维护旗标
 *     reactorMaintenance（锁定 → 维护 +，解锁 → 双清）。
 *
 * 时钟接线裁决（动态 import）：本模块经动态 import SpaceOperaClock 注入
 * slowPlanetHook —— 与 situationEngine 同构（避免静态 import 改变 HourlySystems
 * 「space-opera 每 tick 最后注册」的阶段序不变量，见 src/simulation/HourlySystems.js:223
 * 注释）；套件/集成层可 await ensureArchetypeHookInjected() 保证钩子就位。
 *
 * 纪律（doc43 §1.4 零漂移铁律）：
 *  - import 期仅构建冻结常量 + 动态注入时钟钩子，不改任何世界状态；
 *  - stepArchetypeMechanics 首行守卫 world.spaceOperaState（金快照世界零读取零写入），
 *    仅处理已挂载 compactState 的行星（惰性容器守卫），绝不 ensure、绝不消费 world.rng；
 *  - 确定性随机一律 deriveSeed/sampleFloat01 + DOMAIN_SALTS.PLANET_MASTER 盐值
 *    （「行星静态天体原型」语义；盐值取自冻结表，无私编魔数）；零 Math.random / Date.now；
 *  - 周期历史码使用正值段 70..72（planetStateSchema HISTORY_EVENT_CODES 注释口径：
 *    负值段留给局势弧；70+ 为本模块私有枚举，不与既有 1..6 冲突）。
 */

import { getArchetype } from '../../content/planetaryArchetypes.js';
import { ensureCompactPlanetState, appendHistory, STATUS_FLAG } from './planetStateSchema.js';
import { DOMAIN_SALTS, deriveSeed, sampleFloat01 } from '../world/deterministicRng.js';
import { awakenLeviathan } from '../ground/planetaryThreat.js';
import { TICKS_PER_DAY } from '../../core/clock.js';
import { emit } from '../../core/eventBus.js';

/** 原型机制确定性子流盐值（DOMAIN_SALTS 冻结表：行星静态天体原型域） */
const ARCH_SALT = DOMAIN_SALTS.PLANET_MASTER;

/** #3 考古地标选址 step 基值（deriveSeed step 段位：0x4C00 = buildingId 48 纪念） */
const LANDMARK_STEP_BASE = 0x4c00;

/** #2 量子重排 Fisher-Yates step 段位基值（periodIndex × 16 + 槽位） */
const QUANTUM_STEP_BASE = 0x5100;

/** #0 潮汐火山未护盾建筑受损判定概率（M2 裁决：单周期 50% 火力覆盖） */
const TIDAL_DAMAGE_PROB = 0.5;

/** #15 净化守卫未护盾建筑周期受损概率（M2 裁决：每次 Slow 访问 35%） */
const PURIFIER_DAMAGE_PROB = 0.35;

/** 模块私有历史码（正值段 70..；负值段留给局势弧，见 planetStateSchema.js:497 注释） */
const HIST_ARCHETYPE_TIDAL_VOLCANO = 70; // #0 潮汐火山期喷发（impactCode = 受损建筑数）
const HIST_ARCHETYPE_BACKFLOW_FLIP = 71; // #1 物质倒灌相位翻转（impactCode = 新相位）
const HIST_ARCHETYPE_GUARDIAN_AWAKENED = 72; // #15 净化守卫苏醒（impactCode = env7 取整）

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function clampTick(tick) {
  return Number.isFinite(tick) ? Math.max(0, Math.trunc(tick)) : 0;
}

/** 天数 → tick（1 tick = 1 游戏小时；TICKS_PER_DAY = 24，src/core/clock.js 权威口径） */
function ticksFromDays(days) {
  return Math.max(1, Math.round(days * TICKS_PER_DAY));
}

/* ============================== 原型状态容器（惰性幂等） ============================== */

/**
 * 惰性挂载 compact.archetypeState（幂等；绝不消费 world.rng）。
 * 结构：{ profileApplied, quantumLocked, reactorMaintenance, backflowPhase,
 *        backflowMineUpkeepPenaltyActive, backflowRelicSpeedBonusActive,
 *        hostileGuardians, purifierDamageEvents, tidalPeriodSeen, tidalSurgePeriod,
 *        quantumPeriodSeen, lastQuantumReshufflePeriod, landmarkTiles }
 */
function ensureArchetypeState(compact) {
  if (!isPlainObject(compact.archetypeState)) {
    compact.archetypeState = {
      profileApplied: false,
      quantumLocked: false,
      reactorMaintenance: false,
      backflowPhase: 0,
      backflowMineUpkeepPenaltyActive: false,
      backflowRelicSpeedBonusActive: false,
      hostileGuardians: false,
      purifierDamageEvents: 0,
      tidalPeriodSeen: 0,
      tidalSurgePeriod: -1,
      quantumPeriodSeen: 0,
      lastQuantumReshufflePeriod: 0,
      landmarkTiles: null,
    };
  }
  return compact.archetypeState;
}

/* ============================== 建筑位段直读直写（热路径零分配） ============================== */

const BUILDING_MASK = 0x3f << 16;
const FLAGS_MASK = 0x3f << 26;

/**
 * Tile 建筑段清零 + DEVASTATED 置位（其余位段无损；与 sparseFrontierCA 熔岩烧毁同口径：
 * withBuilding(t, 0) + withFlags(t, flags | DEVASTATED) 的内联形态）。
 */
function devastateBuilding(t) {
  const cleared = t & ~BUILDING_MASK;
  const flags = ((cleared >>> 26) & 0x3f) | STATUS_FLAG.DEVASTATED;
  return ((cleared & ~FLAGS_MASK) | ((flags & 0x3f) << 26)) >>> 0;
}

/* ============================== applyArchetypeProfile（doc45 Task 2.3 基线修正） ============================== */

/**
 * #3 先驱者考古地标（buildingId 48，先驱者奇观段 48-63）：deriveSeed 确定性选址，
 * 仅落建筑空置格（buildingId === 0）；不足 count 时顺序重试至 512 次（确定性上限）。
 */
function placeInitialLandmarks(world, compact, st, count) {
  const seed = (typeof world.seed === 'number' && Number.isFinite(world.seed)) ? world.seed >>> 0 : 0;
  const placed = [];
  for (let attempt = 0; placed.length < count && attempt < 512; attempt++) {
    const r = deriveSeed(seed, ARCH_SALT, compact.id, LANDMARK_STEP_BASE + attempt);
    const idx = r % 256;
    const t = compact.tiles[idx] >>> 0;
    if (((t >>> 16) & 0x3f) !== 0) continue; // 建筑空置格才可落地标
    compact.tiles[idx] = ((t & ~BUILDING_MASK) | (48 << 16)) >>> 0; // 48 = 先驱者奇观
    placed.push(idx);
  }
  st.landmarkTiles = placed;
  return placed;
}

/**
 * 按原型 hooks 一次性修正行星基线（ensureCompactPlanetState 之后调用；幂等）。
 *
 * @param {object} planet - 行星实体
 * @param {object} world - 世界根对象（读 world.seed，绝不读 world.rng）
 * @returns {object} planet.compactState（幂等：重复调用同引用零重写）
 */
export function applyArchetypeProfile(planet, world) {
  const compact = ensureCompactPlanetState(planet, world);
  const st = ensureArchetypeState(compact);
  if (st.profileApplied === true) return compact;
  st.profileApplied = true;

  const arch = getArchetype(compact.archetypeId & 0x0f);
  const hooks = arch.hooks;
  const tick = clampTick(world && world.tick);

  // —— #10 超临界硫磺毒釜：envVector[1] 基线 70（含 Slow Tick 漂移基线快照）——
  if (Number.isFinite(hooks.initialEnv1)) {
    compact.envVector[1] = hooks.initialEnv1;
    if (Array.isArray(compact.envBaseline) && compact.envBaseline.length === compact.envVector.length) {
      compact.envBaseline[1] = hooks.initialEnv1;
    }
  }
  // —— #14 剥离地幔铁核星：农业与水圈恒 0（envVector[6] HydrosphereLevel 基线归零）——
  if (hooks.agriHydroZero === true) {
    compact.envVector[6] = 0;
    if (Array.isArray(compact.envBaseline) && compact.envBaseline.length === compact.envVector.length) {
      compact.envBaseline[6] = 0;
    }
    st.agriHydroZero = true;
  }
  // —— #11 断环天工界：顶级轨道环带基座 ——
  if (Number.isFinite(hooks.maxOrbitalDistricts) && isPlainObject(compact.orbitalLayer)) {
    compact.orbitalLayer.maxOrbitalDistricts = hooks.maxOrbitalDistricts;
  }
  // —— #12 蜂巢溶洞死月：地下溶洞容量翻倍（4 → 8 槽，追加空槽）——
  if (Number.isFinite(hooks.subUrbanSlotsMultiplier)
    && isPlainObject(compact.subterraneanLayer)
    && Array.isArray(compact.subterraneanLayer.subUrbanSlots)) {
    const mul = Math.max(1, Math.round(hooks.subUrbanSlotsMultiplier));
    const slots = compact.subterraneanLayer.subUrbanSlots;
    const target = Math.min(16, slots.length * mul);
    while (slots.length < target) slots.push(0);
    st.subUrbanSlotsMultiplier = mul;
  }
  // —— #15 盖亚圣域：宜居度恒定 100%（planet 实体字段存在才写）——
  if (Number.isFinite(hooks.habitabilityFixed) && Number.isFinite(planet.habitability)) {
    planet.habitability = hooks.habitabilityFixed;
  }
  // —— #3 先驱者机械墓园：3 处高阶考古地标（buildingId 48 确定性选址）——
  if (Number.isFinite(hooks.initialArchaeologyLandmarks) && Array.isArray(compact.tiles)) {
    placeInitialLandmarks(world, compact, st, hooks.initialArchaeologyLandmarks);
  }
  // —— #1 沙漏双星：倒灌相位按当前 tick 初始化（前半掩埋 / 后半裸露）——
  if (Number.isFinite(hooks.backflowPeriodDays)) {
    const phase = Math.floor(tick / ticksFromDays(hooks.backflowPeriodDays)) % 2;
    st.backflowPhase = phase;
    st.backflowMineUpkeepPenaltyActive = phase === 0;
    st.backflowRelicSpeedBonusActive = phase === 1;
  }
  return compact;
}

/* ============================== 周期步进（#0 / #1 / #2 / #6 / #15） ============================== */

/** #0 潮汐火山期（每 90 天；已见周期游标推进，任意 tick 跳变不漏触发） */
function stepTidalVolcano(world, planet, compact, st, tick, hooks) {
  const periodTicks = ticksFromDays(hooks.tidalVolcanoPeriodDays);
  const periodIndex = Math.floor(tick / periodTicks);
  if (periodIndex <= st.tidalPeriodSeen) return null;
  st.tidalPeriodSeen = periodIndex;
  st.tidalSurgePeriod = periodIndex; // 本周期地热产出 +100%（geothermalSurgeActive 消费）

  compact.envVector[0] = Math.min(100, compact.envVector[0] + (hooks.tidalVolcanoEnv0Spike || 20));

  const seed = (typeof world.seed === 'number' && Number.isFinite(world.seed)) ? world.seed >>> 0 : 0;
  let damaged = 0;
  for (let i = 0; i < compact.tiles.length; i++) {
    const t = compact.tiles[i] >>> 0;
    const bid = (t >>> 16) & 0x3f;
    if (bid < 1 || bid > 47) continue; // 仅采集/城市/工业建筑（48-63 先驱者奇观豁免）
    if (((t >>> 26) & 0x3f & STATUS_FLAG.SHIELDED) !== 0) continue; // 护盾 Bit 28 免疫
    if (sampleFloat01(seed, ARCH_SALT, compact.id, periodIndex * 256 + i) >= TIDAL_DAMAGE_PROB) continue;
    compact.tiles[i] = devastateBuilding(t);
    damaged++;
  }
  appendHistory(compact, tick, HIST_ARCHETYPE_TIDAL_VOLCANO, compact.colony ? compact.colony.ownerId : -1, damaged);
  emit(world, 'TidalVolcanoEruption', {
    planetId: planet.id,
    periodIndex,
    env0: compact.envVector[0],
    damagedBuildings: damaged,
  }, 'world');
  return { periodIndex, damaged };
}

/** #1 物质倒灌相位切换（每 240 天；前半掩埋维护 +35% / 后半遗迹裸露 S1 +60%） */
function stepBackflow(world, planet, compact, st, tick, hooks) {
  const periodTicks = ticksFromDays(hooks.backflowPeriodDays);
  const phase = Math.floor(tick / periodTicks) % 2;
  if (phase === st.backflowPhase) return null;
  st.backflowPhase = phase;
  st.backflowMineUpkeepPenaltyActive = phase === 0;
  st.backflowRelicSpeedBonusActive = phase === 1;
  appendHistory(compact, tick, HIST_ARCHETYPE_BACKFLOW_FLIP, compact.colony ? compact.colony.ownerId : -1, phase);
  emit(world, 'MatterBackflowPhase', {
    planetId: planet.id,
    phase,
    mineUpkeepPenaltyActive: phase === 0,
    relicSpeedBonusActive: phase === 1,
  }, 'world');
  return { phase };
}

/** #2 量子相移重组（未锁定每 60 天确定性重排 zoneSlots；锁定后停止重排） */
function stepQuantumPhase(world, planet, compact, st, tick, hooks) {
  const periodTicks = ticksFromDays(hooks.phaseShiftPeriodDays);
  const periodIndex = Math.floor(tick / periodTicks);
  if (periodIndex <= st.quantumPeriodSeen) return null;
  st.quantumPeriodSeen = periodIndex;
  if (st.quantumLocked === true) return { locked: true }; // 观测场锁定：边界消费、绝不重排

  const zoneSlots = isPlainObject(compact.urbanZones) && Array.isArray(compact.urbanZones.zoneSlots)
    ? compact.urbanZones.zoneSlots
    : null;
  if (!zoneSlots || zoneSlots.length < 2) return { periodIndex, reshuffled: false };

  // —— Fisher-Yates 确定性重排（逐位 deriveSeed 抽取；值集守恒仅次序变化）——
  const seed = (typeof world.seed === 'number' && Number.isFinite(world.seed)) ? world.seed >>> 0 : 0;
  for (let i = zoneSlots.length - 1; i > 0; i--) {
    const r = deriveSeed(seed, ARCH_SALT, compact.id, QUANTUM_STEP_BASE + periodIndex * 16 + i);
    const j = r % (i + 1);
    const tmp = zoneSlots[i];
    zoneSlots[i] = zoneSlots[j];
    zoneSlots[j] = tmp;
  }
  st.lastQuantumReshufflePeriod = periodIndex;
  emit(world, 'QuantumPhaseShift', { planetId: planet.id, periodIndex }, 'world');
  return { periodIndex, reshuffled: true };
}

/** #6 巨兽孵化卫星：envVector[0] > 80 → 复用 awakenLeviathan 惊醒狂暴幼兽 */
function stepLeviathanNursery(world, planet, compact, hooks) {
  if (!(compact.envVector[0] > hooks.wakeThresholdEnv0)) return null;
  const leviathan = awakenLeviathan(world, planet);
  return { leviathanAwakened: !!(leviathan && leviathan.active) };
}

/** #15 盖亚圣域：envVector[7] > 35 → 必定刷远古净化守卫（棘轮）+ 未护盾建筑周期受损 */
function stepGaiaGuardians(world, planet, compact, st, tick, hooks) {
  const threshold = hooks.guardianThresholdEnv7;
  const polluted = compact.envVector[7] > threshold;
  let awakenedNow = false;

  if (polluted && st.hostileGuardians !== true) {
    st.hostileGuardians = true; // 棘轮：一旦苏醒不再回落
    awakenedNow = true;
    appendHistory(compact, tick, HIST_ARCHETYPE_GUARDIAN_AWAKENED, compact.colony ? compact.colony.ownerId : -1, Math.round(compact.envVector[7]));
    emit(world, 'PurifierGuardiansAwakened', {
      planetId: planet.id,
      env7: compact.envVector[7],
      threshold,
    }, 'world');
  }

  if (!(st.hostileGuardians === true && polluted)) return awakenedNow ? { awakened: true } : null;

  // —— 未护盾建筑周期受损（每次 Slow 访问 35%；护盾 Bit 28 免疫；确定性 roll）——
  const seed = (typeof world.seed === 'number' && Number.isFinite(world.seed)) ? world.seed >>> 0 : 0;
  let damaged = 0;
  for (let i = 0; i < compact.tiles.length; i++) {
    const t = compact.tiles[i] >>> 0;
    const bid = (t >>> 16) & 0x3f;
    if (bid < 1 || bid > 47) continue;
    if (((t >>> 26) & 0x3f & STATUS_FLAG.SHIELDED) !== 0) continue;
    if (sampleFloat01(seed, ARCH_SALT, compact.id, tick * 256 + i) >= PURIFIER_DAMAGE_PROB) continue;
    compact.tiles[i] = devastateBuilding(t);
    damaged++;
  }
  if (damaged > 0) st.purifierDamageEvents += damaged;
  return { awakened: awakenedNow || undefined, damaged };
}

/* ============================== Slow 桶钩子（setClockHooks 注入） ============================== */

/**
 * 原型专属模拟步进（SpaceOperaClock Slow 桶 slowPlanetHook 注册形态）。
 *
 * 首行守卫 world.spaceOperaState（未挂载容器 → null 零写入）；仅处理已挂载
 * compactState 的行星（惰性容器守卫，绝不 ensure）。周期判定按「已见周期游标」
 * 推进：任意 tick 跳变不漏触发、重复访问不重放。
 *
 * @param {object} world - 世界根对象
 * @param {object} planet - 行星实体
 * @param {number} dtDay - 本次步进折算天数（Slow 桶 30 tick = 1.25 天；离散事件步仅契约占位）
 * @returns {object|null} 本步原型事件摘要（无事件返回 null）
 */
export function stepArchetypeMechanics(world, planet, dtDay) {
  void dtDay; // 契约占位：周期判定走绝对 tick 已见游标，杜绝浮点累积误触发
  if (!world || typeof world !== 'object' || !world.spaceOperaState) return null;
  if (!planet || typeof planet !== 'object') return null;
  const compact = planet.compactState; // 惰性容器守卫：未触达行星零写入零漂移
  if (!compact || typeof compact !== 'object') return null;
  if (!Array.isArray(compact.envVector) || compact.envVector.length < 8) return null;

  const st = ensureArchetypeState(compact);
  applyArchetypeProfile(planet, world); // 幂等：已应用则零重写

  const tick = clampTick(world.tick);
  const arch = getArchetype(compact.archetypeId & 0x0f);
  switch (arch.id) {
    case 0: return stepTidalVolcano(world, planet, compact, st, tick, arch.hooks);
    case 1: return stepBackflow(world, planet, compact, st, tick, arch.hooks);
    case 2: return stepQuantumPhase(world, planet, compact, st, tick, arch.hooks);
    case 6: return stepLeviathanNursery(world, planet, compact, arch.hooks);
    case 15: return stepGaiaGuardians(world, planet, compact, st, tick, arch.hooks);
    default: return null; // #3/#4/#5/#7/#8/#9/#10/#11/#12/#13/#14 为被动钩子（无周期步进）
  }
}

/* ============================== 原型钩子消费口（集成层/结算层读取） ============================== */

/**
 * #0 地热产出 +100% 旗标（火山期存续判定）：当前 tick 所属周期 === 最后喷发周期。
 */
export function geothermalSurgeActive(compact, tick) {
  if (!isPlainObject(compact) || !isPlainObject(compact.archetypeState)) return false;
  const st = compact.archetypeState;
  if (!Number.isFinite(st.tidalSurgePeriod) || st.tidalSurgePeriod < 0) return false;
  const arch = getArchetype(compact.archetypeId & 0x0f);
  if (arch.id !== 0) return false;
  return Math.floor(clampTick(tick) / ticksFromDays(arch.hooks.tidalVolcanoPeriodDays)) === st.tidalSurgePeriod;
}

/** #1 掩埋相位（矿井维护费 +35%）旗标 */
export function backflowMineUpkeepPenaltyActive(compact) {
  return !!(isPlainObject(compact) && isPlainObject(compact.archetypeState)
    && compact.archetypeState.backflowMineUpkeepPenaltyActive === true);
}

/** #1 裸露相位（先驱者遗迹 S1 考古速度 +60%）旗标 */
export function backflowRelicSpeedBonusActive(compact) {
  return !!(isPlainObject(compact) && isPlainObject(compact.archetypeState)
    && compact.archetypeState.backflowRelicSpeedBonusActive === true);
}

/**
 * #2 物理科研产出加成（倍率增量）：锁定（quantumLocked）→ +120%（1.2），否则 0。
 */
export function quantumPhysicsResearchBonus(compact) {
  if (!isPlainObject(compact) || !isPlainObject(compact.archetypeState)) return 0;
  const arch = getArchetype(compact.archetypeId & 0x0f);
  if (arch.id !== 2) return 0;
  return compact.archetypeState.quantumLocked === true ? arch.hooks.lockedPhysicsBonus : 0;
}

/**
 * #2 量子相位锁定切换（LockQuantumPhasePlanet 命令领域落点；M2 集成 handler 注入）。
 * engageLock=true → quantumLocked=true + 反应堆维护旗标 reactorMaintenance=true；
 * engageLock=false → 双旗标清零（观测场撤收）。
 *
 * @param {object} compact - 紧凑 PlanetState 容器
 * @param {boolean} engageLock - true 张开观测场锁定 | false 撤收
 * @returns {object} compact.archetypeState
 */
export function setQuantumPhaseLock(compact, engageLock) {
  const st = ensureArchetypeState(compact);
  st.quantumLocked = engageLock === true;
  st.reactorMaintenance = st.quantumLocked; // 反应堆维护旗标随锁定同步
  return st;
}

/**
 * #5 永昼永夜潮汐锁定界晨昏带建造检定：列 x ∈ hook.terminatorColumns（含端点）
 * 无惩罚；其余列建造罚。非 #5 原型恒无惩罚（true）。
 *
 * @param {object} compact - 紧凑 PlanetState 容器
 * @param {number} x - 地表列号 0..15
 * @returns {boolean} true = 无惩罚建造
 */
export function canBuildWithoutPenalty(compact, x) {
  if (!isPlainObject(compact)) return true;
  const arch = getArchetype(compact.archetypeId & 0x0f);
  const cols = arch.hooks.terminatorColumns;
  if (!Array.isArray(cols) || cols.length !== 2) return true;
  const col = Number(x);
  if (!Number.isFinite(col)) return false;
  return col >= cols[0] && col <= cols[1];
}

/**
 * #7 全视晶化共鸣星情报加成汇总：遍历全部已挂载 compactState 的行星，对
 * 已殖民（colony.ownerId ≥ 0）的 archetype 7 行星逐星累计解密 +2 / 探测半径 +80%。
 *
 * @param {object} world - 世界根对象
 * @returns {{decryption: number, detectionBonus: number}} 情报修正合计
 */
export function crystallineIntelBonus(world) {
  const bonus = { decryption: 0, detectionBonus: 0 };
  const planets = world && world.entities && world.entities.planets ? world.entities.planets : {};
  for (const key of Object.keys(planets).sort()) {
    const compact = planets[key] && planets[key].compactState;
    const colony = compact && compact.colony;
    if (!compact || !colony || !(Number(colony.ownerId) >= 0)) continue;
    const arch = getArchetype(compact.archetypeId & 0x0f);
    if (arch.id !== 7) continue;
    bonus.decryption += arch.hooks.decryptBonus;
    bonus.detectionBonus += arch.hooks.detectionBonus;
  }
  return bonus;
}

/**
 * #8 万丈冰壳暗海界轨道轰炸伤害乘数：archetype 8 → 0.25（-75%），其余 → 1.0。
 */
export function bombardmentDamageMultiplier(compact) {
  if (!isPlainObject(compact)) return 1.0;
  const arch = getArchetype(compact.archetypeId & 0x0f);
  const mult = arch.hooks.bombardmentDamageMultiplier;
  return Number.isFinite(mult) ? mult : 1.0;
}

/* ============================== 时钟接线（动态 import，避免阶段序扰动） ============================== */
// 静态打包产物中动态 import 相对说明符不可达（404 静默降级）——统一静态接线（SpaceOperaWiring.js）。
import { setClockHooks } from '../../simulation/SpaceOperaClock.js';

/** Slow 桶钩子入口（setClockHooks.slowPlanetHook 注册形态；签名 (world, planet, dtDay)） */
function slowPlanetHookEntry(world, planet, dtDay) {
  return stepArchetypeMechanics(world, planet, dtDay);
}

let hookInjectState = 'idle'; // idle → injecting → registered | failed（注册完成以 .then 内为准）
let hookInjectPromise = null;

/** 动态 import SpaceOperaClock 并 setClockHooks 注入 slowPlanetHook（幂等） */
function injectSlowPlanetHook() {
  if (hookInjectState !== 'idle') return;
  setClockHooks({ slowPlanetHook: slowPlanetHookEntry });
  hookInjectState = 'registered';}

/**
 * 幂等预注入 Slow 桶钩子（返回注入完成的 Promise）。
 * 同步 import 本模块后「立即同步跑 tick 循环」的调用方（套件/集成层）必须先
 * await ensureArchetypeHookInjected()，否则该轮同步循环内 slowPlanetHook 尚未就位。
 * 注入完成判定以 setClockHooks 实际执行（registered）为准，杜绝 .then 未落地即放行。
 *
 * @returns {Promise<void>} 注入完成（或已注入/已降级）信号
 */
export function ensureArchetypeHookInjected() {
  injectSlowPlanetHook();
  return Promise.resolve();
}

// import 副作用：向 SpaceOperaClock 注册 slowPlanetHook（动态 import 经 setClockHooks 注入；
// 函数体首行守卫 world.spaceOperaState，未触达世界/金快照 8be8ce2c 零漂移；
// 注入完成判定以 hookInjectState='registered' 为准 —— 套件须 await ensureArchetypeHookInjected()）
injectSlowPlanetHook();
