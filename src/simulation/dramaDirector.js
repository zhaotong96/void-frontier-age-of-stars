/**
 * simulation/dramaDirector.js — 自适应太空歌剧戏剧导演（Adaptive Space Opera Drama Director）
 * （SPEC-PLAN-046 阶段三 M3 Task 3.5；责任人：Eng-C，M3 集成落位 simulation/ 层）
 *
 * 职责（doc46 §Task 3.5 + doc42 总纲 §五.4 逐条契约）：
 *  1. 双核心状态变量（权威容器 world.spaceOperaState.dramaDirector，六键冻结契约见
 *     worldMigration.js / CHK-00-04）：宏观戏剧张力 T ∈ [0,100]、创伤适应系数 A ∈ [0.75,1.35]
 *     （由 adaptDays ∈ [-50,100] 驱动）。
 *  2. adaptDays 日演进（registerDaily 'space-opera-drama-adapt'，函数体首行守卫
 *     world.spaceOperaState）：adaptDays<0 → +3.0/天；0..60 → +1.0/天；>60 → +0.5/天；
 *     封顶 100.0、下限 −50.0；步进后 adaptationFactor = clamp(1+0.0035×adaptDays, 0.75, 1.35)，
 *     恢复宽限期（recoveryGraceUntilTick ≥ tick）期间 A 锁 0.75。
 *  3. 伤亡折算：reportDowned(world,n) → adaptDays −4.0×n；reportKilled(world,n) →
 *     adaptDays −20.0×n（1 Killed = 5 Downed 精确折算比）；扣减后同步重算 A。
 *  4. 戏剧预算：W_base = min(10000, 0.5×popAndFleetScore + 0.5×industrialWealthScore)，
 *     W_effective = min(10000, W_base×G(c)×A)；G(c)：c=floor(tick/720)（0 基月周期序），
 *     c≤10 → 0.70；10<c<40 → 0.70+0.30×(c−10)/30；c≥40 → 1.00。
 *  5. 张力 T 月度推进（月末收口；注册序恒在 'space-opera-jacobian' 之后，见文件尾接线裁决）：
 *     T += 1.0 × (0.4×mean(|S_i−eq_i|) + 2×活跃危机局势数 + 近 30 天战役烈度) × A，clamp [0,100]。
 *  6. 高潮宣泄：T ≥ 75 且无活跃 GRAND_CLIMAX → spawnSituation('GRAND_CLIMAX'，meta 记录
 *     tensionTop2 弧线 + W_effective)；局势收束（climax 或 defused）→ resolveGrandClimax：
 *     T 强制 25.0、A 强制 0.75、adaptDays=−50.0、recoveryGraceUntilTick=tick+2160、
 *     climaxCount+1、injectOpportunityBeacons(world,18)（OPPORTUNITY_BEACON 精确 18 个）。
 *
 * A=0.75 与公式 0.825 的裁决（doc46 §Task 3.5 §2/§4 内部张力）：
 *  climax 复位时 adaptDays=−50.0，按公式 1+0.0035×(−50)=0.825 ≠ 0.75。裁决：reset 显式置
 *  A=0.75 并在 2160 tick 宽限期内锁定 0.75（黄金喘息重建期语义，doc42 §五.4「将适应因子下调
 *  至 0.75 的创伤恢复期」为权威）；宽限期过后恢复公式推导（adaptDays=−50 → 0.825，随后每日
 *  +3 天数爬升）。CHK-M3-06 两段断言分别覆盖「结算瞬间 A===0.75」与「宽限期满公式恢复 0.825」。
 *
 * 月度收口接线裁决（doc46 §Task 3.5(d)「在雅可比步进之后」）：
 *  月度阶段注册统一收敛到 src/simulation/SpaceOperaWiring.js 的同步显式接线
 *  （monthly → jacobian → drama 按注册序执行）。原「动态 import('./jacobianCoupling.js')
 *  .then(...) 链式注册」方案在静态打包产物（build-static-bundle IIFE）中相对说明符
 *  不可达（404 → catch 降级 → 收口永不注册），且存在同步 import 后立即跨月推演的
 *  时序洞，已废除。
 */

