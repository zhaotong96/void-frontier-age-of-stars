/**
 * ui/components/tabs.js — 标签页切换器
 *
 * tabs({ items, activeId, onChange }) → .vf-tabs（role="tablist"）。
 *  - items: [{ id, label, badge? }]；badge 为小圆点计数徽标（0/null/空串不显示）；
 *  - 点击切换 is-active / aria-selected 并调用 onChange(id)；
 *  - element._setActive(id)：供外部直接切换高亮（不触发 onChange）。
 * 顶层不触碰 document。
 */

import { el } from './dom.js';

export function tabs({ items, activeId, onChange } = {}) {
  const list = Array.isArray(items) ? items : [];
  const root = el('div', { class: 'vf-tabs', role: 'tablist' });
  const buttons = new Map(); // id → button

  for (const item of list) {
    if (!item || item.id == null) continue;
    const id = item.id;
    const children = [el('span', { class: 'vf-tab-label', text: String(item.label ?? id) })];
    if (item.badge !== undefined && item.badge !== null && item.badge !== 0 && item.badge !== '') {
      children.push(el('span', { class: 'vf-tab-badge', text: String(item.badge) }));
    }
    const button = el('button', {
      class: 'vf-tab',
      type: 'button',
      role: 'tab',
      dataset: { tab: String(id) }, // data-tab 便于测试与自动化定位
      on: {
        click: () => {
          setActive(id);
          if (typeof onChange === 'function') onChange(id);
        },
      },
    }, children);
    buttons.set(id, button);
    root.append(button);
  }

  /** 切换高亮：仅命中项 is-active；未匹配 id 时全部取消 */
  function setActive(id) {
    for (const [itemId, button] of buttons) {
      const isActive = itemId === id;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
  }

  root._setActive = setActive;
  setActive(activeId);
  return root;
}
