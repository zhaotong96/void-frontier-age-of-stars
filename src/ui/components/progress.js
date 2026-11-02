/**
 * ui/components/progress.js — 进度条
 *
 * progressBar({ value, max = 100, label, detail, kind = 'default' }) → .vf-progress。
 * 结构：.vf-progress(.kind) > .vf-progress-head(.vf-progress-label + .vf-progress-detail)?
 *       + .vf-progress-track > .vf-progress-fill（宽度 = value/max 百分比，clamp 0–100）。
 * kind: default|accent|warn|danger —— 非 default 时以 kind 值作为修饰类，
 * 颜色一律由 CSS 变量（var(--accent)/var(--warn)/var(--danger)…）决定，组件不写死颜色。
 * 纯展示组件：无事件、无定时器；顶层不触碰 document。
 */

import { el } from './dom.js';

export function progressBar({ value, max = 100, label, detail, kind = 'default' } = {}) {
  const pct = clampPercent(value, max);

  // label / detail 任一存在才渲染头部行
  const head = (label != null || detail != null)
    ? el('div', { class: 'vf-progress-head' }, [
        label != null ? el('span', { class: 'vf-progress-label', text: String(label) }) : null,
        detail != null ? el('span', { class: 'vf-progress-detail', text: String(detail) }) : null,
      ])
    : null;

  return el('div', { class: kind && kind !== 'default' ? `vf-progress ${kind}` : 'vf-progress' }, [
    head,
    el('div', { class: 'vf-progress-track' }, [
      el('div', { class: 'vf-progress-fill', style: { width: `${pct}%` } }),
    ]),
  ]);
}

/** value/max → 百分比并 clamp 到 0–100（保留两位小数）；max 非法或值非有限按 0 处理 */
function clampPercent(value, max) {
  const m = Number(max);
  const v = Number(value);
  if (!Number.isFinite(m) || m <= 0 || !Number.isFinite(v)) return 0;
  const pct = (v / m) * 100;
  return Math.round(Math.min(100, Math.max(0, pct)) * 100) / 100;
}
