/**
 * ui/charts/gauge.js — 半环仪表盘（纯 SVG）
 *
 * gauge({ value, max, label, danger, warn, width, height, fluid }) → svg.vf-chart。
 *  - 半环自左（180°）经顶到右（360°）：底层轨道弧 + 数值进度弧；
 *  - 颜色分档：ratio < warn → 青（#4fd8e8）、warn ≤ ratio < danger → 琥珀（#e8b04f）、
 *    ratio ≥ danger 或 value 超 max → 红（#e85f5f）；ratio = value/max（钳制 0–1 后参与绘制）；
 *  - 中央大数字显示 value（非法按 0 处理并 warn 一次），label 显示于其下；
 *  - 用于威胁等级 / 稳定度等单值指标。
 *
 * 约定：全部节点经 createElementNS（复用 components/dom.js 的 svgEl），
 * 文本一律 textContent；弧线路径由极坐标计算生成（无三角函数库依赖）；
 * 顶层不触碰 document/window，可在 Node 侧安全 import。
 */

import { svgEl } from '../components/dom.js';

/** 状态色（与默认色板/主题对齐：青 / 琥珀 / 红） */
const COLOR_CYAN = '#4fd8e8';
const COLOR_AMBER = '#e8b04f';
const COLOR_RED = '#e85f5f';
const TRACK_COLOR = 'rgba(113, 131, 154, 0.25)';
const TEXT_MAIN = '#c9d6e3';
const TEXT_DIM = '#71839a';

const DEFAULT_WARN = 0.6;
const DEFAULT_DANGER = 0.8;
const STROKE_W = 9;

export function gauge({
  value,
  max,
  label,
  danger = DEFAULT_DANGER,
  warn = DEFAULT_WARN,
  width = 160,
  height = 96,
  fluid = false,
} = {}) {
  const w = positive(width, 160);
  const h = positive(height, 96);

  // —— 数据防御：value 非法按 0；max 非法/≤0 时比值按 0 ——
  const invalid = { count: 0 };
  const v = toFinite(value, 0, invalid);
  const m = toFinite(max, NaN, invalid);
  if (invalid.count > 0) {
    console.warn(`[vf-chart] gauge: value/max 含非法数值（NaN/undefined），已按安全值处理`);
  }
  const ratio = Number.isFinite(m) && m > 0 ? v / m : 0;
  const over = Number.isFinite(m) && m > 0 && v > m;
  const t = Math.min(1, Math.max(0, ratio));

  // —— 阈值防御：非法回退默认；warn 高于 danger 时对调 ——
  let dLim = Number.isFinite(danger) ? Math.min(1, Math.max(0, danger)) : DEFAULT_DANGER;
  let wLim = Number.isFinite(warn) ? Math.min(1, Math.max(0, warn)) : DEFAULT_WARN;
  if (wLim > dLim) { const tmp = wLim; wLim = dLim; dLim = tmp; }

  const color = over || ratio >= dLim ? COLOR_RED : ratio >= wLim ? COLOR_AMBER : COLOR_CYAN;

  // —— 几何：圆心在底部中线，半径受宽高约束 ——
  const cx = w / 2;
  const cy = h - 6;
  const r = Math.max(10, Math.min(w / 2 - 12, cy - 22));

  const svg = svgEl('svg', {
    class: 'vf-chart vf-chart-gauge',
    viewBox: `0 0 ${w} ${h}`,
    width: fluid ? '100%' : w,
    height: h,
    role: 'img',
    preserveAspectRatio: 'xMidYMid meet',
  });
  svg.appendChild(svgEl('title', {
    text: `${label != null ? String(label) : '数值'}：${formatNumber(v)}${Number.isFinite(m) && m > 0 ? ` / ${formatNumber(m)}` : ''}${over ? '（超出上限）' : ''}`,
  }));

  // —— 轨道弧（完整半环） ——
  svg.appendChild(svgEl('path', {
    class: 'vf-chart-gauge-track',
    d: arcPath(cx, cy, r, 180, 360),
    fill: 'none',
    stroke: TRACK_COLOR,
    'stroke-width': STROKE_W,
    'stroke-linecap': 'round',
  }));

  // —— 数值弧（t>0 时绘制，颜色随分档） ——
  if (t > 0) {
    svg.appendChild(svgEl('path', {
      class: 'vf-chart-gauge-fill',
      d: arcPath(cx, cy, r, 180, 180 + 180 * t),
      fill: 'none',
      stroke: color,
      'stroke-width': STROKE_W,
      'stroke-linecap': 'round',
    }));
  }

  // —— 中央数值与标签 ——
  svg.appendChild(svgEl('text', {
    class: 'vf-chart-gauge-value',
    x: r2(cx), y: r2(cy - 8),
    'font-size': 20, fill: TEXT_MAIN, 'text-anchor': 'middle', 'font-weight': 600,
    text: formatNumber(v),
  }));
  if (label != null) {
    svg.appendChild(svgEl('text', {
      class: 'vf-chart-gauge-label',
      x: r2(cx), y: r2(cy + 8),
      'font-size': 10, fill: TEXT_DIM, 'text-anchor': 'middle',
      text: String(label),
    }));
  }
  return svg;
}

/* ------------------------------------------------------------------ */
/* 内部工具（仅本文件使用）                                            */
/* ------------------------------------------------------------------ */

/** 半环弧路径：startAngle/endAngle 单位为度（180=左端，270=顶部，360=右端） */
function arcPath(cx, cy, r, startDeg, endDeg) {
  const [x1, y1] = polar(cx, cy, r, startDeg);
  const [x2, y2] = polar(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  // sweep=1：屏幕坐标下自左端经顶部到右端的顺时针方向
  return `M ${r2(x1)} ${r2(y1)} A ${r2(r)} ${r2(r)} 0 ${largeArc} 1 ${r2(x2)} ${r2(y2)}`;
}

/** 极坐标转笛卡尔（SVG y 轴向下，角度增加即顺时针） */
function polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/** 数值防御：有限数原样返回；null/undefined 视为未提供（静默回退）；
 *  其余非法值（NaN/非数值）回退 fallback 并计数（整次调用只 warn 一次） */
function toFinite(v, fallback, invalid) {
  if (v == null) return fallback;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  invalid.count += 1;
  return fallback;
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
