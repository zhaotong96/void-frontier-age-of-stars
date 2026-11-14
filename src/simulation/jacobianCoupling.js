/**
 * simulation/jacobianCoupling.js — 严格赫尔维茨稳定的 7×7 跨系统雅可比耦合器
 * （SPEC-PLAN-045 阶段二 M2 Task 2.1；责任人：Eng-A）
 *
 * 职责（doc45 §Task 2.1 逐条契约）：
 *  1. 冻结常量 JACOBIAN_7X7（7×7 = 49 元素与 45 号文档矩阵逐位一致；行 i = 受影响系统
 *     S_i，列 j = 源系统 S_j）与 SYSTEM_EQUILIBRIUM 平衡点向量；
 *  2. 软饱和边界函数 softSaturate100：边界膝点软饱和（内域 [SOFT_KNEE, 100−SOFT_KNEE]
 *     严格恒等、边界指数膝点渐近 0/100，无硬截断）。冲突裁决记录：doc45 §Task 2.1 §2
 *     原文 tanh 公式 σ(x)=50+50·tanh((x−50)/35) 与同文档 CHK-M2-01 门禁「收敛回 S_eq
 *     邻域」数学不相容（σ(S_eq)≠S_eq，实测不动点被吸至 [8.98,…,8.18]、S3 偏差 −10.4），
 *     依 42 号总纲 §三.1「J 在 S_eq 处线性化、冲击阻尼振荡后收敛回平衡点」的收敛语义
 *     裁决替换为膝点软饱和（总纲收敛语义 > 45 号执行卷公式字面，规格内部 bug 修正）；
 *     内域 dσ/dx=1 → 复合映射在平衡点的雅可比恰为 J，赫尔维茨语义无损；
 *  3. stepJacobianCoupling：离散演化差分方程（代码契约与 doc45 §Task 2.1 逐表达式一致）
 *       S(t+1) = σ_soft( S(t) + dt·( J·(S(t)−S_eq) + ΔS_endo(t) + U_player(t) ) )
 *     逐分量 toFixed(4) 后写回 world.spaceOperaState.systemVector；
 *  4. recordButterflyRipple：|ΔS_k| ≥ 8.0 的冲击自动提取三阶蝴蝶效应主传导路径
 *     （一阶 c1_i = J[i][k]·δ、二阶 c2_m = J[m][i]·c1、三阶 c3_n = J[n][m]·c2，各阶取
 *     |·| 最大者，等幅并列取带符号较大者——该并列裁决使 S2+25 的二阶主路径命中
 *     S6(+1.68) 而非等幅的 S4(−1.68)，与 doc45 §1.2 架构图口径一致），写入
 *     world.spaceOperaState.butterflyCausalLog（上限 16 条，超出 shift）；
 *  5. consumePendingShocks：读 world.spaceOperaState.pendingSystemShocks
 *     （{systemIndex: delta} 字典，由 S3 叛乱等弧写入）合成 playerImpulse，
 *     |delta| ≥ 8.0 的冲击走 recordButterflyRipple，返回 impulses 并清空字典；
 *  6. stepSpaceOperaJacobian：月末收口（registerMonthly('space-opera-jacobian')）——
 *     endoDelta 由活跃局势聚合（ENDOGENOUS_PUSH_DEFAULTS，S 弧模块在局势 meta 提供
 *     endogenousPush 时优先）+ consumePendingShocks 作 playerImpulse →
 *     stepJacobianCoupling → |playerImpulse[k]| ≥ 8 的未记录分量补录涟漪。
 *
 * 赫尔维茨稳定性（42 号总纲 §三.1；doc45 §Task 2.1 §3）：J 的全部 7 个特征值实部严格为负，
 * 线性部分 J·(S−S_eq) 任意单次冲击激发 2~3 阶跨系统阻尼振荡后渐近收敛。
 * 勘误（42 号总纲合规终审裁决，GATE-17-M3 复核留档）：doc45 §Task 2.1 §3 沿引的特征值清单
 * （λ1 = −0.7513，λ2,3 = −0.5097±0.0466i，λ4,5 = −0.4796±0.2995i，λ6,7 = −0.3750±0.2198i）
 * 与其自身冻结矩阵不符——对 JACOBIAN_7X7（本文件，49 元素与 42 号 §三.1 表逐位一致）实测谱为
 * λ1..λ5 = −0.878021, −0.730101, −0.641354, −0.432133±0.274185i（|λ|=0.5118）, −0.641354 之外
 * 另含 −0.319221, −0.037037（Faddeev–LeVerrier 特征多项式 × 200 随机点 det(xI−J) 交叉验证
 * 最大误差 2.7e-12，Durand-Kerner 求根残差 8.1e-17；实测谱和 = trace = −3.47 精确吻合，
 * 而声称清单之和 −3.4799 偏离 trace、模积 ≈0.0119 ≠ |det| 0.00127）——赫尔维茨实质
 * （全实部严格为负 + S_eq 精确不动点 + 复对阻尼振荡）全部成立，属文档级数值勘误，无行为影响。
 *
 * 纪律（doc43 §1.4 零漂移铁律）：
 *  - import 期仅注册月度阶段（TickPipeline registerMonthly），不改任何世界状态；
 *  - stepSpaceOperaJacobian 函数体首行守卫 world.spaceOperaState：未挂载容器
 *    （默认流程/金快照 8be8ce2c 世界）零读取零写入，逐位零漂移；
 *  - 零 Math.random / Date.now：本模块全确定（矩阵/常量/纯函数），无随机消费；
 *  - stepJacobianCoupling 保持 doc45 代码契约原样（容器由调用方保证，收口入口已守卫）。
 */