import { registerDaily, registerMonthly } from './TickPipeline.js';
import {
  registerSituationArc,
  spawnSituation,
  listActiveSituations,
} from '../domain/events/situationEngine.js';
import { injectOpportunityBeacons } from '../domain/world/subspaceBeaconStream.js';
import { ensureSpaceOperaState } from '../domain/world/worldMigration.js';
import { emit, chronicle } from '../core/eventBus.js';
import { TICKS_PER_DAY, TICKS_PER_MONTH } from '../core/clock.js';

/* ============================== 冻结常量（doc46 §Task 3.5 精确值） ============================== */

/**
 * 七大系统平衡点向量 S_eq（与 jacobianCoupling.SYSTEM_EQUILIBRIUM 同源常量的本地复制；
 * 刻意不静态 import 该模块 —— 见文件头「月度收口接线裁决」。M3 套件 CHK-M3-06 逐位互证）。
 */
export const EQUILIBRIUM_S = Object.freeze([15.0, 15.0, 20.0, 15.0, 15.0, 10.0, 10.0]);

/** 张力阈值与宣泄落点（doc46 精确值） */
export const CLIMAX_TENSION_THRESHOLD = 75.0;
export const CATHARSIS_TENSION = 25.0;
export const CATHARSIS_ADAPTATION = 0.75;
export const CATHARSIS_ADAPT_DAYS = -50.0;
export const RECOVERY_GRACE_TICKS = 2160; // 90 游戏日黄金喘息重建期
export const CATHARSIS_OPPORTUNITY_BEACONS = 18;

/** adaptDays 三段日增速与值域（doc46 精确值） */
export const ADAPT_RECOVER_PER_DAY = 3.0; // adaptDays < 0
export const ADAPT_GROW_PER_DAY = 1.0; // 0 ≤ adaptDays ≤ 60
export const ADAPT_SLOW_PER_DAY = 0.5; // adaptDays > 60
export const ADAPT_SLOW_THRESHOLD = 60.0;
export const ADAPT_DAYS_MIN = -50.0;
export const ADAPT_DAYS_MAX = 100.0;

/** 适应系数映射（A = clamp(1 + 0.0035×adaptDays, 0.75, 1.35)） */
export const ADAPT_SLOPE = 0.0035;
export const ADAPT_FACTOR_MIN = 0.75;
export const ADAPT_FACTOR_MAX = 1.35;

/** 伤亡折算（doc46 精确值：1 Killed = 5 Downed） */
export const DOWNED_ADAPT_COST = 4.0;
export const KILLED_ADAPT_COST = 20.0;

/** 早期宽限斜坡 G(c)（doc46 精确式） */
export const GRACE_RAMP_START_CYCLE = 10;
export const GRACE_RAMP_END_CYCLE = 40;
export const GRACE_RAMP_BASE = 0.70;

/** 预算双因子权重与硬上限（doc46 精确值 50/50 与 10000） */
export const BUDGET_POP_WEIGHT = 0.5;
export const BUDGET_WEALTH_WEIGHT = 0.5;
export const BUDGET_CAP = 10000;

/** 评分口径常数（doc46 给结构不给常数 → M3 落地裁决，写入 notes） */
export const POP_SCORE_PER_POP = 10;
export const FLEET_SCORE_PER_SHIP = 40;
export const BUILDING_SCORE_PER_TILE = 15;
export const STOCKPILE_SCORE_DIVISOR = 10;

/** 张力月度推进系数（doc46 精确值 0.4 / 2；dt=1.0 月/收口） */
export const TENSION_MEAN_DEV_COEF = 0.4;
export const TENSION_PER_CRISIS = 2.0;
export const TENSION_DT_PER_CLOSE = 1.0;
export const TENSION_MIN = 0.0;
export const TENSION_MAX = 100.0;

/** 战役烈度统计窗口：30 游戏日 = 720 tick */
export const BATTLE_INTENSITY_WINDOW_TICKS = 30 * TICKS_PER_DAY;

