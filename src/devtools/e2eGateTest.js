/**
 * devtools/e2eGateTest.js — doc5 §5 浏览器级端到端验收矩阵（18 刚性场景）
 *
 * 配套页面：tests/tools/e2e-gate-test.html（dev-server 根目录启动后访问
 * http://127.0.0.1:8093/tests/tools/e2e-gate-test.html —— 仅支持 HTTP 模块加载，
 * 不支持 file:// 直开）。页面自动 boot 真实 App（scenarioFactory 种子 24601），
 * 依序执行可自动化子集，逐行输出 id / PASS|FAIL|MANUAL / detail。
 *
 * 覆盖矩阵（doc5 §5 全 18 项 + 2 项真实时序地形项）：
 *   自动（auto，浏览器内实测）：
 *     UI-01 银河双击进入星系      — 画布派发 dblclick @母星系拾取点 → hash === '#/system/<id>'
 *     UI-02 星系单击行星联动      — 画布派发 click @行星拾取点 → app.selection=planet 且路由不变
 *     UI-04 管理视图侧栏退避      — 遍历 11 个管理视图：内容左缘 ≥ 56px 且与 .vf-sidebar 无水平交集
 *     UI-05 侧栏展开/收起一致性   — .vf-sidebar.expanded → .vf-view padding-left 198px；移除 → 68px
 *     UI-06 折叠面板跨快照保持    — 折叠首面板 → 强制重建 ×10（间隔 260ms ≥ 2.5s 跨度）→ is-collapsed 恒定
 *     UI-07 快照刷新滚动保持      — .vf-float-panel scrollTop=180 → 强制重建 ×2 → scrollTop === 180
 *     NAV-01 银河→星系→地表往返   — 行星卡「登陆行星地表」→ 简报「← 返回 xx 星系」→ 精确回原星系
 *     NAV-02 未殖民行星准入       — 简报下拉含「未殖民 · 可勘探」选项 + 「自由探索模式」按钮可用
 *     NAV-03 地表简报 Escape 逃逸 — window 派发 Escape keydown → 立即退回所属星系路由
 *     NAV-04 跨视图 Inspector 清理 — app.select('system') 开抽屉 → goto ground → .vf-inspector[hidden]
 *   模拟（simulated，隔离世界，不触碰在玩存档）：
 *     EVT-01 航线劫掠生成空间目标 — fireEvent(evt_pirate_raid) on createStarterCampaign 副本
 *                                   → objectives 新增 active 实体 + 合法 target/secondarySystemId
 *     WORLD-03 POI 双次构建一致   — 同种子双世界 + 同行星两次 ensurePlanetPois → JSON 逐位一致
 *   静态（static，源码级确定性断言）：
 *     GL-01 大气辉光矩阵契约      — GLOW_VERT：gl_Position 仅左乘局部坐标一次（uMVP*local，
 *                                   无 uMVP*(uModel*local) 二次复合）；PLANET_VERT 同契约；
 *                                   GL 激活时附加校验 System3D._p.glow/.planet uniform 表
 *   手动（manual，pass=null）：
 *     UI-03 / EVT-02 / WORLD-02 / SAVE-03 / E2E-02（doc5 剩余场景，理由见 E2E_CASES）
 *     TERRAIN-07（10 分钟鬼影）/ TERRAIN-09（FPS 采样）— 真实 WebGL 时序，超出本页面范围
 *
 * 导出契约：
 *   runE2E(opts) → Promise<{ results, allPass, summary, meta }>
 *     results: [{ id, title, kind, pass(true|false|null), detail, ms }]（按 doc5 §5 表序）
 *   E2E_CASES：矩阵元数据（页面渲染与 Node 侧冒烟共用）
 *   analyzeGlowSource(srcText)：GL-01 的纯函数断言核（无 DOM，可 Node 单测）
 *
 * 窗口钩子（由页面安装）：
 *   window.__vfE2E = { run, results, allPass } —— 自动化直接读取。
 *
 * 约束：顶层零副作用、不触碰 document/window（runE2E 函数体内除外）；
 * 禁 Math.random；对视图私有字段（_dossierSigVal/_pickList/_renderer）的访问仅为
 * 只读探测与确定性重建探针，不写世界状态。本文件不修改任何被测源码。
 */

import { uiState } from '../ui/state/UIStateStore.js';
import { parseHash } from '../app/Router.js';

/** 默认战役种子（与 scenarioFactory 缺省一致，保证可复现） */
export const DEFAULT_SEED = 24601;

/** doc5 §3.3：11 个非沉浸管理视图（galaxy/system/combat/ground/menu 为沉浸式） */
export const MANAGEMENT_SCREENS = [
  'colony', 'fleet', 'designer', 'research', 'market',
  'diplomacy', 'government', 'events', 'chronicle', 'settings', 'diagnostics',
];

/** UI-04 左缘安全判据（.vf-sidebar right = 10+46 = 56px；判据留 0.5px 容差） */
const SAFE_LEFT_MIN = 56;
/** UI-05 期望 padding-left（--vf-safe-left-expanded / --vf-safe-left-collapsed） */
const PAD_EXPANDED = 198;
const PAD_COLLAPSED = 68;
/** UI-06：快照推进次数与间隔（10 × 260ms ≈ 2.6s ≥ doc5 的 2.5s 跨度要求） */
const SNAPSHOT_ROUNDS = 10;
const SNAPSHOT_GAP_MS = 260;

/**
 * doc5 §5 全矩阵元数据（渲染顺序 = 表序；执行顺序由 runE2E 内部编排）。
 * kind: auto=浏览器实测 | simulated=隔离世界模拟 | static=源码级断言 | manual=手动
 */
