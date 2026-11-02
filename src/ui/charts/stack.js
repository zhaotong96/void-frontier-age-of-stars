/**
 * ui/charts/stack.js — 堆叠横条（纯 SVG）
 *
 * stackBar({ parts, total, height }) → svg.vf-chart。
 *  - parts = [{ value, color?, label? }]，自左向右按值占比堆叠；
 *  - total 缺省时取各段之和；sum 超出 total 的部分按 viewBox 裁剪（不缩放已给占比）；
 *  - 每段挂 SVG <title> 子元素：hover 显示「label: value」；
 *  - 外层圆角经 clipPath 实现（clipId 由确定性自增序号生成，不使用随机数）；
 *  - 非法/负 value 按 0 计入并整次调用只 console.warn 一次；无有效数据时仅显示轨道底条。
 *
 * 用途：人口构成、账本构成等「部分对整体」展示。
 * 约定：全部节点经 createElementNS（复用 components/dom.js 的 svgEl），
 * 文本一律 textContent；顶层不触碰 document/window，可在 Node 侧安全 import。
 */

import { svgEl } from '../components/dom.js';
import { CHART_COLORS } from './svgChart.js';

/** 轨道底条（暗色主题回退值；CSS 类 vf-chart-* 可覆盖） */
const TRACK_COLOR = 'rgba(113, 131, 154, 0.16)';

/** viewBox 逻辑宽度（配合 preserveAspectRatio="none" 实现百分比伸缩） */
const VIEW_W = 1000;

/** clipPath 序号（模块级确定性自增，保证同文档内 id 唯一） */
let clipSeq = 0;

export function stackBar({ parts, total, height = 14 } = {}) {
  const h = Number.isFinite(height) && height > 0 ? height : 14;

  // —— 数据防御：非法/负值按 0 处理（整次调用只 warn 一次） ——
  const invalid = { count: 0 };
  const norm = normalizeParts(parts, invalid);
  if (invalid.count > 0) {
    console.warn(`[vf-chart] stackBar: 检测到 ${invalid.count} 个非法/负值分段，已按 0 处理`);
  }
  const sum = norm.reduce((acc, p) => acc + p.value, 0);
  const denom = Number.isFinite(Number(total)) && Number(total) > 0 ? Number(total) : sum;

  const clipId = `vf-stack-clip-${clipSeq + 1}`;
  clipSeq += 1;

  const svg = svgEl('svg', {
    class: 'vf-chart vf-chart-stack',
    viewBox: `0 0 ${VIEW_W} ${h}`,
    width: '100%',
    height: h,
    role: 'img',
    preserveAspectRatio: 'none',
    'aria-label': norm.length
      ? `构成：${norm.map((p) => `${p.label || '未命名'} ${formatNumber(p.value)}`).join('，')}`
      : '暂无数据',
  });

  // —— 圆角裁剪：整体条形四角圆滑 ——
  svg.appendChild(svgEl('defs', null, [
    svgEl('clipPath', { id: clipId }, [
      svgEl('rect', { x: 0, y: 0, width: VIEW_W, height: h, rx: Math.min(4, h / 2), ry: Math.min(4, h / 2) }),
    ]),
  ]));

  const body = svgEl('g', { class: 'vf-chart-stack-body', 'clip-path': `url(#${clipId})` });
  // 轨道底条：分段不足/为空时仍有可见容器
  body.appendChild(svgEl('rect', {
    class: 'vf-chart-stack-track',
    x: 0, y: 0, width: VIEW_W, height: h,
    fill: TRACK_COLOR,
  }));

  if (denom > 0) {
    let cursor = 0;
    for (const part of norm) {
      const width = (part.value / denom) * VIEW_W;
      if (width <= 0) continue; // 零宽分段跳过（非数据错误）
      const rect = svgEl('rect', {
        class: 'vf-chart-stack-seg',
        x: r2(cursor), y: 0, width: r2(width), height: h,
        fill: part.color,
      });
      rect.appendChild(svgEl('title', { text: `${part.label || '未命名'}: ${formatNumber(part.value)}` }));
      body.appendChild(rect);
      cursor += width;
      if (cursor >= VIEW_W) break; // 超出部分由 clipPath 兜底，停止绘制
    }
  }

  svg.appendChild(body);
  return svg;
}

/* ------------------------------------------------------------------ */
/* 内部工具（仅本文件使用）                                            */
/* ------------------------------------------------------------------ */

/** 归一化 parts：value 非有限或 <0 记为 0 并计数；color 缺省按色板循环 */
function normalizeParts(parts, invalid) {
  const list = Array.isArray(parts) ? parts : [];
  const norm = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') { invalid.count += 1; continue; }
    let value = Number(raw.value);
    if (!Number.isFinite(value) || value < 0) {
      invalid.count += 1;
      value = 0;
    }
    norm.push({
      value,
      color: typeof raw.color === 'string' && raw.color ? raw.color : CHART_COLORS[norm.length % CHART_COLORS.length],
      label: raw.label != null ? String(raw.label) : '',
    });
  }
  return norm;
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

/** 坐标取整到两位小数 */
function r2(n) {
  return Math.round(n * 100) / 100;
}