import { registerMonthly } from './TickPipeline.js';

/* ============================== 冻结矩阵与平衡点（doc45 Task 2.1 §3 逐位契约） ============================== */

/**
 * 7×7 跨系统雅可比耦合矩阵 J（行 i 为受影响系统 S_i，列 j 为源系统 S_j；冻结）。
 * 与 doc45 §Task 2.1 代码契约逐元素一致（并与 doc42 §三.1 机制映射表逐位互证）。
 */
export const JACOBIAN_7X7 = Object.freeze([
  Object.freeze([-0.50, +0.16, -0.08, +0.10, +0.06, +0.12, -0.12]), // S1: 异星考古
  Object.freeze([+0.24, -0.47, -0.10, +0.22, -0.05, +0.08, -0.06]), // S2: 生态相变
  Object.freeze([+0.12, +0.28, -0.53, -0.20, -0.16, +0.20, +0.15]), // S3: 殖民地社会
  Object.freeze([+0.18, +0.20, -0.24, -0.47, -0.12, -0.15, -0.08]), // S4: 宏观经济
  Object.freeze([+0.20, +0.06, -0.12, +0.26, -0.50, +0.12, +0.18]), // S5: 舰队学说
  Object.freeze([+0.10, +0.12, +0.24, -0.18, -0.25, -0.49, +0.18]), // S6: 黑市辛迪加
  Object.freeze([+0.16, +0.10, +0.14, +0.18, -0.24, +0.26, -0.51]), // S7: 议会与天灾
]);

/** 七大系统平衡点向量 S_eq（冻结；与 worldMigration.ensureSpaceOperaState 默认 systemVector 同源） */
export const SYSTEM_EQUILIBRIUM = Object.freeze([15.0, 15.0, 20.0, 15.0, 15.0, 10.0, 10.0]);

/* ============================== 软饱和与演化步进（doc45 Task 2.1 代码契约逐字） ============================== */

/**
 * 膝点宽度（冲突裁决常量；导出）：内域 [SOFT_KNEE, 100−SOFT_KNEE] = [8, 92] 严格恒等。
 * S_eq 全部分量 8.4–20 落在内域 → S_eq 为精确不动点。
 */
export const SOFT_KNEE = 8.0;

