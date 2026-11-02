/**
 * ui/components/modal.js — 单例模态对话框
 *
 * showModal({ title, body, actions, onClose, wide }) → { close() }。
 *  - 同一时间只允许一个 modal：再次调用自动关闭旧实例（新的替换旧的）；
 *  - 点击遮罩空白处或按 ESC 关闭并触发 onClose（任何路径只触发一次）；
 *  - body：Node 或 (container) => void（由调用方往容器里构建），字符串兜底；
 *  - actions: [{ label, kind?('primary|ghost|danger'), onClick?(close), disabled? }]，
 *    按钮点击后默认关闭；onClick 显式返回 false 可保持打开；onClick/close 均为可选。
 * 结构：.vf-modal-backdrop > .vf-modal(.wide) > header(.vf-modal-title + 关闭按钮)
 *       + .vf-modal-body + .vf-modal-actions；role="dialog" + aria-modal + ESC +
 *       关闭按钮 aria-label="关闭"。所有动态文本一律 textContent。
 * 顶层不触碰 document；onClose / body 构建抛错被隔离，保证节点一定能清理。
 */

import { el } from './dom.js';

let current = null; // 当前打开实例的句柄（单例约束）
let uid = 0;        // 标题元素自增序号（确定性 id，供 aria-labelledby；不用随机数）

export function showModal({ title, body, actions, onClose, wide } = {}) {
  if (current) current.close(); // 新的替换旧的

  let closed = false;
  const titleId = `vf-modal-title-${++uid}`;

  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };

  function close() {
    if (closed) return; // 幂等：重复 close 不产生副作用
    closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    if (current === handle) current = null;
    if (typeof onClose === 'function') {
      try {
        onClose();
      } catch (err) {
        console.warn('[modal] onClose 抛错:', err);
      }
    }
  }

  const handle = { close };

  // —— 标题（h2 兼顾读屏语义，样式由 CSS 覆盖）——
  const titleEl = el('h2', { class: 'vf-modal-title', id: titleId });
  if (title instanceof Node) titleEl.append(title);
  else if (title != null) titleEl.textContent = String(title);

  // —— 主体：函数交给调用方构建，Node 直接挂载，字符串兜底 ——
  const bodyEl = el('div', { class: 'vf-modal-body' });
  try {
    if (typeof body === 'function') body(bodyEl);
    else if (body instanceof Node) bodyEl.append(body);
    else if (body != null) bodyEl.textContent = String(body);
  } catch (err) {
    console.warn('[modal] body 构建抛错:', err);
  }

  // —— 操作按钮 ——
  const actionsEl = el('div', { class: 'vf-modal-actions' });
  for (const action of Array.isArray(actions) ? actions : []) {
    if (!action) continue;
    actionsEl.append(el('button', {
      class: action.kind ? `vf-btn vf-btn-${action.kind}` : 'vf-btn',
      type: 'button',
      disabled: action.disabled === true,
      on: {
        click: () => {
          let keepOpen = false;
          try {
            keepOpen = typeof action.onClick === 'function' && action.onClick(close) === false;
          } catch (err) {
            console.warn('[modal] action onClick 抛错:', err);
          }
          if (!keepOpen) close(); // 默认点击后关闭；onClick 显式返回 false 时保持打开
        },
      },
    }, [action.label != null ? String(action.label) : '确定']));
  }

  // —— 组装：backdrop > dialog；仅点击遮罩空白处关闭 ——
  const dialog = el('div', {
    class: wide ? 'vf-modal wide' : 'vf-modal',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId,
    tabindex: '-1',
  }, [
    el('header', { class: 'vf-modal-head' }, [
      titleEl,
      el('button', {
        class: 'vf-modal-close',
        type: 'button',
        'aria-label': '关闭',
        title: '关闭',
        on: { click: () => close() },
      }, ['×']),
    ]),
    bodyEl,
    actionsEl,
  ]);

  const backdrop = el('div', {
    class: 'vf-modal-backdrop',
    on: {
      click: (event) => {
        if (event.target === backdrop) close(); // 点在 dialog 内部不关闭
      },
    },
  }, [dialog]);

  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  current = handle;
  dialog.focus();

  return handle;
}
