/**
 * ui/screens/GalaxyView.js — 银河地图主视图（任务书 6.1 / 6.2）
 *
 * 结构：.vf-view > .vf-view-head（标题 + 图例 + 时间提示 + 快捷操作条）
 *             + .vf-view-body（CanvasManager 画布 + .vf-layers 图层复选框组）
 *
 * 交互：
 *  - 鼠标左键拖拽平移（移动超过 4px 才判定为拖拽，避免误触）；
 *  - 滚轮以光标为锚缩放（zoom 0.5–4）；
 *  - 单击（未拖拽）→ pick 命中 → app.select('system', id)（空白处清除选择）；
 *  - 双击 → app.goto('system', id) 进入星系视图；
 *  - 悬停 → renderer._hoverId 更新 + pointer 光标。
 *
 * 生命周期：rAF 循环仅在已 mount 时运行，unmount 时 cancelAnimationFrame 并释放
 * CanvasManager 与全部事件监听。opts.time 仅取 performance.now()/1000 供表现动画，
 * 绝不进入模拟。
 */

import { el, clearEl } from '../components/dom.js';
import { CanvasManager } from '../../render/CanvasManager.js';
import { GalaxyRenderer } from '../../render/GalaxyRenderer.js';
import { L } from '../../core/i18n.js';

/** 图层复选框定义（10 键，标签取 zh-CN 词典 ui.layer.*） */
const LAYER_DEFS = [
  { key: 'lanes', labelKey: 'ui.layer.lanes' },       // 航道控制
  { key: 'ownership', labelKey: 'ui.layer.factions' }, // 势力范围
  { key: 'claims', labelKey: 'ui.layer.claims' },      // 领土主张
  { key: 'resources', labelKey: 'ui.layer.resources' }, // 资源富集
  { key: 'danger', labelKey: 'ui.layer.danger' },      // 星系危险度
  { key: 'fleets', labelKey: 'ui.layer.fleets' },      // 已知舰队
  { key: 'surveys', labelKey: 'ui.layer.surveys' },    // 扫描覆盖
  { key: 'colonies', labelKey: 'ui.layer.colonies' },  // 殖民状态
  { key: 'trade', labelKey: 'ui.layer.trade' },        // 贸易流
  { key: 'fronts', labelKey: 'ui.layer.fronts' },      // 战争前线
];

/** 图层默认开关（信息类默认开，噪声较大的叠加层默认关） */
const DEFAULT_LAYERS = {
  lanes: true, ownership: true, claims: false, resources: false, danger: false,
  fleets: true, surveys: true, colonies: true, trade: false, fronts: true,
};

/** 快捷条最多展示的扫描按钮数（防航路密集时溢出） */
const MAX_SCAN_BUTTONS = 6;