/**
 * 边界膝点软饱和函数（42 号总纲 §三.1 收敛语义修正 doc45 Task 2.1 §2 tanh 公式，
 * 冲突裁决记录见模块头与验收报告）：
 *   - 下界 0：x < SOFT_KNEE 时指数膝点软压 lo = SOFT_KNEE·exp((x−SOFT_KNEE)/SOFT_KNEE)，
 *     渐近 0、永不越界，膝点处值/斜率双连续（C1）；
 *   - 上界 100：lo > 100−SOFT_KNEE 时对称膝点 capped = 100 − SOFT_KNEE·exp((100−SOFT_KNEE−lo)/SOFT_KNEE)，
 *     渐近 100、无硬截断；
 *   - 内域严格恒等（dσ/dx = 1 → 复合映射在平衡点的雅可比恰为 J，赫尔维茨语义无损）；
 *   - NaN 输入返回 50 中性值防污染；±Infinity 经膝点自然收敛到 0/100。
 */
export function softSaturate100(x) {
  if (Number.isNaN(x)) return 50.0;
  const lo = x >= SOFT_KNEE ? x : SOFT_KNEE * Math.exp((x - SOFT_KNEE) / SOFT_KNEE);
  const capped = lo <= 100 - SOFT_KNEE ? lo : 100 - SOFT_KNEE * Math.exp((100 - SOFT_KNEE - lo) / SOFT_KNEE);
  return Math.max(0.0, Math.min(100.0, capped));
}

/**
 * 离散时间演化差分方程步进（doc45 §Task 2.1 核心代码实现契约逐表达式一致）：
 *   S(t+1) = σ_soft( S(t) + dt·( J·(S(t)−S_eq) + endoDelta + playerImpulse ) )
 * 逐分量 toFixed(4) 量化后整体写回 state.systemVector。
 *
 * @param {object} world - 世界根对象（须已挂载 world.spaceOperaState；月末收口入口已首行守卫）
 * @param {number[]} endoDelta - 七维内生推动 ΔS_endo（默认全零）
 * @param {number[]} playerImpulse - 七维玩家冲击 U_player（默认全零）
 * @param {number} dt - 步长（默认 0.25；doc45 月度 Slow Tick 收口帧口径）
 * @returns {number[]} 新的七维状态向量（已写回 world.spaceOperaState.systemVector）
 */
export function stepJacobianCoupling(world, endoDelta = [0, 0, 0, 0, 0, 0, 0], playerImpulse = [0, 0, 0, 0, 0, 0, 0], dt = 0.25) {
  const state = world.spaceOperaState;
  const S = state.systemVector;
  const nextS = new Array(7);

  for (let i = 0; i < 7; i++) {
    let couplingSum = 0.0;
    const row = JACOBIAN_7X7[i];
    for (let j = 0; j < 7; j++) {
      couplingSum += row[j] * (S[j] - SYSTEM_EQUILIBRIUM[j]);
    }
    const rawNext = S[i] + dt * (couplingSum + (endoDelta[i] || 0) + (playerImpulse[i] || 0));
    nextS[i] = Number(softSaturate100(rawNext).toFixed(4));
  }

  state.systemVector = nextS;
  return nextS;
}

/* ============================== 三阶蝴蝶效应因果链（doc45 Task 2.1 §4） ============================== */

/** 涟漪触发冲击阈值（doc45 §Task 2.1 §4：|ΔS_k| ≥ 8.0） */
const RIPPLE_DELTA_THRESHOLD = 8.0;

/** 因果链日志上限（doc43 Task 0.3：butterflyCausalLog 有界 16 条，超出 shift） */
const BUTTERFLY_LOG_CAP = 16;

/** 值量化口径（与步进状态向量一致的 toFixed(4)） */
function round4(v) {
  return Number(v.toFixed(4));
}