export const E2E_CASES = [
  { id: 'UI-01', title: '银河双击进入星系', kind: 'auto' },
  { id: 'UI-02', title: '星系单击行星联动', kind: 'auto' },
  {
    id: 'UI-03', title: '星系双击行星聚焦', kind: 'manual',
    detail: '需真实 WebGL 相机收敛测量（System3D focusCur/distCur 指数阻尼收敛至 targetDist=radius×9.5）。'
      + '手动：星系视图双击行星 → 观察运镜平滑聚焦该行星轨道 + 右侧行星折叠卡强制展开；双击空白复位全景。',
  },
  { id: 'GL-01', title: '多轨道位置大气辉光对齐', kind: 'static' },
  { id: 'UI-04', title: '管理页面与侧栏退避', kind: 'auto' },
  { id: 'UI-05', title: '导航栏展开与收起一致性', kind: 'auto' },
  { id: 'UI-06', title: '折叠面板跨快照状态保持', kind: 'auto' },
  { id: 'UI-07', title: '快照刷新期间滚动条保持', kind: 'auto' },
  { id: 'NAV-01', title: '银河→星系→地表往返', kind: 'auto' },
  { id: 'NAV-02', title: '未殖民行星直接登陆勘探', kind: 'auto' },
  { id: 'NAV-03', title: '地表简报 Escape 逃逸', kind: 'auto' },
  { id: 'NAV-04', title: '跨视图 Inspector 自动清理', kind: 'auto' },
  { id: 'EVT-01', title: '航线劫掠生成空间目标', kind: 'simulated' },
  {
    id: 'EVT-02', title: '事件一键派遣舰队', kind: 'manual',
    detail: '需事件目标卡点击 + OrderFleetMove 命令管线 + 舰队 transit 断言，事件触发依赖运行期世界状态。'
      + '手动：触发 evt_pirate_raid → 目标卡「一键派遣最近护航舰队」→ 舰队进入 transit 且路径指向目标星系。',
  },
  {
    id: 'WORLD-02', title: '千种子天体分布统计', kind: 'manual',
    detail: '1,000 种子批量统计（行星数 [2,8] 均值 5、moons/belts 按恒星光谱生成率）由 Node 套件 '
      + 'tests/suites/celestial-bodies.suite.js 覆盖；浏览器页面不重复承担批量生成耗时。手动：npm test 查看该套件结果。',
  },
  { id: 'WORLD-03', title: '同一星球多次进出 POI 持久', kind: 'simulated' },
  {
    id: 'SAVE-03', title: 'POI 采样后存档恢复幂等', kind: 'manual',
    detail: 'SaveCodec 序列化往返归 persistence 域测试覆盖。手动：地表采样 POI 获奖奖励 → 存档 → 读档 → '
      + '再次交互该 POI → 应返回 ALREADY_HARVESTED 且 rewardPaid === true 不重复发奖。',
  },
  {
    id: 'E2E-02', title: '扫描→登陆→探索→科研全链路', kind: 'manual',
    detail: '跨 5 个域系统的完整闭环（扫描未知冰封行星 → 先遣队登陆 → 采样遗迹与深层矿脉 → researchData '
      + '入账解锁科技 → 建立前哨），由 Node 集成套件或人工跟随脚本执行。',
  },
  {
    id: 'TERRAIN-07', title: '10 分钟持续渲染鬼影', kind: 'manual',
    detail: '真实时间窗长时渲染检查（doc6 地形门禁），超出自动化页面范围。手动：地表视图连续渲染 10 分钟观察残影。',
  },
  {
    id: 'TERRAIN-09', title: '地表 FPS 采样', kind: 'manual',
    detail: '真实 WebGL 时序采样（doc6 地形门禁；战场同类压测已由 tests/tools/gl-gate-test.html 门禁 3 覆盖）。'
      + '手动：地表视图运行 ≥10 秒读取 FPS 均值/最低值。',
  },
];

// —— 通用工具（仅函数体内触碰浏览器全局） ————————————————————————————————————

/** 等待 ms（setTimeout 兜底保证后台标签页也能推进） */
function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/** 下一帧：rAF 优先，60ms setTimeout 兜底（后台标签 rAF 停发时不挂死） */
function nextFrame() {
  return new Promise((resolve) => {
    let done = false;
    const settle = () => { if (!done) { done = true; resolve(); } };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(settle);
    setTimeout(settle, 60);
  });
}

/** 连续推进 n 帧 */
async function frames(n) {
  for (let i = 0; i < n; i++) await nextFrame();
}

/**
 * 轮询等待条件成立；超时返回 false（不抛错，由用例自行判定）。
 * @param {Function} cond 条件函数
 * @param {number} [timeoutMs=3000]
 */
async function waitFor(cond, timeoutMs = 3000) {
  const deadline = performance.now() + timeoutMs;
  while (!cond()) {
    if (performance.now() > deadline) return false;
    await nextFrame();
  }
  return true;
}

/** 数值取整 n 位（非有限值返回 null） */
function roundN(v, n = 1) {
  if (v == null || !Number.isFinite(v)) return null;
  const p = Math.pow(10, n);
  return Math.round(v * p) / p;
}

/** 错误消息格式化 */
function errMsg(e) {
  return (e && e.message) ? e.message : String(e);
}

/**
 * 路由跳转并等待视图激活（goto → hashchange 异步 → _onRoute 同步挂载 → 补 2 帧）。
 * @returns {Promise<boolean>} 是否在超时内到达目标路由
 */
async function routeTo(app, screen, param = null) {
  app.goto(screen, param);
  const target = `#/${screen}${param ? '/' + param : ''}`;
  // hash 同步赋值、hashchange 异步派发：须同时等 hash 与活动视图就绪
  const arrived = await waitFor(() => location.hash === target
    && !!app._activeViewObj && app._activeViewObj.id === screen, 3000);
  await frames(2);
  return arrived;
}