/** 庆典/机遇弧（不计入「活跃危机局势数」） */
const CELEBRATION_ARCS = Object.freeze({ GRAND_CLIMAX: true, LEVIATHAN_PARADE: true });

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const round4 = (v) => Number(v.toFixed(4));

function tickOf(world) {
  return Number.isFinite(world && world.tick) ? Math.max(0, Math.trunc(world.tick)) : 0;
}

/** 戏剧导演状态只读守卫（容器/子容器缺失 → null；绝不 ensure、绝不重建） */
function dramaStateOf(world) {
  const so = world && world.spaceOperaState;
  const dd = so && so.dramaDirector;
  return dd && typeof dd === 'object' ? dd : null;
}

/* ============================== Task 3.5 §2 adaptDays 演进与伤亡折算 ============================== */

/** 恢复宽限期判定（recoveryGraceUntilTick ≥ tick 视为在期内；边界含） */
export function inRecoveryGrace(world, dd = null) {
  const state = dd || dramaStateOf(world);
  if (!state) return false;
  const until = Number.isFinite(state.recoveryGraceUntilTick) ? state.recoveryGraceUntilTick : -1;
  return until >= tickOf(world);
}

/**
 * 创伤适应系数推导（纯函数）：宽限期内锁定 0.75（裁决见文件头），
 * 期外 A = clamp(1 + 0.0035×adaptDays, 0.75, 1.35)。
 */
export function deriveAdaptationFactor(adaptDays, graceLocked) {
  if (graceLocked === true) return CATHARSIS_ADAPTATION;
  const d = Number.isFinite(adaptDays) ? adaptDays : 0;
  return clamp(1 + ADAPT_SLOPE * d, ADAPT_FACTOR_MIN, ADAPT_FACTOR_MAX);
}

/**
 * adaptDays 日演进（registerDaily 'space-opera-drama-adapt' 注册形态）。
 * 三段增速：<0 → +3.0；0..60 → +1.0；>60 → +0.5；clamp [−50, 100]。
 * 步进后重算 adaptationFactor（宽限期锁 0.75）。
 * 首行守卫 world.spaceOperaState（金快照世界零读取零写入）。
 *
 * @returns {object|null} {adaptDays, adaptationFactor, graceLocked}（容器缺失返回 null）
 */
export function stepDramaAdaptationDaily(world) {
  const dd = dramaStateOf(world);
  if (!dd) return null;
  const cur = Number.isFinite(dd.adaptDays) ? dd.adaptDays : 0;
  const rate = cur < 0 ? ADAPT_RECOVER_PER_DAY : (cur <= ADAPT_SLOW_THRESHOLD ? ADAPT_GROW_PER_DAY : ADAPT_SLOW_PER_DAY);
  const next = clamp(cur + rate, ADAPT_DAYS_MIN, ADAPT_DAYS_MAX);
  dd.adaptDays = next;
  const grace = inRecoveryGrace(world, dd);
  dd.adaptationFactor = deriveAdaptationFactor(next, grace);
  return { adaptDays: next, adaptationFactor: dd.adaptationFactor, graceLocked: grace };
}

/** 伤亡折算内核（Downed −4.0/单位；Killed −20.0/单位；下限 −50；同步重算 A） */
function reportTrauma(world, count, perUnitCost, kind) {
  const dd = dramaStateOf(world);
  if (!dd) return null;
  const n = Math.max(0, Math.trunc(Number.isFinite(count) ? count : 0));
  if (n <= 0) return null; // 零伤亡零写入
  const before = Number.isFinite(dd.adaptDays) ? dd.adaptDays : 0;
  const next = Math.max(ADAPT_DAYS_MIN, before - perUnitCost * n);
  dd.adaptDays = next;
  dd.adaptationFactor = deriveAdaptationFactor(next, inRecoveryGrace(world, dd));
  emit(world, 'DramaTraumaReported', {
    kind,
    count: n,
    adaptCostPerUnit: perUnitCost,
    deducted: perUnitCost * n,
    adaptDays: next,
    adaptationFactor: dd.adaptationFactor,
  }, 'world');
  return { kind, count: n, deducted: perUnitCost * n, adaptDays: next, adaptationFactor: dd.adaptationFactor };
}