/**
 * 记录一次三阶蝴蝶效应涟漪（|delta| ≥ 8.0 触发；低于阈值静默返回 null）。
 *
 * 传导链裁决（doc45 §Task 2.1 §4 + §1.2 架构图示例）：
 *  - 一阶 c1_i = J[i][source]·delta，在 i ≠ source 中取 |c1| 最大者；
 *  - 二阶 c2_m = J[m][i]·c1，在 m ∉ {source, i} 中取 |c2| 最大者；
 *  - 三阶 c3_n = J[n][m]·c2，在 n ∉ {source, i, m} 中取 |c3| 最大者；
 *  - 各阶并列等幅时取带符号较大者（正传导优先）：S2 +25 的二阶在 S4(−1.68) 与
 *    S6(+1.68) 等幅，裁决命中 S6(+1.68)，与 doc45 §1.2「S6 黑市走私 (+1.68)」一致。
 *
 * 容器缺失（world.spaceOperaState 未挂载）时返回 null（零写入零漂移）；
 * butterflyCausalLog 缺失时在已挂载容器内惰性补齐。
 *
 * @param {object} world - 世界根对象
 * @param {number} sourceSystem - 源系统下标 0..6（0 基；S_k 标签 = 下标 + 1）
 * @param {number} delta - 冲击幅度（带符号）
 * @returns {object|null} 因果链对象 {tick, sourceSystem, delta, order1, order2, order3, path}
 */
export function recordButterflyRipple(world, sourceSystem, delta) {
  const soState = world && typeof world === 'object' ? world.spaceOperaState : null;
  if (!soState || typeof soState !== 'object') return null;
  const src = Number(sourceSystem);
  if (!Number.isInteger(src) || src < 0 || src > 6) {
    throw new Error(`SO: recordButterflyRipple sourceSystem 须为 0..6 整数（实测 ${String(sourceSystem)}）`);
  }
  const d = Number(delta);
  if (!Number.isFinite(d) || Math.abs(d) < RIPPLE_DELTA_THRESHOLD) return null;
  if (!Array.isArray(soState.butterflyCausalLog)) soState.butterflyCausalLog = [];

  // 一阶主传导（列 src）
  let i1 = -1;
  let v1 = 0.0;
  let a1 = -1.0;
  for (let i = 0; i < 7; i++) {
    if (i === src) continue;
    const v = JACOBIAN_7X7[i][src] * d;
    const a = Math.abs(v);
    if (a > a1 || (a === a1 && v > v1)) { a1 = a; v1 = v; i1 = i; }
  }
  // 二阶主传导（列 i1）
  let i2 = -1;
  let v2 = 0.0;
  let a2 = -1.0;
  for (let m = 0; m < 7; m++) {
    if (m === src || m === i1) continue;
    const v = JACOBIAN_7X7[m][i1] * v1;
    const a = Math.abs(v);
    if (a > a2 || (a === a2 && v > v2)) { a2 = a; v2 = v; i2 = m; }
  }
  // 三阶主传导（列 i2）
  let i3 = -1;
  let v3 = 0.0;
  let a3 = -1.0;
  for (let n = 0; n < 7; n++) {
    if (n === src || n === i1 || n === i2) continue;
    const v = JACOBIAN_7X7[n][i2] * v2;
    const a = Math.abs(v);
    if (a > a3 || (a === a3 && v > v3)) { a3 = a; v3 = v; i3 = n; }
  }

  const tick = Number.isFinite(world.tick) ? Math.max(0, Math.trunc(world.tick)) : 0;
  const chain = {
    tick,
    sourceSystem: src,
    delta: d,
    order1: { system: i1, value: round4(v1) },
    order2: { system: i2, value: round4(v2) },
    order3: { system: i3, value: round4(v3) },
    path: [src, i1, i2, i3],
  };
  const log = soState.butterflyCausalLog;
  log.push(chain);
  if (log.length > BUTTERFLY_LOG_CAP) log.shift();
  return chain;
}

/* ============================== 待决冲击消费（S3 叛乱等弧 → 雅可比入口） ============================== */

/**
 * 解析冲击/弧键 → 系统下标：数字串 '0'..'6' 或弧标签 'S1'..'S7'；其余返回 null。
 */
