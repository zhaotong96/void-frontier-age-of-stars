/**
 * ui/charts/svgChart.js — 折线图与迷你趋势线（纯 SVG，零依赖渲染）
 *
 * lineChart({ series, width, height, yMin, yMax, xLabels, colors, title, fluid }) → svg.vf-chart
 *  - series = [{ name, points:[number...], color? }]；points 为等间隔采样值；
 *  - Y 域自动收敛自全部合法点，yMin/yMax 显式传入时覆盖对应侧；
 *  - 网格线固定 3 条（水平），图例 = 色点 + name，自动按宽度换行；
 *  - 无任何合法数据时居中显示「暂无数据」；
 *  - 末点绘制小圆（vf-chart-enddot）；非法点（NaN/undefined/非数值）跳过并整次调用只 console.warn 一次。
 *
 * sparkline({ points, color, width, height, fluid }) → svg.vf-chart-sparkline
 *  - 迷你折线：无坐标轴/网格，仅归一化折线 + 末点小圆。
 *
 * 约定：全部节点经 createElementNS（复用 components/dom.js 的 svgEl/el），
 * 文本一律 textContent，禁止 innerHTML 拼接；顶层不触碰 document/window，
 * 可在 Node 侧安全 import；本文件同时导出默认色板 CHART_COLORS 供其它图表复用。
 */

import { el, svgEl } from '../components/dom.js';

/** 默认系列色板（与主题 accent/warn/danger 对齐），按序循环取用 */
export const CHART_COLORS = ['#4fd8e8', '#7ea8ff', '#62d98a', '#e8b04f', '#e85f5f', '#b48ce8'];

/** 结构性配色（暗色主题回退值；CSS 类 vf-chart-* 可覆盖） */
const GRID_COLOR = 'rgba(113, 131, 154, 0.22)';
const AXIS_COLOR = 'rgba(113, 131, 154, 0.45)';
const TEXT_DIM = '#71839a';
const TEXT_MAIN = '#c9d6e3';

/** 网格线固定条数 */
const GRID_LINES = 3;

/**
 * 折线图：多系列等间隔曲线。
 * @returns {SVGElement} class 含 "vf-chart"
 */
export function lineChart({
  series,
  width = 320,
  height = 120,
  yMin,
  yMax,
  xLabels,
  colors,
  title,
  fluid = false,
} = {}) {
  const w = positive(width, 320);
  const h = positive(height, 120);
  const palette = Array.isArray(colors) && colors.length ? colors : CHART_COLORS;

  // —— 数据防御：归一化系列，统计非法点（整次调用只 warn 一次）——
  const invalid = { count: 0 };
  const norm = normalizeSeries(series, invalid);
  const hasData = norm.some((s) => s.runs.length > 0);
  if (invalid.count > 0) {
    console.warn(`[vf-chart] lineChart: 检测到 ${invalid.count} 个非法数据点（NaN/undefined），已跳过`);
  }

  // —— 布局：标题 / X 轴标签 / 图例的预留高度 ——
  const padL = 34;
  const padR = 10;
  const padT = title != null ? 20 : 10;
  const padB = Array.isArray(xLabels) && xLabels.length ? 18 : 10;
  const legendRows = buildLegendRows(norm, w);
  const legendH = legendRows.length > 0 ? legendRows.length * 14 + 2 : 0;
  const plotX = padL;
  const plotY = padT;
  const plotW = Math.max(10, w - padL - padR);
  const plotH = Math.max(20, h - padT - padB - legendH);

  const svg = svgEl('svg', {
    class: 'vf-chart vf-chart-line',
    viewBox: `0 0 ${w} ${h}`,
    width: fluid ? '100%' : w,
    height: h,
    role: 'img',
    preserveAspectRatio: 'xMidYMid meet',
  });
  if (title != null) {
    svg.appendChild(svgEl('text', {
      class: 'vf-chart-title', x: 4, y: 13,
      'font-size': 11, fill: TEXT_MAIN, 'text-anchor': 'start',
      text: String(title),
    }));
  }

  if (!hasData) {
    // 空数据安全显示：网格仍给出坐标感（不显示刻度值），居中提示「暂无数据」
    appendGrid(svg, plotX, plotY, plotW, plotH, [0, 1], false);
    svg.appendChild(svgEl('text', {
      class: 'vf-chart-empty',
      x: w / 2, y: plotY + plotH / 2,
      'font-size': 12, fill: TEXT_DIM, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
      text: '暂无数据',
    }));
    appendLegend(svg, legendRows, h - legendH + 2);
    return svg;
  }

  // —— Y 域：全部合法点收敛，yMin/yMax 显式覆盖对应侧 ——
  const allValues = [];
  for (const s of norm) for (const run of s.runs) for (const [, v] of run) allValues.push(v);
  const [lo, hi] = resolveDomain(allValues, yMin, yMax);

  const yOf = (v) => plotY + (1 - (v - lo) / (hi - lo)) * plotH;
  const xOf = (i, n) => plotX + (n <= 1 ? 0 : (i / (n - 1)) * plotW);

  appendGrid(svg, plotX, plotY, plotW, plotH, [lo, hi]);

  // —— X 轴标签：最多 6 个等距锚点（首 start / 尾 end / 中间 middle）——
  if (Array.isArray(xLabels) && xLabels.length) {
    appendXLabels(svg, xLabels, plotX, plotY + plotH, plotW);
  }

  // —— 折线：合法点按连续段绘制，断点处分段 ——
  for (let si = 0; si < norm.length; si++) {
    const s = norm[si];
    const color = s.color || palette[si % palette.length];
    const n = s.length;
    for (const run of s.runs) {
      if (run.length >= 2) {
        svg.appendChild(svgEl('polyline', {
          class: 'vf-chart-line-series',
          points: run.map(([i, v]) => `${r2(xOf(i, n))},${r2(yOf(v))}`).join(' '),
          fill: 'none',
          stroke: color,
          'stroke-width': 1.6,
          'stroke-linejoin': 'round',
          'stroke-linecap': 'round',
        }));
      }
    }
    // 末点小圆：取该系列最后一个合法点
    const lastRun = s.runs[s.runs.length - 1];
    if (lastRun && lastRun.length) {
      const [li, lv] = lastRun[lastRun.length - 1];
      svg.appendChild(svgEl('circle', {
        class: 'vf-chart-enddot',
        cx: r2(xOf(li, n)), cy: r2(yOf(lv)), r: 2.6,
        fill: color,
      }));
    }
  }

  appendLegend(svg, legendRows, h - legendH + 2);
  return svg;
}

