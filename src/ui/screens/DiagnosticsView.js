/**
 * ui/screens/DiagnosticsView.js — 系统诊断面板（任务书 10.4）
 * 在浏览器内运行全量/分组测试，展示编号、说明、耗时、通过/失败、实测/期望。
 */

import { el } from '../components/dom.js';
import { panel } from '../components/panels.js';
import { progressBar } from '../components/progress.js';
import { L } from '../../core/i18n.js';

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
    wrap.appendChild(body);
    root.appendChild(wrap);
    this.results = [];
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
