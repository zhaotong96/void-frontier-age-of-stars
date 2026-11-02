/**
 * ui/shell/Tutorial.js — 可关闭的新手引导（任务书 6.5）
 *
 * 按实际操作逐步点亮的检查清单：扫描→前哨→殖民→建造→造舰→舰队→外交。
 * 进度存 localStorage（不覆盖游戏状态）；随时可关闭，设置里可重置。
 */

import { el } from '../components/dom.js';
import { L } from '../../core/i18n.js';

const LS_KEY = 'vf-tutorial-v1';

const STEPS = [
  { id: 'select', text: '在银河地图点击一个星系查看情报', test: (w) => false }, // 由 UI 点击置位
  { id: 'scan', text: '派遣科学船扫描相邻星系（检视器或舰队视图）', test: (w) => (w.events.log.exploration || []).some((e) => e.type === 'SystemClassified' && e.payload.factionId === w.playerFactionId) },
  { id: 'outpost', text: '在宜居行星建立前哨（星系视图）', test: (w) => (w.stats.coloniesFounded || 0) >= 1 },
  { id: 'build', text: '在殖民地建造矿场与农场（殖民地视图）', test: (w) => Object.values(w.entities.colonies).some((c) => c.factionId === w.playerFactionId && c.buildings.some((b) => (b.defId || '').startsWith('bld_mine'))) },
  { id: 'ship', text: '在舰船设计中保存蓝图并下单建造', test: (w) => (w.stats.shipsBuilt || 0) >= 1 },
  { id: 'diplomacy', text: '在外交视图接触邻近文明', test: (w) => Object.values(w.relations.diplomacy).some((r) => r.contactState === 'contacted') },
];

export class Tutorial {
  constructor(app) {
    this.app = app;
    this.dismissed = Tutorial.loadState().dismissed ?? false;
    this.done = Tutorial.loadState().done ?? {};
    this.el = null;
  }

  static loadState() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    } catch {
      return {};
    }
  }

  static saveState(state) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch { /* ignore */ }
  }

  static reset() {
    try {
      localStorage.removeItem(LS_KEY);
    } catch { /* ignore */ }
  }

  markDone(stepId) {
    if (!this.done[stepId]) {
      this.done[stepId] = Date.now();
      Tutorial.saveState({ done: this.done, dismissed: this.dismissed });
      this.refresh();
    }
  }

  dismiss() {
    this.dismissed = true;
    Tutorial.saveState({ done: this.done, dismissed: true });
    this.refresh();
  }

  /** 挂载到 GalaxyView 头部区域（App 每帧调用 refresh 节流刷新） */
  mount(container) {
    this.container = container;
    this.refresh();
  }

  refresh() {
    if (!this.container) return;
    const w = this.app.world;
    if (!w || this.dismissed) {
      if (this.el) {
        this.el.remove();
        this.el = null;
      }
      return;
    }
    // 状态判定
    for (const s of STEPS) {
      if (!this.done[s.id]) {
        let ok = false;
        try {
          ok = s.test(w);
        } catch { /* ignore */ }
        if (ok) this.markDone(s.id);
      }
    }
    const remaining = STEPS.filter((s) => !this.done[s.id]);
    if (remaining.length === 0) {
      this.dismiss(); // 全部完成自动收起
      return;
    }
    if (!this.el) {
      this.el = el('div', {
        style: {
          position: 'absolute', top: '48px', right: '10px', zIndex: 8,
          width: '250px', background: 'rgba(14,21,32,0.95)', border: '1px solid var(--accent-dim)',
          borderRadius: '6px', padding: '10px',
        },
      });
      this.container.appendChild(this.el);
    }
    this.el.innerHTML = '';
    this.el.appendChild(el('div', { class: 'vf-row' }, [
      el('span', { class: 'vf-accent vf-grow', text: '指挥官指引' }),
      el('button', {
        class: 'vf-btn small',
        text: '×',
        title: '关闭引导（可在设置重置）',
        'aria-label': '关闭新手引导',
        on: { click: () => this.dismiss() },
      }),
    ]));
    for (const s of STEPS) {
      const done = !!this.done[s.id];
      this.el.appendChild(el('div', { class: 'vf-row', style: { padding: '2px 0' } }, [
        el('span', { class: done ? 'vf-ok' : 'vf-dim', text: done ? '✓' : '○' }),
        el('span', { class: `vf-small vf-grow ${done ? 'vf-faint' : 'vf-dim'}`, text: s.text }),
      ]));
    }
    this.el.appendChild(el('div', { class: 'vf-faint vf-small mt-1', text: `${STEPS.length - remaining.length}/${STEPS.length} · 完成后自动收起` }));
  }

  dispose() {
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
    this.container = null;
  }
}
