/**
 * domain/events/situationEngine.js — 通用四幕局势状态机引擎
 * （SPEC-PLAN-044 阶段一 M1 Task 1.3；责任人：Eng-B）
 *
 * 职责（doc44 §Task 1.3 逐条契约）：
 *  1. 活跃局势实例标准结构 {id, systemArcId, targetEntityId, progress, progressMax,
 *     actStage(1-4), currentApproach, approachCooldownUntilTick, monthlyDelta,
 *     lastStepTick, createdTick, resolvedTick|null, meta{}}，存
 *     world.spaceOperaState.situations（key = String(id)）；
 *  2. 统一生命周期钩子 spawnSituation / stepSituationBucket / switchSituationApproach /
 *     resolveSituationClimax，弧定义经 registerSituationArc 注册（弧模块 import 期自注册）；
 *  3. 策略切换冷却 720 tick（1 真实月；44 号文档「30 帧」按 CONV 时间语义折算，见 notes）；
 *  4. 事件发射：SituationSpawned / SituationApproachSwitched / SituationResolved
 *     （eventBus.emit；中文条目见 src/content/eventNames.js）。
 *
 * 四幕进度区间裁决（doc42 总纲为最高权威）：S1 = [0,250]/[251,650]/[651,900]/[901,1000]；
 * 44 号文档的 251-500/501-750/751-1000 与总纲冲突，弃用。各弧经 def.actBounds 自带幕界表。
 *
 * 纪律（doc43 §1.4 零漂移铁律）：
 *  - 全程零 Math.random / Date.now：确定性采样由各弧经 deterministicRng 完成；
 *  - 本模块不改 TickPipeline、不挂任何小时/月度阶段 —— 时钟接线（stepSituation 与
 *    各弧月度钩子）经动态 import SpaceOperaClock 的 setClockHooks 注入（避免模块环，
 *    doc44 Task 1.2(c)）；容器缺失（默认流程/金快照世界）时全部钩子在时钟侧首行守卫零动作；
 *  - getSituation/listActiveSituations 只读：不 ensure、不挂容器；
 *    spawn/switch/resolve 才经 ensureSpaceOperaState 惰性挂载。
 */

// SPEC-PLAN-049 模块图裁决：改 import 零依赖叶子 ./world/spaceOperaState.js（环断裂）。
// 原 import worldMigration 会使本模块求值期间恒挂起于 worldMigration 链首位；M4 工位 A
// 为 activateSpaceOperaCampaign 新增的静态依赖链（archetypeMechanics → planetaryThreat →
// galacticSenateAndCrisisArc → 本模块顶层 registerSituationArc / galacticParagons 顶层
// registerSituationMonthlyHook）将在该挂起窗口读取本模块尚未初始化的 ARC_ENUM /
// monthlyHookFns 常量 → TDZ 爆破。叶子模块零依赖，本模块求值永不被 worldMigration 链挂起。
import { ensureSpaceOperaState } from '../world/spaceOperaState.js';
import { emit } from '../../core/eventBus.js';
import { TICKS_PER_MONTH } from '../../core/clock.js';

/**
 * 策略切换冷却（tick）：720 tick = 1 真实月（doc42 权威月历口径 720 tick/月；
 * 44 号文档「30 帧」按 1 tick = 1 游戏小时折算为 720 tick，见施工 notes 裁决）。
 */
export const APPROACH_COOLDOWN_TICKS = TICKS_PER_MONTH; // 720

/** 合法局势弧枚举（doc44 Task 1.3 §1 + Eng-B 扩展 PLANETARY_REVOLT / GRAND_CLIMAX） */
export const SITUATION_ARC_IDS = Object.freeze([
  'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7',
  'GRAVITY_WELL', 'LEVIATHAN_PARADE', 'PLANETARY_REVOLT', 'GRAND_CLIMAX',
]);

const ARC_ENUM = new Set(SITUATION_ARC_IDS);

/** 弧定义注册表（arcId → def；弧模块 import 期自注册） */
const ARCS = new Map();

/** 各弧贡献的月度收口钩子（S2 工业扰动推进 / S4 短缺监视等；时钟注入） */
const monthlyHookFns = [];

