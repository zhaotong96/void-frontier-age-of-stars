/**
 * ui/screens/DiagnosticsView.js — 系统诊断面板（任务书 10.4）
 * 在浏览器内运行全量/分组测试，展示编号、说明、耗时、通过/失败、实测/期望。
 * 另含"地表渲染诊断"卡（doc7 §2.2 / doc6 §3.3）：循环地表诊断渲染模式、
 * 导出 GL 状态快照 JSON —— 经 src/devtools/glGateTest.js 的地表诊断 API，
 * 其底层通过 window.__vfSurfaceDebug 钩子（PlanetSurface3D.init 注册）操作
 * 当前挂载的 GroundView 渲染器。
 */

import { el } from '../components/dom.js';
import { panel } from '../components/panels.js';
import { progressBar } from '../components/progress.js';
import { L } from '../../core/i18n.js';
import { surfaceCycleDebugMode, surfaceGLSnapshot } from '../../devtools/glGateTest.js';
import { spaceOperaView } from '../../simulation/ViewModels.js';

/** 地表诊断模式显示名（0..3，与 PlanetSurface3D.setDebugMode 契约一致） */
const SURFACE_MODE_NAMES = ['0 off', '1 unlit_nocull', '2 wireframe_normal', '3 winding_audit'];

export const DiagnosticsView = {
  id: 'diagnostics',
  title: '系统诊断',

  mount(ctx) {
    const { root, app } = ctx;
    this.app = app;
    root.innerHTML = '';
    const wrap = el('div', { class: 'vf-view' });
    const head = el('div', { class: 'vf-view-head' });
    head.appendChild(el('h2', { text: L('ui.diagnostics') }));
    const runAllBtn = el('button', { class: 'vf-btn primary', text: '运行全部测试' });
    runAllBtn.addEventListener('click', () => this.runAll());
    head.appendChild(runAllBtn);
    const exportBtn = el('button', { class: 'vf-btn', text: L('ui.export') });
    exportBtn.addEventListener('click', () => this.exportReport());
    head.appendChild(exportBtn);
    wrap.appendChild(head);

    const body = el('div', { class: 'vf-view-body pad' });
    this.summary = el('div', { class: 'vf-row mt-1' });
    body.appendChild(this.summary);
    this.resultsBox = el('div', { class: 'mt-2' });
    body.appendChild(this.resultsBox);
    body.appendChild(this.buildSurfaceDiagCard());
    // SPEC-PLAN-046 M3：太空歌剧态势小节（world.spaceOperaState 不存在则整节不渲染；
    // 只读投影消费 spaceOperaView，绝不改动世界状态）
    const soSection = this.buildSpaceOperaSection(app && app.world);
    if (soSection) body.appendChild(soSection);
    wrap.appendChild(body);
    root.appendChild(wrap);
    this.results = [];
  },

  /**
   * 「太空歌剧态势」只读小节（SPEC-PLAN-046 M3）：systemVector 七维条 / 张力与适应 /
   * 活跃局势表 / 因果链尾 4 条。world 缺失或未挂载 spaceOperaState → 返回 null（整节不渲染）。
   */
  buildSpaceOperaSection(world) {
    const view = world ? spaceOperaView(world) : null;
    if (!view) return null;
    const p = panel({ title: '太空歌剧态势', open: true });

    // —— 七维宏观状态条（S1..S7 ∈ [0,100]）——
    const SYS_NAMES = ['S1 考古', 'S2 生态', 'S3 社会', 'S4 经济', 'S5 舰队', 'S6 黑市', 'S7 议会'];
    const vectorBox = el('div', { class: 'mt-1' });
    for (let i = 0; i < view.systemVector.length; i++) {
      vectorBox.appendChild(progressBar({
        value: view.systemVector[i],
        max: 100,
        label: `${SYS_NAMES[i] || `S${i + 1}`} ${view.systemVector[i].toFixed(1)}`,
        detail: `偏离均衡 ${view.equilibriumGap[i].toFixed(2)}`,
      }));
    }
    p.appendChild(vectorBox);

    // —— 张力 / 适应 / 信标 / 天灾态势行 ——
    p.appendChild(el('div', {
      class: 'vf-row mt-1',
      text: `张力 T ${view.drama.tension.toFixed(1)} / 100 · 适应 A ${view.drama.adaptationFactor.toFixed(3)} · 适应天数 ${view.drama.adaptDays.toFixed(1)} · 高潮次数 ${view.drama.climaxCount}`
        + ` · 信标 ${view.beacons.total}（非帝国 ${view.beacons.nonEmpire} / 机遇 ${view.beacons.opportunity}）`
        + ` · 主权违约 ${view.empireDefaulted ? '进行中' : '无'}`
        + ` · 终局天灾 ${view.endgameCrisis.active || '无'}${view.endgameCrisis.ghostSignalActive ? '（幽灵信号）' : ''}`,
    }));

    // —— 活跃局势表 ——
    if (view.activeSituations.length > 0) {
      const sitBox = el('div', { class: 'mt-1' });
      sitBox.appendChild(el('div', { class: 'vf-faint vf-small', text: `活跃局势 ${view.activeSituations.length} 场（弧 / 进度 / 幕 / 对策）` }));
      for (const sit of view.activeSituations) {
        sitBox.appendChild(el('div', {
          class: 'vf-row vf-mono vf-small',
          text: `#${sit.id} ${sit.arc} · ${sit.progress.toFixed(1)} · 第${sit.act}幕 · ${sit.approach || '—'}`,
        }));
      }
      p.appendChild(sitBox);
    }

    // —— 三阶蝴蝶效应因果链尾 4 条 ——
    if (view.butterflyCausalLog.length > 0) {
      const logBox = el('div', { class: 'mt-1' });
      logBox.appendChild(el('div', { class: 'vf-faint vf-small', text: '蝴蝶效应因果链（尾 4 条）' }));
      for (const chain of view.butterflyCausalLog.slice(-4)) {
        const fmt = (o) => `S${o.system + 1}(${o.value >= 0 ? '+' : ''}${o.value})`;
        logBox.appendChild(el('div', {
          class: 'vf-row vf-mono vf-small',
          text: `tick ${chain.tick}：S${chain.sourceSystem + 1} ${chain.delta >= 0 ? '+' : ''}${chain.delta} → ${fmt(chain.order1)} → ${fmt(chain.order2)} → ${fmt(chain.order3)}`,
        }));
      }
      p.appendChild(logBox);
    }
    return p;
  },

  /** 地表渲染诊断卡：循环诊断模式（F3 同效）+ 导出 GL 状态快照 JSON */
  buildSurfaceDiagCard() {
    const p = panel({ title: '地表渲染诊断', open: true });
    const status = el('span', { class: 'vf-faint vf-small', text: '未挂载地表视图时不可用' });
    const setStatus = (text, ok) => {
      status.textContent = text;
      status.className = ok ? 'vf-ok vf-small' : 'vf-faint vf-small';
    };
    setStatus('模式: -', false);

    const cycleBtn = el('button', { class: 'vf-btn', text: '循环诊断模式' });
    cycleBtn.addEventListener('click', () => {
      const r = surfaceCycleDebugMode();
      if (r.ok) setStatus(`模式: ${SURFACE_MODE_NAMES[r.debugMode] || r.debugMode}`, true);
      else setStatus(r.reason || '不可用', false);
    });

    const snapBtn = el('button', { class: 'vf-btn', text: '导出诊断 JSON' });
    snapBtn.addEventListener('click', () => {
      const r = surfaceGLSnapshot();
      if (!r.ok) {
        setStatus(r.reason || '不可用', false);
        return;
      }
      console.log('[地表渲染诊断快照]', r.snapshot);
      try {
        const blob = new Blob([JSON.stringify(r.snapshot, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'vf-surface-glsnapshot.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setStatus('快照已导出（vf-surface-glsnapshot.json，另见 Console）', true);
      } catch (e) {
        setStatus('快照已打印到 Console（下载失败: ' + (e && e.message) + '）', false);
      }
    });

    const row = el('div', { class: 'vf-row' });
    row.appendChild(cycleBtn);
    row.appendChild(snapBtn);
    row.appendChild(status);
    p.appendChild(row);
    return p;
  },

  async runAll() {
    this.results = [];
    this.resultsBox.innerHTML = '';
    this.summary.innerHTML = '';
    const running = el('div', { class: 'vf-accent', text: '测试运行中…' });
    this.summary.appendChild(running);
    try {
      const { collectSuites } = await import('../../../tests/suites/index.js');
      const suites = collectSuites();
      for (const suite of suites) {
        const t0 = performance.now();
        let result;
        try {
          result = await suite.run();
        } catch (e) {
          result = { ok: false, error: String(e && e.message) };
        }
        const ms = performance.now() - t0;
        this.results.push({ id: suite.id, name: suite.name, group: suite.group, ...result, ms: Math.round(ms) });
        this.renderResults();
      }
    } catch (e) {
      running.textContent = `测试加载失败: ${e && e.message}`;
      return;
    }
    this.renderSummary();
  },

  renderSummary() {
    const pass = this.results.filter((r) => r.ok).length;
    const total = this.results.length;
    this.summary.innerHTML = '';
    this.summary.appendChild(progressBar({
      value: pass,
      max: total || 1,
      label: `通过 ${pass} / ${total}`,
      kind: pass === total ? 'accent' : 'danger',
    }));
  },

  renderResults() {
    const groups = new Map();
    for (const r of this.results) {
      if (!groups.has(r.group)) groups.set(r.group, []);
      groups.get(r.group).push(r);
    }
    this.resultsBox.innerHTML = '';
    for (const [group, rows] of [...groups.entries()].sort()) {
      const p = panel({ title: group, open: true });
      for (const r of rows) {
        const line = el('div', { class: 'vf-row', style: { padding: '3px 0' } });
        line.appendChild(el('span', {
          class: r.ok ? 'vf-ok' : 'vf-danger',
          text: r.ok ? '✓' : '✗',
          style: { width: '16px' },
        }));
        line.appendChild(el('span', { class: 'vf-mono', text: r.id, style: { width: '90px' } }));
        line.appendChild(el('span', { class: 'vf-grow', text: r.name }));
        line.appendChild(el('span', { class: 'vf-faint vf-small', text: `${r.ms}ms` }));
        if (!r.ok && r.detail) {
          line.title = r.detail;
        }
        p.appendChild(line);
        if (!r.ok && r.detail) {
          p.appendChild(el('div', { class: 'vf-faint vf-small', text: r.detail, style: { paddingLeft: '106px' } }));
        }
      }
      this.resultsBox.appendChild(p);
    }
  },

  exportReport() {
    const report = {
      generatedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      results: this.results,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vf-test-report.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  unmount() {},
  onSnapshot() {},
};
