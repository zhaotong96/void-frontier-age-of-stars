/**
 * ui/charts/timeline.js — 竖直时间线（HTML 结构，与 SVG 图表同一 CSS 前缀）
 *
 * timeline({ entries, onSelect, max }) → div.vf-chart。
 *  - entries = [{ tick, text, kind }]，按数组顺序自上而下渲染；
 *    tick 为调用方已格式化的时间戳文本，text 为条目正文（均直接 textContent）；
 *  - kind ∈ info|good|warn|danger，决定左侧节点颜色（未知/缺省按 info）；
 *    颜色以内联样式落地保证无 CSS 时可见，同时挂 vf-kind-* 类供主题覆盖；
 *  - onSelect 为函数时条目可点击/键盘激活（Enter/Space），回调入参为原始 entry；
 *  - 最多渲染 max（默认 200）条，超出部分折叠为一行提示。
 *
 * 约定：节点经 components/dom.js 的 el() 构建（createElement + textContent），
 * 禁止 innerHTML 拼接动态内容；顶层不触碰 document/window，可在 Node 侧安全 import。
 */

import { el } from '../components/dom.js';

/** 单次最大渲染条数 */
const MAX_RENDER_DEFAULT = 200;

/** kind → 节点色（与默认色板/主题语义色对齐） */
const KIND_COLORS = {
  info: '#4fd8e8',
  good: '#62d98a',
  warn: '#e8b04f',
  danger: '#e85f5f',
};
const KIND_DEFAULT = 'info';

export function timeline({ entries, onSelect, max = MAX_RENDER_DEFAULT } = {}) {
  const root = el('div', { class: 'vf-chart vf-chart-timeline' });
  const list = Array.isArray(entries) ? entries : [];
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : MAX_RENDER_DEFAULT;

  if (!list.length) {
    root.appendChild(el('div', { class: 'vf-chart-empty', text: '暂无数据' }));
    return root;
  }

  const shown = list.slice(0, limit);
  const listEl = el('ol', { class: 'vf-chart-timeline-list' });
  for (const entry of shown) {
    listEl.appendChild(buildItem(entry, typeof onSelect === 'function' ? onSelect : null));
  }
  root.appendChild(listEl);

  const hidden = list.length - shown.length;
  if (hidden > 0) {
    root.appendChild(el('div', {
      class: 'vf-chart-timeline-more',
      text: `其余 ${hidden} 条已折叠`,
    }));
  }
  return root;
}

/* ------------------------------------------------------------------ */
/* 内部工具（仅本文件使用）                                            */
/* ------------------------------------------------------------------ */

/** 构建单条时间线节点；onSelect 存在时启用点击与键盘激活 */
function buildItem(entry, onSelect) {
  const kind = normalizeKind(entry && entry.kind);
  const clickable = typeof onSelect === 'function';
  const item = el('li', {
    class: `vf-chart-timeline-item vf-kind-${kind}${clickable ? ' clickable' : ''}`,
    style: clickable ? { cursor: 'pointer' } : null,
  });

  // 左侧节点：内联背景色保证无 CSS 时的可见性，vf-kind-* 供主题覆盖
  item.appendChild(el('span', {
    class: 'vf-chart-timeline-dot',
    style: { background: KIND_COLORS[kind] },
    'aria-hidden': 'true',
  }));

  const body = el('div', { class: 'vf-chart-timeline-body' });
  if (entry && entry.tick != null && entry.tick !== '') {
    body.appendChild(el('span', { class: 'vf-chart-timeline-tick', text: String(entry.tick) }));
  }
  if (entry && entry.text != null && entry.text !== '') {
    body.appendChild(el('span', { class: 'vf-chart-timeline-text', text: String(entry.text) }));
  }
  item.appendChild(body);

  if (clickable) {
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    const activate = () => onSelect(entry);
    item.addEventListener('click', activate);
    item.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        activate();
      }
    });
  }
  return item;
}

/** kind 归一化：仅接受四个合法枚举，其余回退 info */
function normalizeKind(kind) {
  return Object.prototype.hasOwnProperty.call(KIND_COLORS, kind) ? kind : KIND_DEFAULT;
}
