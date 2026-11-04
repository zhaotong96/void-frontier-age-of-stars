/**
 * devtools/glGateTest.js — rework.md 图形硬性门禁测试（在真实浏览器 DOM 环境运行）
 *
 * 覆盖 rework.md 三项门禁：
 *   门禁 1 — 50 次视图切换显存泄漏检测：
 *     模拟 GalaxyView 挂载/卸载循环 50 次（每次全新 CanvasManager + GalaxyRenderer，
 *     跑一帧裸后处理管线 + 一帧完整 GalaxyRenderer GL 渲染后整体 dispose）。
 *     以 GLContext 的 _tracked 资源清册（programs/buffers/vaos/textures/fbos）计数：
 *     第 50 次迭代的 dispose 前峰值 ≤ 第 1 次迭代峰值 + 5（余量）即通过；
 *     每 10 次采样 performance.memory.usedJSHeapSize（Chrome 专有，缺失时 heap 字段
 *     置 null，判定仅依赖 GL 对象计数）。
 *   门禁 2 — WEBGL_lose_context 触发退化：
 *     经 gl.getExtension('WEBGL_lose_context').loseContext() 主动丢失上下文，验证
 *     CanvasManager 平滑退化（webglcontextlost 事件 → glDegraded=true + glCanvas 隐藏
 *     + beginGLFrame 短路返回 null），全程捕获模式不崩溃；随后 restoreContext() 验证
 *     恢复路径（等待 webglcontextrestored 事件并记录，验证的是"丢失时平滑退化不崩溃"，
 *     不要求恢复后可继续渲染 —— 恢复是否成功重建管线依环境而定，未恢复只记入
 *     notes 供面板展示，不作为失败理由）。
 *   门禁 3 — 100 艘战舰同屏压测：
 *     不走完整游戏：直接构造 battleView（src/simulation/ViewModels.js）形状的
 *     100 单位 + 200 投射物渲染数据（坐标/属性全部由确定性 hash01 生成），经
 *     Battle3D.draw 连续绘制 120 帧（模拟 2 秒 @60fps），用 requestAnimationFrame 的
 *     performance.now() 差值测每帧真实耗时；统计 avgFps / minFps（排除前 10 帧预热），
 *     判定 avgFps ≥ 30 && minFps ≥ 20。
 *     ⚠ 已知兼容问题（结果中 shimApplied/scratchPatched/notes 如实上报，均为
 *     Battle3D 待修复缺陷，本文件只打临时垫片以完成测量，不修改任何源码）：
 *     1) Battle3D.js 的着色器源码自带 GLSL_VERSION 前缀，而 GLCore.createProgram 会
 *        再统一前置一次 → 组装后双 #version 使全部战斗程序编译失败 → 构建 Battle3D
 *        前对 glc.createProgram 打垫片（剥掉源码自带的 #version 行，构建后立即还原）；
 *     2) Battle3D 构造函数的 _scratch 缺少 draw() 引用的 proj/view 矩阵槽位 → 首帧
 *        即抛 TypeError → 为压测实例补齐两个槽位（draw 每帧覆写其内容）。
 *
 * 用法（诊断面板 / DevTools 控制台）：
 *   const { results } = await import('/src/devtools/glGateTest.js')
 *     .then((m) => m.runGateTests(document.querySelector('.vf-view-body')));
 *   // container 需有非零布局尺寸（CanvasManager 依赖 getBoundingClientRect 测量），
 *   // 且页面须处于前台（后台标签页 rAF 被节流，门禁 3 会快速失败并给出提示）。
 *
 * 返回契约：
 * {
 *   results: {
 *     leak:    { pass, switches, heap0MB, heap1MB, heapDeltaMB, glObjects0, glObjects1, ... },
 *     ctxLoss: { pass, degradedAfterLoss, restoredAfterRestore, errors, ... },
 *     stress:  { pass, shipCount, avgFps, minFps, frameTimesMs, ... },
 *     allPass: boolean,
 *   }
 * }
 * "..." 为面板诊断用附加字段（逐项含义见各门禁返回处注释），不影响契约字段消费。
 * 另导出 gateTestProgress（{ gate, iteration, note }）：门禁耗时较长（门禁 1 为
 * 同步密集循环，会周期性让出主线程），诊断面板可轮询它展示当前进度。
 *
 * 地表渲染诊断（doc7 §2.2 / doc6 §3.3）导出：
 *   surfaceSetDebugMode(mode) / surfaceCycleDebugMode() / surfaceGLSnapshot() ——
 *   经 window.__vfSurfaceDebug 钩子（PlanetSurface3D.init 注册、destroy 注销）操作
 *   【当前挂载】的地表渲染器；未挂载时返回 { ok:false, reason }，不抛错。
 *
 * 约束：顶层不触碰 document/window（全部 DOM/全局访问发生在函数体内）；禁用
 * Math.random，全部离散分布由确定性 hash01 生成；本模块只调用渲染层公开 API，
 * 不写任何世界/快照状态。
 */

import { CanvasManager } from '../render/CanvasManager.js';
import { GalaxyRenderer } from '../render/GalaxyRenderer.js';
import { Battle3D } from '../render/gl/Battle3D.js';
import { mat4 } from '../render/gl/Mat4.js';
import { availableHullIds } from '../render/meshes/ShipMeshes.js';

