/**
 * app/App.js — 单应用根控制器（任务书 2.1 / 6.1）
 *
 * 职责：持有世界与模拟循环（固定步长累加器）、路由与视图切换、
 * 命令分发、快照刷新、告警与通知、存档钩子。
 * App 不含游戏规则 —— 规则一律在 domain/simulation 层。
 */

import { initRouter, navigate, onRouteChange, parseHash } from './Router.js';
import { activateView, registerView } from './ViewRegistry.js';
import { executeCommand, hasCommand } from '../core/commandBus.js';
import { createStarterCampaign } from '../devtools/scenarioFactory.js';
import './commands.js'; // 命令注册（核心必需，静态导入消除启动瀑布与 file:// 阻塞）
import { advanceOneTick } from '../simulation/WorldSimulation.js';
import { SPEEDS, dateStr } from '../core/clock.js';
import { buildSnapshot } from '../simulation/SnapshotBuilder.js';
import { SaveManager } from '../persistence/SaveManager.js';
import { toast, showModal } from '../ui/components/index.js';
import { el } from '../ui/components/dom.js';
import { L, setLanguage } from '../core/i18n.js';
import { AudioManager } from '../render/AudioManager.js';
import { recentLog } from '../core/eventBus.js';

/**
 * WP-5 P1-G：路由 → 场景环境音层映射（AudioManager.startAmbient 六场景声库；
 * 此前 setScene 全仓 0 调用，场景层环境音为孤岛死代码）。未列出的次要屏
 * 落到 'planet' 基准层；AMBIENT_BUILDERS 对未知 id 静默忽略，不致命。
 */
const AMBIENT_ROUTE_SCENE = {
  menu: 'menu', settings: 'menu', diagnostics: 'menu',
  galaxy: 'deepSpace', chronicle: 'deepSpace', events: 'deepSpace',
  diplomacy: 'deepSpace', market: 'deepSpace', government: 'deepSpace',
  system: 'starCorona', designer: 'starCorona', fleet: 'starCorona', research: 'starCorona',
  colony: 'planet',
  ground: 'ground', combat: 'combat',
};

import { MenuView } from '../ui/screens/MenuView.js';
import { GalaxyView } from '../ui/screens/GalaxyView.js';
import { SystemView } from '../ui/screens/SystemView.js';
import { ColonyView } from '../ui/screens/ColonyView.js';
import { FleetView } from '../ui/screens/FleetView.js';
import { DesignerView } from '../ui/screens/DesignerView.js';
import { CombatView } from '../ui/screens/CombatView.js';
import { ResearchView } from '../ui/screens/ResearchView.js';
import { MarketView } from '../ui/screens/MarketView.js';
import { DiplomacyView } from '../ui/screens/DiplomacyView.js';
import { GovernmentView } from '../ui/screens/GovernmentView.js';
import { GroundView } from '../ui/screens/GroundView.js';
import { EventsView } from '../ui/screens/EventsView.js';
import { ChronicleView } from '../ui/screens/ChronicleView.js';
import { SettingsView } from '../ui/screens/SettingsView.js';
import { DiagnosticsView } from '../ui/screens/DiagnosticsView.js';

import { TabGuard } from '../persistence/TabGuard.js';
import { loadLocalSettings, saveLocalSettings } from '../ui/screens/SettingsView.js';
import { TopBar } from '../ui/shell/TopBar.js';
import { SideNav } from '../ui/shell/SideNav.js';
import { Inspector } from '../ui/shell/Inspector.js';
import { BottomBar } from '../ui/shell/BottomBar.js';

let app_keysBound = false;

/** 路由历史栈深度上限（doc5 §3.5：防御性视图栈） */
const ROUTE_STACK_MAX = 16;

export class App {
  constructor(rootEl) {
    this.root = rootEl;
    this.world = null;
    this.snapshot = null;
    this.speedIdx = 1; // 1x
    this.running = false;
    this.accumulator = 0;
    this.lastFrame = 0;
    this.selection = null; // { kind, id }
    this.pendingEvent = null; // 叙事事件弹卡
    this.saveManager = new SaveManager();
    this.tabGuard = new TabGuard();
    this.audio = new AudioManager();
    this.performance = { fps: 0, tickMs: 0, lastSnapshotAt: 0 };
    // —— 防御性路由历史栈（doc5 §3.5 P0-05）：goto 压栈 / goBack 弹栈回退 ——
    this._routeStack = [];
    /** 跨视图切换时保留 Inspector 打开态的屏幕（其余一律自动收起，NAV-04） */
    this.keepInspectorScreens = new Set(['galaxy']);
    this._frame = this._frame.bind(this);
    // 诊断/测试句柄（只读探测与自动化验证用；生产无副作用）
    window.__VF_APP = this;
    window.__vfRouteStack = () => this._routeStack;
  }

