/**
 * ui/components/toast.js — 右下角轻提示
 *
 * toast(message, { kind = 'info', timeout }) → 该提示元素。
 *  - kind: 'info' | 'success' | 'warn' | 'error'（默认 info；error 不自动消失）；
 *  - timeout：自动消失毫秒数（默认 3600）；显式传入时对任意 kind 一律生效；
 *  - 同屏最多 5 条，超出移除最旧；每条 role="status"。
 * 结构：.vf-toast-container（固定右下角，首条提示时惰性创建）
 *       > .vf-toast.{kind}（kind 作为修饰类：info/success/warn/error）。
 * clearToasts()：清空全部提示并复位容器（未触发的定时器一并取消）。
 * 顶层不触碰 document；不使用随机数。
 */

import { el } from './dom.js';

const MAX_VISIBLE = 5;     // 同屏上限
const DEFAULT_TIMEOUT = 3600;

let container = null;      // 惰性创建的提示容器
const timers = new Set();  // 存活中的自动消失定时器（clearToasts 统一清理）

export function toast(message, opts = {}) {
  const kind = typeof opts.kind === 'string' && opts.kind ? opts.kind : 'info';
  if (!container || !container.isConnected) {
    container = el('div', { class: 'vf-toast-container', 'aria-live': 'polite' });
    document.body.append(container);
  }

  const node = el('div', { class: `vf-toast ${kind}`, role: 'status' });
  if (message instanceof Node) node.append(message); // 允许直接挂安全节点
  else node.textContent = message == null ? '' : String(message);

  // 超出同屏上限：移除最旧的一条
  while (container.childElementCount >= MAX_VISIBLE) {
    const oldest = container.firstElementChild;
    if (!oldest) break;
    dismiss(oldest);
  }
  container.append(node);

  // error 默认常驻；timeout 显式传入则一律生效
  const timeout = opts.timeout !== undefined ? opts.timeout : (kind === 'error' ? null : DEFAULT_TIMEOUT);
  if (typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      dismiss(node);
    }, timeout);
    timers.add(timer);
  }

  return node;
}

/** 移除一条提示；容器清空后一并摘除，避免残留空层 */
function dismiss(node) {
  if (!node.isConnected) return; // 已被 clearToasts 移除（旧定时器晚到时不动新容器）
  node.remove();
  if (container && container.childElementCount === 0) {
    container.remove();
    container = null;
  }
}

/** 清空全部提示并复位容器 */
export function clearToasts() {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  if (container) {
    container.remove();
    container = null;
  }
}