// —— 门禁参数（可经 runGateTests 的 opts 覆盖） ————————————————————————————

const DEFAULT_OPTS = {
  switches: 50,   // 门禁 1：挂载/卸载循环次数
  ships: 100,     // 门禁 3：战舰单位数
  projectiles: 200, // 门禁 3：投射物数
  frames: 120,    // 门禁 3：绘制帧数（≈ 2 秒 @60fps）
  warmup: 10,     // 门禁 3：统计时排除的预热帧数
};

/** 门禁 1：GL 对象总数判定余量（第 50 次 ≤ 第 1 次 + 余量） */
const LEAK_TOLERANCE = 5;
/** 门禁 1：堆采样间隔（每 N 次切换采样一次） */
const HEAP_SAMPLE_EVERY = 10;
/** 门禁 2：上下文事件等待超时（ms） */
const CTX_EVENT_TIMEOUT_MS = 3000;
/** 门禁 3：压测整体超时兜底（ms；rAF 被节流/卡死时退出） */
const STRESS_TIMEOUT_MS = 30000;
/** 门禁 3：FPS 判定线（rework.md：avgFps ≥ 30 && minFps ≥ 20） */
const AVG_FPS_MIN = 30;
const MIN_FPS_MIN = 20;

/** 门禁 1 合成星系快照用恒星类型（覆盖普通/黑洞/脉冲星 → 命中球壳绘制路径） */
const STAR_TYPES = ['yellowDwarf', 'redDwarf', 'blueGiant', 'whiteDwarf', 'neutronStar', 'pulsar', 'blackHole'];
/** 门禁 3：structureMax 分级阶梯（Battle3D.draw 的 guessHull 按 structureMax 推断船体网格，
 *  该阶梯覆盖 battleship/carrier/gun_cruiser/destroyer/frigate/scout 全部 6 档网格） */
const STRUCTURE_LADDER = [100, 200, 320, 600, 1000, 2000];

/**
 * 门禁运行进度（诊断面板可轮询；runGateTests 启动时重置）。
 * gate: null | 'leak' | 'ctxLoss' | 'stress'；iteration: 门禁 1 当前迭代序号。
 */
export const gateTestProgress = { gate: null, iteration: 0, note: '' };

/** 重置进度标记 */
function setProgress(gate, iteration, note) {
  gateTestProgress.gate = gate;
  gateTestProgress.iteration = iteration || 0;
  gateTestProgress.note = note || '';
}

// —— 通用工具（仅在函数体内触碰浏览器全局） ————————————————————————————

/** 确定性 hash：f(i) = frac(sin(i·127.1)·43758.5453)（与 GalaxyRenderer 同源，禁用随机数） */
function hash01(i) {
  const s = Math.sin(i * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/** 数值取整到 n 位小数；非有限值/空值返回 null */
function roundN(v, n) {
  if (v == null || !Number.isFinite(v)) return null;
  const p = Math.pow(10, n);
  return Math.round(v * p) / p;
}

/**
 * 统计 GLContext 资源清册（glc._tracked）的各类 GL 对象数量。
 * @param {import('../render/gl/GLCore.js').GLContext|null} glc
 * @returns {{programs:number, buffers:number, vaos:number, textures:number, fbos:number, total:number}}
 */
function countTracked(glc) {
  const t = glc && glc._tracked;
  const programs = t && t.programs ? t.programs.length : 0;
  const buffers = t && t.buffers ? t.buffers.length : 0;
  const vaos = t && t.vaos ? t.vaos.length : 0;
  const textures = t && t.textures ? t.textures.length : 0;
  const fbos = t && t.fbos ? t.fbos.length : 0;
  return { programs, buffers, vaos, textures, fbos, total: programs + buffers + vaos + textures + fbos };
}

/**
 * 采样 JS 堆用量（MB）。
 * performance.memory 为 Chrome 专有 API；Firefox/Safari 等环境返回 null，
 * 门禁 1 的判定仅依赖 GL 对象计数，heap 字段置 null 供面板标注"环境不支持"。
 */
function heapUsedMB() {
  if (typeof performance === 'undefined' || !performance.memory) return null;
  return roundN(performance.memory.usedJSHeapSize / 1048576, 2);
}

/** 尽力触发 GC（仅当 Chrome 以 --js-flags=--expose-gc 启动时存在 window.gc；否则静默跳过） */
function tryGc() {
  if (typeof window !== 'undefined' && typeof window.gc === 'function') {
    try { window.gc(); } catch (_) { /* GC 失败不影响测试 */ }
  }
}

/**
 * 下一帧 Promise：优先 rAF，同时以 50ms setTimeout 兜底 —— 后台/被遮挡页面 rAF
 * 可能长期停发，纯 rAF 等待会让 waitFor 无限挂起（兜底保证轮询按期限退出）。
 */
function nextFrame() {
  return new Promise((resolve) => {
    let done = false;
    const settle = () => {
      if (done) return;
      done = true;
      resolve();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(settle);
    setTimeout(settle, 50);
  });
}

/**
 * 剔除着色器源码最前方的一条 #version 行（仅当源码以 #version 指令开头时）。
 * 背景：GLCore.createProgram 会统一为源码前置 GLSL_VERSION；而 Battle3D.js 的
 * 着色器源码自带 GLSL_VERSION 前缀 → 组装后出现双 #version（第二行报
 * "'version' directive must occur before anything else"）编译失败。此垫片把
 * Battle3D 源码自带的 #version 行剥掉，交由 GLCore 统一前置，使其可构建以完成
 * 性能压测；不修改任何源码文件。Battle3D 修复（删除自带前缀）后，源码不以
 * #version 开头，此函数为恒等变换，垫片自动失效。
 */
function stripLeadingVersionDirective(src) {
  return String(src).replace(/^[ \t]*#version[^\n]*\n/, '');
}

/**
 * 等待条件成立（每帧轮询一次）。
 * @returns {Promise<boolean>} 超时返回 false
 */
async function waitFor(cond, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (!cond()) {
    if (performance.now() > deadline) return false;
    await nextFrame();
  }
  return true;
}

/**
 * 等待目标派发一次指定事件。
 * @returns {Promise<boolean>} 事件在超时前触发返回 true，超时返回 false（不 reject，
 *                              避免测试自身产生未捕获异常）
 */
function waitForEvent(target, type, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const onEvt = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      target.removeEventListener(type, onEvt);
      resolve(true);
    };
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      target.removeEventListener(type, onEvt);
      resolve(false);
    }, timeoutMs);
    target.addEventListener(type, onEvt);
  });
}