function parseSystemIndex(key) {
  const n = Number(key);
  if (key !== '' && Number.isInteger(n) && n >= 0 && n <= 6) return n;
  const m = /^S([1-7])$/i.exec(String(key));
  return m ? Number(m[1]) - 1 : null;
}

/**
 * 消费待决系统冲击（doc45 M2 交付契约：S3 叛乱等弧写入
 * world.spaceOperaState.pendingSystemShocks = {systemIndex: delta} 字典）：
 *  - 合成七维 playerImpulse（同键累加；非法键/非有限值忽略）；
 *  - |delta| ≥ 8.0 的冲击逐条走 recordButterflyRipple 记因果链；
 *  - 返回 impulses 并清空字典（delete 键：下次弧写入时重建）。
 *
 * 容器/字典缺失 → 返回全零 impulses（零写入零漂移）。
 *
 * @param {object} world - 世界根对象
 * @returns {number[]} 七维玩家冲击向量
 */
export function consumePendingShocks(world) {
  const soState = world && typeof world === 'object' ? world.spaceOperaState : null;
  if (!soState || typeof soState !== 'object') return [0, 0, 0, 0, 0, 0, 0];
  const pending = soState.pendingSystemShocks;
  if (!pending || typeof pending !== 'object') return [0, 0, 0, 0, 0, 0, 0];

  const impulses = [0, 0, 0, 0, 0, 0, 0];
  const keys = Object.keys(pending).sort();
  for (let n = 0; n < keys.length; n++) {
    const idx = parseSystemIndex(keys[n]);
    if (idx == null) continue;
    const d = Number(pending[keys[n]]);
    if (!Number.isFinite(d) || d === 0) continue;
    impulses[idx] += d;
    if (Math.abs(d) >= RIPPLE_DELTA_THRESHOLD) recordButterflyRipple(world, idx, d);
  }
  delete soState.pendingSystemShocks;
  return impulses;
}

/* ============================== 月末收口（内生推动聚合 + 演化步进 + 涟漪补录） ============================== */

/**
 * 活跃局势内生推动默认表（doc45 M2 交付契约逐值；key = systemArcId，value = 每活跃局势
 * 的月度 endo 推动量）。S 弧模块可在局势 meta.endogenousPush 提供弧自定义值优先。
 */
export const ENDOGENOUS_PUSH_DEFAULTS = Object.freeze({
  S1: 1.0,
  S2: 3.0,
  S3: 3.0,
  S4: 4.0,
  S5: 1.0,
  S6: 2.0,
  S7: 2.0,
});

/**
 * 单条活跃局势的 endo 推动裁决：
 *  1. meta.endogenousPush（S 弧模块已在 meta 提供）有限 → 优先；
 *  2. 否则 ENDOGENOUS_PUSH_DEFAULTS[systemArcId]（S1..S7 弧默认）；
 *  3. 皆缺 → 0（非 S 弧无默认映射，不贡献）。
 */
function resolveEndogenousPush(situation) {
  const meta = situation.meta;
  if (meta && typeof meta === 'object' && Number.isFinite(meta.endogenousPush)) {
    return meta.endogenousPush;
  }
  const arcId = typeof situation.systemArcId === 'string' ? situation.systemArcId : '';
  const def = ENDOGENOUS_PUSH_DEFAULTS[arcId];
  return Number.isFinite(def) ? def : 0.0;
}

/**
 * 活跃局势 endo 聚合（确定性：situationId 数值升序遍历；resolvedTick != null 跳过）。
 * 弧映射 S1..S7 → 下标 0..6；非 S 弧仅当 meta 同时提供 endogenousSystem(0..6) +
 * endogenousPush 时按指定下标贡献。
 */