/** 在元素树内按精确/包含文本查按钮 */
function findButton(root, textExact, textIncludes) {
  const btns = Array.from((root || document).querySelectorAll('button'));
  return btns.find((b) => {
    const t = (b.textContent || '').trim();
    if (textExact != null) return t === textExact;
    return t.includes(textIncludes);
  }) || null;
}

// —— GL-01：GLOW_VERT / PLANET_VERT 矩阵契约源码断言（纯函数，Node 可测） ————————

/**
 * 从 System3D.js 源码文本提取 GLOW_VERT / PLANET_VERT 并校验 doc5 §3.1 矩阵契约：
 *  - GLOW_VERT：局部坐标声明为 vec4(aPos * uRadius, 1.0)；gl_Position 仅左乘
 *    uMVP * local 一次；uModel 只用于 vWorld/vN；禁止回归模式 uMVP * w（平移平方 → 2C 漂移）。
 *  - PLANET_VERT：gl_Position = uMVP * vec4(aPos, 1.0)（局部坐标直接左乘）。
 * @param {string} srcText System3D.js 全文
 * @returns {{ok:boolean, glow:{found:boolean, checks: {name:string, pass:boolean, got?:string}[]},
 *            planet:{found:boolean, checks: {name:string, pass:boolean, got?:string}[]}}}
 */
export function analyzeGlowSource(srcText) {
  const src = String(srcText || '');
  const out = {
    ok: false,
    glow: { found: false, checks: [] },
    planet: { found: false, checks: [] },
  };

  const extract = (name) => {
    const re = new RegExp('const ' + name + '\\s*=\\s*`([\\s\\S]*?)`;');
    const m = src.match(re);
    return m ? m[1] : null;
  };

  // —— GLOW_VERT ——
  const glow = extract('GLOW_VERT');
  out.glow.found = !!glow;
  if (glow) {
    const g = out.glow.checks;
    const localDecl = /vec4\s+local\s*=\s*vec4\s*\(\s*aPos\s*\*\s*uRadius\s*,\s*1\.0\s*\)/.test(glow);
    g.push({ name: 'local=vec4(aPos*uRadius,1.0)', pass: localDecl });
    const pos = glow.match(/gl_Position\s*=\s*([^;]+);/);
    const posExpr = pos ? pos[1].trim() : '';
    g.push({ name: 'gl_Position 存在', pass: !!pos, got: posExpr });
    g.push({ name: 'gl_Position=uMVP*local（单次左乘）', pass: /^uMVP\s*\*\s*local$/.test(posExpr), got: posExpr });
    g.push({ name: 'gl_Position 不含 uModel（无二次复合）', pass: !!pos && !/uModel/.test(posExpr), got: posExpr });
    g.push({ name: '无回归模式 uMVP*w', pass: !/uMVP\s*\*\s*w\b/.test(glow) });
  }

  // —— PLANET_VERT ——
  const planet = extract('PLANET_VERT');
  out.planet.found = !!planet;
  if (planet) {
    const p = out.planet.checks;
    const pos = planet.match(/gl_Position\s*=\s*([^;]+);/);
    const posExpr = pos ? pos[1].trim() : '';
    p.push({ name: 'gl_Position 存在', pass: !!pos, got: posExpr });
    p.push({
      name: 'gl_Position=uMVP*vec4(aPos,1.0)',
      pass: /^uMVP\s*\*\s*vec4\s*\(\s*aPos\s*,\s*1\.0\s*\)$/.test(posExpr),
      got: posExpr,
    });
  }

  out.ok = out.glow.found && out.planet.found
    && out.glow.checks.every((c) => c.pass)
    && out.planet.checks.every((c) => c.pass);
  return out;
}

/**
 * GL-01 活体附加断言（best-effort）：SystemView GL 通道激活时读取 System3D 程序表
 * （_p.glow / _p.planet 的 uniform 位置缓存）与行星拾取清册。
 * @param {object} systemView 已挂载的 SystemView（app._activeViewObj）
 * @returns {{glMode:boolean, glowUniforms:string[], planetUniforms:string[],
 *            pickListCount:number, note:string}}
 */
export function probeSystemGL(systemView) {
  const res = {
    glMode: false, glowUniforms: [], planetUniforms: [], pickListCount: 0, note: '',
  };
  try {
    const r = systemView && systemView._renderer;
    const s3d = r && r._s3d;
    res.glMode = !!(s3d && s3d._p && s3d._p.glow);
    if (res.glMode) {
      res.glowUniforms = Object.keys(s3d._p.glow.u || {});
      res.planetUniforms = Object.keys((s3d._p.planet && s3d._p.planet.u) || {});
    } else {
      res.note = 'System3D GL 通道未激活（环境无 WebGL2 或已降级 2D）——仅执行静态源码断言';
    }
    res.pickListCount = (r && Array.isArray(r._pickList)) ? r._pickList.length : 0;
  } catch (e) {
    res.note = '活体探测异常: ' + errMsg(e);
  }
  return res;
}

// —— 用例执行核 ——————————————————————————————————————————————————————————————

/**
 * 创建结果表（doc5 §5 表序），执行期间逐项回填 pass/detail/ms。
 * @returns {{rows: object[], set: (id:string, pass:boolean|null, detail:string, ms?:number)=>void}}
 */