/**
 * 上报瘫痪/重伤单位（Storyteller Trauma Reduction）：每单位 adaptDays −4.0。
 * 守卫式读取（容器缺失返回 null）；n ≤ 0 零写入。
 */
export function reportDowned(world, n) {
  return reportTrauma(world, n, DOWNED_ADAPT_COST, 'downed');
}

/**
 * 上报阵亡/沦陷/主力舰击毁：每单位 adaptDays −20.0（1 Killed = 5 Downed 精确折算比）。
 */
export function reportKilled(world, n) {
  return reportTrauma(world, n, KILLED_ADAPT_COST, 'killed');
}

// —— import 副作用：adaptDays 日演进阶段注册（函数体首行守卫 world.spaceOperaState）——
registerDaily('space-opera-drama-adapt', (world) => {
  stepDramaAdaptationDaily(world);
});

/* ============================== Task 3.5 §3 宽限斜坡与戏剧预算 ============================== */

/**
 * 早期宽限斜坡 G(c)（纯函数）：c = floor(tick/720)（0 基月周期序）。
 * c ≤ 10 → 0.70；10 < c < 40 → 0.70 + 0.30×(c−10)/30；c ≥ 40 → 1.00。
 */
export function graceSlopeG(c) {
  const cycle = Number.isFinite(c) ? c : 0;
  if (cycle <= GRACE_RAMP_START_CYCLE) return GRACE_RAMP_BASE;
  if (cycle >= GRACE_RAMP_END_CYCLE) return 1.00;
  return GRACE_RAMP_BASE + 0.30 * ((cycle - GRACE_RAMP_START_CYCLE) / (GRACE_RAMP_END_CYCLE - GRACE_RAMP_START_CYCLE));
}

/**
 * 基础帝国规模预算（纯读，零写入；评分口径见文件头 notes 裁决）：
 *  popAndFleetScore       = Σ(compact.colony.popTotal)×10 + Σ(world.entities.fleets 舰船数)×40
 *                           （dissolved 舰队不计；仅统计已挂 compactState 的行星，绝不 ensure）
 *  industrialWealthScore  = Σ(compact tiles buildingId≠0 格数)×15 + Σ(stockpile 总值)/10
 *  W_base                 = min(10000, 0.5×popAndFleetScore + 0.5×industrialWealthScore)
 *  W_effective            = min(10000, W_base × G(c) × A)
 *
 * @returns {object|null} 预算档案（容器缺失返回 null）
 */
export function computeDramaBudget(world) {
  if (!world || !world.spaceOperaState) return null;
  const dd = dramaStateOf(world);
  const tick = tickOf(world);
  const cycle = Math.floor(tick / TICKS_PER_MONTH);
  const g = graceSlopeG(cycle);
  const grace = inRecoveryGrace(world, dd);
  const adaptDays = dd && Number.isFinite(dd.adaptDays) ? dd.adaptDays : 0;
  const a = deriveAdaptationFactor(adaptDays, grace);

  const planets = world.entities && world.entities.planets ? world.entities.planets : {};
  let popTotal = 0;
  let buildingTiles = 0;
  let stockpileValue = 0;
  for (const key of Object.keys(planets).sort()) {
    const planet = planets[key];
    const compact = planet && planet.compactState;
    const colony = compact && compact.colony;
    if (colony && Number.isFinite(colony.popTotal) && colony.popTotal > 0) {
      popTotal += colony.popTotal;
    }
    if (compact && Array.isArray(compact.tiles)) {
      for (let i = 0; i < compact.tiles.length; i++) {
        if (((compact.tiles[i] >>> 16) & 0x3f) !== 0) buildingTiles += 1;
      }
    }
    if (colony && Array.isArray(colony.stockpile)) {
      for (let i = 0; i < colony.stockpile.length; i++) {
        const v = Number(colony.stockpile[i]);
        if (Number.isFinite(v) && v > 0) stockpileValue += v;
      }
    }
  }
  const fleets = world.entities && world.entities.fleets ? world.entities.fleets : {};
  let shipCount = 0;
  for (const key of Object.keys(fleets).sort()) {
    const fleet = fleets[key];
    if (!fleet || fleet.status === 'dissolved') continue;
    if (Array.isArray(fleet.shipIds)) shipCount += fleet.shipIds.length;
  }

  const popAndFleetScore = popTotal * POP_SCORE_PER_POP + shipCount * FLEET_SCORE_PER_SHIP;
  const industrialWealthScore = buildingTiles * BUILDING_SCORE_PER_TILE + stockpileValue / STOCKPILE_SCORE_DIVISOR;
  const wBase = Math.min(BUDGET_CAP, BUDGET_POP_WEIGHT * popAndFleetScore + BUDGET_WEALTH_WEIGHT * industrialWealthScore);
  const wEffective = Math.min(BUDGET_CAP, wBase * g * a);
  return {
    cycle,
    g,
    a,
    graceLocked: grace,
    adaptDays,
    popTotal,
    shipCount,
    buildingTiles,
    stockpileValue,
    popAndFleetScore,
    industrialWealthScore,
    wBase,
    wEffective,
  };
}

