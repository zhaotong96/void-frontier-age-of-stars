/**
 * core/math.js — 通用数学算子与数值边界防护（任务书 2.5 / 11.3）
 */

export const EPS = 1e-9;

/** 边界约束 */
export function clamp(v, min, max) {
  if (Number.isNaN(v)) return min;
  return v < min ? min : v > max ? max : v;
}

/** 安全除法：零/非有限分母返回 fallback */
export function safeDivide(a, b, fallback = 0) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b) < EPS) return fallback;
  const r = a / b;
  return Number.isFinite(r) ? r : fallback;
}

/** 线性插值 */
export function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

/** 角度归一化到 [0, 2π) */
export function normalizeAngle(theta) {
  const TAU = Math.PI * 2;
  let t = theta % TAU;
  if (t < 0) t += TAU;
  return t;
}

/** 角度差（有符号，[-π, π]） */
export function angleDelta(a, b) {
  const TAU = Math.PI * 2;
  let d = normalizeAngle(b - a);
  if (d > Math.PI) d -= TAU;
  return d;
}

/** 向量长度 */
export function vecLen(x, y) {
  return Math.hypot(x, y);
}

/** 两点距离 */
export function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

/** 两点距离平方（比较用，避免开方） */
export function dist2(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

/** 限速：把向量长度 clamp 到 maxLen */
export function clampVec(vx, vy, maxLen) {
  const l = Math.hypot(vx, vy);
  if (l <= maxLen || l < EPS) return [vx, vy];
  const k = maxLen / l;
  return [vx * k, vy * k];
}

/** 圆-圆相交 */
export function circleHit(ax, ay, ar, bx, by, br) {
  const r = ar + br;
  return dist2(ax, ay, bx, by) <= r * r;
}

/** 圆-矩形相交（矩形以中心+半宽高表示） */
export function circleRectHit(cx, cy, cr, rx, ry, hw, hh) {
  const nx = clamp(cx, rx - hw, rx + hw);
  const ny = clamp(cy, ry - hh, ry + hh);
  return dist2(cx, cy, nx, ny) <= cr * cr;
}

/** 调试期有限值断言：NaN/Infinity 直接抛出，禁止传播进世界状态 */
export function assertFinite(v, context) {
  if (!Number.isFinite(v)) {
    throw new Error(`assertFinite 失败 [${context}]: ${v}`);
  }
  return v;
}

/** 取整到安全整数边界 */
export function safeInt(v, fallback = 0) {
  if (!Number.isFinite(v)) return fallback;
  const i = Math.trunc(v);
  if (i > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
  if (i < Number.MIN_SAFE_INTEGER) return Number.MIN_SAFE_INTEGER;
  return i;
}

/** 非负整数取整（资源计量） */
export function nonNegInt(v, fallback = 0) {
  const i = safeInt(v, fallback);
  return i < 0 ? 0 : i;
}

/**
 * 稳定排序：对 arr 原地排序，比较器相同时按原下标稳定（现代 JS sort 已稳定，
 * 但显式 tie-break 更能表达确定性意图）。
 */
export function stableSortBy(arr, keyFn) {
  return arr
    .map((v, i) => [v, i])
    .sort((a, b) => {
      const ka = keyFn(a[0]);
      const kb = keyFn(b[0]);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      return a[1] - b[1];
    })
    .map((p) => p[0]);
}

/** 确定性对象键遍历：始终按 key 排序迭代，杜绝插入次序依赖 */
export function sortedKeys(obj) {
  return Object.keys(obj).sort();
}

/** 确定性对象值遍历 */
export function sortedValues(obj) {
  return sortedKeys(obj).map((k) => obj[k]);
}

/** 确定性对象键值遍历（回调 (key, value)） */
export function eachSorted(obj, fn) {
  for (const k of sortedKeys(obj)) fn(k, obj[k]);
}

/** 格式化大数字（显示层）：1234567 -> "1.23M" */
export function formatBig(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (abs >= 1e4) return (v / 1e3).toFixed(1) + 'K';
  return String(Math.round(v * 100) / 100);
}

/** 百分比显示 */
export function formatPct(v, digits = 0) {
  return (v * 100).toFixed(digits) + '%';
}