function makeResultRows() {
  const rows = E2E_CASES.map((c) => ({
    id: c.id,
    title: c.title,
    kind: c.kind,
    pass: null, // auto/simulated/static 执行后回填 true|false；manual 恒为 null
    detail: c.detail || '',
    ms: 0,
  }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    rows,
    set(id, pass, detail, ms) {
      const r = byId.get(id);
      if (!r) return;
      if (pass !== null) r.pass = !!pass;
      if (detail != null && detail !== '') {
        r.detail = r.detail ? r.detail + ' — ' + detail : detail;
      }
      if (ms != null) r.ms = roundN(ms, 0);
    },
  };
}

/** 用例包裹：计时 + 异常隔离（单用例崩溃收敛为 FAIL，不拖垮整份报告） */
async function runCase(api, id, fn) {
  const t0 = performance.now();
  try {
    const detail = await fn();
    api.set(id, true, typeof detail === 'string' ? detail : '', performance.now() - t0);
  } catch (e) {
    api.set(id, false, errMsg(e) + (e && e.stack ? ' @ ' + String(e.stack).split('\n')[1] : ''), performance.now() - t0);
  }
}

/** 断言（失败即抛，由 runCase 捕获为 FAIL detail） */
function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}

/**
 * 用例上下文准备：母星系/母星/一颗未殖民行星。
 */
function resolveAnchors(app) {
  const w = app.world;
  const fac = w.entities.factions[w.playerFactionId];
  const homeSysId = fac.homeSystemId;
  const homePlanetId = fac.homePlanetId || null;
  const sys = w.entities.systems[homeSysId];
  const uncolonized = (sys.planetIds || [])
    .map((pid) => w.entities.planets[pid])
    .find((p) => p && !p.colonyId) || null;
  return { homeSysId, homePlanetId, uncolonizedPlanetId: uncolonized ? uncolonized.id : null };
}

/**
 * 等待渲染器拾取清册中出现目标条目（视图 rAF 循环每帧刷新 _pickList）。
 * @returns {Promise<object|null>}
 */
async function waitForPickEntry(view, listKey, matchFn, timeoutMs = 3000) {
  let found = null;
  const ok = await waitFor(() => {
    const list = (view && view._renderer && view._renderer[listKey]) || [];
    found = list.find(matchFn) || null;
    return !!found;
  }, timeoutMs);
  return ok ? found : null;
}

/** 在画布上以渲染器逻辑坐标派发鼠标事件（视图 toLocal 的逆映射） */
function dispatchCanvasMouse(view, type, lx, ly) {
  const canvas = view._cm.canvas;
  const rect = canvas.getBoundingClientRect();
  const k = rect.width / Math.max(1, view._cm.width); // CSS / 逻辑像素比
  const clientX = rect.left + lx * k;
  const clientY = rect.top + ly * k;
  canvas.dispatchEvent(new MouseEvent(type, {
    bubbles: true, cancelable: true, view: window, button: 0, clientX, clientY,
  }));
  return { clientX, clientY };
}

/**
 * UI-01：银河画布 dblclick @母星系拾取点 → hash === '#/system/<id>' 且 SystemView 激活。
 */
async function caseUI01(app, anchor) {
  await routeTo(app, 'galaxy');
  const gv = app._activeViewObj;
  assert(gv && gv.id === 'galaxy', 'galaxy 视图未激活（got ' + (gv && gv.id) + '）');
  const entry = await waitForPickEntry(
    gv, '_pickList',
    (e) => e.id === anchor.homeSysId && e.vis !== false,
  );
  assert(entry, 'GalaxyRenderer._pickList 未出现母星系条目（' + anchor.homeSysId + '）');
  dispatchCanvasMouse(gv, 'dblclick', entry.sx, entry.sy);
  const target = '#/system/' + anchor.homeSysId;
  const ok = await waitFor(() => location.hash === target, 3000);
  assert(ok, '双击后 hash 未切换（got ' + location.hash + '，期望 ' + target + '）');
  await frames(2);
  const sv = app._activeViewObj;
  assert(sv && sv.id === 'system', 'SystemView 未激活（got ' + (sv && sv.id) + '）');
  assert(sv._systemId === anchor.homeSysId, 'SystemView._systemId=' + sv._systemId + ' ≠ ' + anchor.homeSysId);
  return 'dblclick@(' + roundN(entry.sx) + ',' + roundN(entry.sy) + ') → ' + location.hash;
}

/**
 * UI-02：SystemView 画布 click @行星拾取点 → app.selection={planet,id}、卡片高亮、路由不变。
 */
async function caseUI02(app, anchor) {
  const sv = app._activeViewObj;
  assert(sv && sv.id === 'system', '前置：SystemView 未激活');
  const hashBefore = location.hash;
  let hit = null;
  for (let attempt = 0; attempt < 8 && !hit; attempt++) {
    const entry = await waitForPickEntry(
      sv, '_pickList',
      (e) => !!e.id && e.x != null && e.y != null,
      1500,
    );
    if (!entry) break;
    dispatchCanvasMouse(sv, 'click', entry.x, entry.y);
    await frames(1);
    const sel = app.selection;
    if (sel && sel.kind === 'planet') hit = sel.id;
  }
  assert(hit, '画布 click 未命中行星（app.selection=' + JSON.stringify(app.selection) + '）');
  assert(location.hash === hashBefore, '路由发生跳变（' + hashBefore + ' → ' + location.hash + '）');
  const card = sv._planetCards && sv._planetCards.get(hit);
  const highlighted = !!(card && card.style.borderColor);
  assert(highlighted, '行星卡未获得高亮边框（planetId=' + hit + '）');
  return 'click → selection={kind:planet,id:' + hit + '}，路由保持 ' + hashBefore + '，卡片高亮已设置';
}

/**
 * GL-01：源码级矩阵契约（analyzeGlowSource）+ GL 激活时的活体 uniform/拾取清册附加校验。
 */
