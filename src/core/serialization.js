/**
 * core/serialization.js — 稳定序列化、哈希与克隆（任务书 2.5 / 1.5）
 *
 * 确定性要求：同一世界两次 JSON 序列化必须逐字节一致 —— 对象键始终排序；
 * undefined 与函数不得进入世界状态（由 invariant 拒绝）。
 */

/** 稳定字符串化：键排序、丢弃 undefined、数组保序 */
export function stableStringify(value) {
  const out = [];
  walk(value, out);
  return out.join('');
}

function walk(v, out) {
  if (v === undefined || typeof v === 'function') return; // 与 JSON 语义一致
  if (v === null || typeof v !== 'object') {
    out.push(JSON.stringify(v));
    return;
  }
  if (Array.isArray(v)) {
    out.push('[');
    for (let i = 0; i < v.length; i++) {
      if (i > 0) out.push(',');
      walk(v[i], out);
    }
    out.push(']');
    return;
  }
  out.push('{');
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  for (let i = 0; i < keys.length; i++) {
    if (i > 0) out.push(',');
    out.push(JSON.stringify(keys[i]), ':');
    walk(v[keys[i]], out);
  }
  out.push('}');
}

/** FNV-1a 32 位哈希 */
export function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
  }
  return h >>> 0;
}

/** 世界规范化哈希：确定性回归测试与存档校验共用 */
export function worldHash(world) {
  return hash32(stableStringify(world)).toString(16).padStart(8, '0');
}

/** 深克隆：优先结构化克隆（保留类型），退化 JSON */
export function deepClone(obj) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(obj);
    } catch {
      /* 含不可克隆对象时退化为 JSON */
    }
  }
  return JSON.parse(JSON.stringify(obj));
}

/** 反序列化世界（JSON 文本 → 对象），不做语义校验（校验由 invariant 负责） */
export function parseWorld(text) {
  return JSON.parse(text);
}