/* ============================== 战役烈度与危机计数（纯读） ============================== */

/** 近 30 天战役烈度：Σ(1 + 双方战损舰数)（endedTick ∈ [tick−720, tick] 的战报） */
function battleIntensityLast30Days(world, tick) {
  const battles = world && world.battles;
  const history = battles && Array.isArray(battles.history) ? battles.history : [];
  const cutoff = tick - BATTLE_INTENSITY_WINDOW_TICKS;
  let intensity = 0;
  for (let i = 0; i < history.length; i++) {
    const report = history[i];
    if (!report || typeof report !== 'object') continue;
    const ended = Number.isFinite(report.endedTick) ? report.endedTick : 0;
    if (ended < cutoff) continue;
    const losses = report.losses && typeof report.losses === 'object' ? report.losses : {};
    const a = Number(losses.a);
    const b = Number(losses.b);
    intensity += 1 + (Number.isFinite(a) && a > 0 ? a : 0) + (Number.isFinite(b) && b > 0 ? b : 0);
  }
  return intensity;
}

/** 活跃危机局势数：除庆典/机遇弧（GRAND_CLIMAX / LEVIATHAN_PARADE）外的活跃局势总数 */
function activeCrisisCount(world) {
  return listActiveSituations(world).filter((s) => s && CELEBRATION_ARCS[s.systemArcId] !== true).length;
}

/* ============================== Task 3.5 §4 高潮宣泄（Climax Catharsis） ============================== */

/**
 * 史诗高潮宣泄结算（GRAND_CLIMAX 弧 climax 钩子与显式结算入口）：
 *  1. T 强制回落 25.0；2. A 强制重置 0.75（adaptDays = −50.0）；3. 开启 2160 tick
 *  黄金喘息重建期（recoveryGraceUntilTick = tick + 2160）；4. climaxCount +1、
 *  lastClimaxTick 记账；5. injectOpportunityBeacons(world, 18) 注入 18 个机遇信标。
 *  幂等：同一局势 meta.catharsisApplied 已置位 → 零重复结算。
 * 首行守卫 world.spaceOperaState。
 *
 * @param {object} world - 世界根对象
 * @param {object|null} situation - GRAND_CLIMAX 局势实例（可为 null 直接结算）
 * @param {string} [outcome] - 'climax' | 'defused'（平定或度过皆触发宣泄）
 * @returns {object|null} 宣泄结算档案（容器缺失/重复结算返回 null）
 */