/* ============================== 时钟接线（静态 import setClockHooks） ==============================
 * SpaceOperaClock 不反向依赖本模块（其仅 import TickPipeline/core/planetStateSchema），静态边无环；
 * 原动态 import 编排在静态打包产物（build-static-bundle IIFE）中不可达（相对说明符 404），
 * 已统一改为静态显式接线（见 src/simulation/SpaceOperaWiring.js 裁决注释）。 */
import { setClockHooks } from '../../simulation/SpaceOperaClock.js';

let clockHooksInjected = false; // 幂等旗标（setClockHooks 按 key 覆盖，重注安全）

/** 当前完整的钩子注册包（stepSituation + 全部月度钩子；每次注入重取最新快照） */
function buildHookReg() {
  return {
    stepSituation: stepSituationBucket,
    monthlyHooks: monthlyHookFns.slice(),
  };
}

/**
 * 动态 import ../../simulation/SpaceOperaClock.js 并 setClockHooks 注入。
 * 动态解析的 .then 回调在整个同步模块图求值完成后才执行 —— 各弧 import 期经
 * registerSituationMonthlyHook 同步登记的月度钩子必然已被收入快照；
 * 此后任何迟到的钩子注册会触发一次幂等重注（setClockHooks 按 key 覆盖）。
 */
function injectClockHooks() {
  setClockHooks(buildHookReg());
  clockHooksInjected = true;
}

let injectPromise = null;

/** 廉价触媒：时钟未就绪且无 pending 注入时补一次注入（公开 API 幂等自愈） */
function touchClockInjection() {
  if (!clockHooksInjected) injectClockHooks();
}

/**
 * 幂等预注入时钟钩子（返回注入完成的 Promise）。
 * 动态 import 的解析是异步微任务：同步 import 本引擎后「立即同步跑 tick 循环」的
 * 调用方（集成层/套件）必须先 await ensureClockHooksInjected()，否则该轮同步循环
 * 内 hooks 尚未就位；常规游戏流程（启动后异步进入帧循环）无需显式调用。
 *
 * @returns {Promise<void>} 注入完成（或已注入）信号
 */
export function ensureClockHooksInjected() {
  injectClockHooks();
  return Promise.resolve();
}

// import 副作用：向 SpaceOperaClock 注册 stepSituation（四幕局势 Medium-Tick 步进）；
// 月度钩子由各弧模块 import 期经 registerSituationMonthlyHook 登记（S2/S4）。
injectClockHooks();

/**
 * 登记弧级月度收口钩子（fn(world)；月末 tick%720===0 时由 SpaceOperaClock 触发）。
 * 迟到登记会触发一次幂等时钟重注，保证钩子不丢。
 *
 * @param {(world: object) => void} fn - 月度钩子（首行须自守卫 world.spaceOperaState）
 */
export function registerSituationMonthlyHook(fn) {
  if (typeof fn !== 'function') throw new Error('SO: registerSituationMonthlyHook 需要函数');
  monthlyHookFns.push(fn);
  setClockHooks(buildHookReg());
  clockHooksInjected = true;
}

/* ============================== 弧定义注册 ============================== */

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 幕界表 → 幕次：自第四幕向第一幕按下界扫描，首个 progress ≥ bounds[i][0] 命中。
 * 兼容 doc42 整数幕界（[0,250]/[251,650]/…）与 [0,25)/[25,50)/… 百分比幕界两种口径。
 *
 * @returns {number} 1..4
 */
export function actStageForBounds(actBounds, progress) {
  const p = Number.isFinite(progress) ? progress : 0;
  for (let i = (actBounds.length - 1); i >= 0; i--) {
    if (p >= actBounds[i][0]) return i + 1;
  }
  return 1;
}

/**
 * 注册局势弧定义（弧模块 import 期自注册；重复注册视为工程缺陷，直接抛错）。
 *
 * def 契约：
 *  - progressMax: number                         进度上限（S1=1000，其余标准 100）
 *  - actBounds: [[a,b]×4]                        四幕幕界表（doc42 S1 裁决口径）
 *  - approaches: { approachId: { monthlyDelta, immediate(world,situation),
 *                 eventWeights?: {good,danger}, researchModifier? } }
 *  - baseMonthlyDelta?: number                   未选对策时的基础月增速（如 S2 +4.0/月）
 *  - onStep?(world, situation, dtMonth)          每次步进前的弧级钩子（可改写 monthlyDelta）
 *  - climax?(world, situation, outcome)          收官钩子（outcome = 'climax' | 'defused'）
 *
 * @param {string} arcId - 局势弧 ID（须 ∈ SITUATION_ARC_IDS）
 * @param {object} def - 弧定义
 */
