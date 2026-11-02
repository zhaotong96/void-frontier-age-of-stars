/**
 * ui/shell/SideNav.js — 左侧主导航（任务书 6.1 / 6.2）
 */

import { el } from '../components/dom.js';
import { L } from '../../core/i18n.js';

const NAV_ITEMS = [
  { id: 'galaxy', icon: '◉', labelKey: 'ui.galaxy' },
  { id: 'colony', icon: '⌂', labelKey: 'ui.colony' },
  { id: 'fleet', icon: '➤', labelKey: 'ui.fleet' },
  { id: 'designer', icon: '⚙', labelKey: 'ui.designer' },
  { id: 'research', icon: '⚛', labelKey: 'ui.research' },
  { id: 'market', icon: '⇄', labelKey: 'ui.market' },
  { id: 'diplomacy', icon: '☮', labelKey: 'ui.diplomacy' },
  { id: 'government', icon: '☰', labelKey: 'ui.government' },
  { id: 'ground', icon: '☠', labelKey: 'ui.ground' },
  { id: 'events', icon: '❢', labelKey: 'ui.events' },
  { id: 'chronicle', icon: '✎', labelKey: 'ui.chronicle' },
];

export class SideNav {
  constructor(root, app) {
    this.app = app;
    this.root = root;
    this.refresh();
  }

  refresh() {
    const app = this.app;
    this.root.innerHTML = '';
    const items = app.inGame ? NAV_ITEMS : [];
    for (const it of items) {
      const registered = !!require_view(it.id);
      if (!registered) continue; // 未实现视图不显示（禁止死链接 —— 任务书 6.2）
      const btn = el('button', {
        class: 'vf-nav-item',
        dataset: { nav: it.id },
        on: { click: () => app.goto(it.id) },
      });
      btn.appendChild(el('span', { class: 'icon', text: it.icon }));
      btn.appendChild(el('span', { text: L(it.labelKey) }));
      // 事件徽标
      if (it.id === 'events' && app.snapshot?.pendingEvent) {
        btn.appendChild(el('span', { class: 'badge', text: '1' }));
      }
      if (app._route === it.id) btn.classList.add('is-active');
      this.root.appendChild(btn);
    }
    // 常驻项
    for (const it of [
      { id: 'menu', icon: '⟲', labelKey: 'ui.newGame' },
      { id: 'settings', icon: '⚒', labelKey: 'ui.settings' },
      { id: 'diagnostics', icon: '✓', labelKey: 'ui.diagnostics' },
    ]) {
      const btn = el('button', {
        class: 'vf-nav-item' + (app._route === it.id ? ' is-active' : ''),
        on: { click: () => app.goto(it.id) },
      });
      btn.appendChild(el('span', { class: 'icon', text: it.icon }));
      btn.appendChild(el('span', { text: L(it.labelKey) }));
      this.root.appendChild(btn);
    }
  }
}

import { getView } from '../../app/ViewRegistry.js';
function require_view(id) {
  return getView(id);
}
