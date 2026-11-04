/**
 * ui/components/panels.js — 可折叠面板与键值列表
 *
 *  - panel({ title, content, open = true, tools = [], dense, id }) → .vf-panel：
 *    .vf-panel-head（.vf-panel-title + .vf-panel-tools + .vf-panel-toggle 折叠箭头）
 *    + .vf-panel-body（折叠时 body[hidden] + 根节点 is-collapsed，样式由 CSS 负责）。
 *    content：Node | (container) => void | 数组 | 字符串；点击头部空白也可折叠；
 *    tools: [{ label, title, onClick }] 渲染为 .vf-panel-tool 小按钮。
 *    id：面板稳定键（挂 dataset.panelId 并作为 UIStateStore 折叠记忆键）；
 *    未传时回退 `panel:${title}`（Node 标题取其 textContent）。
 *    展开态经 uiState（UIStateStore）跨快照记忆：用户点击折叠/展开立即持久化；
 *    重建时 uiState 已有记录则以记录为准，否则用 open 参数（不回写仓库）。
 *  - kvList(pairs)：pairs = [k, v][] 或 { k: v } → .vf-kv 两列网格；
 *    v 可为 Node（直接作为值单元格）或原始值（textContent 安全渲染）。
 * 顶层不触碰 document。
 */

import { el } from './dom.js';
import { uiState } from '../state/UIStateStore.js';

/** 面板稳定键：显式 id 优先，否则 panel:${title}（Node 标题取文本，空白归一） */
function panelKey(opts) {
  if (opts && opts.id != null && opts.id !== '') return String(opts.id);
  const t = opts ? opts.title : null;
  if (t instanceof Node) return `panel:${String(t.textContent || '').trim()}`;
  return `panel:${t == null ? '' : String(t).trim()}`;
}

export function panel({ title, content, open = true, tools = [], dense, id } = {}) {
  const stableId = panelKey({ title, id });
  let isOpen = uiState.isPanelOpen(stableId, open !== false);

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
  if (stableId) root.dataset.panelId = stableId;
  setOpen(isOpen, false); // 初始同步不回写：uiState 已有记录时以记录为准、否则保留调用方默认
  return root;

  /** 应用展开/折叠态：根类名 + body[hidden] + 箭头字符 + aria-expanded；
   *  persist（默认 true）时写入 UIStateStore 跨快照记忆。 */
  function setOpen(next, persist = true) {
    isOpen = next;
    if (persist) uiState.setPanelOpen(stableId, next);
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