async function caseGL01(app) {
  const url = new URL('../render/gl/System3D.js', import.meta.url);
  const resp = await fetch(url);
  assert(resp.ok, 'System3D.js 源码拉取失败：HTTP ' + resp.status);
  const analysis = analyzeGlowSource(await resp.text());
  const glowFails = analysis.glow.checks.filter((c) => !c.pass);
  const planetFails = analysis.planet.checks.filter((c) => !c.pass);
  assert(analysis.ok, 'GLOW_VERT/PLANET_VERT 契约断言失败：'
    + JSON.stringify(glowFails.concat(planetFails)));
  const sv = app._activeViewObj;
  const live = (sv && sv.id === 'system') ? probeSystemGL(sv) : { glMode: false, note: 'SystemView 未激活' };
  if (live.glMode) {
    const needGlow = ['uMVP', 'uModel', 'uRadius', 'uCenter', 'uTint', 'uPower'];
    const missing = needGlow.filter((u) => !live.glowUniforms.includes(u));
    assert(missing.length === 0, 'glow 程序缺 uniform：' + missing.join(','));
    assert(live.pickListCount > 0, 'SystemRenderer 拾取清册为空');
    return '静态契约 9/9 通过；GL 激活：glow uniforms[' + live.glowUniforms.join(',') + ']，pickList=' + live.pickListCount;
  }
  return '静态契约 9/9 通过（' + (live.note || 'GL 未激活，仅静态断言') + '）';
}

/**
 * UI-06：折叠首面板 → 10 轮强制重建（间隔 260ms，总跨度 ≈2.6s）→ .is-collapsed 恒定。
 * 重建探针：SystemView._dossierSigVal 置空强制 _buildDossier 走完整
 * preserveScrollAndFocus → clearEl → panel() 重建路径（与 doc5「连续 10 次 onSnapshot」
 * 等价且不受世界状态波动影响；只影响前端重建判定，不写世界）。
 */
async function caseUI06(app) {
  const sv = app._activeViewObj;
  assert(sv && sv.id === 'system' && sv._dossier, '前置：SystemView 情报舱未挂载');
  const first = sv._dossier.querySelector('.vf-panel');
  assert(first, '情报舱内未找到 .vf-panel');
  const pid = first.dataset.panelId || '';
  assert(!!pid, '面板缺 data-panel-id（UIStateStore 稳定键未接线）');
  const toggle = first.querySelector('.vf-panel-toggle');
  assert(toggle, '面板缺折叠按钮');
  toggle.click();
  await frames(1);
  assert(first.classList.contains('is-collapsed'), '点击折叠后 .is-collapsed 未生效');
  assert(uiState.isPanelOpen(pid, true) === false, '折叠态未持久化进 UIStateStore');
  await sleep(SNAPSHOT_GAP_MS); // 脱离 onSnapshot 250ms 节流窗，保证后续每轮真实重建
  const states = [];
  for (let i = 0; i < SNAPSHOT_ROUNDS; i++) {
    sv._dossierSigVal = null; // 确定性重建探针（见函数注释）
    app.refreshSnapshot();
    await frames(1);
    const cur = sv._dossier.querySelector('.vf-panel[data-panel-id="' + pid + '"]');
    states.push(!!(cur && cur.classList.contains('is-collapsed')));
    if (i < SNAPSHOT_ROUNDS - 1) await sleep(SNAPSHOT_GAP_MS);
  }
  const kept = states.filter(Boolean).length;
  assert(kept === SNAPSHOT_ROUNDS,
    '跨 ' + SNAPSHOT_ROUNDS + ' 轮快照重建折叠态保持 ' + kept + '/' + SNAPSHOT_ROUNDS);
  assert(uiState.isPanelOpen(pid, true) === false, '终点复查：UIStateStore 记录被重建回写');
  return '面板[' + pid + ']折叠 → ' + SNAPSHOT_ROUNDS + ' 轮强制重建（'
    + roundN(SNAPSHOT_ROUNDS * SNAPSHOT_GAP_MS / 1000, 1) + 's 跨度）is-collapsed ' + kept + '/' + SNAPSHOT_ROUNDS + ' 恒定';
}

/**
 * UI-07：.vf-float-panel scrollTop=180 → 快照强制重建 ×2 → scrollTop 保持 180。
 */
async function caseUI07(app) {
  const sv = app._activeViewObj;
  assert(sv && sv.id === 'system' && sv._dossier, '前置：SystemView 情报舱未挂载');
  // 复原 UI-06 折叠的首面板，保证情报舱内容足够滚动
  const first = sv._dossier.querySelector('.vf-panel');
  if (first && first.classList.contains('is-collapsed')) {
    const t = first.querySelector('.vf-panel-toggle');
    if (t) t.click();
  }
  await frames(1);
  const fp = sv._dossier;
  const maxScroll = fp.scrollHeight - fp.clientHeight;
  assert(maxScroll >= 180, '情报舱不可滚至 180px（maxScroll=' + maxScroll + '，内容不足）');
  fp.scrollTop = 180;
  await frames(1);
  assert(fp.scrollTop === 180, 'scrollTop 设置未生效（got ' + fp.scrollTop + '）');
  for (let i = 0; i < 2; i++) {
    sv._dossierSigVal = null; // 同 UI-06 的确定性重建探针
    app.refreshSnapshot();
    await frames(1);
    assert(fp.scrollTop === 180,
      '第 ' + (i + 1) + ' 次快照刷新后 scrollTop=' + fp.scrollTop + ' ≠ 180（滚动保持失效）');
  }
  return 'scrollTop=180 经 2 轮强制重建后保持（maxScroll=' + maxScroll + '）';
}

/**
 * UI-04：遍历 11 个管理视图 — 内容左缘 ≥ 56px 且与 .vf-sidebar 无水平交集、非沉浸式。
 */