export const GalaxyView = {
  id: 'galaxy',
  title: '银河',

  mount(ctx) {
    const { root, app } = ctx;
    this.app = app;
    this._mounted = true;
    this._layers = { ...DEFAULT_LAYERS };
    this._snap = app.snapshot || null;
    this._selectedId = null;
    this._marketIds = new Set();
    this._drag = { active: false, moved: false, startX: 0, startY: 0, lastX: 0, lastY: 0 };
    this._raf = 0;
    this._handlers = {}; // unmount 时统一移除的监听

    root.innerHTML = '';

    // —— 头部 ——
    const head = el('div', { class: 'vf-view-head' });
    head.appendChild(el('h2', { text: L('ui.galaxy') }));
    head.appendChild(el('span', {
      class: 'vf-dim vf-small',
      text: '拖拽平移 · 滚轮缩放 · 单击选择 · 双击进入星系',
    }));
    this._timeHint = el('span', { class: 'vf-mono vf-faint vf-small', text: '' });
    head.appendChild(this._timeHint);
    head.appendChild(el('span', { class: 'vf-grow' }));
    this._quickBar = el('div', { class: 'vf-row', style: { gap: '6px' } });
    head.appendChild(this._quickBar);

    // —— 主体：画布 + 图层面板 ——
    const body = el('div', { class: 'vf-view-body' });
    this._cm = new CanvasManager().attach(body);
    this._bodyEl = body;
    this._renderer = new GalaxyRenderer();
    this._renderer.init(this._cm);
    if (this._snap) this._renderer.setSnapshot(this._snap);

    // 图层复选框组（.vf-layers 由 styles.css 定位在左上角）
    const layerBox = el('div', { class: 'vf-layers' });
    layerBox.appendChild(el('div', { class: 'vf-faint vf-small', text: '图层' }));
    for (const def of LAYER_DEFS) {
      const input = el('input', { type: 'checkbox' });
      input.checked = !!this._layers[def.key];
      input.addEventListener('change', () => {
        this._layers[def.key] = input.checked;
      });
      const label = el('label', {}, [input, el('span', { text: L(def.labelKey) })]);
      layerBox.appendChild(label);
    }
    body.appendChild(layerBox);

    const wrap = el('div', { class: 'vf-view vf-view-immersive' }, [head, body]);
    root.appendChild(wrap);

    this._bindEvents();
    this._selectedId = this._currentSelectionId();
    this._renderQuickBar();

    // —— 渲染循环：仅 mounted 期间运行 ——
    const loop = () => {
      if (!this._mounted) return;
      this._raf = requestAnimationFrame(loop);
      this._drawFrame();
    };
    this._mountTutorial();
    this._raf = requestAnimationFrame(loop);
  },

  /** 新手引导（可关闭，进度存 localStorage） */
  _mountTutorial() {
    const { Tutorial } = tutorialApi();
    this._tutorial = new Tutorial(this.app);
    this._tutorial.mount(this._bodyEl);
  },

  /** 快照推送：更新渲染引用 + 选中态 + 时间提示 + 快捷条 */
  onSnapshot(snap) {
    if (!this._mounted) return;
    this._snap = snap || this._snap;
    if (this._renderer && this._snap) this._renderer.setSnapshot(this._snap);
    this._selectedId = this._currentSelectionId();
    if (snap && snap.date) this._timeHint.textContent = snap.date;
    // 市场星系集合（只读读取，trade 图层用）
    const w = this.app.world;
    this._marketIds = new Set(w && w.economy && w.economy.markets ? Object.keys(w.economy.markets) : []);
    this._renderQuickBar();
  },

  /** 卸载：停循环、移除全部监听、释放画布与引用 */
  unmount() {
    if (this._tutorial) {
      this._tutorial.dispose();
      this._tutorial = null;
    }
    this._mounted = false;
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
    // 移除画布与 window 上的监听
    const canvas = this._cm ? this._cm.canvas : null;
    const H = this._handlers || {};
    if (canvas) {
      canvas.removeEventListener('mousedown', H.mousedown);
      canvas.removeEventListener('click', H.click);
      canvas.removeEventListener('dblclick', H.dblclick);
      canvas.removeEventListener('mouseleave', H.mouseleave);
      canvas.removeEventListener('wheel', H.wheel);
    }
    window.removeEventListener('mousemove', H.mousemove);
    window.removeEventListener('mouseup', H.mouseup);
    this._handlers = {};
    if (this._cm) {
      this._cm.dispose();
      this._cm = null;
    }
    this._renderer = null;
    this._snap = null;
    this._quickBar = null;
    this._timeHint = null;
    this._marketIds = new Set();
  },

  // —— 内部实现 ——————————————————————————————————

  /** 当前选中的星系 id（无选中或非 system 类型返回 null） */
  _currentSelectionId() {
    const sel = this.app.selection;
    return sel && sel.kind === 'system' ? sel.id : null;
  },

  /** 绑定画布 / window 交互（全部登记到 _handlers 供 unmount 移除） */
  _bindEvents() {
    const cm = this._cm;
    const renderer = this._renderer;
    const canvas = cm.canvas;
    const drag = this._drag;

    /** 事件坐标 → 画布逻辑像素坐标 */
    const toLocal = (e) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const mousedown = (e) => {
      if (e.button !== 0) return; // 仅左键拖拽
      drag.active = true;
      drag.moved = false;
      drag.startX = drag.lastX = e.clientX;
      drag.startY = drag.lastY = e.clientY;
    };

    const mousemove = (e) => {
      if (drag.active) {
        const dx = e.clientX - drag.lastX;
        const dy = e.clientY - drag.lastY;
        // 位移超过 4px 才判定为拖拽，避免与单击冲突
        if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4) {
          drag.moved = true;
          canvas.style.cursor = 'grabbing';
        }
        if (drag.moved) {
          renderer.panBy(dx, dy);
          drag.lastX = e.clientX;
          drag.lastY = e.clientY;
        }
        return;
      }
      // 非拖拽：悬停命中检测（仅当光标在画布上时更新）
      const rect = canvas.getBoundingClientRect();
      const inside = e.clientX >= rect.left && e.clientX <= rect.right
        && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (!inside) return;
      const p = toLocal(e);
      const hit = renderer.pick(p.x, p.y);
      renderer._hoverId = hit; // 视图按任务约定直接维护 renderer._hoverId
      canvas.style.cursor = hit ? 'pointer' : 'default';
    };

    const mouseup = () => {
      drag.active = false;
      if (canvas.style.cursor === 'grabbing') canvas.style.cursor = 'default';
    };

    const click = (e) => {
      if (drag.moved) { drag.moved = false; return; } // 拖拽结束不触发选择
      const p = toLocal(e);
      // SPEC-PLAN-052 Task 52.1：信标命中优先于星系拾取（命中 → 打开信标交互弹窗）
      if (pickSpaceOperaBeacon(this, p.x, p.y)) return;
      const hit = renderer.pick(p.x, p.y);
      if (hit) this.app.select('system', hit);
      else this.app.select(null); // 空白处清除选择
      this._selectedId = this._currentSelectionId();
      this._renderQuickBar();
    };

    const dblclick = (e) => {
      const p = toLocal(e);
      const hit = renderer.pick(p.x, p.y);
      if (hit) this.app.goto('system', hit);
    };

    const mouseleave = () => {
      renderer._hoverId = null;
      if (!drag.active) canvas.style.cursor = 'default';
    };

    const wheel = (e) => {
      e.preventDefault(); // 阻止页面滚动
      const p = toLocal(e);
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      renderer.zoomAt(p.x, p.y, factor);
    };

    canvas.addEventListener('mousedown', mousedown);
    canvas.addEventListener('click', click);
    canvas.addEventListener('dblclick', dblclick);
    canvas.addEventListener('mouseleave', mouseleave);
    canvas.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('mousemove', mousemove);
    window.addEventListener('mouseup', mouseup);

    this._handlers = { mousedown, mousemove, mouseup, click, dblclick, mouseleave, wheel };
  },

  /** 渲染一帧（读取最新快照与图层开关；time 仅用于表现动画） */
  _drawFrame() {
    const cm = this._cm;
    const renderer = this._renderer;
    if (!cm || !renderer || cm.width < 2 || cm.height < 2) return;
    cm.beginFrame();
    const w = this.app.world;
    const opts = {
      selectedId: this._selectedId,
      hoverId: renderer._hoverId,
      playerFactionId: w ? w.playerFactionId : null,
      reducedEffects: !!(w && w.settings && w.settings.reducedEffects),
      time: performance.now() / 1000, // 仅动画用，不进模拟
      marketSystemIds: this._marketIds,
    };
    renderer.render(cm.ctx, cm.width, cm.height, this._snap, this._layers, opts);
    // SPEC-PLAN-052 Task 52.1：四频段信标呼吸脉冲 + 5 类自主生态舰队轨迹叠加层
    //（世界未激活太空歌剧时 drawSpaceOperaOverlay 内部零绘制）
    drawSpaceOperaOverlay(this, cm.ctx, cm.width, cm.height);
  },

  /**
   * 头部快捷操作条：选中星系时展示
   *  - 本系或相邻星系的「扫描」按钮（自动挑选有传感器、可触及目标的玩家舰队）；
   *  - 「星系详情」按钮（进入星系视图）。
   */
  _renderQuickBar() {
    const bar = this._quickBar;
    if (!bar) return;
    clearEl(bar);
    const app = this.app;
    if (!app.inGame) return;
    const sel = app.selection;
    if (!sel || sel.kind !== 'system') return;
    const systems = (this._snap && this._snap.systems) || [];
    const sys = systems.find((s) => s.id === sel.id);
    if (!sys) return;

    // 扫描目标：本系 + 相邻航路星系（层级已达 4 的不再提示扫描）
    let count = 0;
    const targetIds = [sys.id, ...(sys.lanes || [])];
    for (const tid of targetIds) {
      if (count >= MAX_SCAN_BUTTONS) break;
      const target = tid === sys.id ? sys : systems.find((s) => s.id === tid);
      if (!target || (target.surveyedLevel ?? 0) >= 4) continue;
      const fleetId = this._findScannerFleet(tid);
      if (!fleetId) continue; // 没有可执行扫描的舰队则不展示该按钮
      const btn = el('button', {
        class: 'vf-btn small primary',
        text: `扫描 ${target.name}`,
        title: `派遣舰队扫描 ${target.name}（当前层级 ${target.surveyedLevel ?? 0}/4）`,
      });
      btn.addEventListener('click', () => {
        app.dispatch('IssueScanOrder', { fleetId, targetSystemId: tid });
      });
      bar.appendChild(btn);
      count++;
    }

    // 星系详情入口
    bar.appendChild(el('button', {
      class: 'vf-btn small',
      text: '星系详情',
      title: '打开星系视图',
      on: { click: () => app.goto('system', sys.id) },
    }));
  },

  /**
   * 挑选一支能对 targetSystemId 执行扫描的玩家舰队：
   * 需在目标星系或其相邻星系、非在途、且编内有传感器舰船（只读访问世界数据）。
   * @returns {string|null} fleetId
   */
  _findScannerFleet(targetSystemId) {
    const w = this.app.world;
    if (!w) return null;
    const pid = w.playerFactionId;
    const fleets = w.entities.fleets || {};
    for (const fid of Object.keys(fleets).sort()) {
      const f = fleets[fid];
      if (f.factionId !== pid || f.transit || !f.systemId) continue;
      if (f.systemId !== targetSystemId) {
        const here = w.entities.systems[f.systemId];
        if (!here || !(here.lanes || []).includes(targetSystemId)) continue;
      }
      const hasSensor = (f.shipIds || []).some((sid) => {
        const ship = w.entities.ships[sid];
        return !!ship && ((ship.stats && ship.stats.sensor) ?? 0) > 0;
      });
      if (hasSensor) return fid;
    }
    return null;
  },
};

