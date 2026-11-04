/**
 * ui/screens/SystemView.js — 星系详情视图（路由 #/system/<systemId>，R7 全屏沉浸式重构）
 *
 * 布局：.vf-view.vf-view-immersive > .vf-view-head（悬浮玻璃条：返回银河 + 标题 +
 *       总览检视）+ .vf-view-body（3D 轨道画布 SystemRenderer 占满全视口）。
 *       原右侧固定信息列移除，改为 .vf-float-panel 悬浮毛玻璃情报舱：
 *       星系档案 → 行星卡列表 → 在系舰队 → 异常列表。
 *
 * 交互（doc5 §2.2 四层操作语法 / §3.5.2）：
 *  - 鼠标左键拖拽：旋转轨道相机（增量传给 SystemRenderer opts.yaw，渲染器内部
 *    俯仰固定，仅水平环绕）；
 *  - 滚轮：数字变焦（画布容器 transform: scale 1.0–2.6，拾取坐标按比例反解）；
 *  - 单击行星 → app.select('planet', id)（全局选中态联动）+ 情报舱行星卡高亮；
 *    单击空白 → 清除选中；「定位」按钮反向联动；
 *  - 双击行星 → 选中 + System3D 相机指数阻尼聚焦（Orbit Lerp）+ 强制展开
 *    行星操作舱；双击空白 → 复位聚焦至星系全景；
 *  - 右键行星 → 抑制原生菜单并弹出 .vf-radial-menu 四向径向快捷指令环
 *    （轨道扫描 / 建立前哨 / 派遣先遣队登陆 / 设为舰队目标）；
 *  - 键盘：Escape 三级退避链（关径向菜单 → 取消聚焦 → 返回银河）；
 *    Enter/Space 对选中天体首次聚焦、二次推进登陆（goto('ground', planetId)）；
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
import { toast } from '../components/index.js';
import { L } from '../../core/i18n.js';
import { parseHash } from '../../app/Router.js';
import { CanvasManager } from '../../render/CanvasManager.js';
import { SystemRenderer } from '../../render/SystemRenderer.js';
import { explorationView } from '../../simulation/ViewModels.js';
import { uiState } from '../state/UIStateStore.js';

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
/** 未探测天体回波编号（orbitIndex 0..7 → #I..#VIII，doc5 §3.2） */
const GHOST_NUM = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

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
    this._dossierSigVal = null;    // 情报舱轻量签名（未变动跳过 DOM 重建）
    this._radial = null;           // 右键径向菜单根节点
    this._radialOpen = false;

    // —— 瞬态 UI 状态槽（跨快照/重挂载保持选中与聚焦） ——
    uiState.view('system', { selectedPlanetId: null, focusedPlanetId: null });

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
    head.appendChild(el('span', { class: 'vf-dim vf-small', text: '拖拽旋转 · 滚轮缩放 · 单击选中 · 双击聚焦 · 右键快捷指令' }));
    head.appendChild(el('button', {
      class: 'vf-btn small',
      text: '总览检视',
      title: '在右侧检视器抽屉中打开星系总览档案',
      on: { click: () => app.select('system', this._systemId) },
    }));

    // —— 主体：3D 轨道画布占满全视口 ——
    const body = el('div', { class: 'vf-view-body', style: { overflow: 'hidden' } });
    // —— 悬浮情报舱（原右栏内容：档案 / 行星 / 舰队 / 异常）——
    this._dossier = el('div', { class: 'vf-float-panel' });
    body.appendChild(this._dossier);

    // —— 右键径向快捷指令环（.vf-radial-menu，默认隐藏） ——
    this._radial = el('div', { class: 'vf-radial-menu', hidden: '' });

    const wrap = el('div', { class: 'vf-view vf-view-immersive' }, [head, body, this._radial]);
    root.appendChild(wrap); // 先入文档再建画布：保证 GL 上下文/System3D 在挂载态初始化

    this._cm = new CanvasManager().attach(body);
    this._renderer = new SystemRenderer();
    this._renderer.init(this._cm); // GL 通道接线（WebGL2 不可用时内部自动退化 2D）
    // 画布尺寸变化 → 立即补绘一帧（日常逐帧渲染由 rAF 循环承担）
    this._unsubResize = this._cm.onResize(() => {
      if (this._mounted) this._drawFrame();
    });

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
      uiState.view('system').focusedPlanetId = null; // 换星系：聚焦失效
      this._clearFocus();
      this._hideRadialMenu();
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
    this._radial = null;
    this._radialOpen = false;
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
      uiState.view('system').selectedPlanetId = this._selectedPlanetId;
      this._highlightPlanetCard(hit);
      if (hit) {
        this.app.select('planet', hit); // 全局选中态联动（检视器不弹抽屉）
      } else {
        this.app.select(null); // 空白处清除选中
      }
    };
    // 双击（doc5 §2.2/§3.5.2）：命中行星 → 选中+相机平滑聚焦+展开深层操作舱；
    // 双击空白 → 复位聚焦至星系全景
    const dblclick = (e) => {
      const p = toLocal(e);
      const hit = this._renderer.pick(p.x, p.y);
      const v = uiState.view('system');
      if (hit) {
        this._selectedPlanetId = hit;
        v.selectedPlanetId = hit;
        v.focusedPlanetId = hit;
        this._highlightPlanetCard(hit);
        this.app.select('planet', hit);
        uiState.setPanelOpen(`sys:${this._systemId}:planets`, true);
        uiState.setPanelOpen(`sys:planet:${hit}`, true);
        this._dossierSigVal = null; // 强制重建以应用强制展开
        this._buildDossier();
        this._focusPlanet(hit);
      } else {
        v.focusedPlanetId = null;
        this._clearFocus();
      }
    };
    // 右键（doc5 §2.2）：抑制原生菜单，命中天体弹出径向快捷指令环
    const contextmenu = (e) => {
      e.preventDefault();
      const p = toLocal(e);
      const hit = this._renderer.pick(p.x, p.y);
      if (hit) {
        this._selectedPlanetId = hit;
        uiState.view('system').selectedPlanetId = hit;
        this._highlightPlanetCard(hit);
        this.app.select('planet', hit);
        this._showRadialMenu(e.clientX, e.clientY, hit);
      } else {
        this._hideRadialMenu();
      }
    };
    // 键盘（doc5 §2.2）：Escape 三级退避链；Enter/Space 对选中天体默认推进
    const keydown = (e) => {
      if (!this._mounted) return;
      const tag = ((e.target && e.target.tagName) || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === 'Escape') {
        if (this._radialOpen) { this._hideRadialMenu(); e.preventDefault(); return; } // 1. 关菜单
        const v = uiState.view('system');
        if (v.focusedPlanetId) { // 2. 取消聚焦回全景
          v.focusedPlanetId = null;
          this._clearFocus();
          e.preventDefault();
          return;
        }
        this.app.goto('galaxy'); // 3. 返回银河
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ') && this._selectedPlanetId) {
        e.preventDefault();
        const v = uiState.view('system');
        if (v.focusedPlanetId === this._selectedPlanetId) {
          this.app.goto('ground', this._selectedPlanetId); // 二次推进：登陆行星
        } else {
          v.focusedPlanetId = this._selectedPlanetId; // 首次：聚焦 + 展开行星舱
          uiState.setPanelOpen(`sys:planet:${this._selectedPlanetId}`, true);
          this._dossierSigVal = null;
          this._buildDossier();
          this._focusPlanet(this._selectedPlanetId);
        }
      }
    };
    // 径向菜单外点击关闭（capture 先于画布选择逻辑）
    const docClick = (e) => {
      if (!this._radialOpen) return;
      if (e.target instanceof Element && e.target.closest('.vf-radial-menu')) return;
      this._hideRadialMenu();
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
    canvas.addEventListener('dblclick', dblclick);
    canvas.addEventListener('contextmenu', contextmenu);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('mouseleave', mouseleave);
    window.addEventListener('mousemove', mousemove);
    window.addEventListener('mouseup', mouseup);
    window.addEventListener('keydown', keydown);
    document.addEventListener('click', docClick, true);
    this._handlers = [
      { target: canvas, type: 'mousedown', fn: mousedown },
      { target: canvas, type: 'click', fn: click },
      { target: canvas, type: 'dblclick', fn: dblclick },
      { target: canvas, type: 'contextmenu', fn: contextmenu },
      { target: canvas, type: 'wheel', fn: wheel },
      { target: canvas, type: 'mouseleave', fn: mouseleave },
      { target: window, type: 'mousemove', fn: mousemove },
      { target: window, type: 'mouseup', fn: mouseup },
      { target: window, type: 'keydown', fn: keydown },
      { target: document, type: 'click', fn: docClick },
    ];
  },

  /** 相机聚焦行星（经 SystemRenderer 持有的 System3D；2D 退化路径安全跳过） */
  _focusPlanet(planetId) {
    const s3d = this._renderer && this._renderer._s3d;
    if (s3d && typeof s3d.setOrbitFocus === 'function') s3d.setOrbitFocus(planetId);
  },

  /** 取消相机聚焦回星系全景 */
  _clearFocus() {
    const s3d = this._renderer && this._renderer._s3d;
    if (s3d && typeof s3d.clearOrbitFocus === 'function') s3d.clearOrbitFocus();
  },

  // —— 右键径向快捷指令环（doc5 §3.5.2） ————————————————

  /** 在光标处弹出径向菜单（四项高频空间指令，复用行星卡既有命令路径） */
  _showRadialMenu(clientX, clientY, planetId) {
    const menu = this._radial;
    if (!menu) return;
    menu.replaceChildren();
    const items = this._radialItems(planetId);
    const R = 64;
    items.forEach((it, i) => {
      const ang = -Math.PI / 2 + (i / Math.max(1, items.length)) * Math.PI * 2;
      menu.appendChild(el('button', {
        class: 'vf-radial-item' + (it.primary ? ' primary' : ''),
        type: 'button',
        text: it.label,
        title: it.title || '',
        style: {
          left: `${Math.round(Math.cos(ang) * R)}px`,
          top: `${Math.round(Math.sin(ang) * R)}px`,
        },
        on: {
          click: (ev) => {
            ev.stopPropagation();
            this._hideRadialMenu();
            it.onClick();
          },
        },
      }));
    });
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    menu.removeAttribute('hidden');
    this._radialOpen = true;
  },

  /** 收起径向菜单 */
  _hideRadialMenu() {
    this._radialOpen = false;
    if (this._radial) this._radial.setAttribute('hidden', '');
  },

  /** 径向菜单四项：轨道扫描 / 建立前哨 / 派遣先遣队登陆 / 设为舰队目标 */
  _radialItems(planetId) {
    const app = this.app;
    const d = this._data;
    const planet = d ? d.planets.find((p) => p.id === planetId) : null;
    const lvl = d ? d.system.surveyedLevel : 0;
    return [
      {
        label: '轨道扫描',
        title: '派遣本系舰队对星系执行扫描',
        onClick: () => {
          const fleetId = this._firstInSystemPlayerFleet();
          if (!fleetId || !this._fleetHasSensor(fleetId)) {
            toast('轨道扫描需要一支在本星系且编有传感器的舰队', { kind: 'warn' });
            return;
          }
          app.dispatch('IssueScanOrder', { fleetId, targetSystemId: this._systemId });
        },
      },
      {
        label: '建立前哨',
        title: '在无主行星建立前哨站（层级≥3 · 宜居度≥20）',
        onClick: () => {
          if (!planet) return;
          if (lvl < 3) { toast('需要调查层级≥3 才能建立前哨', { kind: 'warn' }); return; }
          if (planet.colonyId) { toast('该行星已有殖民地/前哨', { kind: 'warn' }); return; }
          if ((planet.habitability ?? 0) < 20) { toast('宜居度过低，无法建立前哨', { kind: 'warn' }); return; }
          const fleetId = this._firstInSystemPlayerFleet();
          app.dispatch('FoundOutpost', fleetId ? { planetId, fleetId } : { planetId });
        },
      },
      {
        label: '派遣先遣队登陆',
        title: '进入行星地表简报（任务或先遣勘探）',
        primary: true,
        onClick: () => app.goto('ground', planetId),
      },
      {
        label: '设为舰队目标',
        title: '将行星设为舰队航行目标',
        onClick: () => toast('暂未开放', { kind: 'info' }),
      },
    ];
  },

  /** 数字变焦：缩放两层画布元素本身（GL 与 HUD 2D 同步；不缩放包裹层，
   *  避免 CanvasManager 测量到放大后的矩形而膨胀绘制缓冲），拾取坐标按实际矩形反解 */
  _setZoom(z) {
    this._zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    const cm = this._cm;
    if (!cm) return;
    for (const c of [cm.glCanvas, cm.hudCanvas]) {
      if (c) c.style.transform = `scale(${this._zoom})`;
    }
  },

  /** 整体刷新：重建数据包 + 标题 + 悬浮情报舱（并恢复跨快照聚焦态） */
  _refreshAll() {
    this._buildData();
    const d = this._data;
    this._titleEl.textContent = d ? `${L('ui.system')} · ${d.system.name}` : L('ui.system');
    // 恢复 uiState 中的聚焦行星（重挂载/换快照后相机重新对准）
    const v = uiState.view('system');
    if (v.focusedPlanetId) {
      const alive = d && d.planets.some((p) => p.id === v.focusedPlanetId);
      if (alive) this._focusPlanet(v.focusedPlanetId);
      else v.focusedPlanetId = null;
    }
    this._buildDossier();
  },

  /** 情报舱轻量签名：调查层级 + 行星归属 + 舰队状态 + 异常进度（未变动跳过重建） */
  _dossierSignature() {
    const d = this._data;
    if (!d) return 'null';
    return [
      d.system.surveyedLevel,
      d.system.ownerFactionId || '',
      d.system.star ? d.system.star.name || '' : '',
      d.planets.map((p) => `${p.id}:${p.colonyId || 0}`).join(','),
      d.fleets.map((f) => `${f.id}:${f.status || ''}:${f.shipCount ?? 0}`).join(','),
      d.anomalies.map((a) => `${a.id}:${a.state || ''}:${a.progress ?? 0}`).join(','),
    ].join('|');
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
        moons: Array.isArray(p.moons) ? p.moons : null, // doc7 TASK-4.3：3D 伴生卫星 feed
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
        belts: Array.isArray(sys.belts) ? sys.belts : null, // doc7 TASK-4.3：3D 小行星带 feed
      },
      planets,
      fleets,
      anomalies,
      tick: w.tick,
      // 渲染器专用轻量投影（舰队附阵营色，供小三角着色；surveyedLevel 供未探测回波）
      render: {
        system: {
          star: { typeId: sys.star ? sys.star.typeId : null },
          surveyedLevel: lvl,
          planets: planets.map((p) => ({
            id: p.id, name: p.name, category: p.category,
            habitability: p.habitability, colonyId: p.colonyId, orbitIndex: p.orbitIndex,
            primaryThemeId: p.primaryThemeId || null, // doc7 TASK-3.1：轨道主题视觉 feed
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

  /** 渲染一帧轨道视图（yaw 来自用户拖拽累计；帧末叠加未探测回波 HUD） */
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
    this._drawGhostOverlay(cm.ctx, cm.width, cm.height);
  },

  /**
   * 未探测天体回波 HUD（doc5 §3.2）：调查层级<2 时对全部天体绘制
   * 青色虚线扫描框 + `[? 引力回波 #I..#VIII]` 标签（复用渲染器拾取投影）。
   */
  _drawGhostOverlay(ctx, w, h) {
    const d = this._data;
    if (!ctx || !d || d.system.surveyedLevel >= 2) return;
    const list = this._renderer && this._renderer._pickList;
    if (!list || !list.length) return;
    const orbitOf = new Map();
    for (const p of d.planets) orbitOf.set(p.id, p.orbitIndex ?? 0);
    ctx.save();
    ctx.strokeStyle = 'rgba(79, 216, 232, 0.72)';
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.2;
    ctx.fillStyle = 'rgba(143, 216, 232, 0.95)';
    ctx.font = '10px "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const e of list) {
      if (e.x < -40 || e.y < -40 || e.x > w + 40 || e.y > h + 40) continue;
      const half = Math.max(11, (e.r || 0) + 5);
      ctx.strokeRect(e.x - half, e.y - half, half * 2, half * 2);
      const idx = Math.min(GHOST_NUM.length - 1, orbitOf.get(e.id) ?? 0);
      ctx.fillText(`[? 引力回波 #${GHOST_NUM[idx]}]`, e.x, e.y + half + 4);
    }
    ctx.restore();
  },

  /**
   * 构建悬浮情报舱：档案 → 行星 → 舰队 → 异常。
   * doc5 §3.4：重建包裹在 uiState.preserveScrollAndFocus 内（滚动/焦点跨重建保持）；
   * 轻量签名未实质变动时直接跳过 DOM 替换（任意时钟倍速下折叠态与滚动条绝对稳定）。
   */
  _buildDossier() {
    const box = this._dossier;
    if (!box) return;
    const sig = this._dossierSignature();
    if (sig === this._dossierSigVal && box.childElementCount > 0) return; // 未变动：跳过
    this._dossierSigVal = sig;
    uiState.preserveScrollAndFocus(`dossier:${this._systemId || 'none'}`, box, () => {
      this._buildDossierInner();
    });
  },

  /** 情报舱实际 DOM 构建（仅在签名变动时执行） */
  _buildDossierInner() {
    const box = this._dossier;
    if (!box) return;
    clearEl(box);
    this._planetCards = new Map();
    const d = this._data;
    if (!d) {
      box.appendChild(el('div', { class: 'vf-faint vf-center mt-3', text: '未找到目标星系 —— 请从银河地图双击进入' }));
      return;
    }
    const sid = d.system.id;
    const w = this.app.world;
    const sys = d.system;
    const lvl = sys.surveyedLevel;

    // 1) 星系档案
    const file = panel({ title: '星系档案', open: true, id: `sys:${sid}:dossier` });
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

    // 2) 行星列表（分类层级后揭示；未探测天体以引力回波虚影标注）
    if (lvl >= 2) {
      const list = panel({ title: `行星（${d.planets.length}）`, open: true, id: `sys:${sid}:planets` });
      for (const p of d.planets) list.appendChild(this._planetCard(p, lvl));
      box.appendChild(list);
    } else {
      const list = panel({ title: '行星', open: true, id: `sys:${sid}:planets` });
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
   * 面板稳定键 sys:planet:<pid>（跨快照折叠记忆 + 双击聚焦强制展开，doc5 §3.4/§3.5）。
   * 「建立前哨」条件：调查层级≥3、宜居度≥20、无殖民地（FoundOutpost 命令还需
   * 一支在本星系的己方舰队 —— 无舰队时按钮禁用并给出提示）。
   * 「登陆行星地表」条件：调查层级≥3 且该行星无进行中的地面行动（active 任务）——
   * 主操作入口以显式路由参数直达地表简报：app.goto('ground', p.id)。
   */
  _planetCard(p, lvl) {
    const app = this.app;
    const canFound = lvl >= 3 && (p.habitability ?? 0) >= 20 && !p.colonyId;
    const fleetId = canFound ? this._firstInSystemPlayerFleet() : null;

    const card = panel({
      title: p.name,
      open: true,
      dense: true,
      id: `sys:planet:${p.id}`,
      tools: [{
        label: '定位',
        title: '在轨道图中高亮该行星并设为全局选中',
        onClick: () => {
          this._selectedPlanetId = p.id;
          uiState.view('system').selectedPlanetId = p.id;
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

    // 卡片底部主操作：登陆行星地表（调查层级≥3 且无进行中的地面行动时提供）
    if (lvl >= 3 && !this._hasActiveGroundMission(p.id)) {
      card.appendChild(el('button', {
        class: 'vf-btn primary mt-1',
        text: '🚀 登陆行星地表',
        title: '降落小队 / 视察殖民地 / 先遣勘探 — 进入全 3D 行星地表',
        on: {
          click: () => {
            // 显式路由参数：GroundView 按 planetId 预选简报目标（doc5 §3.5）
            app.goto('ground', p.id);
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
    const p = panel({ title: `在系舰队（${d.fleets.length}）`, open: true, id: `sys:${d.system.id}:fleets` });
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
    const p = panel({ title: `异常（${d.anomalies.length}）`, open: true, id: `sys:${d.system.id}:anomalies` });
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

  /** 该行星是否已有进行中的地面行动（active 状态；有则不重复提供登陆入口） */
  _hasActiveGroundMission(planetId) {
    const w = this.app.world;
    if (!w || !w.entities || !w.entities.groundMissions) return false;
    return Object.values(w.entities.groundMissions).some(
      (m) => m && m.status === 'active' && m.planetId === planetId,
    );
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
