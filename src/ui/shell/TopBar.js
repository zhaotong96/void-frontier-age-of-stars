/**
 * ui/shell/TopBar.js — 顶端战略状态栏（任务书 6.1）
 */

import { el } from '../components/dom.js';
import { SPEEDS } from '../../core/clock.js';
import { L } from '../../core/i18n.js';
import { resourceChip } from '../components/bars.js';
import { formatBig } from '../../core/math.js';

export class TopBar {
  constructor(root, app) {
    this.app = app;
    this.root = root;
    this.build();
  }

  build() {
    this.root.innerHTML = '';
    this.el = el('div', { class: 'vf-topbar-inner vf-row' });
    this.root.appendChild(this.el);
    this.render();
  }

  render() {
    const app = this.app;
    const w = app.world;
    const el = this.el;
    el.innerHTML = '';

    el.appendChild(elBrand());

    if (!w) {
      el.appendChild(el('div', { class: 'spacer' }));
      return;
    }
    const snap = app.snapshot;
    this.dateEl = el('div', { class: 'vf-date', text: snap ? snap.date : '—' });
    el.appendChild(this.dateEl);

    // 速度控制
    const speedWrap = el('div', { class: 'vf-speed-controls', role: 'group', 'aria-label': L('ui.speed') });
    this.speedBtns = [];
    SPEEDS.forEach((s, i) => {
      const b = el('button', {
        class: 'vf-btn small' + (app.speedIdx === i ? ' primary' : ''),
        text: s.label,
        title: `${s.label}（${i === 0 ? '空格' : i}）`,
        on: { click: () => app.setSpeed(i) },
      });
      this.speedBtns.push(b);
      speedWrap.appendChild(b);
    });
    el.appendChild(speedWrap);

    el.appendChild(el('div', { class: 'spacer' }));

    // 玩家资源
    if (snap && snap.player) {
      const led = snap.resources?.balances || {};
      el.appendChild(resourceChip({ icon: '◈', label: L('ui.credits'), value: led.credits ?? 0 }));
      el.appendChild(resourceChip({ icon: '✦', label: L('ui.influence'), value: led.influence ?? 0 }));
      el.appendChild(resourceChip({ icon: '⌬', label: L('ui.researchRate'), value: researchRate(app) }));
      const threat = threatLevel(w);
      el.appendChild(el('span', {
        class: `vf-chip tone-${threat.tone}`,
        text: `${L('ui.threat')} ${threat.label}`,
      }));
    }

    // 通知入口
    const alerts = snap ? snap.alerts.length : 0;
    el.appendChild(el('button', {
      class: 'vf-btn small',
      text: `⚑ ${L('ui.notifications')}${alerts ? ` (${alerts})` : ''}`,
      title: '跳转到事件与通知',
      on: { click: () => app.goto('events') },
    }));
  }

  refresh() {
    if (!this.app.world) return;
    if (this.dateEl && this.app.snapshot) {
      this.dateEl.textContent = this.app.snapshot.date;
    }
    const led = this.app.snapshot?.resources?.balances;
    if (led && this._lastCredits !== led.credits) {
      this._lastCredits = led.credits;
      this.render();
    }
  }

  refreshSpeed() {
    this.render();
  }
}

function elBrand() {
  return el('span', { class: 'brand', text: 'VOID FRONTIER' });
}

function researchRate(app) {
  const w = app.world;
  const fid = w.playerFactionId;
  const rs = w.research[fid];
  if (!rs) return 0;
  let labs = 0;
  for (const cid of Object.keys(w.entities.colonies)) {
    const c = w.entities.colonies[cid];
    if (c.factionId !== fid) continue;
    for (const b of c.buildings) {
      if (b.state === 'active' && b.defId === 'bld_lab') labs++;
    }
  }
  return Math.round((1 + labs * 1.5) * 10) / 10;
}

function threatLevel(world) {
  let wars = 0;
  for (const wid of Object.keys(world.entities.wars)) {
    if (world.entities.wars[wid].status === 'active') wars++;
  }
  if (wars > 0) return { label: '战争', tone: 'danger' };
  let tension = 0;
  for (const key of Object.keys(world.relations.diplomacy)) {
    tension = Math.max(tension, world.relations.diplomacy[key].borderTension || 0);
  }
  if (tension > 50) return { label: '紧张', tone: 'warn' };
  return { label: '平稳', tone: 'ok' };
}