/** 错误消息格式化（Error → message，兜底 String） */
function errMsg(e) {
  return (e && e.message) ? e.message : String(e);
}

// —— 合成数据（确定性，禁用随机数） ————————————————————————————————————————

/**
 * 构造最小可渲染的 App 快照（GalaxyRenderer.render 所需形状）：
 * 12 个已勘测星系（含黑洞/脉冲星 → 命中超新星球壳路径），链式航路（指向更大 id，
 * 满足 GalaxyRenderer 的 `laneId <= s.id 跳过` 去重规则），两个势力配色。
 */
function makeGalaxySnapshot() {
  const n = 12;
  const systems = [];
  for (let i = 0; i < n; i++) {
    const pad = (j) => 'sys-' + String(j).padStart(3, '0');
    systems.push({
      id: pad(i),
      name: '门禁星系-' + i,
      x: Math.round(140 + hash01(i * 3.71 + 0.9) * 720),
      y: Math.round(140 + hash01(i * 9.13 + 4.7) * 720),
      lanes: i < n - 1 ? [pad(i + 1)] : [],
      surveyedLevel: 4,
      ownerFactionId: i % 3 === 0 ? null : (i % 2 === 0 ? 'fac-a' : 'fac-b'),
      dangerRating: Math.round(hash01(i * 5.39 + 1.1) * 100) / 10,
      star: { typeId: STAR_TYPES[i % STAR_TYPES.length] },
      colonyCount: i % 2,
      resourceRating: Math.round(hash01(i * 2.93 + 8.8) * 100) / 10,
    });
  }
  return {
    systems,
    factions: [
      { id: 'fac-a', color: '#4fd8e8' },
      { id: 'fac-b', color: '#e85f5f' },
    ],
    fleets: [],
    battles: [],
  };
}

/**
 * 构造门禁 3 压测数据：battleView（ViewModels.js）形状的战斗视图。
 *  - 单位字段与 battleView 输出一一对应：shipId/side/x/y/heading/hullId/retreatCharge/
 *    name/hullName/shield/shieldMax/structure/structureMax/destroyed/order；
 *  - hullId 从 availableHullIds() 轮转取值（覆盖 12 种船体形状的数据侧）；
 *  - structureMax 按 STRUCTURE_LADDER 轮转（Battle3D.draw 经 guessHull(structureMax)
 *    选择网格，该阶梯覆盖全部 6 档船体网格的绘制路径）；
 *  - 每 25 艘置 1 艘 retreat + retreatCharge（命中跃迁漏斗绘制路径）；
 *  - 投射物 beamFx / missile 交替（分别命中光束带 / 导弹光点路径）。
 */
function makeBattleData(shipCount, projectileCount) {
  const hulls = availableHullIds();
  const units = [];
  for (let i = 0; i < shipCount; i++) {
    const hullId = hulls[i % hulls.length];
    const structureMax = STRUCTURE_LADDER[i % STRUCTURE_LADDER.length];
    const retreat = i % 25 === 0;
    units.push({
      shipId: 'gate-' + String(i).padStart(3, '0'),
      side: i % 2 === 0 ? 'a' : 'b',
      x: Math.round(hash01(i * 1.7 + 0.3) * 1000),
      y: Math.round(hash01(i * 2.3 + 5.1) * 320),
      heading: Math.round(hash01(i * 3.1 + 9.9) * 628) / 100, // 0..6.28 弧度
      hullId,
      name: '门禁战舰-' + i,
      hullName: hullId,
      shield: Math.round(40 + hash01(i * 4.7 + 2.2) * 160),
      shieldMax: 200,
      structure: Math.round(structureMax * (0.55 + hash01(i * 5.9 + 7.7) * 0.4)),
      structureMax,
      destroyed: false,
      order: retreat ? 'retreat' : 'attack',
      retreatCharge: retreat ? Math.round(hash01(i * 6.1 + 3.3) * 250) / 10 : 0,
    });
  }
  const projectiles = [];
  for (let i = 0; i < projectileCount; i++) {
    const src = units[(i * 7) % units.length];
    const dst = units[(i * 7 + 3) % units.length];
    if (i % 2 === 0) {
      projectiles.push({ kind: 'beamFx', x: src.x, y: src.y, x0: src.x, y0: src.y, x1: dst.x, y1: dst.y, side: src.side });
    } else {
      projectiles.push({
        kind: 'missile',
        x: Math.round(hash01(i * 7.7 + 1.9) * 1000),
        y: Math.round(hash01(i * 8.3 + 6.6) * 320),
        x0: src.x, y0: src.y, x1: dst.x, y1: dst.y,
        side: src.side,
      });
    }
  }
  return {
    id: 'gate-battle',
    systemId: 'sys-gate',
    systemName: '门禁战场',
    time: 0,
    status: 'active',
    sides: { a: 'fac-a', b: 'fac-b' },
    units,
    projectiles,
    events: [],
    losses: { a: 0, b: 0 },
  };
}

