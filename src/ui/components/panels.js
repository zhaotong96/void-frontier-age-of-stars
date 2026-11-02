/**
 * ui/components/panels.js — 可折叠面板与键值列表
 *
 *  - panel({ title, content, open = true, tools = [], dense }) → .vf-panel：
 *    .vf-panel-head（.vf-panel-title + .vf-panel-tools + .vf-panel-toggle 折叠箭头）
 *    + .vf-panel-body（折叠时 body[hidden] + 根节点 is-collapsed，样式由 CSS 负责）。
 *    content：Node | (container) => void | 数组 | 字符串；点击头部空白也可折叠；
 *    tools: [{ label, title, onClick }] 渲染为 .vf-panel-tool 小按钮。
 *  - kvList(pairs)：pairs = [k, v][] 或 { k: v } → .vf-kv 两列网格；
 *    v 可为 Node（直接作为值单元格）或原始值（textContent 安全渲染）。
 * 顶层不触碰 document。
 */

import { el } from './dom.js';

export function panel({ title, content, open = true, tools = [], dense } = {}) {
  let isOpen = open !== false;

  const body = el('div', { class: 'vf-panel-body' });
  fillContent(body, content);

  const titleEl = el('div', { class: 'vf-panel-title' });
  if (title instanceof Node) titleEl.append(title);
  else if (title != null) titleEl.textContent = String(title);

  const toggle = el('button', { class: 'vf-panel-toggle', type: 'button' }, ['▾']);

  const toolButtons = el('div', { class: 'vf-panel-tools' });
  for (const tool of Array.isArray(tools) ? tools : []) {
    if (!tool) continue;
    toolButtons.append(el('button', {
      class: 'vf-panel-tool',
      type: 'button',
      title: tool.title != null ? String(tool.title) : null,
      'aria-label': tool.title != null ? String(tool.title) : null,
      on: {
        click: (event) => {
          if (typeof tool.onClick === 'function') tool.onClick(event);
        },
      },
    }, [String(tool.label ?? '')]));
  }

  const head = el('div', { class: 'vf-panel-head' }, [titleEl, toolButtons, toggle]);

  // 点击头部空白也可折叠；落在按钮上的点击不折叠
  head.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('button')) return;
    setOpen(!isOpen);
  });
  toggle.addEventListener('click', () => setOpen(!isOpen));

  const root = el('section', { class: dense ? 'vf-panel is-dense' : 'vf-panel' }, [head, body]);
  setOpen(isOpen);
  return root;

  /** 应用展开/折叠态：根类名 + body[hidden] + 箭头字符 + aria-expanded */
  function setOpen(next) {
    isOpen = next;
    root.classList.toggle('is-collapsed', !isOpen);
    if (isOpen) body.removeAttribute('hidden');
    else body.setAttribute('hidden', '');
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    toggle.textContent = isOpen ? '▾' : '▸';
    toggle.setAttribute('title', isOpen ? '折叠' : '展开');
  }
}

/** 键值两列网格：key 一列、value 一列；value 为 Node 时直接作为单元格 */
export function kvList(pairs) {
  const entries = Array.isArray(pairs)
    ? pairs
    : Object.entries(pairs && typeof pairs === 'object' ? pairs : {});
  const root = el('div', { class: 'vf-kv' });
  for (const pair of entries) {
    if (!pair) continue;
    const [key, value] = pair;
    root.append(el('span', { class: 'vf-kv-key', text: String(key) }));
    if (value instanceof Node) root.append(value);
    else root.append(el('span', { class: 'vf-kv-val', text: value == null ? '' : String(value) }));
  }
  return root;
}

/** content 填充：函数回调容器；数组递归；Node 直挂；其余转文本 */
function fillContent(container, content) {
  if (content == null) return;
  if (typeof content === 'function') {
    try {
      content(container);
    } catch (err) {
      console.warn('[panel] content 构建函数抛错:', err);
    }
    return;
  }
  if (Array.isArray(content)) {
    for (const item of content) fillContent(container, item);
    return;
  }
  if (content instanceof Node) {
    container.append(content);
    return;
  }
  container.append(document.createTextNode(String(content)));
}