import { Tutorial } from '../shell/Tutorial.js';
function tutorialApi() {
  return { Tutorial };
}

/* ==================== SPEC-PLAN-052 Task 52.1：星图信标流脉冲与自主舰队轨迹（M4 工位 D） ==================== */

import { showModal } from '../components/modal.js';
import { spaceOperaView } from '../../simulation/ViewModels.js';

/** 信标脉冲呼吸半径（canvas 逻辑像素；命中半径 = PULSE_MAX + 6） */
const PULSE_MIN = 6;
const PULSE_MAX = 14;

/**
 * 星图叠加层绘制：≥15 条四频段子空间信标呼吸脉冲光环 + 5 类自主生态舰队航线图标
 * （doc52 §Task 52.1 §2：频段着色 #ff4444 / #ffd700 / #00e5ff / #e040fb；palette
 * 映射到实际 FREQ_* 枚举见 ViewModels.BEACON_FREQ_ZH）。每帧由 _drawFrame 调用；
 * 世界未激活太空歌剧 → 零绘制。坐标取 renderer._projCache（星系屏幕投影，GL/2D 通用）。
 */
export function drawSpaceOperaOverlay(view, ctx, w, h) {
  const world = view.app && view.app.world;
  if (!world || !world.spaceOperaState) return;
  const renderer = view._renderer;
  const proj = renderer && renderer._projCache;
  if (!proj) return;
  const so = spaceOperaView(world);
  if (!so) return;
  const t = performance.now() / 1000;

  ctx.save();

  // —— 1. 自主生态舰队航线图标（5 类；菱形图标 + 航线虚线）——
  const FLEET_COLOR = {
    TRADE_CONVOY: '#ffd700',
    SMUGGLER_RUNNER: '#ff8a65',
    PATROL_FLOTILLA: '#4fd8e8',
    MARKET_EXPEDITION: '#a06bff',
    BOUNTY_HUNTER: '#ff4444',
  };
  for (const f of so.autonomousFleetsList || []) {
    if (!f.position) continue;
    const sx = (f.position.x - renderer.view.x) * renderer.view.zoom + w / 2;
    const sy = (f.position.y - renderer.view.y) * renderer.view.zoom + h / 2;
    if (sx < -30 || sy < -30 || sx > w + 30 || sy > h + 30) continue;
    const color = FLEET_COLOR[f.type] || '#71839a';
    // 航线虚线（origin → 当前位置）
    const oProj = proj.get(f.origin != null ? findSystemIdByName(view, f.origin) : null);
    void oProj; // 航线端点由插值 position 覆盖（origin/destination 名称随 tooltip 展示）
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 5);
    ctx.lineTo(sx + 5, sy);
    ctx.lineTo(sx, sy + 5);
    ctx.lineTo(sx - 5, sy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(216,230,240,0.92)';
    ctx.font = '9px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(f.typeZh + ' → ' + f.destination, sx, sy + 12);
  }

  // —— 2. 四频段信标呼吸脉冲光环 ——
  for (const b of so.beaconsList || []) {
    if (!b.position) continue;
    const entry = proj.get(b.systemId);
    let sx;
    let sy;
    if (entry && Number.isFinite(entry.sx)) {
      sx = entry.sx;
      sy = entry.sy;
    } else {
      sx = (b.position.x - renderer.view.x) * renderer.view.zoom + w / 2;
      sy = (b.position.y - renderer.view.y) * renderer.view.zoom + h / 2;
    }
    if (sx < -30 || sy < -30 || sx > w + 30 || sy > h + 30) continue;
    const breath = PULSE_MIN + (PULSE_MAX - PULSE_MIN) * (0.5 + 0.5 * Math.sin(t * 2.4 + (b.id % 7)));
    ctx.strokeStyle = b.color || '#71839a';
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(sx, sy, breath, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = b.color || '#71839a';
    ctx.beginPath();
    ctx.arc(sx, sy, breath * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // 频段解调小字（首字）
    ctx.fillStyle = 'rgba(216,230,240,0.85)';
    ctx.font = '9px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('◈' + (b.frequencyName || '').slice(0, 2), sx, sy - breath - 4);
  }
  ctx.restore();
}

/**
 * 信标命中检测（星图点击路径最先调用；命中 → 打开信标交互弹窗并返回 true）。
 * 命中半径 = PULSE_MAX + 6（呼吸上限外扩 6px 容差）。
 */
export function pickSpaceOperaBeacon(view, x, y) {
  const world = view.app && view.app.world;
  if (!world || !world.spaceOperaState) return false;
  const renderer = view._renderer;
  const cm = view._cm;
  const proj = renderer && renderer._projCache;
  if (!proj || !cm) return false;
  const so = spaceOperaView(world);
  if (!so) return false;
  const hitR = PULSE_MAX + 6;
  for (const b of so.beaconsList || []) {
    if (!b.position) continue;
    const entry = proj.get(b.systemId);
    let sx;
    let sy;
    if (entry && Number.isFinite(entry.sx)) {
      sx = entry.sx;
      sy = entry.sy;
    } else {
      sx = (b.position.x - renderer.view.x) * renderer.view.zoom + cm.width / 2;
      sy = (b.position.y - renderer.view.y) * renderer.view.zoom + cm.height / 2;
    }
    if (Math.hypot(x - sx, y - sy) <= hitR) {
      openBeaconModal(view, b);
      return true;
    }
  }
  return false;
}

/**
 * 信标交互响应弹窗（doc52 §Task 52.1：半透明科幻信标弹窗 —— 标题 / 频段解调内容 /
 * 交互选项按钮 → RespondSubspaceBeacon）。
 */
export function openBeaconModal(view, beacon) {
  const app = view.app;
  const w = app.world;
  const body = document.createElement('div');
  body.className = 'vf-col';
  body.style.cssText = 'gap:6px;min-width:320px;';
  const head = document.createElement('div');
  head.className = 'vf-row';
  head.innerHTML = '<span class="vf-tag accent">' + (beacon.frequencyName || '') + '</span>'
    + '<span class="vf-faint vf-small">' + (beacon.systemName || '') + '</span>';
  body.appendChild(head);
  const textEl = document.createElement('div');
  textEl.className = 'vf-small';
  textEl.style.cssText = 'white-space:pre-wrap;color:#d8e6f0;background:rgba(15,23,42,0.55);padding:8px;border-radius:6px;border:1px solid rgba(79,216,232,0.35);';
  textEl.textContent = beacon.text || '';
  body.appendChild(textEl);
  const expires = Number.isFinite(beacon.expiresTick) && w ? Math.max(0, beacon.expiresTick - (w.tick || 0)) : null;
  if (expires != null) {
    const meta = document.createElement('div');
    meta.className = 'vf-faint vf-small';
    meta.textContent = '信号窗口剩余 ' + expires + ' ticks（' + Math.ceil(expires / 24) + ' 游戏日）';
    body.appendChild(meta);
  }
  for (const opt of beacon.options || []) {
    const btn = document.createElement('button');
    btn.className = 'vf-btn small primary';
    btn.textContent = opt.label || opt.id;
    btn.title = 'RespondSubspaceBeacon → ' + opt.id + (opt.effectHint ? '（' + opt.effectHint + '）' : '');
    btn.addEventListener('click', () => {
      app.dispatch('RespondSubspaceBeacon', { beaconId: beacon.id, responseOptionId: opt.id });
      if (modalHandle && typeof modalHandle.close === 'function') modalHandle.close();
      view._renderQuickBar && view._renderQuickBar();
      view._forceRebuild && view._forceRebuild();
    });
    body.appendChild(btn);
  }
  const modalHandle = showModal({ title: '◈ 子空间信标 · ' + (beacon.title || '未解调信号'), body, wide: false });
}

/** 星系名 → systemId 反查（航线 origin 端投影回退；O(systems) 单帧少量调用） */
function findSystemIdByName(view, name) {
  const w = view.app && view.app.world;
  const systems = (w && w.entities && w.entities.systems) || {};
  for (const key of Object.keys(systems)) {
    if (systems[key] && systems[key].name === name) return key;
  }
  return null;
}