export function resolveGrandClimax(world, situation, outcome = 'climax') {
  if (!world || !world.spaceOperaState) return null;
  const dd = dramaStateOf(world);
  if (!dd) return null;
  const sit = situation && typeof situation === 'object' ? situation : null;
  if (sit && sit.meta && sit.meta.catharsisApplied === true) return null; // 幂等防重入
  const tick = tickOf(world);

  if (sit) {
    if (!sit.meta || typeof sit.meta !== 'object') sit.meta = {};
    sit.meta.catharsisApplied = true;
    sit.meta.catharsisOutcome = outcome === 'defused' ? 'defused' : 'climax';
  }
  dd.tension = CATHARSIS_TENSION;
  dd.adaptDays = CATHARSIS_ADAPT_DAYS;
  dd.adaptationFactor = CATHARSIS_ADAPTATION;
  dd.recoveryGraceUntilTick = tick + RECOVERY_GRACE_TICKS;
  dd.climaxCount = (Number.isFinite(dd.climaxCount) ? dd.climaxCount : 0) + 1;
  dd.lastClimaxTick = tick;

  const injected = injectOpportunityBeacons(world, CATHARSIS_OPPORTUNITY_BEACONS);
  emit(world, 'GrandClimaxResolved', {
    situationId: sit ? sit.id : null,
    outcome: sit && sit.meta ? sit.meta.catharsisOutcome : outcome,
    tension: dd.tension,
    adaptationFactor: dd.adaptationFactor,
    adaptDays: dd.adaptDays,
    recoveryGraceUntilTick: dd.recoveryGraceUntilTick,
    climaxCount: dd.climaxCount,
    opportunityBeacons: injected,
  }, 'world');
  chronicle(world, 'world', '史诗高潮落幕：张力宣泄回落 25.0，帝国步入 90 日黄金喘息重建期，星区涌现 18 个战后机遇信标', {
    situationId: sit ? sit.id : null,
    climaxCount: dd.climaxCount,
  });
  return {
    tension: dd.tension,
    adaptationFactor: dd.adaptationFactor,
    adaptDays: dd.adaptDays,
    recoveryGraceUntilTick: dd.recoveryGraceUntilTick,
    climaxCount: dd.climaxCount,
    opportunityBeacons: injected,
  };
}

/** tensionTop2 弧线裁决：按 |S_i−eq_i| 降序取前二（tie 取系统下标较小者） */
function top2Arcs(deviations) {
  const ranked = deviations.map((d, i) => ({ system: i, arc: `S${i + 1}`, deviation: round4(d) }));
  ranked.sort((a, b) => (b.deviation - a.deviation) || (a.system - b.system));
  return ranked.slice(0, 2);
}

/** 生成 GRAND_CLIMAX 四幕史诗高潮局势（meta 记录 tensionTop2 弧线 + W_effective） */
function spawnGrandClimax(world, deviations, budget, tension) {
  const top2 = top2Arcs(deviations);
  const sit = spawnSituation(world, {
    arcId: 'GRAND_CLIMAX',
    targetEntityId: null,
    progress: 0,
    meta: {
      tensionAtTrigger: round4(tension),
      tensionTop2: top2,
      wEffective: round4(budget.wEffective),
      cycle: budget.cycle,
      adaptationFactor: budget.a,
    },
  });
  emit(world, 'GrandClimaxTriggered', {
    situationId: sit.id,
    tension: round4(tension),
    tensionTop2: top2,
    wEffective: round4(budget.wEffective),
    cycle: budget.cycle,
  }, 'world');
  chronicle(world, 'world', `戏剧导演：宏观张力突破 ${CLIMAX_TENSION_THRESHOLD.toFixed(1)}，最尖锐的两条系统弧线（${top2.map((t) => t.arc).join(' / ')}）合并升格为四幕史诗高潮大事件`, {
    situationId: sit.id,
  });
  return sit;
}

/**
 * 戏剧导演月末收口（registerMonthly 'space-opera-drama' 注册形态；注册序恒在
 * 'space-opera-jacobian' 之后 —— 张力推进消费雅可比步进后的 S 快照，接线裁决见文件头）：
 *  1. A 刷新（宽限期锁 0.75 / 期外公式）；
 *  2. T += 1.0 × (0.4×mean(|S_i−eq_i|) + 2×活跃危机局势数 + 近 30 天战役烈度) × A，clamp [0,100]；
 *  3. T ≥ 75 且无活跃 GRAND_CLIMAX → spawnSituation('GRAND_CLIMAX')。
 *
 * @returns {object|null} {tension, gained, adaptationFactor, wEffective, spawnedClimax, climaxId}
 */