// —— 门禁 1：50 次视图切换显存泄漏检测 ——————————————————————————————————————

/**
 * @param {HTMLElement} container
 * @param {object} cfg
 * @returns {Promise<object>} { pass, switches, heap0MB, heap1MB, heapDeltaMB,
 *          glObjects0, glObjects1, heapSamplesMB, glObjectPeaksMin, glObjectPeaksMax,
 *          glModeFrames, errors }
 *          - glObjects0/glObjects1：第 1 次 / 最后一次迭代在 dispose 前（峰值点）的
 *            GL 对象总数；每次挂载的分配量应恒定，逐次增长即泄漏；
 *          - heapSamplesMB：每 HEAP_SAMPLE_EVERY 次切换采样一次的堆序列（无
 *            performance.memory 的环境为 [null,...]）；
 *          - glModeFrames：GalaxyRenderer 成功走通 GL 路径的迭代数（0 说明全部回退 2D）。
 */
async function gateLeakSwitches(container, cfg) {
  const switches = cfg.switches;
  const errors = [];
  const heapSamplesMB = [];
  const glObjectPeaks = [];
  let glModeFrames = 0;

  tryGc();
  const heap0MB = heapUsedMB(); // 基线（循环前）
  const snapshot = makeGalaxySnapshot();

  for (let i = 1; i <= switches; i++) {
    setProgress('leak', i, '挂载/渲染/卸载第 ' + i + ' 次');
    // 每次迭代让出主线程一帧：避免 50 次连续同步渲染阻塞页面（诊断面板可保持响应，
    // 浏览器也有机会回收前次迭代的垃圾）
    await nextFrame();
    // —— 挂载：全新 CanvasManager + GalaxyRenderer（真实 GalaxyView 挂载形态） ——
    const cm = new CanvasManager().attach(container);
    const renderer = new GalaxyRenderer().init(cm);
    try {
      cm.beginFrame(); // HUD 2D 变换复位（真实帧同样先调 beginFrame）

      // 帧 A：任务书规定的裸后处理管线帧（beginGLFrame → 清屏 → endGLFrame）
      const target = cm.beginGLFrame();
      if (target && cm.gl) {
        const gl = cm.gl;
        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.clearColor(0.0275, 0.0431, 0.0706, 1.0); // --bg #070b12
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      }
      cm.endGLFrame({ bloom: 0, exposure: 1, time: 0 });

      // 帧 B：完整 GalaxyRenderer 渲染帧（懒构建 Galaxy3D 的 programs/VAO/缓冲 +
      // 星系盘/星云/航路/节点/球壳绘制 + HUD，与真实挂载帧完全同路径）
      renderer.render(cm.ctx, cm.width, cm.height, snapshot, {}, { time: i * 0.016 });
    } catch (e) {
      errors.push('第 ' + i + ' 次切换渲染异常: ' + errMsg(e));
    }
    if (renderer._mode === 'gl') glModeFrames++;

    // dispose 前采样清册峰值：同一挂载形态的分配量应恒定
    glObjectPeaks.push(countTracked(cm.glc).total);
    if (i % HEAP_SAMPLE_EVERY === 0) {
      tryGc();
      heapSamplesMB.push(heapUsedMB());
    }

    // —— 卸载：GalaxyRenderer 当前无公开 dispose 方法（防御式调用，未来补齐即生效）；
    // 其 GL 资源全部登记在 cm.glc._tracked，由 cm.dispose() 统一 deleteProgram/
    // deleteBuffer/... 并经 WEBGL_lose_context 弃置上下文 —— 与真实卸载路径一致。
    try {
      if (typeof renderer.dispose === 'function') renderer.dispose();
    } catch (e) {
      errors.push('第 ' + i + ' 次切换 renderer.dispose 异常: ' + errMsg(e));
    }
    cm.dispose();
  }

  tryGc();
  const heap1MB = heapUsedMB(); // 终值（循环后）
  setProgress('leak', switches, '循环完成，统计结果');

  const glObjects0 = glObjectPeaks.length ? glObjectPeaks[0] : 0;
  const glObjects1 = glObjectPeaks.length ? glObjectPeaks[glObjectPeaks.length - 1] : 0;
  if (glObjects0 <= 0) {
    errors.push('未观测到 GL 对象分配（环境无 WebGL2 或 GL 管线未建立），无法判定泄漏');
  }
  if (glModeFrames <= 0) {
    errors.push('GalaxyRenderer 从未走通 GL 渲染路径（全部回退 2D），门禁覆盖不完整');
  }
  const noGrowth = glObjects1 <= glObjects0 + LEAK_TOLERANCE;
  const pass = errors.length === 0 && noGrowth;

  return {
    pass,
    switches,
    heap0MB,
    heap1MB,
    heapDeltaMB: (heap0MB != null && heap1MB != null) ? roundN(heap1MB - heap0MB, 2) : null,
    glObjects0,
    glObjects1,
    // —— 附加诊断字段 ——
    leakTolerance: LEAK_TOLERANCE,
    heapSamplesMB,
    glObjectPeaksMin: glObjectPeaks.length ? Math.min.apply(null, glObjectPeaks) : 0,
    glObjectPeaksMax: glObjectPeaks.length ? Math.max.apply(null, glObjectPeaks) : 0,
    glModeFrames,
    errors,
  };
}

