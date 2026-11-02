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
import { SPEEDS, dateStr } from '../core/clock.js';
import { buildSnapshot } from '../simulation/SnapshotBuilder.js';
import { SaveManager } from '../persistence/SaveManager.js';
import { toast, showModal } from '../ui/components/index.js';
import { L } from '../core/i18n.js';
import { AudioManager } from '../render/AudioManager.js';
import { recentLog } from '../core/eventBus.js';

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

import { TopBar } from '../ui/shell/TopBar.js';
import { SideNav } from '../ui/shell/SideNav.js';
import { Inspector } from '../ui/shell/Inspector.js';
import { BottomBar } from '../ui/shell/BottomBar.js';

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
    this.audio = new AudioManager();
    this.performance = { fps: 0, tickMs: 0, lastSnapshotAt: 0 };
    this._frame = this._frame.bind(this);
    // 诊断/测试句柄（只读探测与自动化验证用；生产无副作用）
    window.__VF_APP = this;
  }

  async boot() {
    window.__bootSteps = window.__bootSteps || [];
    const mark = (s) => window.__bootSteps.push(s);
    try {
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
    // rAF 看门狗：后台/失焦标签页 rAF 被冻结时以低频维持模拟（降频不冻结）
    this._watchdog = setInterval(() => {
      if (performance.now() - this.lastFrame > 600) this._frame(performance.now());
    }, 500);
    } catch (e) { mark('boot:error:' + (e && e.message) + ' @ ' + String(e && e.stack || '').split(String.fromCharCode(10)).slice(1, 3).join(' <- ')); throw e; }
    this.lastFrame = performance.now();
    requestAnimationFrame(this._frame);
  }

  buildShell() {
    this.root.innerHTML = '';
    const shell = document.createElement('div');
    shell.className = 'vf-shell';
    shell.innerHTML = `
      <header class="vf-topbar" id="vf-topbar"></header>
      <nav class="vf-sidebar" id="vf-sidebar" aria-label="主导航"></nav>
      <main class="vf-main" id="vf-main"></main>
      <aside class="vf-inspector" id="vf-inspector"></aside>
      <footer class="vf-bottombar" id="vf-bottombar"></footer>
    `;
    this.root.appendChild(shell);
    this.shellEl = shell;
    this.topBar = new TopBar(document.getElementById('vf-topbar'), this);
    this.sideNav = new SideNav(document.getElementById('vf-sidebar'), this);
    this.inspector = new Inspector(document.getElementById('vf-inspector'), this);
    this.bottomBar = new BottomBar(document.getElementById('vf-bottombar'), this);
    this.mainEl = document.getElementById('vf-main');
  }

  /** 是否处于战役内 */
  get inGame() {
    return !!this.world;
  }

  // —— 生命周期 ——

  /** 开启新战役（由 MenuView 调用） */
  async startNewGame(config) {
    const [factory] = await Promise.all([
      import('../devtools/scenarioFactory.js'),
      import('./commands.js'), // 命令注册（含内容依赖，动态加载）
    ]);
    const world = factory.createStarterCampaign(config);
    this.world = world;
    this.selection = null;
    this.pendingEvent = null;
    this.accumulator = 0;
    this.speedIdx = 1;
    await this.saveManager.save(world, 'auto', `开局检查点 · ${world.campaignName || ''}`);
    this.enterGame();
    navigate('galaxy');
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
    this.shellEl.classList.remove('no-inspector');
    this.sideNav.refresh();
    this.running = true;
  }

  exitToMenu() {
    this.world = null;
    this.running = false;
    this.snapshot = null;
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
    // 模拟推进（WorldSimulation 内部含 TickPipeline 与战斗步进）；模块懒加载缓存
    worldSim().then((mod) => {
      mod.advanceOneTick(this.world);
      this._checkPendingEvent();
    }).catch((e) => {
      (window.__simErrs ||= []).push(String(e && e.message || e) + ' @ phase=' + (e && e.phaseName || '?') + ' @ ' + String(e && e.stack || '').split(String.fromCharCode(10)).slice(1, 3).join(' <- '));
      this.reportFatal(e);
    });
  }

  _checkPendingEvent() {
    if (this.pendingEvent) return;
    const w = this.world;
    if (w.narrative && w.narrative.pendingChoices && w.narrative.pendingChoices.length > 0) {
      this.pendingEvent = w.narrative.pendingChoices[0];
      this.setSpeed(0);
      this.goto('events');
    }
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
    if (!this.inGame && route.screen !== 'menu') {
      navigate('menu');
      return;
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

  goto(screen, param = null) {
    navigate(screen, param);
  }

  /** 选中实体（检视器 + 地图联动） */
  select(kind, id) {
    this.selection = kind && id ? { kind, id } : null;
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

/** 延迟加载模拟内核（避免启动期阻塞首屏） */
let _sim = null;
function worldSim() {
  if (!_sim) _sim = import('../simulation/WorldSimulation.js');
  return _sim;
}