export function stepSpaceOperaDramaMonthly(world) {
  const dd = dramaStateOf(world);
  if (!dd) return null;
  const so = world.spaceOperaState;
  if (!Array.isArray(so.systemVector) || so.systemVector.length !== 7) return null; // 防御手造容器（与 jacobian 同口径）
  const tick = tickOf(world);

  const budget = computeDramaBudget(world);
  dd.adaptationFactor = budget.a;

  const deviations = so.systemVector.map((v, i) => Math.abs((Number.isFinite(v) ? v : 0) - EQUILIBRIUM_S[i]));
  const meanDev = deviations.reduce((s, v) => s + v, 0) / deviations.length;
  const crisisCount = activeCrisisCount(world);
  const intensity = battleIntensityLast30Days(world, tick);
  const gain = TENSION_DT_PER_CLOSE
    * (TENSION_MEAN_DEV_COEF * meanDev + TENSION_PER_CRISIS * crisisCount + intensity)
    * budget.a;
  const prev = Number.isFinite(dd.tension) ? dd.tension : TENSION_MIN;
  const next = clamp(prev + gain, TENSION_MIN, TENSION_MAX);
  dd.tension = next;

  let spawned = null;
  const hasActiveClimax = listActiveSituations(world).some((s) => s && s.systemArcId === 'GRAND_CLIMAX');
  if (next >= CLIMAX_TENSION_THRESHOLD && !hasActiveClimax) {
    spawned = spawnGrandClimax(world, deviations, budget, next);
  }
  return {
    tension: next,
    gained: gain,
    adaptationFactor: budget.a,
    wEffective: budget.wEffective,
    spawnedClimax: !!spawned,
    climaxId: spawned ? spawned.id : null,
  };
}

/* ============================== GRAND_CLIMAX 弧定义（import 期注册） ============================== */

/**
 * 四幕史诗高潮大事件弧（doc46 §Task 3.5 §4）：
 *  - 未干预时 baseMonthlyDelta +25/月（四幕每幕一个月，四个月自然演满 → climax）；
 *  - 玩家平定（defused）或度过（climax）皆触发 resolveGrandClimax 宣泄结算；
 *  - 同一时刻至多一场活跃（月度收口 spawn 前置检定）。
 */
registerSituationArc('GRAND_CLIMAX', {
  progressMax: 100,
  baseMonthlyDelta: 25,
  actBounds: [
    [0, 25],
    [25, 50],
    [50, 75],
    [75, 100],
  ],
  approaches: {},
  climax(world, situation, outcome) {
    resolveGrandClimax(world, situation, outcome);
  },
});

/* ============================== 月末收口接线（静态显式注册） ============================== */

let dramaMonthlyRegistered = false;

/**
 * 幂等注册戏剧导演月度收口（由 SpaceOperaWiring 在 'space-opera-jacobian' 之后显式调用）。
 * 原动态 import('./jacobianCoupling.js').then(...) 链式注册在静态打包产物（build-static-bundle
 * IIFE）中相对说明符不可达（404），且异步注册存在「同步 import 后立即跨月推演」的时序洞——
 * 统一改为 SpaceOperaWiring 的同步显式接线，注册序恒为 monthly → jacobian → drama。
 */
export function registerDramaMonthlyClose() {
  if (dramaMonthlyRegistered) return;
  dramaMonthlyRegistered = true;
  registerMonthly('space-opera-drama', stepSpaceOperaDramaMonthly);
}

/**
 * 幂等预等待月度收口注册完成（返回完成的 Promise；保留套件兼容签名）。
 * 注册已改为 SpaceOperaWiring 的同步显式接线，本函数现为同步注册 + 立即 resolve。
 */
export function ensureDramaMonthlyRegistered() {
  registerDramaMonthlyClose();
  return Promise.resolve();
}