// —— 门禁 2：WEBGL_lose_context 触发退化 ——————————————————————————————————————

/**
 * @param {HTMLElement} container
 * @param {object} cfg
 * @returns {Promise<object>} { pass, degradedAfterLoss, restoredAfterRestore, errors,
 *          notes, lostEventFired, restoredEventFired, glDegradedFlag, glCanvasHidden,
 *          beginGLFrameNullWhileDegraded, pipelineRebuiltAfterRestore, glStillLostAfterRestore,
 *          glStateTimeline }
 *          - degradedAfterLoss：丢失后平滑退化验证结论（事件触发 + glDegraded 标记 +
 *            glCanvas 隐藏 + beginGLFrame 短路，全部成立才为 true）；
 *          - restoredAfterRestore：webglcontextrestored 是否在超时内触发
 *            （信息性字段 —— restoreContext 后能否重建管线依环境而定，未触发只记
 *            notes，不参与判定）；
 *          - pass = degradedAfterLoss && 全程无异常。
 */
async function gateContextLoss(container, cfg) {
  const errors = [];
  const notes = [];
  const result = {
    pass: false,
    degradedAfterLoss: false,
    restoredAfterRestore: false,
    errors,
    notes,
    lostEventFired: false,
    restoredEventFired: false,
    glDegradedFlag: false,
    glCanvasHidden: false,
    beginGLFrameNullWhileDegraded: false,
    pipelineRebuiltAfterRestore: false,
    glStillLostAfterRestore: null,
  };

  setProgress('ctxLoss', 0, '创建 CanvasManager 并触发上下文丢失');
  const cm = new CanvasManager().attach(container);
  if (!cm.hasGL || !cm.gl) {
    errors.push('环境无 WebGL2（hasGL=false），无法执行上下文丢失门禁');
    cm.dispose();
    return result;
  }
  // GLContext._init 已缓存 WEBGL_lose_context；兜底再取一次
  const ext = cm.glc.loseContextExt || cm.gl.getExtension('WEBGL_lose_context');
  if (!ext) {
    errors.push('WEBGL_lose_context 扩展不可用，无法模拟上下文丢失');
    cm.dispose();
    return result;
  }

  // GL 状态变化时间线（degraded=true 丢失 / false 恢复重建），诊断用
  const glStateTimeline = [];
  const offState = cm.onGLStateChange((degraded) => {
    glStateTimeline.push({ degraded, atMs: Math.round(performance.now()) });
  });

  // 1) 预挂监听（先注册再触发，避免竞态）
  const lostPromise = waitForEvent(cm.glCanvas, 'webglcontextlost', CTX_EVENT_TIMEOUT_MS)
    .then((fired) => { result.lostEventFired = fired; return fired; });

  // 2) 主动丢失上下文（CanvasManager._onGLLost → preventDefault + _enterDegraded）
  try {
    ext.loseContext();
  } catch (e) {
    errors.push('loseContext() 抛错: ' + errMsg(e));
  }

  await lostPromise;
  // CanvasManager 的事件处理器与本次测试监听同挂 glCanvas（注册在前），事件派发时
  // glDegraded 已置位；再轮询一帧确保状态稳定
  await waitFor(() => cm.glDegraded === true, CTX_EVENT_TIMEOUT_MS);

  // 3) 验证退化态：标记 + glCanvas 以 opacity:0 隐藏 + GL 帧短路
  result.glDegradedFlag = cm.glDegraded === true;
  result.glCanvasHidden = !!(cm.glCanvas && cm.glCanvas.style.opacity === '0');
  try {
    result.beginGLFrameNullWhileDegraded = cm.beginGLFrame() === null;
  } catch (e) {
    errors.push('退化期 beginGLFrame 抛错: ' + errMsg(e));
  }
  result.degradedAfterLoss =
    result.lostEventFired && result.glDegradedFlag && result.glCanvasHidden &&
    result.beginGLFrameNullWhileDegraded;
  if (!result.lostEventFired) errors.push('webglcontextlost 事件未在超时内触发');
  if (!result.degradedAfterLoss) errors.push('丢失后未达成平滑退化（glDegraded/glCanvas 隐藏/beginGLFrame 短路任一不成立）');

  // 4) 模拟恢复：等待 webglcontextrestored（CanvasManager._onGLRestored 自动 rebuild，
  //    rebuild 失败内部自行收敛为降级，不会向外抛错）
  const restoredPromise = waitForEvent(cm.glCanvas, 'webglcontextrestored', CTX_EVENT_TIMEOUT_MS)
    .then((fired) => { result.restoredEventFired = fired; return fired; });
  try {
    ext.restoreContext(); // 上下文未丢失时调用会抛 InvalidStateError —— 此处已确认丢失
  } catch (e) {
    errors.push('restoreContext() 抛错: ' + errMsg(e));
  }
  result.restoredAfterRestore = await restoredPromise;
  if (!result.restoredAfterRestore) {
    // 按任务约定：restoreContext 后能否真实恢复依环境而定（部分环境上下文一经
    // 丢失即无法重建）。恢复成功与否只记入 notes，不影响门禁判定 —— 门禁验证的
    // 是"丢失时平滑退化不崩溃"。
    notes.push('webglcontextrestored 事件未在超时内触发：环境未真实恢复上下文（isContextLost 仍为 true 时按 2D 兜底继续，属预期行为）');
  }

  // 5) 恢复后捕获模式探测：不要求"恢复后继续渲染"，只要求不崩溃
  try {
    result.glStillLostAfterRestore = cm.gl.isContextLost();
    const target = cm.beginGLFrame(); // 已重建 → 正常帧；仍降级 → null；均不得抛错
    if (target) cm.endGLFrame({ bloom: 0, exposure: 1, time: 0 });
    result.pipelineRebuiltAfterRestore = !result.glStillLostAfterRestore && cm.glDegraded === false;
  } catch (e) {
    errors.push('恢复后 GL 探测帧抛错: ' + errMsg(e));
  }

  result.glStateTimeline = glStateTimeline;
  result.pass = result.degradedAfterLoss && errors.length === 0;

  offState();
  cm.dispose();
  return result;
}