async function caseUI04(app) {
  const sidebar = document.getElementById('vf-sidebar');
  assert(sidebar, '#vf-sidebar 不存在');
  const perView = [];
  for (const screen of MANAGEMENT_SCREENS) {
    const ok = await routeTo(app, screen);
    assert(ok, '路由 ' + screen + ' 未在超时内到达（hash=' + location.hash + '）');
    const viewRoot = app.mainEl && app.mainEl.querySelector('.vf-view');
    assert(viewRoot, screen + ' 视图根 .vf-view 不存在');
    const immersive = viewRoot.classList.contains('vf-view-immersive');
    assert(!immersive, screen + ' 被标记为沉浸式（vf-view-immersive），管理视图集合定义不符');
    const body = viewRoot.querySelector('.vf-view-body');
    assert(body, screen + ' 缺 .vf-view-body');
    const sideRight = sidebar.getBoundingClientRect().right;
    let minLeft = body.getBoundingClientRect().left;
    for (const child of body.children) {
      if (!(child instanceof Element)) continue;
      const r = child.getBoundingClientRect();
      if (r.width > 0 && r.left < minLeft) minLeft = r.left;
    }
    const head = viewRoot.querySelector('.vf-view-head');
    if (head) {
      const hr = head.getBoundingClientRect();
      if (hr.width > 0 && hr.left < minLeft) minLeft = hr.left;
    }
    const clearanceOk = minLeft >= SAFE_LEFT_MIN - 0.5;
    const noOverlap = minLeft >= sideRight - 0.5;
    perView.push(screen + ' ' + roundN(minLeft) + 'px' + (clearanceOk && noOverlap ? '' : ' ← 违规'));
    if (!clearanceOk) {
      throw new Error(screen + ' 内容左缘 ' + roundN(minLeft) + 'px < ' + SAFE_LEFT_MIN + 'px 安全距离');
    }
    if (!noOverlap) {
      throw new Error(screen + ' 内容左缘 ' + roundN(minLeft) + 'px 与侧栏右缘 ' + roundN(sideRight) + 'px 交叠');
    }
  }
  await routeTo(app, 'galaxy'); // 还原沉浸式视图，供后续用例使用
  return MANAGEMENT_SCREENS.length + '/' + MANAGEMENT_SCREENS.length + ' 视图左缘 ≥' + SAFE_LEFT_MIN
    + 'px 且与侧栏（右缘 ' + roundN(sidebar.getBoundingClientRect().right) + 'px）零交叠 ['
    + perView.join(' | ') + ']';
}

/**
 * UI-05：.vf-sidebar 加 .expanded → 管理视图 computed padding-left 198px；移除 → 68px。
 */
async function caseUI05(app) {
  await routeTo(app, 'research');
  const sidebar = document.getElementById('vf-sidebar');
  const viewRoot = app.mainEl && app.mainEl.querySelector('.vf-view');
  assert(viewRoot && !viewRoot.classList.contains('vf-view-immersive'), '管理视图未激活');
  const padOf = () => parseFloat(getComputedStyle(viewRoot).paddingLeft);
  await sleep(60);
  const base = padOf();
  sidebar.classList.add('expanded');
  await sleep(350); // transition .18s cubic-bezier 收敛后再测量
  const expanded = padOf();
  sidebar.classList.remove('expanded');
  await sleep(350);
  const collapsed = padOf();
  const near = (v, want) => Math.abs(v - want) <= 0.75;
  assert(near(expanded, PAD_EXPANDED),
    '展开态 padding-left=' + expanded + 'px ≠ ' + PAD_EXPANDED + 'px（检查 :has(.vf-sidebar.expanded) 支持）');
  assert(near(collapsed, PAD_COLLAPSED),
    '收起态 padding-left=' + collapsed + 'px ≠ ' + PAD_COLLAPSED + 'px');
  return '管理视图 padding-left ' + roundN(base) + ' → ' + roundN(expanded) + '（expanded）→ '
    + roundN(collapsed) + 'px（收起），画布容器尺寸不受影响（transform 仅作用于画布元素）';
}

/**
 * NAV-04：app.select('system') 打开检视器抽屉 → goto ground → .vf-inspector[hidden]。
 */
async function caseNAV04(app, anchor) {
  assert(anchor.uncolonizedPlanetId, '母星系中未找到未殖民行星（NAV-02 前置）');
  await routeTo(app, 'system', anchor.homeSysId);
  app.select('system', anchor.homeSysId);
  await frames(1);
  const ins = document.getElementById('vf-inspector');
  assert(ins, '#vf-inspector 不存在');
  assert(!ins.hasAttribute('hidden') && ins.classList.contains('open'),
    'app.select(system) 后抽屉未打开（hidden=' + ins.hasAttribute('hidden') + '）');
  await routeTo(app, 'ground', anchor.uncolonizedPlanetId);
  assert(ins.hasAttribute('hidden') && !ins.classList.contains('open'),
    '进入 ground 后抽屉未自动收起（hidden=' + ins.hasAttribute('hidden') + '）');
  assert(app.selection === null, '跨视图切换后 selection 未清空：' + JSON.stringify(app.selection));
  return 'system 抽屉打开 → #/ground/' + anchor.uncolonizedPlanetId + ' → .vf-inspector[hidden] 且 selection 清空';
}

/**
 * NAV-02：简报下拉含「未殖民 · 可勘探」选项、路由目标行星被预选、「自由探索模式」按钮可用。
 */
async function caseNAV02(app, anchor) {
  const main = app.mainEl;
  const sel = main.querySelector('select[data-focus-key="ground-planet-sel"]');
  assert(sel, '简报缺 select[data-focus-key="ground-planet-sel"]');
  const opts = Array.from(sel.options).map((o) => ({ value: o.value, text: o.textContent }));
  assert(opts.length > 0, '简报下拉为空（未解析到可降落目标）');
  const uncolonized = opts.find((o) => o.text.includes('未殖民'));
  assert(!!uncolonized, '下拉缺「未殖民 · 可勘探」选项：[' + opts.map((o) => o.text).join(' ; ') + ']');
  assert(sel.value === anchor.uncolonizedPlanetId,
    '路由目标行星未被预选（value=' + sel.value + '，期望 ' + anchor.uncolonizedPlanetId + '）');
  const freeBtn = findButton(main, '自由探索模式');
  assert(freeBtn, '缺「自由探索模式」按钮');
  assert(!freeBtn.disabled, '「自由探索模式」按钮被禁用');
  return '下拉 ' + opts.length + ' 项含「未殖民 · 可勘探」（' + uncolonized.text + '）；'
    + '目标行星已预选；自由探索按钮 enabled';
}