function aggregateEndogenousPush(soState) {
  const endo = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
  const bag = soState.situations;
  if (!bag || typeof bag !== 'object') return endo;
  const ids = Object.keys(bag).sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
  for (let n = 0; n < ids.length; n++) {
    const sit = bag[ids[n]];
    if (!sit || typeof sit !== 'object' || sit.resolvedTick != null) continue;
    const push = resolveEndogenousPush(sit);
    if (push === 0) continue;
    const meta = sit.meta;
    const metaIdx = meta && typeof meta === 'object' ? parseSystemIndex(meta.endogenousSystem) : null;
    const idx = metaIdx != null ? metaIdx : parseSystemIndex(sit.systemArcId);
    if (idx != null) endo[idx] += push;
  }
  return endo;
}

/**
 * 预扫描待决冲击中将被 consumePendingShocks 记涟漪的下标集合
 * （收口尾部 |playerImpulse[k]| ≥ 8 补录的去重依据，防同月双记同一条冲击链）。
 */
function collectRippledShockIndexes(soState) {
  const rippled = new Set();
  const pending = soState.pendingSystemShocks;
  if (!pending || typeof pending !== 'object') return rippled;
  const keys = Object.keys(pending);
  for (let n = 0; n < keys.length; n++) {
    const idx = parseSystemIndex(keys[n]);
    if (idx == null) continue;
    const d = Number(pending[keys[n]]);
    if (Number.isFinite(d) && Math.abs(d) >= RIPPLE_DELTA_THRESHOLD) rippled.add(idx);
  }
  return rippled;
}

/**
 * 太空歌剧雅可比月末收口（registerMonthly('space-opera-jacobian') 注册形态）。
 *
 * 月末收口序列（doc45 M2 交付契约）：
 *  1. endoDelta ← 活跃局势聚合（ENDOGENOUS_PUSH_DEFAULTS / meta.endogenousPush）；
 *  2. playerImpulse ← consumePendingShocks（|delta| ≥ 8.0 冲击在其内部已记涟漪）；
 *  3. stepJacobianCoupling 步进写回 systemVector；
 *  4. |playerImpulse[k]| ≥ 8 且未被第 2 步覆盖的分量补录涟漪（去重防双记）。
 *
 * 首行守卫：world.spaceOperaState 缺失（默认流程/金快照世界）→ null 零写入；
 * systemVector 结构非法同样零写入（防御手造容器）。
 *
 * @param {object} world - 世界根对象
 * @returns {object|null} {endoDelta, playerImpulse, systemVector}（容器缺失返回 null）
 */
export function stepSpaceOperaJacobian(world) {
  if (!world || !world.spaceOperaState) return null;
  const soState = world.spaceOperaState;
  if (!Array.isArray(soState.systemVector) || soState.systemVector.length !== 7) return null;

  const endoDelta = aggregateEndogenousPush(soState);
  const rippled = collectRippledShockIndexes(soState);
  const playerImpulse = consumePendingShocks(world);
  const systemVector = stepJacobianCoupling(world, endoDelta, playerImpulse);
  for (let k = 0; k < 7; k++) {
    if (Math.abs(playerImpulse[k]) >= RIPPLE_DELTA_THRESHOLD && !rippled.has(k)) {
      recordButterflyRipple(world, k, playerImpulse[k]);
    }
  }
  return { endoDelta, playerImpulse, systemVector };
}

// —— import 副作用：月度收口阶段注册（经 TickPipeline；函数体首行守卫 world.spaceOperaState，
//    未触达世界/金快照 8be8ce2c 零漂移。集成接线注意：应排在 SpaceOperaClock 的
//    'space-opera-monthly' 之后 import，使弧级月度钩子先写 pendingSystemShocks 再被本收口消费）——
let jacobianMonthlyRegistered = false;

/**
 * 幂等注册雅可比月度收口（由 SpaceOperaWiring 在 'space-opera-monthly' 之后显式调用）。
 * 原模块求值期副作用注册在静态打包图中会使注册序提前于弧级月度钩子
 * （「弧钩子写 pendingSystemShocks → 雅可比收口消费」次序被翻转），故改为显式调用。
 */
export function registerJacobianMonthlyClose() {
  if (jacobianMonthlyRegistered) return;
  jacobianMonthlyRegistered = true;
  registerMonthly('space-opera-jacobian', stepSpaceOperaJacobian);
}