/**
 * 迷你趋势线：单系列折线，无轴无网格。
 * @returns {SVGElement}
 */
export function sparkline({ points, color, width = 80, height = 24, fluid = false } = {}) {
  const w = positive(width, 80);
  const h = positive(height, 24);
  const stroke = typeof color === 'string' ? color : CHART_COLORS[0];

  const svg = svgEl('svg', {
    class: 'vf-chart vf-chart-sparkline',
    viewBox: `0 0 ${w} ${h}`,
    width: fluid ? '100%' : w,
    height: h,
    role: 'img',
    preserveAspectRatio: 'xMidYMid meet',
  });

  const invalid = { count: 0 };
  const runs = finiteRuns(Array.isArray(points) ? points : [], invalid);
  if (invalid.count > 0) {
    console.warn(`[vf-chart] sparkline: 检测到 ${invalid.count} 个非法数据点（NaN/undefined），已跳过`);
  }
  const flat = runs.flat();
  if (!flat.length) return svg; // 空数据：安全返回空白迷你图

  const values = flat.map(([, v]) => v);
  const [lo, hi] = resolveDomain(values, undefined, undefined);
  const pad = 2.5;
  const xOf = (i) => pad + (flat.length <= 1 ? 0 : (i / (flat.length - 1)) * (w - pad * 2));
  const yOf = (v) => pad + (1 - (v - lo) / (hi - lo)) * (h - pad * 2);

  // 迷你图按压缩后的全局序号布点（断点处不保留空档）
  let offset = 0;
  for (const run of runs) {
    if (run.length >= 2) {
      svg.appendChild(svgEl('polyline', {
        class: 'vf-chart-spark-line',
        points: run.map(([, v], k) => `${r2(xOf(offset + k))},${r2(yOf(v))}`).join(' '),
        fill: 'none',
        stroke,
        'stroke-width': 1.4,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      }));
    }
    offset += run.length;
  }
  const lastValue = values[values.length - 1];
  svg.appendChild(svgEl('circle', {
    class: 'vf-chart-enddot',
    cx: r2(xOf(offset - 1)), cy: r2(yOf(lastValue)), r: 1.9,
    fill: stroke,
  }));
  return svg;
}

/* ------------------------------------------------------------------ */
/* 内部工具（仅本文件使用）                                            */
/* ------------------------------------------------------------------ */

/** 归一化 series：过滤非法项，拆分连续合法段；invalid.count 累计非法点数 */
function normalizeSeries(series, invalid) {
  const list = Array.isArray(series) ? series : [];
  const norm = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const name = raw.name != null ? String(raw.name) : '';
    const color = typeof raw.color === 'string' ? raw.color : '';
    const pts = Array.isArray(raw.points) ? raw.points : [];
    norm.push({ name, color, length: pts.length, runs: finiteRuns(pts, invalid) });
  }
  return norm;
}