export function registerSituationArc(arcId, def) {
  if (!ARC_ENUM.has(arcId)) {
    throw new Error(`SO: 非法局势弧 ID ${String(arcId)}（合法集 ${SITUATION_ARC_IDS.join('|')}）`);
  }
  if (ARCS.has(arcId)) throw new Error(`SO: 局势弧 ${arcId} 重复注册`);
  if (!isPlainObject(def)) throw new Error(`SO: 局势弧 ${arcId} 定义必须为对象`);
  if (!Array.isArray(def.actBounds) || def.actBounds.length !== 4) {
    throw new Error(`SO: 局势弧 ${arcId} actBounds 必须为四幕幕界表 [[a,b]×4]`);
  }
  if (def.approaches != null && !isPlainObject(def.approaches)) {
    throw new Error(`SO: 局势弧 ${arcId} approaches 必须为对象映射`);
  }
  ARCS.set(arcId, def);
}

/** 读取弧定义（未注册返回 null；供套件与集成层断言弧参数） */
export function getSituationArc(arcId) {
  return ARCS.get(arcId) || null;
}

/* ============================== 局势实例读写 ============================== */

/** 幂等读取 soState.situations（只读路径，绝不惰性挂载容器） */
function situationsBag(world) {
  const soState = world && world.spaceOperaState;
  return soState && isPlainObject(soState.situations) ? soState.situations : null;
}

/**
 * 按数值/字符串 ID 查找局势：先查活跃表，未命中再查 resolved 历史。
 *
 * @param {object} world - 世界根对象
 * @param {number|string} situationId - 局势 ID
 * @returns {object|null} 局势实例（不存在返回 null）
 */
export function getSituation(world, situationId) {
  const key = String(situationId);
  const bag = situationsBag(world);
  if (bag && bag[key]) return bag[key];
  const soState = world && world.spaceOperaState;
  if (soState && isPlainObject(soState.resolvedSituations) && soState.resolvedSituations[key]) {
    return soState.resolvedSituations[key];
  }
  return null;
}

/**
 * 列出全部活跃局势（resolvedTick === null；确定性按数值 ID 升序）。
 * 只读：容器缺失返回 []（绝不 ensure）。
 */
export function listActiveSituations(world) {
  const bag = situationsBag(world);
  if (!bag) return [];
  const ids = Object.keys(bag).sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
  const out = [];
  for (const id of ids) {
    const sit = bag[id];
    if (isPlainObject(sit) && sit.resolvedTick == null) out.push(sit);
  }
  return out;
}

/** 列出全部 resolved 历史（确定性按数值 ID 升序；只读） */
export function listResolvedSituations(world) {
  const soState = world && world.spaceOperaState;
  const bag = soState && isPlainObject(soState.resolvedSituations) ? soState.resolvedSituations : null;
  if (!bag) return [];
  const ids = Object.keys(bag).sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
  return ids.map((id) => bag[id]);
}

/* ============================== 生命周期钩子 ============================== */

/**
 * 生成局势实例（Task 1.3 §1 标准结构；幂等自增 nextSituationId，绝不消费 world.rng）。
 *
 * config = { arcId, targetEntityId, progress?, monthlyDelta?, currentApproach?,
 *            approachCooldownUntilTick?, meta? }
 *
 * 业务失败（弧未注册 / 对策未知 / 进度非法）抛 Error('SO:…') → 命令总线回滚。
 *
 * @returns {object} 新建的局势实例（已写入活跃表并 emit SituationSpawned）
 */
