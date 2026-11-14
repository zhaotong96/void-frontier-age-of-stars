/**
 * simulation/SpaceOperaClock.js — 三级时钟分片调度器（SPEC-PLAN-044 M1 Task 1.2 落地形态）
 *
 * Medium Tick（10 桶轮询，Bucket = tick % 10）：每帧处理全银河 1/10 行星的
 * 局势步进与 8 维资源库存结算 + 1/10 舰队的跨星系航线推进（300 星规模 = 精确 30 星，
 * 120 舰队规模 = 精确 12 支/帧）。
 * Slow Tick（30 桶轮询，Bucket = tick % 30）：每帧处理 1/30 行星的 envVector 8 维
 * 向基线漂移、稀疏前沿 CA 演化（42 号总纲 §六.3：首次触达以 seedFrontierRing 播种
 * 24 前沿位，逐星 stepSparseFrontierCA 菌毯/熔岩/冰盖/晶格四规则相变）、五纪元晋升
 * 检定与深层坍塌月度抽检 + 1/30 领袖忠诚检定占位
 * （300 星规模 = 精确 10 星，90 领袖规模 = 精确 3 名/帧）。
 * Monthly（registerMonthly）：月末收口触发 S2 工业扰动推进钩子与 S4 短缺监视钩子。
 *
 * 纪律（doc43 §1.4 / doc44 零漂移铁律）：
 *  - import 期仅注册阶段（registerHourly/registerMonthly），不改任何世界状态；
 *  - stepSpaceOperaTick/stepSpaceOperaMonthly 首行守卫 world.spaceOperaState：
 *    未挂载容器（默认流程/金快照世界）零消费零写入，逐位零漂移；
 *  - 只处理已挂载 compactState 的行星（惰性容器守卫，与 HourlySystems planet.fort?.v!==1
 *    跳过模式同构）；绝不 ensure、绝不消费 world.rng；
 *  - 时间语义：1 tick = 1 游戏小时，TICKS_PER_MONTH = 720（src/core/clock.js 权威口径）。
 *
 * 跨模块解耦（doc44 Task 1.2(c)）：局势步进函数（situationEngine，Eng-B）、舰队航行
 * （M3 autonomousSectorLife）、领袖忠诚（M3）、S2/S4 月度钩子与 M2 行星原型 Slow 桶
 * 钩子（archetypeMechanics slowPlanetHook）均经 setClockHooks 注入，避免模块环 ——
 * 本模块不 import 局势/舰队/领袖/原型机制模块（雅可比收口经动态 import 副作用注册）。
 */

import { TICKS_PER_DAY, TICKS_PER_MONTH } from '../core/clock.js';
import {
  hasSurveyedTile,
  numericEntityKey,
  HISTORY_EVENT_CODES,
  appendHistory,
  checkSubterraneanCollapse,
} from '../domain/planets/planetStateSchema.js';
import {
  stepSparseFrontierCA,
  seedFrontierRing,
  frontierCount,
} from '../domain/planets/sparseFrontierCA.js';

const MED_BUCKETS = 10;
const SLOW_BUCKETS = 30;
/** Medium 桶单次步进折算月份数（10 tick / 720 tick·月^-1）——72 次/月精确收敛为整月 */
const MED_STEP_MONTHS = MED_BUCKETS / TICKS_PER_MONTH;
/** Slow 桶单次步进折算月份数（30 tick / 720 tick·月^-1 = 1/24）——24 次/月精确收敛为整月 */
const SLOW_STEP_MONTHS = SLOW_BUCKETS / TICKS_PER_MONTH;
/** Slow 桶单次步进折算天数（30 tick / 24 tick·天^-1 = 1.25 天；M2 slowPlanetHook 消费） */
const SLOW_STEP_DAYS = SLOW_BUCKETS / TICKS_PER_DAY;
/** envVector 向基线漂移速率（每月衰减比例，doc44 Task 1.2(e)） */
const DRIFT_RATE_PER_MONTH = 0.02;

