/**
 * ui/screens/SystemView.js — 星系详情视图（路由 #/system/<systemId>，R7 全屏沉浸式重构）
 *
 * 布局：.vf-view.vf-view-immersive > .vf-view-head（悬浮玻璃条：返回银河 + 标题 +
 *       总览检视）+ .vf-view-body（3D 轨道画布 SystemRenderer 占满全视口）。
 *       原右侧固定信息列移除，改为 .vf-float-panel 悬浮毛玻璃情报舱：
 *       星系档案 → 行星卡列表 → 在系舰队 → 异常列表。
 *
 * 交互：
 *  - 鼠标左键拖拽：旋转轨道相机（增量传给 SystemRenderer opts.yaw，渲染器内部
 *    俯仰固定，仅水平环绕）；
 *  - 滚轮：数字变焦（画布容器 transform: scale 1.0–2.6，拾取坐标按比例反解）；
 *  - 单击行星 → app.select('planet', id)（全局选中态联动）+ 情报舱行星卡高亮；
 *    单击空白 → 清除选中；「定位」按钮反向联动；
 *  - 头部「总览检视」→ app.select('system', id) 打开右侧全局检视器抽屉。
 *
 * 信息分层：恒星/行星情报需调查层级≥2，危险度/资源评级/矿藏需≥3（与 scan.js 语义一致）。
 *
 * 数据来源纪律：只读消费 app.snapshot / app.world（绝不写世界字段）+
 * simulation/ViewModels.js 的导出（explorationView，异常只读视图）；
 * 写操作一律经 app.dispatch（FoundOutpost / IssueScanOrder / InvestigateAnomaly）。
 *
 * onSnapshot 以 250ms 节流刷新情报舱；同视图路由参数变化（ViewRegistry 对相同
 * 视图不重新 mount）时通过 parseHash 感知并整体重建。unmount 释放画布与全部监听。
 */

import { el, clearEl } from '../components/dom.js';
import { panel, kvList } from '../components/panels.js';
import { progressBar } from '../components/progress.js';
import { L } from '../../core/i18n.js';
import { parseHash } from '../../app/Router.js';
import { CanvasManager } from '../../render/CanvasManager.js';
import { SystemRenderer } from '../../render/SystemRenderer.js';
import { explorationView } from '../../simulation/ViewModels.js';

/** 调查层级中文名（0–4，与 SnapshotBuilder / Inspector 一致） */
const SURVEY_LEVELS = ['未接触', '侦测', '分类', '定位', '调查完成'];

/** 异常状态中文名（detected → analyzing → ready → resolved，见 scan.js） */
const ANOMALY_STATES = { detected: '已发现', analyzing: '分析中', ready: '待完成', resolved: '已完成' };

/** 舰队状态中文名（未知状态回退原文） */
const FLEET_STATUS = {
  idle: '待命', scanning: '扫描中', investigating: '调查中',
  combat: '交战中', docked: '停泊', moving: '机动中', retreat: '撤退中',
};

/** 拖拽旋转灵敏度（弧度/逻辑像素） */
const YAW_SPEED = 0.005;
/** 数字变焦范围（画布容器 transform scale） */
const ZOOM_MIN = 1;
const ZOOM_MAX = 2.6;

/**
 * 常用资源中文名（键 = content/resources.js 资源 id）。
 * 词典 ui 层未提供 res.* 词条，此处本地映射用于矿藏/奖励摘要展示，未知 id 回退原文。
 */
const RES_NAMES = {
  ferro: '铁', silicate: '硅酸盐', rareEarth: '稀土', heavyMetal: '重金属',
  hydrogen: '氢', helium3: '氦-3', deuterium: '氘', inertGas: '惰性气体', reagents: '试剂',
  alloy: '合金', polymer: '聚合物', composite: '复合材料', ceramic: '陶瓷', conductor: '超导体',
  food: '食物', water: '水', oxygen: '氧气', biomass: '生物质', medicine: '药品',
  powerCell: '能量电池', reactorFuel: '反应堆燃料',
  quantumCrystal: '量子晶体', darkMatter: '暗物质', exoticMatter: '奇异物质', ancientData: '远古数据',
  researchData: '科研数据', intelPoints: '情报点', credits: '信用点', influence: '影响力',
};