  async boot() {
    window.__bootSteps = window.__bootSteps || [];
    const mark = (s) => window.__bootSteps.push(s);
    try {
    // 多标签页会话仲裁：后来者只读（任务书 8.4）；受限环境静默降级
    try {
    this.tabGuard.acquire((state) => {
      if (state === 'observer') {
        this.setSpeed(0);
        toast('已在另一标签页进行本战役，当前页面为只读镜像', { kind: 'warn' });
      }
    });
    } catch (err) {
      console.warn('[VOID FRONTIER] BroadcastChannel 受限，跳过多标签页仲裁:', err);
    }
    // 恢复本地轻量设置（语言/音量，不进世界状态）
    const local = loadLocalSettings();
    if (local.language) setLanguage(local.language);
    if (typeof local.masterVolume === 'number') this.audio.setVolume('master', local.masterVolume);
    if (typeof local.sfxVolume === 'number') this.audio.setVolume('sfx', local.sfxVolume);
    // 注册全部视图
    for (const v of [MenuView, GalaxyView, SystemView, ColonyView, FleetView, DesignerView,
      CombatView, ResearchView, MarketView, DiplomacyView, GovernmentView, GroundView,
      EventsView, ChronicleView, SettingsView, DiagnosticsView]) {
      registerView(v);
    }
    this.buildShell();
    mark('router:init');
    initRouter();
    onRouteChange((route) => this._onRoute(route));
    mark('route:call');
    this._onRoute(parseHash());
    mark('route:done');
    mark('boot:end');
    // 全局键盘快捷键（任务书 6.6：不依赖设置页是否被打开；R7 追加 N / Esc）
    if (!app_keysBound) {
      app_keysBound = true;
      window.addEventListener('keydown', (e) => {
        const tag = ((e.target && e.target.tagName) || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        // Esc：模态自身监听并关闭弹窗，这里避免重复动作；否则取消选中并收起抽屉
        if (e.key === 'Escape') {
          if (document.querySelector('.vf-modal-backdrop')) return;
          if (this.selection) this.select(null);
          else this.setInspectorOpen(false);
          return;
        }
        if (!this.inGame) return;
        if (e.code === 'Space') { e.preventDefault(); this.togglePause(); }
        else if (e.key >= '1' && e.key <= '4') { this.setSpeed(parseInt(e.key, 10)); }
        else if (e.key === 'g' || e.key === 'G') { this.goto('galaxy'); }
        else if (e.key === 'n' || e.key === 'N') { this.openNextEvent(); }
      });
    }
    // rAF 看门狗：后台/失焦标签页 rAF 被冻结时以低频维持模拟（降频不冻结）
    this._watchdog = setInterval(() => {
      if (performance.now() - this.lastFrame > 600) this._frame(performance.now());
    }, 500);
    } catch (e) { mark('boot:error:' + (e && e.message) + ' @ ' + String(e && e.stack || '').split(String.fromCharCode(10)).slice(1, 3).join(' <- ')); throw e; }
    this.lastFrame = performance.now();
    requestAnimationFrame(this._frame);
  }

  /**
   * 构建应用外壳（R7 全屏沉浸式）：
   *   .vf-main 固定铺满 100vw×100vh 承载 3D 视口；顶栏 / 导航栏 / 遥测条 /
   *   检视器全部改为悬浮毛玻璃 HUD，叠加在视口之上（见 styles.css）。
   * 初始带 .in-menu（首路由是菜单），由 _onRoute 维护。
   */
  buildShell() {
    this.root.innerHTML = '';
    const shell = document.createElement('div');
    shell.className = 'vf-shell in-menu';
    shell.innerHTML = `
      <main class="vf-main" id="vf-main"></main>
      <header class="vf-topbar" id="vf-topbar"></header>
      <nav class="vf-sidebar" id="vf-sidebar" aria-label="主导航"></nav>
      <aside class="vf-inspector" id="vf-inspector" aria-label="上下文检视器"></aside>
      <footer class="vf-bottombar" id="vf-bottombar"></footer>
    `;
    this.root.appendChild(shell);
    this.shellEl = shell;
    this.mainEl = document.getElementById('vf-main');
    this.inspectorEl = document.getElementById('vf-inspector');
    this.topBar = new TopBar(document.getElementById('vf-topbar'), this);
    this.sideNav = new SideNav(document.getElementById('vf-sidebar'), this);
    this.inspector = new Inspector(this.inspectorEl, this);
    this.bottomBar = new BottomBar(document.getElementById('vf-bottombar'), this);
    // 顶栏拆分为三个悬浮 HUD 岛（品牌/星历/倍率 · 资源态势 · 通知）
    this._hudIslandsInit();
  }

  /**
   * 把 TopBar 的单行内容分发到三个 .vf-hud-island（TopBar 本身只负责渲染行，
   * 每次 render 后重新分发：左岛=品牌/星历/时间倍率，中岛=资源与威胁态势，右岛=通知）。
   */
  _hudIslandsInit() {
    const bar = document.getElementById('vf-topbar');
    if (!bar) return;
    const mk = (cls) => {
      const d = document.createElement('div');
      d.className = `vf-hud-island ${cls}`;
      return d;
    };
    this._islandL = mk('island-left');
    this._islandM = mk('island-mid');
    this._islandR = mk('island-right');
    bar.appendChild(this._islandL);
    bar.appendChild(this._islandM);
    bar.appendChild(this._islandR);
    const tb = this.topBar;
    const redistribute = () => {
      const inner = tb && tb.el;
      if (!inner || !this._islandL) return;
      for (const box of [this._islandL, this._islandM, this._islandR]) box.innerHTML = '';
      for (const node of Array.from(inner.children)) {
        const cls = node.classList;
        if (cls.contains('spacer')) continue; // 岛间距由顶栏 flex gap 提供
        if (cls.contains('brand') || cls.contains('vf-date') || cls.contains('vf-speed-controls')) {
          this._islandL.appendChild(node);
        } else if (node.tagName === 'BUTTON') {
          this._islandR.appendChild(node);
        } else {
          this._islandM.appendChild(node);
        }
      }
    };
    const origRender = tb.render.bind(tb);
    tb.render = () => { origRender(); redistribute(); };
    tb.render();
  }

  /** 悬浮检视器抽屉开合（.vf-inspector.open + [hidden]，见 styles.css） */
  setInspectorOpen(open) {
    if (this.inspectorEl) {
      this.inspectorEl.classList.toggle('open', !!open);
      if (open) this.inspectorEl.removeAttribute('hidden');
      else this.inspectorEl.setAttribute('hidden', '');
    }
  }

  /**
   * 全局检视器清理（doc5 §3.5 P0-07 / NAV-04）：清空选中并收起抽屉。
   * 路由切换守卫在 _onRoute 中调用（galaxy 等保留屏除外）。
   */
  closeInspector() {
    this.selection = null;
    this.setInspectorOpen(false);
  }

  /** 是否处于战役内 */
  get inGame() {
    return !!this.world;
  }

  // —— 生命周期 ——

  /** 开启新战役（由 MenuView 调用） */
  async startNewGame(config) {
    const world = createStarterCampaign(config);
    this.world = world;
    this.selection = null;
    this.pendingEvent = null;
    this.accumulator = 0;
    this.speedIdx = 1;

    // 先进入游戏并完成视图路由切换，确保存储异常绝不阻断首屏渲染
    this.enterGame();
    navigate('galaxy');

    // 非阻塞式开局检查点保存，兼容 captureCheckpoint 与 save 双接口；
    // IndexedDB/localStorage 受限时三级降级为会话内存，绝不外抛
    try {
      if (typeof this.saveManager.captureCheckpoint === 'function') {
        await this.saveManager.captureCheckpoint(world, `开局检查点 · ${world.campaignName || ''}`);
      } else {
        await this.saveManager.save(world, 'auto', `开局检查点 · ${world.campaignName || ''}`);
      }
    } catch (err) {
      console.warn('[VOID FRONTIER] 本地持久化受限，已降级为会话内存模式:', err);
    }
  }

  /** 读取存档继续 */
  async loadGame(slotId) {
    const rec = await this.saveManager.load(slotId);
    if (!rec) return false;
    this.world = rec.world;
    this.selection = null;
    this.pendingEvent = null;
    this.accumulator = 0;
    this.speedIdx = 0;
    this.enterGame();
    navigate('galaxy');
    return true;
  }

  enterGame() {
    this.setInspectorOpen(false); // 抽屉默认收起，选中实体时再滑出
    this.sideNav.refresh();
    this.running = true;
  }

  /** 语言切换后原地刷新外壳与当前活动视图（不调 buildShell、不销毁外壳结构） */
  refreshLocaleUI() {
    this.topBar.render();
    this.sideNav.refresh();
    this.bottomBar.refresh();
    const view = this._activeViewObj;
    if (view && typeof view.mount === 'function') {
      // 先卸载再重挂：保证画布/rAF/监听被视图自身清理，不泄漏
      if (typeof view.unmount === 'function') {
        try { view.unmount(); } catch (e) { console.warn('视图卸载异常', e); }
      }
      try {
        view.mount({ root: this.mainEl, app: this, param: this._routeParam || null });
      } catch (e) {
        console.error('视图本地化重挂异常', e);
      }
      this.refreshSnapshot();
    } else {
      this.inspector.render(this.snapshot);
    }
  }

  exitToMenu() {
    this.tabGuard?.release();
    this.world = null;
    this.running = false;
    this.snapshot = null;
    this.selection = null;
    this.pendingEvent = null;
    this.setInspectorOpen(false);
    this.sideNav.refresh();
    navigate('menu');
  }

  // —— 命令 ——

  /** 统一命令入口：UI 只能通过这里修改世界 */
  dispatch(type, params = {}, targetId = null, opts = {}) {
    if (!this.world) return { ok: false, reason: '无进行中的战役' };
    if (!hasCommand(type)) {
      toast(`${L('ui.err.blocked')}: 未知指令 ${type}`, { kind: 'error' });
      return { ok: false, code: 'UNKNOWN_COMMAND' };
    }
    const res = executeCommand(this.world, { type, params, targetId, actorId: this.world.playerFactionId });
    if (!res.ok && !opts.silent) {
      toast(res.reason || res.code, { kind: 'warn' });
      this.audio.blip('deny');
    } else if (res.ok) {
      this.audio.blip('ok');
    }
    this.refreshSnapshot();
    return res;
  }

  // —— 时间与模拟 ——

  setSpeed(idx) {
    this.speedIdx = Math.max(0, Math.min(SPEEDS.length - 1, idx));
    this.audio.blip(this.speedIdx === 0 ? 'pause' : 'ok');
    this.topBar.refreshSpeed();
  }

  togglePause() {
    this.setSpeed(this.speedIdx === 0 ? 1 : 0);
  }

  _frame(now) {
    try {
      const dtReal = Math.min(0.25, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      this.performance.fps = Math.round(1 / Math.max(dtReal, 1e-4));

      if (this.world && this.running) {
        const t0 = performance.now();
        const tps = SPEEDS[this.speedIdx].ticksPerSecond;
        if (tps > 0) {
          this.accumulator += dtReal * tps;
          let steps = 0;
          const maxSteps = 40; // 防螺旋积压
          while (this.accumulator >= 1 && steps < maxSteps) {
            this._advanceTick();
            this.accumulator -= 1;
            steps++;
          }
          if (this.accumulator > maxSteps) this.accumulator = 0; // 积压丢弃（低帧率设备降级）
        }
        this.performance.tickMs = performance.now() - t0;

        // 快照节流刷新（4Hz）+ 命令后立即刷新
        if (now - this.performance.lastSnapshotAt > 250) {
          this.refreshSnapshot();
        }
        // 自动保存检查
        this._autosaveCheck();
      }

      this.topBar.refresh();
      this.bottomBar.refresh();
    } catch (e) {
      // 帧循环错误隔离（RISK-09）：记录并继续调度，不让单帧异常杀死主循环
      (window.__frameErrs ||= []).push(String(e && e.message) + ' @ ' + String(e && e.stack || '').split(String.fromCharCode(10))[1]);
      if ((window.__frameErrs || []).length < 4) this.reportFatal(e);
    }
    requestAnimationFrame(this._frame);
  }

  _advanceTick() {
    // 模拟推进（WorldSimulation 内部含 TickPipeline 与战斗步进）。
    // 纯同步确定性调用：同一帧内 while(accumulator>=1) 连跑多步不产生异步竞态。
    try {
      advanceOneTick(this.world);
      this._checkPendingEvent();
    } catch (e) {
      (window.__simErrs ||= []).push(
        String((e && e.message) || e) + ' @ phase=' + ((e && e.phaseName) || '?')
      );
      this.reportFatal(e);
    }
  }

  _checkPendingEvent() {
    const w = this.world;
    if (!w || !w.narrative || !Array.isArray(w.narrative.pendingChoices)) return;
    const next = w.narrative.pendingChoices[0] || null;
    if (!next) {
      this.pendingEvent = null;
      return;
    }
    // 同一事件已弹出时不重复打断；绝不 goto('events') 卸载当前 3D 视图
    if (this.pendingEvent && this.pendingEvent.eventId === next.eventId) return;
    this.pendingEvent = next;
    this.setSpeed(0);
    this._openNonIntrusiveEventModal(next);
  }

  /**
   * 非侵入式事件模态窗（R7）：以全息模态舱叠加在当前 3D 视口之上，
   * 不销毁底层视图、不跳转路由。裁决成功后清除 pendingEvent；
   * 裁决被拒（命令校验失败）时保持打开，由 dispatch 内部 toast 原因。
   * 关闭弹窗而不裁决（Esc / 遮罩）：事件仍待决，时间维持暂停。
   */
  _openNonIntrusiveEventModal(event) {
    const ev = event || {};
    const w = this.world;
    const live = w && w.narrative && Array.isArray(w.narrative.pendingChoices)
      ? w.narrative.pendingChoices.find((p) => p.eventId === ev.eventId)
      : null;
    const def = live || ev;
    const body = el('div', { class: 'vf-col' });
    body.appendChild(el('div', {
      class: 'vf-dim',
      style: { whiteSpace: 'pre-wrap', lineHeight: '1.7' },
      text: def.bodyZh || '（无正文）',
    }));
    const choices = Array.isArray(def.choices) ? def.choices : [];
    const actions = choices.map((c) => ({
      label: c.labelZh || c.id || '选项',
      kind: 'primary',
      onClick: () => {
        const res = this.dispatch('ResolveEventChoice', { eventId: ev.eventId, choiceId: c.id });
        if (res && res.ok) {
          this.pendingEvent = null;
          this.sideNav.refresh();
          return; // 默认关闭模态
        }
        return false; // 裁决失败保持打开
      },
    }));
    if (!choices.length) {
      actions.push({ label: L('ui.cancel'), kind: 'ghost', onClick: () => {} });
    }
    showModal({
      title: `◈ ${def.titleZh || '叙事事件'}`,
      body,
      actions,
      wide: true,
      onClose: () => {
        // 仅当该事件仍在待决队列时保留 pendingEvent（裁决成功后队列已移除）
        const stillPending = this.world && this.world.narrative
          && Array.isArray(this.world.narrative.pendingChoices)
          && this.world.narrative.pendingChoices.some((p) => p.eventId === ev.eventId);
        if (!stillPending) this.pendingEvent = null;
      },
    });
    // 附加全息模态舱样式（.vf-holo-modal，见 styles.css）
    const backdrop = document.body.lastElementChild;
    if (backdrop && backdrop.classList && backdrop.classList.contains('vf-modal-backdrop')) {
      const dlg = backdrop.querySelector('.vf-modal');
      if (dlg) dlg.classList.add('vf-holo-modal');
    }
  }

  /** N 键：弹出下一个待决事件（无待决事件时给出轻提示） */
  openNextEvent() {
    const w = this.world;
    const queue = w && w.narrative && Array.isArray(w.narrative.pendingChoices)
      ? w.narrative.pendingChoices : [];
    if (!queue.length) {
      toast('当前没有待裁决的事件', { kind: 'info' });
      return;
    }
    const next = this.pendingEvent
      && queue.some((p) => p.eventId === this.pendingEvent.eventId)
      ? this.pendingEvent : queue[0];
    this.setSpeed(0);
    this._openNonIntrusiveEventModal(next);
  }

  /** 重建只读快照并通知当前视图/检视器 */
  refreshSnapshot() {
    if (!this.world) return;
    this.performance.lastSnapshotAt = performance.now();
    this.snapshot = buildSnapshot(this.world);
    const view = this._activeViewObj;
    if (view && typeof view.onSnapshot === 'function') {
      try {
        view.onSnapshot(this.snapshot);
      } catch (e) {
        console.error('视图刷新异常', e);
      }
    }
    this.inspector.render(this.snapshot);
  }

  _autosaveCheck() {
    const w = this.world;
    if (!w) return;
    const interval = (w.settings.autosaveIntervalDays || 2) * 24;
    if (w.tick - (w.stats.lastAutosaveTick || 0) >= interval) {
      w.stats.lastAutosaveTick = w.tick;
      this.saveManager.saveAuto(w).catch((e) => console.error('自动保存失败', e));
    }
  }

  // —— 路由 ——

  _onRoute(route) {
    this._route = route.screen;
    this._routeParam = route.param; // 供 refreshLocaleUI 原地重挂当前视图
    // WP-5 P1-G：场景环境音层随路由流转（与主题层 setAmbientTheme 并行独立）
    if (this.audio) this.audio.setScene(AMBIENT_ROUTE_SCENE[route.screen] || 'planet');
    // 主菜单路由隐藏战略顶栏与遥测条（.vf-shell.in-menu，见 styles.css）
    if (this.shellEl) this.shellEl.classList.toggle('in-menu', route.screen === 'menu');
    // 战役外白名单：菜单 / 设置 / 诊断可直达，其余一律弹回菜单
    const preGameAllowed = route.screen === 'menu' || route.screen === 'settings' || route.screen === 'diagnostics';
    if (!this.inGame && !preGameAllowed) {
      navigate('menu');
      return;
    }
    // Inspector 路由守卫（NAV-04）：除保留屏外，切换视图一律收起抽屉并清空选中
    if (!this.keepInspectorScreens.has(route.screen)) {
      this.closeInspector();
    }
    try {
      const view = activateView(route.screen, { root: this.mainEl, app: this, param: route.param });
      this._activeViewObj = view || null;
      this.sideNav.refresh();
      this.refreshSnapshot();
    } catch (e) {
      // 未知路由回菜单
      console.warn('路由失败', e);
      if (route.screen !== 'menu') navigate('menu');
    }
  }

  /**
   * 路由跳转（doc5 §3.5 P0-05）：目标路由与当前不同且非 replace 时，
   * 把当前 {screen, param, selection} 压入防御性历史栈（上限 16，溢出 shift）。
   * @param {string} screen 目标视图 id
   * @param {string|null} [param=null] 路由参数（如 systemId / planetId / colonyId）
   * @param {{replace?:boolean}} [opts={}] replace=true 时不压栈（兜底跳转）
   */
  goto(screen, param = null, opts = {}) {
    const cur = parseHash();
    const changed = screen !== cur.screen || (param ?? null) !== (cur.param ?? null);
    if (changed && !opts.replace) {
      this._routeStack.push({
        screen: cur.screen,
        param: cur.param || null,
        selection: this.selection ? { ...this.selection } : null,
      });
      if (this._routeStack.length > ROUTE_STACK_MAX) this._routeStack.shift();
    }
    navigate(screen, param);
  }

  /**
   * 防御性回退（Escape 逐级退避的落点）：弹出历史栈上一跳并恢复其选中态；
   * 栈空时兜底跳转 fallbackScreen（默认银河）。
   * @param {string} [fallbackScreen='galaxy']
   * @param {string|null} [fallbackParam=null]
   * @returns {boolean} 是否成功弹栈（false = 走了兜底）
   */
  goBack(fallbackScreen = 'galaxy', fallbackParam = null) {
    const prev = this._routeStack.pop();
    if (prev) {
      navigate(prev.screen, prev.param);
      if (prev.selection) this.select(prev.selection.kind, prev.selection.id);
      return true;
    }
    navigate(fallbackScreen, fallbackParam);
    return false;
  }

  /** 检视器支持的选中类型（planet 等由视图内浮面板自行呈现，不弹抽屉） */
  static get INSPECTOR_KINDS() {
    return ['system', 'fleet', 'colony', 'faction'];
  }

  /** 选中实体（检视器 + 地图联动）：有支持类型的选中即滑出抽屉，清空即收起 */
  select(kind, id) {
    this.selection = kind && id ? { kind, id } : null;
    const supported = !!this.selection
      && App.INSPECTOR_KINDS.includes(this.selection.kind);
    this.setInspectorOpen(supported);
    this.refreshSnapshot();
  }

  // —— 通知/诊断 ——

  alertFeed() {
    if (!this.world) return [];
    return recentLog(this.world, 'all', 40).reverse();
  }

  reportFatal(err) {
    console.error('致命错误', err);
    this.setSpeed(0);
    toast(`发生未处理错误: ${err && err.message}`, { kind: 'error' });
  }

  /** 帮助/确认弹窗（供各视图复用） */
  confirm(title, bodyText, onYes) {
    showModal({
      title,
      body: bodyText,
      actions: [
        { label: L('ui.confirm'), kind: 'primary', onClick: (close) => { close(); onYes(); } },
        { label: L('ui.cancel'), kind: 'ghost', onClick: (close) => close() },
      ],
    });
  }
}