/** 拆分连续合法段：[[index, value], ...][]；非法点计入 invalid.count */
function finiteRuns(points, invalid) {
  const runs = [];
  let cur = [];
  for (let i = 0; i < points.length; i++) {
    const v = Number(points[i]);
    if (Number.isFinite(v)) {
      cur.push([i, v]);
    } else {
      invalid.count += 1;
      if (cur.length) { runs.push(cur); cur = []; }
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/** 解析 Y 域：显式 yMin/yMax 优先；自动侧加 8% 余量；退化域（lo===hi）对称扩展 */
function resolveDomain(values, yMin, yMax) {
  let lo = Number.isFinite(yMin) ? yMin : null;
  let hi = Number.isFinite(yMax) ? yMax : null;
  if (lo == null || hi == null) {
    let dMin = Infinity;
    let dMax = -Infinity;
    for (const v of values) {
      if (v < dMin) dMin = v;
      if (v > dMax) dMax = v;
    }
    if (dMin === Infinity) { dMin = 0; dMax = 1; } // 空值兜底，不参与绘制
    if (lo == null) lo = dMin - domainPad(dMin, dMax);
    if (hi == null) hi = dMax + domainPad(dMin, dMax);
  }
  if (lo > hi) { const t = lo; lo = hi; hi = t; }
  if (lo === hi) { lo -= 1; hi += 1; }
  return [lo, hi];
}

/** 域余量：跨度的 8%；零跨度时回退到量级的 10% 或 1 */
function domainPad(dMin, dMax) {
  const span = dMax - dMin;
  if (span > 0) return span * 0.08;
  const mag = Math.max(Math.abs(dMin), Math.abs(dMax));
  return mag > 0 ? mag * 0.1 : 1;
}

/** 3 条水平网格线 + 左侧对应刻度值（showValues=false 时仅画线） */
function appendGrid(svg, x, y, w, h, [lo, hi], showValues = true) {
  for (let k = 1; k <= GRID_LINES; k++) {
    const gy = r2(y + (k / (GRID_LINES + 1)) * h);
    svg.appendChild(svgEl('line', {
      class: 'vf-chart-grid',
      x1: r2(x), y1: gy, x2: r2(x + w), y2: gy,
      stroke: GRID_COLOR, 'stroke-width': 1,
    }));
    if (!showValues) continue;
    const val = hi - (k / (GRID_LINES + 1)) * (hi - lo);
    svg.appendChild(svgEl('text', {
      class: 'vf-chart-tick',
      x: x - 5, y: gy + 3,
      'font-size': 9, fill: TEXT_DIM, 'text-anchor': 'end',
      text: formatNumber(val),
    }));
  }
  // 底部基线，增强坐标感
  svg.appendChild(svgEl('line', {
    class: 'vf-chart-axis',
    x1: r2(x), y1: r2(y + h), x2: r2(x + w), y2: r2(y + h),
    stroke: AXIS_COLOR, 'stroke-width': 1,
  }));
}

/** X 轴标签：最多 6 个等距采样，首尾分别左对齐/右对齐避免溢出 */
function appendXLabels(svg, labels, plotX, baseY, plotW) {
  const n = labels.length;
  const slots = Math.min(n, 6);
  const picked = new Set();
  for (let k = 0; k < slots; k++) {
    picked.add(Math.round((k / (slots - 1 || 1)) * (n - 1)));
  }
  let prev = -1;
  for (const idx of [...picked].sort((a, b) => a - b)) {
    if (idx === prev) continue; // 去重（n 较小时端点重合）
    prev = idx;
    const anchor = idx === 0 ? 'start' : idx === n - 1 ? 'end' : 'middle';
    const lx = idx === 0 ? plotX : idx === n - 1 ? plotX + plotW : plotX + (idx / (n - 1)) * plotW;
    svg.appendChild(svgEl('text', {
      class: 'vf-chart-xlabel',
      x: r2(lx), y: r2(baseY + 13),
      'font-size': 9, fill: TEXT_DIM, 'text-anchor': anchor,
      text: String(labels[idx]),
    }));
  }
}

/** 图例行贪心换行：估算项宽（CJK 11px/字、拉丁 6.5px/字 + 色点 14px） */
function buildLegendRows(norm, totalW) {
  const items = norm.filter((s) => s.name);
  if (!items.length) return [];
  const rows = [];
  let row = [];
  let acc = 0;
  for (const s of items) {
    const name = s.name;
    let textW = 0;
    for (const ch of name) textW += ch.charCodeAt(0) > 255 ? 11 : 6.5;
    const itemW = 14 + textW + 8;
    if (row.length && acc + itemW > totalW - 8) {
      rows.push(row);
      row = [];
      acc = 0;
    }
    row.push({ name, color: s.color });
    acc += itemW;
  }
  if (row.length) rows.push(row);
  return rows;
}

/** 渲染图例（色点 + 名称），topY 为首行基线起点 */
function appendLegend(svg, rows, topY) {
  rows.forEach((row, r) => {
    let x = 6;
    for (const item of row) {
      svg.appendChild(svgEl('circle', {
        class: 'vf-chart-legend-dot',
        cx: r2(x), cy: r2(topY + r * 14 + 4), r: 3.5,
        fill: item.color || CHART_COLORS[0],
      }));
      x += 10;
      svg.appendChild(svgEl('text', {
        class: 'vf-chart-legend-text',
        x: r2(x), y: r2(topY + r * 14 + 7),
        'font-size': 10, fill: TEXT_DIM,
        text: item.name,
      }));
      let textW = 0;
      for (const ch of item.name) textW += ch.charCodeAt(0) > 255 ? 11 : 6.5;
      x += textW + 8;
    }
  });
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

/** 坐标取整到两位小数，保持标记可读 */
function r2(n) {
  return Math.round(n * 100) / 100;
}