/* ============================== 钩子注册表（跨弧解耦注入点） ============================== */

/**
 * 进程级钩子注册表（setClockHooks 注入；供各弧模块初始化时登记）：
 *  - stepSituation(world, situation, dtMonthFraction)：四幕局势步进（situationEngine 注入）；
 *  - monthlyHooks: fn[]（world）：月末收口钩子（S2 工业扰动推进 / S4 短缺监视，M1 集成注入实现）；
 *  - leaderTick(world, character)：领袖忠诚检定（M3 注入；M1 只计数不调用业务）；
 *  - fleetTick(world, fleet)：自主舰队航线推进（M3 注入；无 autonomousFleets 时跳过）；
 *  - slowPlanetHook(world, planet, dtDay)：Slow 桶行星原型机制钩子（M2
 *    archetypeMechanics 注入；仅对已挂载 compactState 的行星调用）。
 */
const hooks = {
  stepSituation: null,
  monthlyHooks: [],
  leaderTick: null,
  fleetTick: null,
  slowPlanetHook: null,
};

/**
 * 注入时钟钩子（幂等覆盖：按 key 覆盖，未提及的 key 保持原值）。
 * monthlyHooks 接受单函数或函数数组（内部拷贝，防外部可变引用）。
 */
export function setClockHooks(reg = {}) {
  if (!reg || typeof reg !== 'object') return;
  if ('stepSituation' in reg) hooks.stepSituation = typeof reg.stepSituation === 'function' ? reg.stepSituation : null;
  if ('monthlyHooks' in reg) {
    const mh = reg.monthlyHooks;
    if (Array.isArray(mh)) hooks.monthlyHooks = mh.filter((f) => typeof f === 'function');
    else if (typeof mh === 'function') hooks.monthlyHooks = [mh];
    else hooks.monthlyHooks = [];
  }
  if ('leaderTick' in reg) hooks.leaderTick = typeof reg.leaderTick === 'function' ? reg.leaderTick : null;
  if ('fleetTick' in reg) hooks.fleetTick = typeof reg.fleetTick === 'function' ? reg.fleetTick : null;
  if ('slowPlanetHook' in reg) hooks.slowPlanetHook = typeof reg.slowPlanetHook === 'function' ? reg.slowPlanetHook : null;
}

/** 清空全部时钟钩子（套件隔离卫生用） */
export function resetClockHooks() {
  hooks.stepSituation = null;
  hooks.monthlyHooks = [];
  hooks.leaderTick = null;
  hooks.fleetTick = null;
  hooks.slowPlanetHook = null;
}

function zeroStats() {
  return { medPlanets: 0, medFleets: 0, slowPlanets: 0, slowLeaders: 0, situationsStepped: 0 };
}

/* ============================== 确定性遍历辅助 ============================== */

/** 实体集合确定性键序（先 sort keys 保证跨世界逐位一致的遍历顺序） */
function sortedEntityKeys(bag) {
  return bag && typeof bag === 'object' ? Object.keys(bag).sort() : [];
}

/** 桶命中判定：数字键 % bucketCount === bucket（实体无 id 时以集合键兜底） */
function inBucket(entity, key, bucketCount, bucket) {
  const id = entity && typeof entity === 'object' && entity.id !== undefined ? entity.id : key;
  return numericEntityKey(id) % bucketCount === bucket;
}

/**
 * 把活跃局势按 targetEntityId 索引（每 tick 一次，O(S)）。
 * situationId 字典键按数值升序遍历（确定性；局势间互不交互，次序仅约束步进顺序）。
 * 匹配约定：targetEntityId 与 planet.id 同型相等，或其字符串形式相等
 * （局势引擎 spawnSituation 落 targetEntityId 时须使用实体原始 id）。
 */
