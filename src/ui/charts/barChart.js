/**
 * ui/charts/barChart.js — 水平条形图（纯 SVG）
 *
 * barChart({ items, width, height, max, unit, fluid }) → svg.vf-chart。
 *  - items = [{ label, value, color? }]；布局为「标签左 · 条形中 · 数值右」；
 *  - max 显式指定正值域参考上限（小于数据峰值时自动取峰值，不截断条形）；
 *    负值自动引入中轴线（零位轴），条形从零位向左/右伸展；
 *    unit 追加在右侧数值之后（如「艘」「单位」）；
 *  - 行数较多时 SVG 高度按行数自动增高（height 为最小高度）；
 *  - 非法 value（NaN/undefined/非数值）跳过该行并整次调用只 console.warn 一次；
 *    无合法数据时居中显示「暂无数据」。
 *
 * 约定：全部节点经 createElementNS（复用 components/dom.js 的 svgEl），
 * 文本一律 textContent；超宽标签用 textLength 压缩而非裁切；
 * 顶层不触碰 document/window，可在 Node 侧安全 import。
 */

import { svgEl } from '../components/dom.js';
import { CHART_COLORS } from './svgChart.js';

/** 结构性配色（暗色主题回退值；CSS 类 vf-chart-* 可覆盖） */
const AXIS_COLOR = 'rgba(113, 131, 154, 0.45)';
const TEXT_LABEL = '#a7b8ca';
const TEXT_DIM = '#71839a';
const EMPTY_COLOR = '#71839a';

/** 行高与边距（px） */
const ROW_H = 22;
const BAR_H = 12;
const PAD_T = 6;
const PAD_B = 6;
const VALUE_W = 56;

export function barChart({ items, width = 320, height = 140, max, unit, fluid = false } = {}) {
  const w = positive(width, 320);
  const minH = positive(height, 140);

  // —— 数据防御：过滤非法行（整次调用只 warn 一次）——
  const invalid = { count: 0 };
  const rows = normalizeItems(items, invalid);
  if (invalid.count > 0) {
    console.warn(`[vf-chart] barChart: 检测到 ${invalid.count} 个非法数值（NaN/undefined），对应行已跳过`);
  }

  // —— 列宽：标签列按最长标签估宽（CJK 11px/字、拉丁 6.5px/字），钳制到 [36, 110] ——
  let labelW = 36;
  for (const row of rows) labelW = Math.max(labelW, estimateWidth(row.label) + 12);
  labelW = Math.min(110, labelW);
  const plotX = labelW + 4;
  const plotW = Math.max(20, w - plotX - VALUE_W);

  // —— 值域：有负值则引入中轴；max 显式覆盖正值上限；退化域对称扩展 ——
  const [lo, hi] = resolveDomain(rows, max);
  const zeroX = plotX + ((0 - lo) / (hi - lo)) * plotW;

  // —— 高度：随行数自动增高（height 为下限） ——
  const needH = PAD_T + rows.length * ROW_H + PAD_B;
  const h = Math.max(minH, needH);

  const svg = svgEl('svg', {
    class: 'vf-chart vf-chart-bars',
    viewBox: `0 0 ${w} ${h}`,
    width: fluid ? '100%' : w,
    height: h,
    role: 'img',
    preserveAspectRatio: 'xMidYMid meet',
  });

  if (!rows.length) {
    svg.appendChild(svgEl('text', {
      class: 'vf-chart-empty',
      x: w / 2, y: minH / 2,
      'font-size': 12, fill: EMPTY_COLOR, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
      text: '暂无数据',
    }));
    return svg;
  }

  // —— 中轴线：域含负值（或零位不在左缘）时绘制 ——
  if (zeroX > plotX + 0.5) {
    svg.appendChild(svgEl('line', {
      class: 'vf-chart-axis',
      x1: r2(zeroX), y1: PAD_T - 2, x2: r2(zeroX), y2: needH - PAD_B + 2,
      stroke: AXIS_COLOR, 'stroke-width': 1,
    }));
  }

  // —— 行渲染：标签 · 条形 · 数值 ——
  rows.forEach((row, i) => {
    const cy = PAD_T + i * ROW_H + ROW_H / 2;
    const clamped = Math.min(hi, Math.max(lo, row.value));
    const vx = plotX + ((clamped - lo) / (hi - lo)) * plotW;
    const bx = Math.min(zeroX, vx);
    const bw = Math.max(1, Math.abs(vx - zeroX));

    svg.appendChild(svgEl('rect', {
      class: 'vf-chart-bar',
      x: r2(bx), y: r2(cy - BAR_H / 2), width: r2(bw), height: BAR_H, rx: 2, ry: 2,
      fill: row.color,
    }));

    const labelAttrs = {
      class: 'vf-chart-bar-label',
      x: 4, y: r2(cy + 3.5),
      'font-size': 10, fill: TEXT_LABEL, 'text-anchor': 'start',
      text: row.label,
    };
    const labelW_est = estimateWidth(row.label);
    if (labelW_est > labelW - 8) {
      // 超宽标签：按列宽压缩字形而非截断
      labelAttrs.textLength = labelW - 8;
      labelAttrs.lengthAdjust = 'spacingAndGlyphs';
    }
    svg.appendChild(svgEl('text', labelAttrs));

    svg.appendChild(svgEl('text', {
      class: 'vf-chart-bar-value',
      x: w - 4, y: r2(cy + 3.5),
      'font-size': 10, fill: TEXT_DIM, 'text-anchor': 'end',
      text: `${formatNumber(row.value)}${unit != null ? String(unit) : ''}`,
    }));
  });

  return svg;
}