/**
 * NAV-01：简报头部「← 返回 xx 星系」→ 精确回原星系 #/system/<same>。
 */
async function caseNAV01(app, anchor) {
  const btn = findButton(app.mainEl, null, '返回');
  assert(btn && (btn.textContent || '').includes('星系'),
    '简报头部缺「← 返回 xx 星系」逃逸按钮（NAV-01/03 软锁死回归）');
  btn.click();
  const target = '#/system/' + anchor.homeSysId;
  const ok = await waitFor(() => location.hash === target, 3000);
  assert(ok, '返回按钮后未精确回到原星系（hash=' + location.hash + '，期望 ' + target + '）');
  await frames(2);
  return '简报「' + (btn.textContent || '').trim() + '」→ ' + location.hash + '（精确回跳）';
}

/**
 * NAV-03：简报模式 window 派发 Escape keydown → 立即退回所属星系路由。
 */
async function caseNAV03(app, anchor) {
  const ok = await waitFor(() => location.hash === '#/system/' + anchor.homeSysId, 3000);
  assert(ok, 'Escape 后未退回星系路由（hash=' + location.hash + '）');
  await frames(2);
  return 'KeyboardEvent(Escape) → ' + location.hash + '（简报逃逸链生效）';
}

/**
 * EVT-01（隔离世界模拟）：fireEvent(evt_pirate_raid) → objectives 新增 active 实体。
 * 全程在 createStarterCampaign 副本上执行，绝不触碰 app.world / 在玩存档。
 */
async function caseEVT01() {
  const { createStarterCampaign } = await import('./scenarioFactory.js');
  const { fireEvent } = await import('../domain/events/narrative.js');
  const { EVENT_DEFS } = await import('../content/events.js');
  const def = EVENT_DEFS.find((d) => d.id === 'evt_pirate_raid');
  assert(def, 'EVENT_DEFS 缺 evt_pirate_raid 定义');
  const world = createStarterCampaign({ seed: DEFAULT_SEED });
  const before = Object.keys(world.entities.objectives || {}).length;
  fireEvent(world, def);
  const all = Object.values(world.entities.objectives || {});
  const mine = all.filter((o) => o.sourceEventId === 'evt_pirate_raid');
  const active = mine.filter((o) => o.status === 'active');
  assert(active.length >= 1,
    '触发后无 active 目标实体（objectives ' + before + '→' + all.length + '，'
    + 'pendingChoices=' + (world.narrative.pendingChoices || []).length + '）');
  const o = active[0];
  assert(o.targetSystemId && world.entities.systems[o.targetSystemId],
    'targetSystemId 非法：' + String(o.targetSystemId));
  assert(o.secondarySystemId == null || !!world.entities.systems[o.secondarySystemId],
    'secondarySystemId 非法：' + String(o.secondarySystemId));
  assert(o.deadlineTick > world.tick, 'deadlineTick 未指向未来（' + o.deadlineTick + ' ≤ ' + world.tick + '）');
  const tgtName = (world.entities.systems[o.targetSystemId] || {}).name || o.targetSystemId;
  const secName = o.secondarySystemId
    ? ((world.entities.systems[o.secondarySystemId] || {}).name || o.secondarySystemId) : '（无）';
  return '隔离世界(seed=' + DEFAULT_SEED + ')：objectives ' + before + '→' + all.length
    + '；active[' + o.id + '] kind=' + o.kind + ' 目标=' + tgtName + ' 航路另一端=' + secName
    + ' deadline=+' + (o.deadlineTick - world.tick) + 'h';
}

/**
 * WORLD-03（隔离世界模拟）：同种子双世界开局 POI 一致 + 同行星两次 ensurePlanetPois 一致。
 */
async function caseWORLD03() {
  const { createStarterCampaign } = await import('./scenarioFactory.js');
  const { ensurePlanetPois } = await import('../domain/ground/planetPOI.js');
  const wa = createStarterCampaign({ seed: DEFAULT_SEED });
  const wb = createStarterCampaign({ seed: DEFAULT_SEED });
  const facA = wa.entities.factions[wa.playerFactionId];
  const facB = wb.entities.factions[wb.playerFactionId];
  const pa = wa.entities.planets[facA.homePlanetId];
  const pb = wb.entities.planets[facB.homePlanetId];
  assert(pa && pb, '母星实体缺失');
  assert(pa.id === pb.id, '同种子行星 id 漂移：' + pa.id + ' vs ' + pb.id);
  const ja = JSON.stringify(pa.pois || {});
  const jb = JSON.stringify(pb.pois || {});
  assert(ja === jb, '双世界同行星 POI JSON 不一致');
  // 同一星球两次重建（先清除再 ensure → 生成路径与开局逐位一致）
  delete pa.pois;
  const r1 = JSON.stringify(ensurePlanetPois(wa, pa));
  delete pa.pois;
  const r2 = JSON.stringify(ensurePlanetPois(wa, pa));
  assert(r1 === r2, '同行星两次 ensurePlanetPois 结果不一致');
  assert(r1 === ja, '重建结果与开局生成不一致');
  const pois = JSON.parse(r1);
  const keys = Object.keys(pois);
  assert(keys.length >= 1, '母星 POI 数量为 0');
  for (const k of keys) {
    const poi = pois[k];
    assert(poi.kind, 'POI 缺 kind：' + k);
    assert(poi.state === 'unexplored', 'POI 初始状态非 unexplored：' + k);
    assert(poi.rewardPaid === false, 'POI 初始 rewardPaid 非 false：' + k);
    assert(poi.position && Number.isFinite(poi.position.x) && Number.isFinite(poi.position.z)
      && poi.state === 'unexplored' && poi.rewardPaid === false,
      'POI 缺确定性场域坐标 position{x,z} 或幂等锁字段：' + k);
  }
  return '行星 ' + pa.id + '：' + keys.length + ' 个 POI（'
    + keys.map((k) => pois[k].kind + '@' + pois[k].position.x + ',' + pois[k].position.z).join(' | ')
    + '）— 双世界与双次重建 JSON 逐位一致';
}