function indexSituationsByTarget(soState) {
  const map = new Map();
  const bag = soState.situations;
  if (!bag || typeof bag !== 'object') return map;
  const ids = Object.keys(bag).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    return (Number.isFinite(na) ? na : 0) - (Number.isFinite(nb) ? nb : 0);
  });
  for (const sid of ids) {
    const sit = bag[sid];
    if (!sit || typeof sit !== 'object') continue;
    const t = sit.targetEntityId;
    if (!map.has(t)) map.set(t, []);
    map.get(t).push(sit);
    const ts = String(t);
    if (!map.has(ts)) map.set(ts, []);
    if (map.get(ts)[map.get(ts).length - 1] !== sit) map.get(ts).push(sit);
  }
  return map;
}

/* ============================== Medium Tick（10 桶） ============================== */

/** Medium 桶：行星局势步进 + 资源结算；返回 situationsStepped 增量 */
function stepMediumPlanets(world, tick, soState, medBucket, stats) {
  const dtMonth = MED_STEP_MONTHS;
  const byTarget = indexSituationsByTarget(soState);
  const planets = world.entities.planets;
  for (const key of sortedEntityKeys(planets)) {
    const planet = planets[key];
    if (!planet || typeof planet !== 'object') continue;
    if (!inBucket(planet, key, MED_BUCKETS, medBucket)) continue;
    stats.medPlanets++;
    const compact = planet.compactState;
    if (!compact) continue; // 惰性容器守卫：未触达行星零写入

    // —— 活跃局势步进（dtMonthFraction = (tick - lastStepTick)/720，随后对齐本 tick）——
    const list = byTarget.get(planet.id) || byTarget.get(String(planet.id));
    if (list && list.length > 0) {
      for (let i = 0; i < list.length; i++) {
        const sit = list[i];
        const last = Number.isFinite(sit.lastStepTick) ? sit.lastStepTick : tick;
        const dt = Math.max(0, (tick - last) / TICKS_PER_MONTH);
        sit.lastStepTick = tick; // 首遇即对齐节奏（dt=0），杜绝注入钩子后的追涨突刺
        if (typeof hooks.stepSituation === 'function' && dt > 0) {
          hooks.stepSituation(world, sit, dt);
          stats.situationsStepped++;
        }
      }
    }

    // —— 8 维资源结算：stockpile[i] += netFlow[i] × dtMonth（clamp ≥ 0）——
    const colony = compact.colony;
    if (colony && Array.isArray(colony.stockpile) && Array.isArray(colony.netFlow)) {
      const n = Math.min(colony.stockpile.length, colony.netFlow.length);
      for (let i = 0; i < n; i++) {
        const v = colony.stockpile[i] + colony.netFlow[i] * dtMonth;
        colony.stockpile[i] = v > 0 ? v : 0;
      }
    }
  }
}

/** Medium 桶：自主舰队航线推进（无 autonomousFleets 时跳过，M3 填充） */
function stepMediumFleets(world, soState, medBucket, stats) {
  const fleets = world.entities.fleets;
  const hasAutonomous = Array.isArray(soState.autonomousFleets) && soState.autonomousFleets.length > 0;
  for (const key of sortedEntityKeys(fleets)) {
    const fleet = fleets[key];
    if (!fleet || typeof fleet !== 'object') continue;
    if (!inBucket(fleet, key, MED_BUCKETS, medBucket)) continue;
    stats.medFleets++;
    if (hasAutonomous && typeof hooks.fleetTick === 'function') {
      hooks.fleetTick(world, fleet); // M3：自主生态舰队跨星系航线推进
    }
  }
}

/* ============================== Slow Tick（30 桶） ============================== */

/** 五纪元自动晋升（0→1 已勘探 SURVEYED；1→2 colony.ownerId≥0）并落历史环 */
function promoteEpoch(compact, nextStage, eventCode, tick) {
  compact.epochStage = nextStage;
  appendHistory(
    compact,
    tick,
    eventCode,
    compact.colony ? compact.colony.ownerId : -1,
    0,
  );
}