/* ------------------------------------------------------------------ */
/* 内部工具（仅本文件使用）                                            */
/* ------------------------------------------------------------------ */

/** 归一化 items：value 非有限则丢弃该行并计数 */
function normalizeItems(items, invalid) {
  const list = Array.isArray(items) ? items : [];
  const rows = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') { invalid.count += 1; continue; }
    const value = Number(raw.value);
    if (!Number.isFinite(value)) { invalid.count += 1; continue; }
    rows.push({
      label: raw.label != null ? String(raw.label) : '',
      value,
      color: typeof raw.color === 'string' && raw.color ? raw.color : CHART_COLORS[rows.length % CHART_COLORS.length],
    });
  }
  return rows;
}

/** 解析值域：负值入域；max 为正值上限；全零/退化时兜底扩展 */
function resolveDomain(rows, max) {
  let minV = 0;
  let maxV = 0;
  for (const row of rows) {
    if (row.value < minV) minV = row.value;
    if (row.value > maxV) maxV = row.value;
  }
  let hi = Number.isFinite(max) && max > 0 ? Math.max(max, maxV) : maxV;
  if (hi === 0) hi = 1; // 全零数据：保留可见刻度
  const lo = Math.min(minV, 0);
  if (lo === hi) { return [lo - 1, hi + 1]; }
  return [lo, hi];
}

/** 估宽：CJK 及全角字符按 11px，其余按 6.5px（字号 10 的保守估计） */
function estimateWidth(text) {
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) > 255 ? 11 : 6.5;
  return w;
}

/** 数字格式化：最多两位小数、去尾零、千分位；非法回退「—」 */
function formatNumber(n) {
  if (!Number.isFinite(n)) return '—';
  const neg = n < 0;
  const abs = Math.round(Math.abs(n) * 100) / 100;
  const parts = String(abs).split('.');
  let int = parts[0];
  let grouped = '';
  while (int.length > 3) {
    grouped = `,${int.slice(-3)}${grouped}`;
    int = int.slice(0, -3);
  }
  grouped = int + grouped;
  return `${neg ? '-' : ''}${grouped}${parts[1] ? `.${parts[1]}` : ''}`;
}

/** 尺寸防御：非有限或 ≤0 时回退默认值 */
function positive(v, fallback) {
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** 坐标取整到两位小数 */
function r2(n) {
  return Math.round(n * 100) / 100;
}