export function spawnSituation(world, config = {}) {
  touchClockInjection();
  const soState = ensureSpaceOperaState(world);
  const arcId = config.arcId != null ? config.arcId : config.systemArcId;
  if (!ARC_ENUM.has(arcId)) {
    throw new Error(`SO: 非法局势弧 ID ${String(arcId)}`);
  }
  const def = ARCS.get(arcId);
  if (!def) throw new Error(`SO: 局势弧 ${String(arcId)} 未注册（弧模块须 import 期自注册）`);

  const progressMax = Number.isFinite(def.progressMax) ? def.progressMax : 100.0;
  let progress = Number.isFinite(config.progress) ? config.progress : 0;
  if (progress < 0 || progress > progressMax) {
    throw new Error(`SO: 初始进度越界 [0,${progressMax}]（实测 ${progress}）`);
  }

  const approachId = config.currentApproach != null ? config.currentApproach : (config.approachId != null ? config.approachId : null);
  const approaches = isPlainObject(def.approaches) ? def.approaches : {};
  if (approachId != null && !approaches[approachId]) {
    throw new Error(`SO: 局势弧 ${arcId} 无对策 ${String(approachId)}`);
  }
  let monthlyDelta;
  if (Number.isFinite(config.monthlyDelta)) monthlyDelta = config.monthlyDelta;
  else if (approachId != null && Number.isFinite(approaches[approachId].monthlyDelta)) monthlyDelta = approaches[approachId].monthlyDelta;
  else monthlyDelta = Number.isFinite(def.baseMonthlyDelta) ? def.baseMonthlyDelta : 0;

  const id = soState.nextSituationId;
  soState.nextSituationId = id + 1;
  const situation = {
    id,
    systemArcId: arcId,
    targetEntityId: config.targetEntityId != null ? config.targetEntityId : null,
    progress,
    progressMax,
    actStage: actStageForBounds(def.actBounds, progress),
    currentApproach: approachId,
    approachCooldownUntilTick: Number.isFinite(config.approachCooldownUntilTick) ? config.approachCooldownUntilTick : 0,
    monthlyDelta,
    lastStepTick: Number.isFinite(world.tick) ? world.tick : 0,
    createdTick: Number.isFinite(world.tick) ? world.tick : 0,
    resolvedTick: null,
    meta: isPlainObject(config.meta) ? { ...config.meta } : {},
  };
  soState.situations[String(id)] = situation;
  emit(world, 'SituationSpawned', {
    situationId: id,
    systemArcId: arcId,
    targetEntityId: situation.targetEntityId,
    progress,
    progressMax,
    actStage: situation.actStage,
    currentApproach: approachId,
  }, 'world');
  return situation;
}

/**
 * 四幕局势步进（Medium-Tick 桶步进入口；doc44 Task 1.3 §2）：
 *  1. 弧级 onStep 钩子先行（弧可依世界态改写 monthlyDelta，如 S4 赤字公式）；
 *  2. progress += monthlyDelta × dtMonthFraction（clamp [0, progressMax]）；
 *  3. 幕次按弧幕界表重算；
 *  4. approach 冷却无需显式解锁 —— switchSituationApproach 以 world.tick <
 *     approachCooldownUntilTick 判定，tick 自然流逝即自动解锁；
 *  5. progress 到满（climax）或归零（defused 安全解除）→ resolveSituationClimax。
 *
 * @param {object} world - 世界根对象
 * @param {object} situation - 局势实例（活跃）
 * @param {number} dtMonthFraction - 本次步进折算月份数（SpaceOperaClock：(tick−lastStepTick)/720）
 * @returns {object} 局势实例（可能已移入 resolved 历史）
 */
export function stepSituationBucket(world, situation, dtMonthFraction) {
  touchClockInjection();
  if (!isPlainObject(situation) || situation.resolvedTick != null) return situation;
  const def = ARCS.get(situation.systemArcId);
  if (!def) return situation;
  const dt = Number.isFinite(dtMonthFraction) && dtMonthFraction > 0 ? dtMonthFraction : 0;
  if (dt <= 0) return situation;

  if (typeof def.onStep === 'function') def.onStep(world, situation, dt);

  const raw = situation.progress + (Number.isFinite(situation.monthlyDelta) ? situation.monthlyDelta : 0) * dt;
  situation.progress = clamp(raw, 0, situation.progressMax);
  situation.actStage = actStageForBounds(def.actBounds, situation.progress);

  if (situation.progress >= situation.progressMax || situation.progress <= 0) {
    resolveSituationClimax(world, situation);
  }
  return situation;
}