/** Slow 桶：envVector 漂移 + 稀疏前沿 CA 演化 + 五纪元晋升 + 深层坍塌月度抽检 */
function stepSlowPlanets(world, tick, slowBucket, monthWindowCrossed, stats) {
  const planets = world.entities.planets;
  for (const key of sortedEntityKeys(planets)) {
    const planet = planets[key];
    if (!planet || typeof planet !== 'object') continue;
    if (!inBucket(planet, key, SLOW_BUCKETS, slowBucket)) continue;
    stats.slowPlanets++;
    const compact = planet.compactState;
    if (!compact) continue;

    // —— 8 维环境相空间向基线漂移（envVector[i] += (baseline_i − envVector[i]) × 0.02 × dtMonth）——
    const base = compact.envBaseline;
    if (Array.isArray(base) && base.length === compact.envVector.length) {
      for (let i = 0; i < compact.envVector.length; i++) {
        const v = compact.envVector[i] + (base[i] - compact.envVector[i]) * DRIFT_RATE_PER_MONTH * SLOW_STEP_MONTHS;
        compact.envVector[i] = v < 0 ? 0 : v > 100 ? 100 : v;
      }
    }

    // —— 稀疏前沿 CA 演化（42 号总纲 §六.3「慢速时钟…8 维环境向量漂移与稀疏前沿
    //    CA 演化（平均 24 个活跃格）」/ §四.1 地表覆盖物经元胞自动机局部相变）：
    //    首次触达（frontierMask 全零）以 seedFrontierRing 播种 24 个确定性边界位
    //    （幂等：仅置掩码位，不改 Tile；已播种/已演化世界 frontierCount > 0 跳过），
    //    随后逐星 stepSparseFrontierCA 步进四类相变规则（菌毯/熔岩/冰盖/晶格）。
    //    stepSparseFrontierCA 内部自守卫 compact 结构完整性（mask/tiles/envVector
    //    形态非法 → 零写入零漂移）；dtMonth 传 SLOW_STEP_MONTHS（离散 CA 步契约占位）。 ——
    if (Array.isArray(compact.frontierMask) && compact.frontierMask.length === 8
      && frontierCount(compact.frontierMask) === 0) {
      seedFrontierRing(planet);
    }
    stepSparseFrontierCA(world, planet, SLOW_STEP_MONTHS);

    // —— 五纪元晋升检定（2→3 由局势弧触发 / 3→4 由遗产事件触发，此处不代行）——
    if (compact.epochStage === 0 && hasSurveyedTile(compact)) {
      promoteEpoch(compact, 1, HISTORY_EVENT_CODES.EPOCH_SURVEYED, tick);
    }
    if (
      compact.epochStage === 1
      && compact.colony && Number.isFinite(compact.colony.ownerId) && compact.colony.ownerId >= 0
    ) {
      promoteEpoch(compact, 2, HISTORY_EVENT_CODES.EPOCH_COLONY_ESTABLISHED, tick);
    }

    // —— 深层坍塌月度抽检：本桶 30-tick 访问窗 (tick-30, tick] 覆盖月界（tick%720===0）时触发，
    //    保证每颗行星每月恰逢一次检定（720%30===0，逐桶错峰落在本月首个 Slow 访问帧）——
    if (monthWindowCrossed) {
      checkSubterraneanCollapse(planet, world);
    }

    // —— M2 原型专属机制钩子（archetypeMechanics 经 setClockHooks 注入；未注入零动作）——
    //    首行守卫在钩子实现内（stepArchetypeMechanics 守卫 world.spaceOperaState），
    //    仅对已挂载 compactState 的行星触达（走本函数的 compact 守卫）。
    if (typeof hooks.slowPlanetHook === 'function') {
      hooks.slowPlanetHook(world, planet, SLOW_STEP_DAYS);
    }
  }
}

/* ============================== 阶段入口（TickPipeline 注册形态） ============================== */

/**
 * 太空歌剧每小时阶段（registerHourly('space-opera', stepSpaceOperaTick)）。
 * 首行守卫：world.spaceOperaState 缺失（默认流程/金快照世界）→ 全零统计零写入。
 *
 * @returns {{medPlanets: number, medFleets: number, slowPlanets: number, slowLeaders: number, situationsStepped: number}}
 *   本帧桶统计（CHK-M1-04 断言 300 星/120 舰队/90 领袖满载下精确 30/12/10/3）。
 */