/** 资源摘要片段："铁×120、氢×80" */
function rewardsText(list) {
  return (list || []).map((r) => `${RES_NAMES[r.resId] || r.resId}×${r.amount}`).join('、');
}

export const SystemView = {
  id: 'system',
  title: '星系',

  mount(ctx) {
    const { root, app } = ctx;
    this.app = app;
    this._mounted = true;
    this._systemId = (ctx && ctx.param) || null;
    this._selectedPlanetId = null;
    this._lastRefresh = 0;
    this._raf = 0;
    this._handlers = [];   // unmount 时统一移除的监听 {target, type, fn}
    this._unsubResize = null;
    this._planetCards = new Map(); // planetId → 行星卡根节点（联动高亮）
    this._data = null;             // 只读数据包（情报舱 + 渲染共享）
    this._yaw = 0;                 // 用户拖拽附加偏航（→ SystemRenderer opts.yaw）
    this._zoom = 1;                // 数字变焦倍率（容器 transform scale）
    this._drag = { active: false, moved: false, startX: 0, startY: 0, lastX: 0, lastY: 0 };

    root.innerHTML = '';

    // —— 头部（悬浮玻璃条）——
    const head = el('div', { class: 'vf-view-head' });
    head.appendChild(el('button', {
      class: 'vf-btn small',
      text: '← 银河',
      title: '返回银河地图',
      on: { click: () => app.goto('galaxy') },
    }));
    this._titleEl = el('h2', { text: L('ui.system') });
    head.appendChild(this._titleEl);
    head.appendChild(el('span', { class: 'vf-grow' }));
    head.appendChild(el('span', { class: 'vf-dim vf-small', text: '拖拽旋转 · 滚轮缩放 · 单击行星联动档案' }));
    head.appendChild(el('button', {
      class: 'vf-btn small',
      text: '总览检视',
      title: '在右侧检视器抽屉中打开星系总览档案',
      on: { click: () => app.select('system', this._systemId) },
    }));

    // —— 主体：3D 轨道画布占满全视口 ——
    const body = el('div', { class: 'vf-view-body', style: { overflow: 'hidden' } });
    this._cm = new CanvasManager().attach(body);
    this._renderer = new SystemRenderer();
    this._renderer.init(this._cm); // GL 通道接线（WebGL2 不可用时内部自动退化 2D）
    // 画布尺寸变化 → 立即补绘一帧（日常逐帧渲染由 rAF 循环承担）
    this._unsubResize = this._cm.onResize(() => {
      if (this._mounted) this._drawFrame();
    });

    // —— 悬浮情报舱（原右栏内容：档案 / 行星 / 舰队 / 异常）——
    this._dossier = el('div', { class: 'vf-float-panel' });
    body.appendChild(this._dossier);

    const wrap = el('div', { class: 'vf-view vf-view-immersive' }, [head, body]);
    root.appendChild(wrap);

    // —— 画布交互：拖拽旋转 / 滚轮缩放 / 单击选择 ——
    this._bindCanvasEvents();

    this._refreshAll();

    // —— 渲染循环：仅 mounted 期间运行 ——
    const loop = () => {
      if (!this._mounted) return;
      this._raf = requestAnimationFrame(loop);
      this._drawFrame();
    };
    this._raf = requestAnimationFrame(loop);
  },

  /** 快照推送：路由参数变化时整体重建；否则 250ms 节流刷新情报舱 */
  onSnapshot(snap) {
    if (!this._mounted) return;
    void snap; // 数据统一经 _buildData 从 app.snapshot / world 只读拉取
    const route = parseHash();
    if (route.screen === 'system' && route.param && route.param !== this._systemId) {
      this._systemId = route.param;
      this._selectedPlanetId = null;
      this._refreshAll();
      return;
    }
    const now = performance.now();
    if (now - this._lastRefresh < 250) return; // 节流
    this._lastRefresh = now;
    this._refreshAll();
  },

  /** 卸载：停循环、移除监听、释放画布与引用 */
  unmount() {
    this._mounted = false;
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
    for (const h of this._handlers || []) {
      h.target.removeEventListener(h.type, h.fn);
    }
    this._handlers = [];
    if (this._unsubResize) {
      this._unsubResize();
      this._unsubResize = null;
    }
    if (this._cm) {
      this._cm.dispose();
      this._cm = null;
    }
    this._renderer = null;
    this._data = null;
    this._dossier = null;
    this._titleEl = null;
    this._planetCards = new Map();
  },

  // —— 内部实现 ——————————————————————————————————

  /** 绑定画布交互（全部登记到 _handlers 供 unmount 移除） */
  _bindCanvasEvents() {
    const canvas = this._cm.canvas;
    const drag = this._drag;

    /** 事件坐标 → 渲染器逻辑像素坐标（数字变焦时按容器实际尺寸反解） */
    const toLocal = (e) => {
      const rect = canvas.getBoundingClientRect();
      const k = this._cm.width / Math.max(1, rect.width);
      return { x: (e.clientX - rect.left) * k, y: (e.clientY - rect.top) * k };
    };

    const mousedown = (e) => {
      if (e.button !== 0) return; // 仅左键拖拽旋转
      drag.active = true;
      drag.moved = false;
      drag.startX = drag.lastX = e.clientX;
      drag.startY = drag.lastY = e.clientY;
      canvas.style.cursor = 'grabbing';
    };
    const mousemove = (e) => {
      if (!drag.active) return;
      const rect = canvas.getBoundingClientRect();
      const k = this._cm.width / Math.max(1, rect.width); // 变焦时位移按比例还原
      const dx = (e.clientX - drag.lastX) * k;
      const dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4) {
        drag.moved = true;
      }
      if (drag.moved) this._yaw += dx * YAW_SPEED; // 垂直分量忽略：渲染器俯仰固定
    };
    const mouseup = () => {
      drag.active = false;
      if (canvas.style.cursor === 'grabbing') canvas.style.cursor = 'grab';
    };
    const click = (e) => {
      if (drag.moved) { drag.moved = false; return; } // 拖拽结束不触发选择
      const p = toLocal(e);
      const hit = this._renderer.pick(p.x, p.y);
      this._selectedPlanetId = hit || null;
      this._highlightPlanetCard(hit);
      if (hit) {
        this.app.select('planet', hit); // 全局选中态联动（检视器不弹抽屉）
      } else {
        this.app.select(null); // 空白处清除选中
      }
    };
    const wheel = (e) => {
      e.preventDefault(); // 阻止页面滚动
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this._setZoom(this._zoom * factor);
    };
    const mouseleave = () => {
      if (!drag.active && canvas.style.cursor !== 'grab') canvas.style.cursor = 'grab';
    };

    canvas.style.cursor = 'grab';
    canvas.addEventListener('mousedown', mousedown);
    canvas.addEventListener('click', click);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('mouseleave', mouseleave);
    window.addEventListener('mousemove', mousemove);
    window.addEventListener('mouseup', mouseup);
    this._handlers = [
      { target: canvas, type: 'mousedown', fn: mousedown },
      { target: canvas, type: 'click', fn: click },
      { target: canvas, type: 'wheel', fn: wheel },
      { target: canvas, type: 'mouseleave', fn: mouseleave },
      { target: window, type: 'mousemove', fn: mousemove },
      { target: window, type: 'mouseup', fn: mouseup },
    ];
  },

  /** 数字变焦：缩放画布容器（GL 与 HUD 2D 同步），拾取坐标已按实际尺寸反解 */
  _setZoom(z) {
    this._zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    const canvas = this._cm && this._cm.canvas;
    const wrap = canvas && canvas.parentNode; // .vf-view-canvas 包裹层
    if (wrap) wrap.style.transform = `scale(${this._zoom})`;
  },

  /** 整体刷新：重建数据包 + 标题 + 悬浮情报舱 */
  _refreshAll() {
    this._buildData();
    const d = this._data;
    this._titleEl.textContent = d ? `${L('ui.system')} · ${d.system.name}` : L('ui.system');
    this._buildDossier();
  },

  /** 从 app.world / app.snapshot / ViewModels 只读构建数据包（绝不写世界） */
  _buildData() {
    const w = this.app.world;
    const sys = (w && this._systemId) ? w.entities.systems[this._systemId] : null;
    if (!sys) {
      this._data = null;
      return;
    }
    const pid = w.playerFactionId;
    const lvl = sys.surveyedBy[pid] ?? 0;

    const planets = (sys.planetIds || [])
      .map((id) => w.entities.planets[id])
      .filter(Boolean)
      .map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        categoryName: p.categoryName,
        habitability: p.habitability ?? 0,
        gravity: p.gravity,
        atmosphere: p.atmosphere,
        deposits: { ...(p.deposits || {}) },
        colonyId: p.colonyId || null,
        orbitIndex: p.orbitIndex ?? 0,
      }));

    const snap = this.app.snapshot;
    const fleets = snap ? snap.fleets.filter((f) => f.systemId === sys.id) : [];
    // 异常经许可的只读视图模型拉取（含 discoveredBy=玩家 过滤）
    const anomalies = explorationView(w, pid).anomalies.filter((a) => a.systemId === sys.id);

    this._data = {
      system: {
        id: sys.id,
        name: sys.name,
        star: { typeId: sys.star ? sys.star.typeId : null, name: sys.star ? sys.star.name : null },
        ownerFactionId: sys.ownerFactionId || null,
        surveyedLevel: lvl,
        dangerRating: sys.dangerRating,
        resourceRating: sys.resourceRating,
      },
      planets,
      fleets,
      anomalies,
      tick: w.tick,
      // 渲染器专用轻量投影（舰队附阵营色，供小三角着色）
      render: {
        system: {
          star: { typeId: sys.star ? sys.star.typeId : null },
          planets: planets.map((p) => ({
            id: p.id, name: p.name, category: p.category,
            habitability: p.habitability, colonyId: p.colonyId, orbitIndex: p.orbitIndex,
          })),
        },
        fleets: fleets.map((f) => ({
          name: f.name,
          factionId: f.factionId,
          color: (w.entities.factions[f.factionId] && w.entities.factions[f.factionId].color) || '#4fd8e8',
        })),
        anomalies: anomalies.map((a) => ({ state: a.state })),
        tick: w.tick,
      },
    };
  },

  /** 渲染一帧轨道视图（yaw 来自用户拖拽累计） */
  _drawFrame() {
    const cm = this._cm;
    const r = this._renderer;
    if (!cm || !r || cm.width < 2 || cm.height < 2) return;
    cm.beginFrame();
    const w = this.app.world;
    const renderData = this._data
      ? {
          system: this._data.render.system,
          fleets: this._data.render.fleets,
          anomalies: this._data.render.anomalies,
          tick: this._data.tick,
        }
      : null;
    r.render(cm.ctx, cm.width, cm.height, renderData, {
      selectedPlanetId: this._selectedPlanetId,
      reducedEffects: !!(w && w.settings && w.settings.reducedEffects),
      time: performance.now() / 1000, // 仅表现动画，不进模拟
      yaw: this._yaw, // 用户拖拽旋转增量（渲染器俯仰固定，仅水平环绕）
    });
  },

  /** 构建悬浮情报舱：档案 → 行星 → 舰队 → 异常 */
  _buildDossier() {
    const box = this._dossier;
    if (!box) return;
    clearEl(box);
    this._planetCards = new Map();
    const d = this._data;
    if (!d) {
      box.appendChild(el('div', { class: 'vf-faint vf-center mt-3', text: '未找到目标星系 —— 请从银河地图双击进入' }));
      return;
    }
    const w = this.app.world;
    const sys = d.system;
    const lvl = sys.surveyedLevel;

    // 1) 星系档案
    const file = panel({ title: '星系档案', open: true });
    const pairs = [
      ['恒星', lvl >= 2 ? (sys.star.name || '未知') : '未分类'],
      ['归属', sys.ownerFactionId
        ? ((w.entities.factions[sys.ownerFactionId] && w.entities.factions[sys.ownerFactionId].name) || '未知文明')
        : '无主'],
      ['调查层级', `${SURVEY_LEVELS[Math.min(4, lvl)]}（${lvl}/4）`],
    ];
    if (lvl >= 3) {
      pairs.push(['危险度', `${sys.dangerRating ?? 0}/10`]);
      pairs.push(['资源评级', `${sys.resourceRating ?? 0}/10`]);
    }
    file.appendChild(kvList(pairs));
    if (lvl < 2) {
      file.appendChild(el('div', { class: 'vf-faint vf-small mt-1', text: '情报不足：派遣舰队扫描以提升调查层级。' }));
    }
    box.appendChild(file);

    // 2) 行星列表（分类层级后揭示）
    if (lvl >= 2) {
      const list = panel({ title: `行星（${d.planets.length}）`, open: true });
      for (const p of d.planets) list.appendChild(this._planetCard(p, lvl));
      box.appendChild(list);
    } else {
      const list = panel({ title: '行星', open: true });
      list.appendChild(el('div', { class: 'vf-faint vf-small', text: '完成「分类」层级后揭示行星情报。' }));
      box.appendChild(list);
    }

    // 3) 在系舰队
    box.appendChild(this._fleetPanel(d));

    // 4) 异常列表
    box.appendChild(this._anomalyPanel(d));
  },

  /**
   * 行星卡：名称/类别/宜居度/重力/大气（+层级≥3 时的矿藏）与操作按钮。
   * 「建立前哨」条件：调查层级≥3、宜居度≥20、无殖民地（FoundOutpost 命令还需
   * 一支在本星系的己方舰队 —— 无舰队时按钮禁用并给出提示）。
   */
  _planetCard(p, lvl) {
    const app = this.app;
    const canFound = lvl >= 3 && (p.habitability ?? 0) >= 20 && !p.colonyId;
    const fleetId = canFound ? this._firstInSystemPlayerFleet() : null;

    const card = panel({
      title: p.name,
      open: true,
      dense: true,
      tools: [{
        label: '定位',
        title: '在轨道图中高亮该行星并设为全局选中',
        onClick: () => {
          this._selectedPlanetId = p.id;
          this._highlightPlanetCard(p.id);
          app.select('planet', p.id);
        },
      }],
    });

    const pairs = [
      ['类别', p.categoryName || p.category || '未知'],
      ['宜居度', String(p.habitability ?? 0)],
      ['重力', p.gravity != null ? `${p.gravity}g` : '未知'],
      ['大气', p.atmosphere || '未知'],
    ];
    if (lvl >= 3) {
      const deps = Object.keys(p.deposits || {}).sort().filter((k) => (p.deposits[k] ?? 0) > 0);
      pairs.push(['矿藏', deps.length ? deps.map((k) => `${RES_NAMES[k] || k}×${p.deposits[k]}`).join('、') : '无已知矿藏']);
    }
    card.appendChild(kvList(pairs));

    if (p.colonyId) {
      card.appendChild(el('button', {
        class: 'vf-btn small mt-1',
        text: '打开殖民地',
        title: '跳转到殖民地视图',
        on: { click: () => app.goto('colony', p.colonyId) },
      }));
    } else if (canFound) {
      card.appendChild(el('button', {
        class: 'vf-btn small primary mt-1',
        text: '建立前哨',
        title: fleetId ? '消耗 合金×20 + 信用点×150' : '需要一支在本星系的己方舰队',
        disabled: !fleetId,
        on: {
          click: () => {
            // FoundOutpost 校验要求执行舰队；附带本系玩家舰队使命令可直接成立
            app.dispatch('FoundOutpost', fleetId ? { planetId: p.id, fleetId } : { planetId: p.id });
          },
        },
      }));
    }
    this._planetCards.set(p.id, card);
    return card;
  },

  /** 在系舰队面板：名称/状态 + 扫描本星系 + 对本系 detected 异常的「调查」 */
  _fleetPanel(d) {
    const app = this.app;
    const p = panel({ title: `在系舰队（${d.fleets.length}）`, open: true });
    if (!d.fleets.length) {
      p.appendChild(el('div', { class: 'vf-faint vf-small', text: '本星系暂无已知舰队。' }));
      return p;
    }
    const detected = d.anomalies.filter((a) => a.state === 'detected');
    for (const f of d.fleets) {
      const row = el('div', { class: 'vf-col', style: { padding: '4px 0', borderBottom: '1px solid rgba(29,42,58,0.5)' } });
      const headRow = el('div', { class: 'vf-row' });
      headRow.appendChild(el('span', { class: 'vf-mono', text: f.name }));
      headRow.appendChild(el('span', { class: 'vf-tag', text: FLEET_STATUS[f.status] || f.status || '未知' }));
      headRow.appendChild(el('span', { class: 'vf-faint vf-small', text: `舰船×${f.shipCount ?? 0}` }));
      row.appendChild(headRow);

      const btns = el('div', { class: 'vf-row' });
      const canScan = this._fleetHasSensor(f.id);
      btns.appendChild(el('button', {
        class: 'vf-btn small primary',
        text: '扫描本星系',
        title: canScan ? '对当前星系执行扫描' : '舰队没有具备传感器的舰船',
        disabled: !canScan,
        on: { click: () => app.dispatch('IssueScanOrder', { fleetId: f.id, targetSystemId: d.system.id }) },
      }));
      for (const ano of detected) {
        btns.appendChild(el('button', {
          class: 'vf-btn small',
          text: `调查 ${ano.name}`,
          title: '派遣该舰队调查此异常',
          on: { click: () => app.dispatch('InvestigateAnomaly', { fleetId: f.id, anomalyId: ano.id }) },
        }));
      }
      row.appendChild(btns);
      p.appendChild(row);
    }
    return p;
  },

  /** 异常面板：名称/状态/进度条；resolved 显示奖励摘要 */
  _anomalyPanel(d) {
    const p = panel({ title: `异常（${d.anomalies.length}）`, open: true });
    if (!d.anomalies.length) {
      p.appendChild(el('div', { class: 'vf-faint vf-small', text: '本星系暂无已知异常。' }));
      return p;
    }
    for (const a of d.anomalies) {
      const row = el('div', { class: 'vf-col', style: { padding: '4px 0', borderBottom: '1px solid rgba(29,42,58,0.5)' } });
      const headRow = el('div', { class: 'vf-row' });
      headRow.appendChild(el('span', { class: 'vf-mono', text: a.name }));
      const tone = a.state === 'resolved' ? ' ok' : a.state === 'analyzing' ? ' accent' : '';
      headRow.appendChild(el('span', { class: `vf-tag${tone}`, text: ANOMALY_STATES[a.state] || a.state || '未知' }));
      row.appendChild(headRow);

      if (a.state === 'resolved') {
        row.appendChild(el('div', { class: 'vf-ok vf-small', text: `奖励已结算：${rewardsText(a.rewards) || '无'}` }));
      } else {
        const goal = 60 + (a.difficulty ?? 0) * 18; // 目标值与 domain/exploration/scan.js 一致
        row.appendChild(progressBar({
          value: a.progress ?? 0,
          max: goal,
          label: '调查进度',
          detail: `${Math.round(a.progress ?? 0)}/${goal}`,
          kind: 'accent',
        }));
      }
      p.appendChild(row);
    }
    return p;
  },

  /** 高亮行星卡（canvas pick / 「定位」联动）并滚动到可见 */
  _highlightPlanetCard(planetId) {
    for (const [pid, node] of this._planetCards) {
      const active = pid === planetId;
      node.style.borderColor = active ? 'var(--accent)' : '';
      node.style.boxShadow = active ? '0 0 0 1px var(--accent-dim)' : '';
    }
    if (!planetId) return;
    const node = this._planetCards.get(planetId);
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  },

  /** 本星系第一支可执行命令的玩家舰队（非在途），无则 null */
  _firstInSystemPlayerFleet() {
    const w = this.app.world;
    if (!w || !this._systemId) return null;
    const pid = w.playerFactionId;
    for (const fid of Object.keys(w.entities.fleets).sort()) {
      const f = w.entities.fleets[fid];
      if (f.factionId === pid && !f.transit && f.systemId === this._systemId) return fid;
    }
    return null;
  },

  /** 舰队是否编内有传感器的舰船（只读检查，与 IssueScanOrder 校验一致） */
  _fleetHasSensor(fleetId) {
    const w = this.app.world;
    if (!w) return false;
    const f = w.entities.fleets[fleetId];
    if (!f) return false;
    return (f.shipIds || []).some((sid) => {
      const ship = w.entities.ships[sid];
      return !!ship && ((ship.stats && ship.stats.sensor) ?? 0) > 0;
    });
  },
};