/**
 * 切换应对策略（doc44 Task 1.3 §1 冷却契约）：
 *  - 冷却中（world.tick < approachCooldownUntilTick）抛 Error('SO:approach cooldown')
 *    → 命令总线回滚 {ok:false, code:'EXEC_ERROR'}；
 *  - 成功：currentApproach 更新、approachCooldownUntilTick = world.tick + 720、
 *    monthlyDelta 对齐新对策、经弧定义的 immediate(world, situation) 应用即时效果
 *    （immediate 可 throw 业务失败，如 S2 能量不足 —— 先 effect 后落账，失败零脏写）；
 *  - 同对策重复切换为幂等无操作（不刷新冷却）。
 *
 * @returns {object} 局势实例
 */
export function switchSituationApproach(world, situationId, newApproachId) {
  touchClockInjection();
  const situation = getSituation(world, situationId);
  if (!situation) throw new Error(`SO: 局势不存在 ${String(situationId)}`);
  if (situation.resolvedTick != null) throw new Error(`SO: 局势 ${situation.id} 已收束，禁止切换策略`);
  if (Number.isFinite(world.tick) && world.tick < situation.approachCooldownUntilTick) {
    throw new Error('SO:approach cooldown');
  }
  const def = ARCS.get(situation.systemArcId);
  const approaches = def && isPlainObject(def.approaches) ? def.approaches : {};
  const approach = approaches[newApproachId];
  if (!approach) {
    throw new Error(`SO: 局势弧 ${situation.systemArcId} 无对策 ${String(newApproachId)}`);
  }
  if (situation.currentApproach === newApproachId) return situation;

  if (typeof approach.immediate === 'function') {
    approach.immediate(world, situation); // 业务失败在此抛出 → 落账零脏写 → 总线回滚
  }
  situation.currentApproach = newApproachId;
  if (Number.isFinite(approach.monthlyDelta)) situation.monthlyDelta = approach.monthlyDelta;
  situation.approachCooldownUntilTick = (Number.isFinite(world.tick) ? world.tick : 0) + APPROACH_COOLDOWN_TICKS;
  emit(world, 'SituationApproachSwitched', {
    situationId: situation.id,
    systemArcId: situation.systemArcId,
    targetEntityId: situation.targetEntityId,
    approachId: newApproachId,
    cooldownUntilTick: situation.approachCooldownUntilTick,
  }, 'world');
  return situation;
}

/**
 * 收官结算：调弧注册的 climax 钩子（outcome = progress 满 → 'climax' / 归零 → 'defused'），
 * resolvedTick 记账后从活跃表（soState.situations）移除、移入 soState.resolvedSituations
 * （惰性历史表 —— ensureSpaceOperaState 契约键集保持冻结，历史表仅在首次收官时挂载），
 * 并 emit SituationResolved。
 *
 * @param {object} world - 世界根对象
 * @param {object} situation - 局势实例（活跃；重复调用幂等直返）
 * @returns {object} 已收官的局势实例
 */
export function resolveSituationClimax(world, situation) {
  if (!isPlainObject(situation) || situation.resolvedTick != null) return situation;
  const soState = ensureSpaceOperaState(world);
  const def = ARCS.get(situation.systemArcId);
  const outcome = situation.progress >= situation.progressMax ? 'climax' : 'defused';

  if (def && typeof def.climax === 'function') {
    def.climax(world, situation, outcome);
  }
  situation.resolvedTick = Number.isFinite(world.tick) ? world.tick : 0;
  situation.meta.outcome = outcome;
  delete soState.situations[String(situation.id)];
  if (!isPlainObject(soState.resolvedSituations)) soState.resolvedSituations = {};
  soState.resolvedSituations[String(situation.id)] = situation;
  emit(world, 'SituationResolved', {
    situationId: situation.id,
    systemArcId: situation.systemArcId,
    targetEntityId: situation.targetEntityId,
    outcome,
    progress: situation.progress,
    impact: situation.impact != null ? situation.impact : null,
  }, 'world');
  return situation;
}