// —— 门禁 3：100 艘战舰同屏压测 ———————————————————————————————————————————————

/**
 * @param {HTMLElement} container
 * @param {object} cfg
 * @returns {Promise<object>} { pass, shipCount, avgFps, minFps, frameTimesMs, errors,
 *          notes, projectileCount, frames, warmup, drawMsAvg, timedOut, shimApplied,
 *          scratchPatched, glObjectsTracked }
 *          - frameTimesMs：相邻 rAF 时间戳差值序列（ms，含预热段；统计段为 slice(warmup)）；
 *          - avgFps = 1000 / 统计段平均帧耗时；minFps = 1000 / 统计段最慢帧耗时；
 *          - shimApplied / scratchPatched：是否启用了 Battle3D 兼容垫片（true 时
 *            notes 有说明，对应 Battle3D 的两处待修复缺陷）；
 *          - pass = avgFps ≥ 30 && minFps ≥ 20 && 全程无异常且未超时。
 */
async function gateBattleStress(container, cfg) {
  const errors = [];
  const notes = [];
  const shipCount = cfg.ships;
  const projectileCount = cfg.projectiles;
  const frames = cfg.frames;
  const warmup = cfg.warmup;
  const result = {
    pass: false,
    shipCount,
    avgFps: null,
    minFps: null,
    frameTimesMs: [],
    errors,
    notes,
    projectileCount,
    frames,
    warmup,
    drawMsAvg: null,
    timedOut: false,
    shimApplied: false,
    scratchPatched: false,
    glObjectsTracked: 0,
  };

  // 后台标签页 rAF 被节流至 0，压测无法进行 —— 快速失败并说明
  if (typeof document !== 'undefined' && document.hidden) {
    errors.push('页面处于后台（document.hidden=true），requestAnimationFrame 被节流；请在前台运行门禁 3');
    return result;
  }

  setProgress('stress', 0, '创建 CanvasManager 与 Battle3D 资源');
  const cm = new CanvasManager().attach(container);
  if (!cm.hasGL || !cm.gl) {
    errors.push('环境无 WebGL2（hasGL=false），无法执行战舰压测');
    cm.dispose();
    return result;
  }

  // —— Battle3D 双 #version 兼容垫片（详见文件头说明） ——
  // 仅在 Battle3D 构建期间生效：剥掉源码自带的 #version 行（GLCore 会统一前置），
  // 构建后立即还原原方法；是否剥除了版本行记录进 result.shimApplied 供面板/报告展示。
  let battle3d = null;
  const origCreateProgram = cm.glc.createProgram;
  cm.glc.createProgram = (vsSource, fsSource, opts) => {
    const vs = stripLeadingVersionDirective(vsSource);
    const fs = stripLeadingVersionDirective(fsSource);
    if (vs !== vsSource || fs !== fsSource) result.shimApplied = true;
    return origCreateProgram.call(cm.glc, vs, fs, opts);
  };
  try {
    battle3d = new Battle3D(cm.glc, 1); // tier 1：完整 LOD（蜂窝护盾等全量路径）
  } catch (e) {
    errors.push('Battle3D 资源构建失败: ' + errMsg(e));
    cm.glc.createProgram = origCreateProgram;
    cm.dispose();
    return result;
  }
  cm.glc.createProgram = origCreateProgram; // 还原：绘制路径使用原生 createProgram
  if (result.shimApplied) {
    notes.push('已应用 #version 剥离垫片：Battle3D.js 着色器源码自带 GLSL_VERSION 前缀，' +
      'GLCore.createProgram 又统一前置导致双 #version 编译失败（待 Battle3D/GLCore 修复）；' +
      '垫片仅在 Battle3D 构建期间生效并已还原，不影响绘制路径');
  }

  // —— Battle3D scratch 槽位补齐垫片 ——
  // Battle3D.draw 每帧写入 _scratch.proj / _scratch.view（mat4Perspective/mat4LookAt
  // 的 out 参数），但构造函数只创建了 mvp/model/view2/tmp/inv 槽位 → draw 首帧即抛
  // "Cannot read properties of undefined (reading 'fill')"。此处为压测实例补齐两个
  // 矩阵槽位（draw 每帧覆写其内容，不影响渲染语义），只作用于本实例。
  if (!battle3d._scratch) battle3d._scratch = {};
  if (!battle3d._scratch.proj) { battle3d._scratch.proj = mat4(); result.scratchPatched = true; }
  if (!battle3d._scratch.view) { battle3d._scratch.view = mat4(); result.scratchPatched = true; }
  if (result.scratchPatched) {
    notes.push('已补齐 Battle3D._scratch 的 proj/view 矩阵槽位：构造函数未创建 draw() 所需的' +
      '这两个槽位，首帧即崩溃（待 Battle3D 修复）；补齐只作用于压测实例，draw 每帧覆写其内容');
  }

  const data = makeBattleData(shipCount, projectileCount);
  const frameTimes = []; // 相邻 rAF 时间戳差（ms）
  const drawTimes = [];  // battle3d.draw 纯 CPU 提交耗时（ms，诊断用）

  // 连续 frames 帧绘制（rAF 驱动）：每帧 beginGLFrame → 清屏 → battle3d.draw → endGLFrame，
  // 与 BattleRenderer._render3D 的真实帧结构一致（含 HDR Bloom 合成）。
  // 独立 setTimeout 看门狗兜底：rAF 被节流/停发时（页面后台化、渲染器卡顿）也能退出。
  await new Promise((resolve) => {
    let frame = 0;
    let lastTs = 0;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      resolve();
    };
    const deadline = performance.now() + STRESS_TIMEOUT_MS;
    const watchdog = setTimeout(() => {
      result.timedOut = true;
      errors.push('压测超时（' + STRESS_TIMEOUT_MS + 'ms 内未完成 ' + frames + ' 帧；rAF 可能被节流）');
      settle();
    }, STRESS_TIMEOUT_MS);
    const step = () => {
      const now = performance.now();
      if (now > deadline) {
        result.timedOut = true;
        errors.push('压测超时（' + STRESS_TIMEOUT_MS + 'ms 内未完成 ' + frames + ' 帧）');
        settle();
        return;
      }
      if (lastTs > 0) frameTimes.push(now - lastTs); // 每帧真实耗时 = rAF 差值
      lastTs = now;
      if (frame >= frames) { settle(); return; }
      frame += 1;
      setProgress('stress', frame, '绘制第 ' + frame + '/' + frames + ' 帧');
      try {
        const target = cm.beginGLFrame();
        if (!target) throw new Error('beginGLFrame 返回 null（GL 管线不可用或已降级）');
        const gl = cm.gl;
        gl.clearColor(0.008, 0.012, 0.024, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const time = frame / 60; // 确定性时间轴（模拟 2 秒 @60fps）
        const ang = time * 0.05; // 与 BattleRenderer 相同的环绕运镜公式
        const camPos = [Math.sin(ang) * 4.5, 6.2, 10.5 - Math.cos(ang) * 2.0];
        const camTarget = [0, 0, 0];
        const t0 = performance.now();
        battle3d.draw(gl, target.width, target.height, data, { time, camPos, camTarget, tier: 1 });
        drawTimes.push(performance.now() - t0);
        cm.endGLFrame({ bloom: 1.1, exposure: 1.05, time });
      } catch (e) {
        errors.push('第 ' + frame + ' 帧绘制异常: ' + errMsg(e));
        settle();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  result.frameTimesMs = frameTimes.map((v) => roundN(v, 2));
  result.drawMsAvg = drawTimes.length
    ? roundN(drawTimes.reduce((a, b) => a + b, 0) / drawTimes.length, 2)
    : null;
  result.glObjectsTracked = countTracked(cm.glc).total;

  // 统计（排除前 warmup 帧预热）
  const measured = frameTimes.slice(warmup);
  if (measured.length < frames - warmup) {
    errors.push('帧采样不完整（' + measured.length + '/' + (frames - warmup) + '），压测未有效执行');
  } else {
    const sum = measured.reduce((a, b) => a + b, 0);
    const avgMs = sum / measured.length;
    const maxMs = Math.max.apply(null, measured);
    result.avgFps = roundN(1000 / Math.max(avgMs, 0.001), 1);
    result.minFps = roundN(1000 / Math.max(maxMs, 0.001), 1);
    if (result.avgFps < AVG_FPS_MIN) {
      errors.push('avgFps ' + result.avgFps + ' < ' + AVG_FPS_MIN);
    }
    if (result.minFps < MIN_FPS_MIN) {
      errors.push('minFps ' + result.minFps + ' < ' + MIN_FPS_MIN);
    }
  }

  result.pass = errors.length === 0;

  // 清理：不调用 battle3d.destroy() —— 它会整体销毁共享的 GLContext（含 CanvasManager
  // 的 PostProcessor 资源）；battle3d 登记的全部 GL 资源在 cm.glc._tracked 中，
  // 由 cm.dispose() 统一回收，与 BattleRenderer 的真实卸载路径一致。
  cm.dispose();
  return result;
}

// —— 入口 ———————————————————————————————————————————————————————————————————————

/**
 * 单项门禁崩溃隔离：任一门禁抛出未捕获异常时收敛为该形状的失败结果，不拖垮整份报告。
 * @param {Function} fn 门禁执行函数
 * @param {Function} makeFallback 失败兜底形状（含该门禁契约字段的默认值）
 */
async function runSafely(fn, makeFallback) {
  try {
    return await fn();
  } catch (e) {
    const base = makeFallback();
    base.errors.push('门禁执行崩溃: ' + ((e && e.stack) ? e.stack : errMsg(e)));
    base.pass = false;
    return base;
  }
}

/**
 * 运行全部三项图形门禁（顺序执行：三项各自挂载/释放独立的 CanvasManager，互不污染）。
 * @param {HTMLElement} container 挂载 CanvasManager 的 DOM 元素（需有非零布局尺寸）
 * @param {{switches?:number, ships?:number, projectiles?:number, frames?:number, warmup?:number}} [opts]
 * @returns {Promise<{results:{leak:object, ctxLoss:object, stress:object, allPass:boolean}}>}
 */
export async function runGateTests(container, opts = {}) {
  if (!container || typeof container.appendChild !== 'function') {
    throw new Error('[glGateTest] runGateTests 需要传入挂载 CanvasManager 的容器元素');
  }
  const cfg = Object.assign({}, DEFAULT_OPTS, opts || {});
  setProgress(null, 0, '准备运行');
  const leak = await runSafely(
    () => gateLeakSwitches(container, cfg),
    () => ({ pass: false, switches: cfg.switches, heap0MB: null, heap1MB: null, heapDeltaMB: null, glObjects0: 0, glObjects1: 0, errors: [] }),
  );
  const ctxLoss = await runSafely(
    () => gateContextLoss(container, cfg),
    () => ({ pass: false, degradedAfterLoss: false, restoredAfterRestore: false, errors: [], notes: [] }),
  );
  const stress = await runSafely(
    () => gateBattleStress(container, cfg),
    () => ({ pass: false, shipCount: cfg.ships, avgFps: null, minFps: null, frameTimesMs: [], errors: [], notes: [] }),
  );
  const results = {
    leak,
    ctxLoss,
    stress,
    allPass: !!(leak.pass && ctxLoss.pass && stress.pass),
  };
  setProgress(null, 0, results.allPass ? '全部通过' : '存在未通过项');
  return { results };
}

// —— 地表渲染诊断（doc7 §2.2 三档诊断模式 / doc6 §3.3 状态快照） ——————————————————

/**
 * 地表渲染器操作钩子的存活探测（钩子由 PlanetSurface3D.init() 注册到
 * window.__vfSurfaceDebug，destroy() 注销 —— 仅当地表视图已挂载且持有 GL 时存在）。
 */
function surfaceHook() {
  if (typeof window === 'undefined' || !window.__vfSurfaceDebug) return null;
  return window.__vfSurfaceDebug;
}

/**
 * 设置当前挂载地表渲染器的诊断模式（0=off 1=unlit_nocull 2=wireframe_normal
 * 3=winding_audit）。未挂载地表视图时返回 { ok:false }，不抛错。
 * @param {number} mode
 * @returns {{ok:boolean, debugMode?:number, reason?:string}}
 */
export function surfaceSetDebugMode(mode) {
  const hook = surfaceHook();
  if (!hook) return { ok: false, reason: '地表渲染器未挂载（window.__vfSurfaceDebug 不存在；需先进入地表视图）' };
  try {
    return { ok: true, debugMode: hook.setDebugMode(mode) };
  } catch (e) {
    return { ok: false, reason: errMsg(e) };
  }
}

/** 循环诊断模式 0→1→2→3→0（契约同 surfaceSetDebugMode）。 */
export function surfaceCycleDebugMode() {
  const hook = surfaceHook();
  if (!hook) return { ok: false, reason: '地表渲染器未挂载（window.__vfSurfaceDebug 不存在；需先进入地表视图）' };
  try {
    return { ok: true, debugMode: hook.cycleDebugMode() };
  } catch (e) {
    return { ok: false, reason: errMsg(e) };
  }
}

/**
 * 采集 GL 状态快照（JSON-able：浏览器/GPU/viewport/FBO 附件/剔除与深度状态/
 * getError/地形顶点与三角形数/区块数/drawCalls）。未挂载时 snapshot 为 null。
 * @returns {{ok:boolean, snapshot:object|null, reason?:string}}
 */
export function surfaceGLSnapshot() {
  const hook = surfaceHook();
  if (!hook) return { ok: false, snapshot: null, reason: '地表渲染器未挂载（window.__vfSurfaceDebug 不存在；需先进入地表视图）' };
  try {
    return { ok: true, snapshot: hook.getSnapshot() };
  } catch (e) {
    return { ok: false, snapshot: null, reason: errMsg(e) };
  }
}
