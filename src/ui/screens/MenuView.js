/**
 * ui/screens/MenuView.js — 主菜单：新战役配置 / 继续战役 / 存档管理入口
 */

import { el } from '../components/dom.js';
import { panel } from '../components/panels.js';
import { L } from '../../core/i18n.js';
import { seedFromString } from '../../core/rng.js';

export const MenuView = {
  id: 'menu',
  title: '主菜单',

  mount(ctx) {
    const { root, app } = ctx;
    this.app = app;
    root.innerHTML = '';
    const wrap = el('div', { class: 'vf-view' });
    const head = el('div', { class: 'vf-view-head' });
    head.appendChild(el('h2', { text: '无垠边疆：星海纪元' }));
    wrap.appendChild(head);

    const body = el('div', { class: 'vf-view-body pad' });
    const col = el('div', { style: { maxWidth: '560px', margin: '40px auto' } });

    // 新战役
    const p1 = panel({ title: L('ui.newGameTitle'), open: true });
    const form = el('div', { class: 'vf-col' });
    const nameInput = el('input', { type: 'text', value: '边疆回声', 'aria-label': L('ui.campaignName') });
    const seedInput = el('input', { type: 'text', value: '24601', 'aria-label': L('ui.seed') });
    const diffSelect = el('select', { 'aria-label': L('ui.difficulty') });
    for (const [v, k] of [['story', 'ui.difficulty.story'], ['standard', 'ui.difficulty.standard'], ['hard', 'ui.difficulty.hard'], ['sandbox', 'ui.difficulty.sandbox']]) {
      const opt = el('option', { value: v, text: L(k) });
      if (v === 'standard') opt.selected = true;
      diffSelect.appendChild(opt);
    }
    const sizeSelect = el('select', { 'aria-label': '星系规模' });
    for (const [v, label] of [['story', '紧凑（64 星系）'], ['standard', '标准（96 星系）'], ['large', '大型（160 星系）']]) {
      const opt = el('option', { value: v, text: label });
      if (v === 'standard') opt.selected = true;
      sizeSelect.appendChild(opt);
    }
    form.appendChild(labelWrap(L('ui.campaignName'), nameInput));
    form.appendChild(labelWrap(L('ui.seed'), seedInput));
    form.appendChild(labelWrap(L('ui.difficulty'), diffSelect));
    form.appendChild(labelWrap('星系规模', sizeSelect));
    const startBtn = el('button', {
      class: 'vf-btn primary mt-2',
      text: `${L('ui.start')} ▸`,
      on: {
        click: async () => {
          startBtn.disabled = true;
          try {
            const seedText = seedInput.value.trim() || '24601';
            const seed = /^\d+$/.test(seedText) ? parseInt(seedText, 10) : seedFromString(seedText);
            await app.startNewGame({
              seed,
              difficulty: diffSelect.value,
              galaxySize: sizeSelect.value,
              campaignName: nameInput.value.trim() || '边疆回声',
            });
          } finally {
            startBtn.disabled = false;
          }
        },
      },
    });
    form.appendChild(startBtn);
    p1.appendChild(form);
    col.appendChild(p1);

    // 继续战役（存在存档时）
    const p2 = panel({ title: L('ui.load'), open: true });
    const contBox = el('div', { class: 'vf-col' });
    p2.appendChild(contBox);
    col.appendChild(p2);
    this._refreshSaves(contBox, app);

    body.appendChild(col);
    wrap.appendChild(body);
    root.appendChild(wrap);
  },

  async _refreshSaves(box, app) {
    box.innerHTML = '';
    const list = await app.saveManager.list();
    if (list.length === 0) {
      box.appendChild(el('div', { class: 'vf-faint vf-small', text: '暂无存档' }));
      return;
    }
    for (const rec of list) {
      const row = el('div', { class: 'vf-row' });
      row.appendChild(el('span', { class: 'vf-grow', text: `${rec.slotId} · ${rec.summary?.name || ''} · T${rec.worldTick}` }));
      row.appendChild(el('button', {
        class: 'vf-btn small primary',
        text: L('ui.load'),
        on: { click: () => app.loadGame(rec.slotId) },
      }));
      row.appendChild(el('button', {
        class: 'vf-btn small danger',
        text: L('ui.delete'),
        on: { click: () => app.confirm('删除存档', `确认删除槽位 ${rec.slotId}？`, async () => { await app.saveManager.remove(rec.slotId); this._refreshSaves(box, app); }) },
      }));
      box.appendChild(row);
    }
  },

  unmount() {
    this.app = null;
  },

  onSnapshot() {},
};

function labelWrap(label, control) {
  const wrap = el('label', { class: 'vf-col' });
  wrap.appendChild(el('span', { class: 'vf-dim vf-small', text: label }));
  wrap.appendChild(control);
  return wrap;
}