// —— 主入口 ——————————————————————————————————————————————————————————————————

/**
 * 启动真实 App 并依序执行可自动化用例。
 * @param {{container?:HTMLElement, seed?:number}} [opts]
 *   container：App 挂载根（默认 #vf-e2e-app）；seed：战役种子（默认 24601）。
 * @returns {Promise<{results:object[], allPass:boolean, summary:string, meta:object}>}
 */
export async function runE2E(opts = {}) {
  const seed = opts.seed ?? DEFAULT_SEED;
  let container = opts.container;
  if (!container && typeof document !== 'undefined') {
    container = document.getElementById('vf-e2e-app');
  }
  const meta = { seed, booted: false, bootError: null, startedAt: new Date().toISOString(), glMode: null };
  const api = makeResultRows();

  // —— Boot：真实 App（与 main.js 同路径） ——
  let app = null;
  try {
    const { App } = await import('../app/App.js');
    const { registerAll } = await import('../content/localization/index.js');
    registerAll();
    app = new App(container);
    await app.boot();
    await app.startNewGame({ seed });
    app.setSpeed(0); // 暂停模拟：阻断运行期叙事事件弹窗干扰，快照刷新（4Hz）仍继续
    meta.booted = true;
    api.app = app;   // 自动化句柄（window.__vfE2E.app）
  } catch (e) {
    meta.bootError = errMsg(e);
    for (const r of api.rows) {
      if (r.kind !== 'manual') api.set(r.id, false, 'boot 失败：' + meta.bootError);
    }
    return finalize(api, meta);
  }

  const anchor = resolveAnchors(app);
  meta.anchors = anchor;

  // —— 执行序（渲染顺序仍为 E2E_CASES 表序）：
  //   银河(UI-01) → 星系(UI-02 → GL-01 → UI-06 → UI-07)
  //   → 管理视图(UI-04 → UI-05) → 地表(NAV-04 → NAV-02 → NAV-01 → NAV-03)
  //   → 隔离世界模拟(EVT-01 → WORLD-03，不触碰 app.world) ——
  await runCase(api, 'UI-01', () => caseUI01(app, anchor));
  await runCase(api, 'UI-02', () => caseUI02(app, anchor));
  await runCase(api, 'GL-01', () => caseGL01(app));
  const sv = app._activeViewObj;
  meta.glMode = !!(sv && sv._renderer && sv._renderer._s3d);
  if (api.rows.find((r) => r.id === 'UI-02' && r.pass)) {
    await runCase(api, 'UI-06', () => caseUI06(app));
    await runCase(api, 'UI-07', () => caseUI07(app));
  } else {
    api.set('UI-06', false, '前置失败（UI-02 未通过，跳过）');
    api.set('UI-07', false, '前置失败（UI-02 未通过，跳过）');
  }
  await runCase(api, 'UI-04', () => caseUI04(app));
  await runCase(api, 'UI-05', () => caseUI05(app));
  await runCase(api, 'NAV-04', () => caseNAV04(app, anchor));
  // NAV-04 已把路由带到 #/ground/<uncolonized> 且为简报模式（无活动任务）→ 直接断言 NAV-02
  const onBriefing = await waitFor(() => {
    const v = app._activeViewObj;
    return v && v.id === 'ground' && v.mode === 'briefing'
      && !!app.mainEl.querySelector('select[data-focus-key="ground-planet-sel"]');
  }, 3000);
  if (onBriefing) {
    await runCase(api, 'NAV-02', () => caseNAV02(app, anchor));
    await runCase(api, 'NAV-01', () => caseNAV01(app, anchor));
    // NAV-01 已回到 #/system/<home>；再次进入简报后派发 Escape
    await routeTo(app, 'ground', anchor.uncolonizedPlanetId);
    await runCase(api, 'NAV-03', async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
      }));
      return caseNAV03(app, anchor);
    });
  } else {
    for (const id of ['NAV-02', 'NAV-01', 'NAV-03']) api.set(id, false, '前置失败（ground 简报未到达）');
  }
  await runCase(api, 'EVT-01', () => caseEVT01());
  await runCase(api, 'WORLD-03', () => caseWORLD03());

  return finalize(api, meta);
}

/** 汇总收尾 */
function finalize(api, meta) {
  const autoRows = api.rows.filter((r) => r.kind !== 'manual');
  const passed = autoRows.filter((r) => r.pass === true).length;
  const failed = autoRows.filter((r) => r.pass === false).length;
  const unresolved = autoRows.filter((r) => r.pass == null).length;
  const manual = api.rows.length - autoRows.length;
  const allPass = meta.booted && autoRows.length > 0 && failed === 0 && unresolved === 0;
  const summary = autoRows.length + ' 项可自动（PASS ' + passed + ' / FAIL ' + failed
    + (unresolved ? ' / UNRESOLVED ' + unresolved : '') + '），' + manual + ' 项手动';
  return {
    app: api.app || null,   // 自动化句柄（主代理探针用）
    results: api.rows,
    allPass,
    summary,
    meta,
  };
}