export function stepSpaceOperaTick(world) {
  if (!world || !world.spaceOperaState) {
    return zeroStats();
  }
  const soState = world.spaceOperaState;
  const stats = zeroStats();
  const tick = Number.isFinite(world.tick) ? Math.max(0, Math.trunc(world.tick)) : 0;

  // —— Medium Tick（10 桶轮询）——
  const medBucket = tick % MED_BUCKETS;
  stepMediumPlanets(world, tick, soState, medBucket, stats);
  stepMediumFleets(world, soState, medBucket, stats);

  // —— Slow Tick（30 桶轮询）——
  const slowBucket = tick % SLOW_BUCKETS;
  // 月界窗判定：30-tick 访问窗 (tick-30, tick] 内含月界（720 的倍数）⇔ 前后两个整月编号不同。
  // 每颗行星的 Slow 桶每 30 tick 访问一次，该判定保证「每行星每月恰一次」坍塌抽检，
  // 且在 tick%720===0 的桶 0 帧与字面口径完全一致。
  const monthWindowCrossed = tick > 0
    && Math.floor(tick / TICKS_PER_MONTH) !== Math.floor((tick - SLOW_BUCKETS) / TICKS_PER_MONTH);
  stepSlowPlanets(world, tick, slowBucket, monthWindowCrossed, stats);

  // —— 领袖桶（30 桶轮询；M1 只计数，M3 注入 leaderTick 忠诚检定）——
  const characters = world.entities.characters;
  for (const key of sortedEntityKeys(characters)) {
    const ch = characters[key];
    if (!ch || typeof ch !== 'object') continue;
    if (!inBucket(ch, key, SLOW_BUCKETS, slowBucket)) continue;
    stats.slowLeaders++;
    if (typeof hooks.leaderTick === 'function') hooks.leaderTick(world, ch);
  }

  return stats;
}

/**
 * 太空歌剧月末收口（registerMonthly('space-opera-monthly', stepSpaceOperaMonthly)）。
 * 月首 tick%720===0 时触发经 setClockHooks 注入的 monthlyHooks（S2 工业扰动推进 /
 * S4 短缺监视；M1 集成阶段注入实现）。容器缺失（金快照世界）→ 首行守卫零动作。
 *
 * @returns {{monthlyHooksFired: number}} 实际触发的月度钩子数
 */
export function stepSpaceOperaMonthly(world) {
  if (!world || !world.spaceOperaState) return { monthlyHooksFired: 0 };
  const tick = world.tick;
  if (!Number.isFinite(tick) || tick <= 0 || tick % TICKS_PER_MONTH !== 0) {
    return { monthlyHooksFired: 0 };
  }
  let fired = 0;
  for (let i = 0; i < hooks.monthlyHooks.length; i++) {
    const fn = hooks.monthlyHooks[i];
    if (typeof fn === 'function') {
      fn(world);
      fired++;
    }
  }
  return { monthlyHooksFired: fired };
}

// —— 三级时钟分片阶段注册已移交 src/simulation/SpaceOperaWiring.js（静态显式接线）——
//    原因：动态 import('./jacobianCoupling.js') 编排在静态打包产物（build-static-bundle
//    IIFE）中相对说明符不可达（404 → .catch 静默降级 → 雅可比月度收口在打包环境永不注册）。
//    Wiring 以显式顺序注册：'space-opera'（hourly，恒在各既有阶段之后）→
//    'space-opera-monthly' → 'space-opera-jacobian' → 'space-opera-drama'（monthlyCloses
//    按注册序执行：弧级月度钩子先写 pendingSystemShocks，雅可比收口再消费，戏剧导演最后）。
//    本模块保持零阶段注册（纯步骤导出 + setClockHooks 钩子槽），import 期零副作用。
