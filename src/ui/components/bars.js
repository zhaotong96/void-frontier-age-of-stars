/**
 * ui/components/bars.js — 紧凑数据条与小徽章
 *
 *  - statBar({ label, value, max, tone = 'auto', showNumbers = true })：
 *    复用 progressBar 结构的水平条（.vf-progress + .vf-statbar 紧凑变体标记），
 *    右侧数字默认显示 "value / max"（大数自动 K/M/B 缩写）；
 *    tone 非 'auto' 时其值作为修饰类挂在根上（如 'warn'/'danger'），颜色交由 CSS。
 *  - resourceChip({ icon, label, value, delta, tone }) → .vf-chip：
 *    可选 icon（文本字符，如 "◆"）、label、value（>=1e4→K，>=1e6→M，>=1e9→B）、
 *    delta（正数 is-up 绿 / 负数 is-down 红，带符号；null 不显示）。
 * 顶层不触碰 document；不使用随机数。
 */

import { el } from './dom.js';
import { progressBar } from './progress.js';

/** 紧凑水平数据条：progressBar 结构 + .vf-statbar 变体 */
export function statBar({ label, value, max = 100, tone = 'auto', showNumbers = true } = {}) {
  const root = progressBar({
    value,
    max,
    label,
    detail: showNumbers ? `${compactNumber(value)} / ${compactNumber(max)}` : null,
  });
  root.classList.add('vf-statbar'); // 紧凑变体标记（CSS 据此收紧行高与内边距）
  if (tone && tone !== 'auto') root.classList.add(String(tone));
  return root;
}

/** 资源小徽章：icon + label + value + delta 一行内展示 */
export function resourceChip({ icon, label, value, delta, tone } = {}) {
  const kids = [];
  if (icon != null && icon !== '') {
    kids.push(el('span', { class: 'vf-chip-icon', 'aria-hidden': 'true', text: String(icon) }));
  }
  if (label != null && label !== '') {
    kids.push(el('span', { class: 'vf-chip-label', text: String(label) }));
  }
  kids.push(el('span', { class: 'vf-chip-value', text: compactNumber(value ?? 0) }));
  if (typeof delta === 'number' && Number.isFinite(delta)) {
    const cls = delta > 0 ? ' is-up' : delta < 0 ? ' is-down' : '';
    kids.push(el('span', {
      class: `vf-chip-delta${cls}`, // 正绿负红由 CSS 的 is-up/is-down 决定
      text: (delta > 0 ? '+' : delta < 0 ? '-' : '') + compactNumber(Math.abs(delta)),
    }));
  }
  return el('span', { class: tone ? `vf-chip ${String(tone)}` : 'vf-chip' }, kids);
}

/** 大数缩写：>=1e9→B、>=1e6→M、>=1e4→K（一位小数，保留符号），其余原样 */
function compactNumber(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return v == null ? '' : String(v);
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}
